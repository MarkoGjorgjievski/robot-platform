// A capture that waits for what it needs, not for the page to go quiet.
//
// Ikea holds a connection open, so `networkidle` never fires and every
// product page paid the full 60 s timeout (measured 2026-09-15: 69.8 s per
// page with networkidle, 7.0 s with `load`, identical JSON-LD and API yield).
// A certified run knows exactly which values it needs, so `ready` lets it
// poll the live page until those values resolve, then a bounded settle wait
// as the honest last try before a miss is called a miss.
//
// The local page below reproduces the shape: `load` fires at once, a
// long-poll fetch keeps the network busy for the whole test, and the value
// we want appears in the DOM only after a delay.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { PlaywrightBrowser } from './playwright-browser.js';
import type { ReadySnapshot } from './types.js';

const PRICE_DELAY_MS = 1_000;

function pageHtml(): string {
  return `<!doctype html><html><head><title>Slow price</title></head><body>
    <main id="main"><h1>Widget</h1><div id="price"></div></main>
    <script>
      // Keeps the network busy for as long as the server holds it open.
      fetch('/long-poll').catch(() => {});
      setTimeout(() => { document.getElementById('price').textContent = '$12.50'; }, ${PRICE_DELAY_MS});
    </script>
  </body></html>`;
}

const PRICE_PROBE = `(() => {
  const r = document.evaluate('string(//*[@id="price"])', document, null, XPathResult.STRING_TYPE, null);
  return { price: r.stringValue.trim() || null };
})()`;

const priceReady = (s: ReadySnapshot) => (s.probe as { price: string | null } | null)?.price != null;

let server: http.Server;
let baseUrl: string;
let browser: PlaywrightBrowser;
const pending: http.ServerResponse[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url?.startsWith('/long-poll')) { pending.push(res); return; } // held open on purpose
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

describe('PlaywrightBrowser.capture with a ready check', () => {
  it('returns as soon as the needed value resolves, on a page that never goes network-idle', async () => {
    const t0 = Date.now();
    const capture = await browser.capture(`${baseUrl}/p/1`, {
      waitUntil: 'load',
      interceptNetworkRequests: true,
      ready: { script: PRICE_PROBE, isReady: priceReady, timeoutMs: 8_000, settleTimeoutMs: 1_000 },
    });
    const elapsed = Date.now() - t0;

    expect(capture.html).toContain('$12.50');
    expect(capture.timings?.readyState).toBe('ready');
    expect(capture.timings?.readyMs).toBeGreaterThanOrEqual(PRICE_DELAY_MS - 50);
    // Well under the poll deadline plus the settle wait: readiness ended the wait, nothing else did.
    expect(elapsed).toBeLessThan(8_000);
  }, 30_000);

  it('gives up honestly when the value never appears: poll deadline, one bounded settle wait, then "timeout"', async () => {
    const neverReady = (_s: ReadySnapshot) => false;
    const t0 = Date.now();
    const capture = await browser.capture(`${baseUrl}/p/2`, {
      waitUntil: 'load',
      interceptNetworkRequests: true,
      ready: { script: PRICE_PROBE, isReady: neverReady, timeoutMs: 600, settleTimeoutMs: 600 },
    });
    const elapsed = Date.now() - t0;

    expect(capture.timings?.readyState).toBe('timeout');
    expect(capture.timings?.readyMs).toBeGreaterThanOrEqual(1_200);
    // The two bounds are the whole wait: no 60 s networkidle anywhere in the path.
    expect(elapsed).toBeLessThan(15_000);
  }, 30_000);

  it('hands the ready check the structured data and intercepted requests seen so far', async () => {
    const seen: ReadySnapshot[] = [];
    await browser.capture(`${baseUrl}/p/3`, {
      waitUntil: 'load',
      interceptNetworkRequests: true,
      ready: { script: PRICE_PROBE, isReady: (s) => { seen.push(s); return priceReady(s); }, timeoutMs: 8_000, settleTimeoutMs: 500 },
    });
    expect(seen.length).toBeGreaterThan(0);
    for (const s of seen) {
      expect(s.structuredData).toEqual(expect.objectContaining({ ldJson: expect.any(Array), meta: expect.any(Object) }));
      expect(Array.isArray(s.interceptedRequests)).toBe(true);
    }
  }, 30_000);

  it('without a ready check, timings still report navigation and total, and readyState is null', async () => {
    const capture = await browser.capture(`${baseUrl}/p/4`, { waitUntil: 'load', interceptNetworkRequests: false });
    expect(capture.timings?.readyState).toBeNull();
    expect(capture.timings?.readyMs).toBeNull();
    expect(capture.timings?.navigateMs).toBeGreaterThanOrEqual(0);
    expect(capture.timings?.totalMs).toBeGreaterThanOrEqual(capture.timings!.navigateMs);
  }, 30_000);
});
