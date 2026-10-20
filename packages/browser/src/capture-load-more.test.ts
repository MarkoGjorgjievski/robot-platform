// Spec 2026-10-20 §3.7, §5.3: a listing reader loads more of the page before it is read, bounded.
// Served pages, real Chromium: a grid that grows when scrolled, a "Load more" button, a "Load more"
// that is a real link (never followed), a button that pushes `?page=2` (same document, kept), a
// page that grows forever (three rounds at most), a page that never grows (two quiet rounds), a
// "Load more" that is also a variant swatch (never clicked), a click that navigates away (the page
// is returned to), and a page slow enough that the ten-second time budget cuts it short.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { PlaywrightBrowser } from './playwright-browser.js';
import { LOAD_MORE_MAX_ROUNDS, LOAD_MORE_QUIET_ROUNDS } from './load-more.js';

const TEXT = '<p>Every item ships free, returns are easy for thirty days, and our team answers every question within a day of asking.</p>';
const card = (n: number, height = 300) => `<div class="card" style="height:${height}px"><a class="p" href="/p/${n}">Item ${n}</a></div>`;
const cards = (from: number, n: number, height = 300) => Array.from({ length: n }, (_, i) => card(from + i, height)).join('');
/** A listing page; its script can call `add(n)` to append n more cards. */
const listing = (body: string, js: string) => `<!doctype html><html><head><title>Listing</title></head><body>${body}${TEXT}<script>
  const grid = document.getElementById('grid');
  let next = grid.children.length + 1;
  function add(n) { for (let i = 0; i < n; i++, next++) { const d = document.createElement('div'); d.className = 'card'; d.style.height = '300px'; d.innerHTML = '<a class="p" href="/p/' + next + '">Item ' + next + '</a>'; grid.appendChild(d); } }
  ${js}
</script></body></html>`;
const AT_BOTTOM = 'scrollY + innerHeight >= document.documentElement.scrollHeight - 50';

const PAGES: Record<string, string> = {
  '/grow': listing(`<div id="grid">${cards(1, 6)}</div>`, `let batches = 0; addEventListener('scroll', () => { if (batches < 2 && ${AT_BOTTOM}) { batches++; add(6); } });`),
  '/button': listing(`<div id="grid">${cards(1, 4)}</div><button id="more">Load more</button>`, `let clicks = 0; document.getElementById('more').addEventListener('click', () => { clicks++; add(4); if (clicks >= 3) document.getElementById('more').remove(); });`),
  '/link': listing(`<div id="grid">${cards(1, 4)}</div><a id="more" href="/elsewhere">Load more</a>`, ''),
  '/push': listing(`<div id="grid">${cards(1, 4)}</div><button id="more">Load more</button>`, `document.getElementById('more').addEventListener('click', () => { add(4); history.pushState({}, '', '?page=2'); });`),
  '/endless': listing(`<div id="grid">${cards(1, 6)}</div>`, `addEventListener('scroll', () => { if (${AT_BOTTOM}) add(2); });`),
  '/static': listing(`<div id="grid">${cards(1, 6)}</div>`, ''),
  '/variant-more': listing(`<div id="grid">${cards(1, 4)}</div><div class="swatches"><button id="more" class="swatch">Load more</button></div>`, `document.getElementById('more').addEventListener('click', () => { add(4); });`),
  '/navaway': listing(`<div id="grid">${cards(1, 4)}</div><button id="more">Load more</button>`, `document.getElementById('more').addEventListener('click', () => { location.href = '/elsewhere'; });`),
  // Tall enough that a step scroll always runs its full 30 steps (step = 0.9 * 800px window =
  // 720px; 30 * 720 = 21,600px), so each round costs ~3.7s of scrolling plus two 1s settles
  // (scroll, then click) — about 5.7s/round. Two rounds (~11.4s) clear the ~10s budget; a third
  // never starts, though LOAD_MORE_MAX_ROUNDS and `rounds` would both still allow it.
  '/budget': listing(`<div id="grid">${cards(1, 100, 300)}</div><button id="more">Load more</button>`, `document.getElementById('more').addEventListener('click', () => { add(1); });`),
};

/** The probe: how many product links the page holds. `count` turns it into a number. */
const COUNT = `(() => document.querySelectorAll('a.p').length)()`;

let server: http.Server;
let base: string;
let browser: PlaywrightBrowser;
const requests: string[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    requests.push(req.url ?? '/');
    const html = PAGES[(req.url ?? '/').split('?')[0]!];
    if (!html) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('no such page'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = new PlaywrightBrowser();
  await browser.launch({ headless: true });
}, 60_000);

afterAll(async () => {
  await browser?.close();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function read(path: string, loadMore?: { rounds: number; enough: number }) {
  const count = vi.fn((v: unknown) => Number(v));
  const capture = await browser.capture(`${base}${path}`, {
    waitUntil: 'load', interceptNetworkRequests: false, maxTiles: 1, annotate: COUNT,
    ...(loadMore ? { loadMore: { ...loadMore, probe: COUNT, count } } : {}),
  });
  return { capture, links: Number(capture.annotation), probes: count.mock.calls.length };
}

describe('capture loadMore (spec 2026-10-20 §3.7)', () => {
  it('without it, a lazy grid is read as it first loaded', async () => {
    expect((await read('/grow')).links).toBe(6);
  }, 60_000);

  it('scrolls a lazy grid until it stops growing, and the page is read after loading', async () => {
    const r = await read('/grow', { rounds: 3, enough: 100 });
    expect(r.links).toBe(18);
    expect(r.capture.html).toContain('href="/p/18"');
  }, 60_000);

  it('clicks a "Load more" button', async () => {
    expect((await read('/button', { rounds: 3, enough: 100 })).links).toBe(16);
  }, 60_000);

  it('never follows a "Load more" that is a real link', async () => {
    requests.length = 0;
    const r = await read('/link', { rounds: 3, enough: 100 });
    expect(requests).not.toContain('/elsewhere');
    expect(new URL(r.capture.url).pathname).toBe('/link');
    expect(r.links).toBe(4);
  }, 60_000);

  it('keeps what a button loaded when it only pushes ?page=2 (same document)', async () => {
    expect((await read('/push', { rounds: 3, enough: 100 })).links).toBeGreaterThanOrEqual(8);
  }, 60_000);

  it('runs at most three rounds, whatever it is asked, on a page that grows forever', async () => {
    const r = await read('/endless', { rounds: 10, enough: 100_000 });
    expect(LOAD_MORE_MAX_ROUNDS).toBe(3);
    expect(r.probes).toBe(1 + LOAD_MORE_MAX_ROUNDS); // once before the first round, once after each
    expect(r.links).toBeGreaterThan(6);
  }, 90_000);

  it('stops after two rounds that add nothing', async () => {
    const r = await read('/static', { rounds: 3, enough: 100 });
    expect(r.probes).toBe(1 + LOAD_MORE_QUIET_ROUNDS);
    expect(r.links).toBe(6);
  }, 60_000);

  it('does not scroll at all when the page already holds enough', async () => {
    const r = await read('/grow', { rounds: 3, enough: 6 });
    expect(r.probes).toBe(1);
    expect(r.links).toBe(6);
  }, 60_000);

  it('never clicks a "load more" that is also a variant control (a swatch)', async () => {
    // The button's own text and position satisfy findLoadMore; only the swatch class should stop it.
    const r = await read('/variant-more', { rounds: 3, enough: 100 });
    expect(r.probes).toBe(1 + LOAD_MORE_QUIET_ROUNDS); // never grows: two quiet rounds end it
    expect(r.links).toBe(4);
  }, 60_000);

  it('returns to the page when a round navigates away, and reads it as it first loaded', async () => {
    const r = await read('/navaway', { rounds: 3, enough: 100 });
    expect(new URL(r.capture.url).pathname).toBe('/navaway');
    expect(r.links).toBe(4);
  }, 60_000);

  it('stops within about ten seconds, whatever rounds and LOAD_MORE_MAX_ROUNDS would allow', async () => {
    const r = await read('/budget', { rounds: 10, enough: 1_000_000 });
    // Each round that does run costs ~5.7s at best (a full 30-step scroll plus two 1s settles) —
    // more under load, never less — so the budget lets at most two of the three rounds
    // `rounds`/LOAD_MORE_MAX_ROUNDS would allow start: no more than 3 probes (initial + 2 rounds),
    // not 4. Asserted on rounds, not wall time, so a busy machine cannot fail it (final review M3);
    // the budget's own timing is pinned with a fake clock in load-more-budget.test.ts.
    expect(r.probes).toBeGreaterThanOrEqual(2);
    expect(r.probes).toBeLessThan(1 + LOAD_MORE_MAX_ROUNDS);
  }, 60_000);
});
