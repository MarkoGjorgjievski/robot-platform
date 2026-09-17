// Verification waits for the customer's expected values, not for the page to go quiet.
//
// Two things make that different from a certified run's ready check
// (capture-ready.test.ts), and both are pinned here against a local page that,
// like Ikea, never reaches networkidle:
//
// 1. `when: 'after-expand'`. Verification sees the page AFTER the popup and
//    "show more" rounds, and some values only exist in the DOM once those have
//    run. A check polled right after navigation would wait out its whole
//    deadline for a value that the capture itself is about to reveal.
//
// 2. The grace period. A value can show in the visible page a moment before
//    the API response carrying it lands. Capturing in that gap would certify
//    a page path where an API path, the better one, was available, and could
//    differ from one proof page to the next. So once ready, the capture waits
//    until no new response has arrived for `graceQuietMs`, capped at
//    `graceMaxMs`.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { PlaywrightBrowser } from './playwright-browser.js';
import type { ReadySnapshot } from './types.js';

const LATE_API_DELAY_MS = 500;

function pageHtml(): string {
  return `<!doctype html><html><head><title>Hidden price</title></head><body>
    <main id="main"><h1>Widget</h1>
      <button id="more" type="button">Show more</button>
      <div id="price"></div>
    </main>
    <script>
      // Keeps the network busy for as long as the server holds it open: networkidle never fires.
      fetch('/long-poll').catch(() => {});
      document.getElementById('more').addEventListener('click', () => {
        document.getElementById('price').textContent = '$12.50';
      });
    </script>
  </body></html>`;
}

const PRICE_PROBE = `(() => ({ price: (document.getElementById('price')?.textContent ?? '').trim() || null }))()`;
const priceReady = (s: ReadySnapshot) => (s.probe as { price: string | null } | null)?.price != null;

// The same probe, but the moment it first SEES the price it starts the request
// whose response carries that value: the response is then in flight exactly
// when the check passes, which is the gap the grace period exists for. (Firing
// it from the click would not do: the expand round pauses after clicking, and
// the response would have landed before the poll even began.)
const PRICE_PROBE_FIRING_LATE_API = `(() => {
  const price = (document.getElementById('price')?.textContent ?? '').trim() || null;
  if (price && !window.__lateFired) { window.__lateFired = true; fetch('/api/late').then((r) => r.json()).catch(() => {}); }
  return { price };
})()`;

let server: http.Server;
let baseUrl: string;
let browser: PlaywrightBrowser;
const pending: http.ServerResponse[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url?.startsWith('/long-poll')) { pending.push(res); return; } // held open on purpose
    if (req.url?.startsWith('/api/late')) {
      setTimeout(() => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ item: { price: 12.5, name: 'Widget', sku: 'W-1', inStock: true } })); }, LATE_API_DELAY_MS);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(pageHtml());
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
  browser = new PlaywrightBrowser();
  await browser.launch({ headless: true });
});

afterAll(async () => {
  await browser.close();
  for (const res of pending) res.end();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('PlaywrightBrowser.capture — ready check polled after the expand round', () => {
  it('polled right after navigation, a value hidden behind "Show more" is never seen: the check times out', async () => {
    const capture = await browser.capture(`${baseUrl}/p/1`, {
      waitUntil: 'load', interceptNetworkRequests: true,
      ready: { script: PRICE_PROBE, isReady: priceReady, timeoutMs: 600, settleTimeoutMs: 300 },
    });
    expect(capture.timings?.readyState).toBe('timeout');
    // The capture's own expand round reveals it afterwards, which is exactly why polling earlier was pointless.
    expect(capture.html).toContain('$12.50');
  }, 40_000);

  it("`when: 'after-expand'` polls once the capture has clicked it open, and is ready at once", async () => {
    const capture = await browser.capture(`${baseUrl}/p/2`, {
      waitUntil: 'load', interceptNetworkRequests: true,
      ready: { script: PRICE_PROBE, isReady: priceReady, when: 'after-expand', timeoutMs: 8_000, settleTimeoutMs: 300 },
    });
    expect(capture.timings?.readyState).toBe('ready');
    expect(capture.timings!.readyMs!).toBeLessThan(2_000);
    expect(capture.html).toContain('$12.50');
  }, 40_000);

  it('the grace period holds the capture until the late API response has landed', async () => {
    const capture = await browser.capture(`${baseUrl}/p/3`, {
      waitUntil: 'load', interceptNetworkRequests: true,
      ready: { script: PRICE_PROBE_FIRING_LATE_API, isReady: priceReady, when: 'after-expand', timeoutMs: 8_000, settleTimeoutMs: 300, graceQuietMs: 750, graceMaxMs: 3_000 },
    });
    expect(capture.timings?.readyState).toBe('ready');
    expect(capture.interceptedRequests.some((r) => r.url.includes('/api/late'))).toBe(true);
    // Quiet is counted from the LAST response: the late one arrives ~500 ms in and restarts the clock.
    expect(capture.timings!.graceMs!).toBeGreaterThanOrEqual(LATE_API_DELAY_MS + 600);
    expect(capture.timings!.graceMs!).toBeLessThanOrEqual(3_000 + 300);
  }, 40_000);

  it('with nothing arriving, the grace period costs its quiet window and no more', async () => {
    const quietProbe = `(() => ({ price: document.title }))()`; // ready at once, after navigation, no fetch triggered by us
    const capture = await browser.capture(`${baseUrl}/p/4`, {
      waitUntil: 'load', interceptNetworkRequests: true,
      ready: { script: quietProbe, isReady: priceReady, timeoutMs: 8_000, graceQuietMs: 400, graceMaxMs: 3_000 },
    });
    expect(capture.timings?.readyState).toBe('ready');
    expect(capture.timings!.graceMs!).toBeGreaterThanOrEqual(400);
    expect(capture.timings!.graceMs!).toBeLessThan(1_500);
  }, 40_000);

  it('without a grace period the same capture moves on at once', async () => {
    const capture = await browser.capture(`${baseUrl}/p/3b`, {
      waitUntil: 'load', interceptNetworkRequests: true,
      ready: { script: PRICE_PROBE_FIRING_LATE_API, isReady: priceReady, when: 'after-expand', timeoutMs: 8_000, settleTimeoutMs: 300 },
    });
    expect(capture.timings?.readyState).toBe('ready');
    expect(capture.timings?.graceMs ?? null).toBeNull();
  }, 40_000);

  it('no grace is taken when the check never passed: there is nothing to protect', async () => {
    const capture = await browser.capture(`${baseUrl}/p/5`, {
      waitUntil: 'load', interceptNetworkRequests: true,
      ready: { script: PRICE_PROBE, isReady: () => false, timeoutMs: 300, settleTimeoutMs: 300, graceQuietMs: 750, graceMaxMs: 3_000 },
    });
    expect(capture.timings?.readyState).toBe('timeout');
    expect(capture.timings?.graceMs ?? null).toBeNull();
  }, 40_000);
});
