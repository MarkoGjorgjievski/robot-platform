// Spec 2026-10-19 §3.4 and §5.5: one more dismissal pass just before the screenshot (late banners:
// puma's OneTrust), the page back at the top (ikea's y≈1000), one warning line for an overlay that
// survives — and no new wait on a page with nothing over it.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PlaywrightBrowser } from './playwright-browser.js';
import type { ReadySnapshot } from './types.js';
import { fixturePage, pageState, serveHtml, type HtmlSite, type PageState } from './__fixtures__/overlay-pages.js';

// The spec's fixture says "two seconds after load"; three keeps it clear of the first pass's
// 1.5 s settle wait on a slow machine, so only the final pass can be the one that closes it.
const LATE_MS = 3000;

const PAGES: Record<string, string> = {
  '/late-banner': fixturePage('', '',
    `setTimeout(() => {
       const b = document.createElement('div');
       b.id = 'onetrust-banner-sdk';
       b.style.cssText = 'position:fixed;left:0;right:0;bottom:0;height:140px;background:#fff;z-index:10';
       b.innerHTML = '<button id="onetrust-accept-btn-handler">Accept All Cookies</button>';
       document.body.appendChild(b);
       b.querySelector('button').addEventListener('click', () => { window.__flags.acceptedAt = Math.round(performance.now()); b.remove(); });
     }, ${LATE_MS});`),
  // ikea: the dismissal click leaves the page scrolled (there, ~1000 px down). Dismissal offers
  // only controls on the window, so the notice sits at the top and its click does the scrolling.
  '/scrolled': fixturePage(
    `<div id="consent-notice" class="cookie-notice" style="padding:20px;background:#eee">We use cookies <button id="notice-ok">Got it</button></div>`,
    '',
    `document.getElementById('notice-ok').addEventListener('click', () => { document.getElementById('consent-notice').remove(); window.scrollTo(0, 1000); });`),
  // An overlay that comes back every 100 ms: nothing can close it, so the capture says so.
  '/nag': fixturePage('', '',
    `function nag() {
       const old = document.getElementById('nag');
       if (old && getComputedStyle(old).display !== 'none') return;
       if (old) old.remove();
       const d = document.createElement('div');
       d.id = 'nag';
       d.style.cssText = 'position:fixed;inset:0;z-index:100;background:rgba(0,0,0,.6);color:#fff';
       d.textContent = 'Subscribe to our newsletter for 10% off your first order';
       document.body.appendChild(d);
     }
     nag(); setInterval(nag, 100);`),
  // Review Focus 4: a late dialog whose Close button navigates by script.
  '/navigating-close': fixturePage('', '',
    `setTimeout(() => {
       const d = document.createElement('div');
       d.id = 'leave'; d.setAttribute('role', 'dialog');
       d.style.cssText = 'position:fixed;inset:25%;background:#fff;z-index:100';
       d.innerHTML = '<button id="leave-close" aria-label="Close">×</button>';
       document.body.appendChild(d);
       d.querySelector('button').addEventListener('click', () => { location.href = '/elsewhere'; });
     }, ${LATE_MS});`),
  // Review Focus 5: a heavy page with nothing over it.
  '/heavy': fixturePage(`<div id="heavy">${'<span>x </span>'.repeat(15_000)}</div>`),
  // Final review I1: the expand pass opens a panel holding its own "Close" button. The final
  // pass's global `{ name: 'close' }` step must not click it shut again.
  '/close-in-panel': fixturePage(
    `<button id="cp-acc" aria-expanded="false" aria-controls="cp-panel">Delivery</button>
     <div id="cp-panel" hidden>CP_PANEL_TEXT <button id="cp-close">Close</button></div>`, '',
    `const acc = document.getElementById('cp-acc');
     const set = (open) => { acc.setAttribute('aria-expanded', String(open)); document.getElementById('cp-panel').hidden = !open; };
     acc.addEventListener('click', () => set(acc.getAttribute('aria-expanded') !== 'true'));
     document.getElementById('cp-close').addEventListener('click', () => set(false));`),
  // The same behind a "Show more" that names no panel (no aria-controls): only the final pass's
  // rule — global steps only inside an overlay or a consent-like layer — protects it.
  '/close-after-show-more': fixturePage(
    `<button id="sm-more">Show more</button>
     <div id="sm-panel" hidden>SM_PANEL_TEXT <button id="sm-close">Close</button></div>`, '',
    `document.getElementById('sm-more').addEventListener('click', () => { document.getElementById('sm-panel').hidden = false; });
     document.getElementById('sm-close').addEventListener('click', () => { document.getElementById('sm-panel').hidden = true; });`),
  // A toggle whose aria-label becomes "Close" while its panel is open (the [aria-label="Close"] step).
  '/toggle-named-close': fixturePage(
    `<button id="tg" aria-expanded="false" aria-controls="tg-panel">Specifications</button>
     <div id="tg-panel" hidden>TG_PANEL_TEXT</div>`, '',
    `const tg = document.getElementById('tg');
     tg.addEventListener('click', () => {
       const open = tg.getAttribute('aria-expanded') !== 'true';
       tg.setAttribute('aria-expanded', String(open));
       if (open) tg.setAttribute('aria-label', 'Close'); else tg.removeAttribute('aria-label');
       document.getElementById('tg-panel').hidden = !open;
     });`),
};

const IDS = ['onetrust-banner-sdk', 'consent-notice', 'nag', 'leave', 'cp-panel', 'sm-panel', 'tg-panel'];
const present = (id: string) => `(() => !!document.getElementById(${JSON.stringify(id)}))()`;
const isTrue = (s: ReadySnapshot) => s.probe === true;

let browser: PlaywrightBrowser;
let site: HtmlSite;
beforeAll(async () => {
  site = await serveHtml(PAGES);
  browser = new PlaywrightBrowser();
  await browser.launch({ headless: true });
}, 60_000);
afterAll(async () => {
  await browser?.close();
  await site?.close();
});

describe('the final pass before the screenshot (spec 2026-10-19 §3.4)', () => {
  it('closes a cookie banner that appeared after the first pass (puma\'s late OneTrust)', async () => {
    const c = await browser.capture(`${site.baseUrl}/late-banner`, {
      waitUntil: 'load', interceptNetworkRequests: false, maxTiles: 1, annotate: pageState(IDS),
      ready: { script: present('onetrust-banner-sdk'), isReady: isTrue, when: 'after-expand', timeoutMs: 8_000, settleTimeoutMs: 300 },
    });
    const s = c.annotation as PageState;
    expect(c.timings?.readyState).toBe('ready');
    expect(s.flags.acceptedAt as number).toBeGreaterThanOrEqual(LATE_MS);
    expect(s.exists['onetrust-banner-sdk']).toBe(false);
  }, 60_000);

  it('leaves the page at the top after a dismissal click scrolled it (ikea)', async () => {
    const c = await browser.capture(`${site.baseUrl}/scrolled`, { waitUntil: 'load', interceptNetworkRequests: false, maxTiles: 1, annotate: pageState(IDS) });
    const s = c.annotation as PageState;
    expect(s.clicks).toContain('notice-ok');
    expect(s.scrollY).toBe(0);
  }, 60_000);

  it('logs one warning line naming an overlay it could not close, and still captures', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const c = await browser.capture(`${site.baseUrl}/nag`, { waitUntil: 'load', interceptNetworkRequests: false, maxTiles: 1 });
      const lines = warn.mock.calls.map((args) => String(args[0])).filter((l) => l.includes('overlay still covers'));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(/: an overlay still covers the middle of the page after dismissal: div#nag "Subscribe to our newsletter/);
      expect(c.screenshotTiles).toHaveLength(1);
      expect(c.timings!.totalMs).toBeLessThan(15_000); // four rounds per pass, bounded
    } finally {
      warn.mockRestore();
    }
  }, 60_000);

  it('ends on the requested page when a final-pass click navigates by script (Review Focus 4)', async () => {
    const c = await browser.capture(`${site.baseUrl}/navigating-close`, {
      waitUntil: 'load', interceptNetworkRequests: false, maxTiles: 1,
      ready: { script: present('leave'), isReady: isTrue, when: 'after-expand', timeoutMs: 8_000, settleTimeoutMs: 300 },
    });
    expect(site.requested).toContain('/elsewhere');
    expect(new URL(c.url).pathname).toBe('/navigating-close');
  }, 60_000);
});

describe('the final pass never closes what the expand pass opened (final review I1)', () => {
  const plain = async (path: string) => {
    const c = await browser.capture(`${site.baseUrl}${path}`, { waitUntil: 'load', interceptNetworkRequests: false, maxTiles: 1, annotate: pageState(IDS) });
    return c.annotation as PageState;
  };

  it('a "Close" button inside a panel the expand pass opened is never clicked', async () => {
    const s = await plain('/close-in-panel');
    expect(s.clicks).toContain('cp-acc');
    expect(s.clicks).not.toContain('cp-close');
    expect(s.shown['cp-panel']).toBe(true);
  }, 60_000);

  it('nor one inside a panel a "Show more" revealed (no aria-controls)', async () => {
    const s = await plain('/close-after-show-more');
    expect(s.clicks).toContain('sm-more');
    expect(s.clicks).not.toContain('sm-close');
    expect(s.shown['sm-panel']).toBe(true);
  }, 60_000);

  it('a toggle whose aria-label became "Close" when it opened is not clicked shut', async () => {
    const s = await plain('/toggle-named-close');
    expect(s.clicks.filter((id) => id === 'tg')).toHaveLength(1);
    expect(s.shown['tg-panel']).toBe(true);
  }, 60_000);
});

describe('a page with no overlay is captured as today (spec §5.5)', () => {
  it('adds no wait: a heavy page with nothing over it, no warning (Review Focus 5)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const c = await browser.capture(`${site.baseUrl}/heavy`, { waitUntil: 'load', interceptNetworkRequests: false, maxTiles: 1 });
      // Today's floor is the 1.5 s settle wait before the first pass plus one screenshot. A second
      // settle wait, or a loop that does not stop on a clean page, lands well above this bound.
      expect(c.timings!.totalMs - c.timings!.navigateMs).toBeLessThan(2_500);
      expect(warn.mock.calls.some((args) => String(args[0]).includes('overlay still covers'))).toBe(false);
    } finally {
      warn.mockRestore();
    }
  }, 60_000);
});
