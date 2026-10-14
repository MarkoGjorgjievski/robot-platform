// packages/browser/src/capture-verdict.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createServer as createTcpServer, type AddressInfo } from 'node:net';
import { PlaywrightBrowser } from './playwright-browser.js';
import { CaptureError } from './types.js';

const PRODUCT = `<html><head><title>Widget</title></head><body><h1>Widget</h1>${'<p>Real product copy that goes on and on. </p>'.repeat(60)}</body></html>`;
let server: Server; let base = ''; let browser: PlaywrightBrowser;

beforeAll(async () => {
  server = createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x');
    if (u.pathname === '/ok') return res.writeHead(200, { 'content-type': 'text/html' }).end(PRODUCT);
    if (u.pathname === '/blocked') return res.writeHead(403, { 'content-type': 'text/html', server: 'cloudflare', 'cf-ray': 'abc' }).end('<html><head><title>Just a moment...</title></head><body>Checking your browser. Ray ID: abc</body></html>');
    if (u.pathname === '/captcha') return res.writeHead(200, { 'content-type': 'text/html' }).end('<html><head><title>Verify you are human</title></head><body><p>Verify you are human to continue.</p></body></html>');
    // Cloudflare's JS challenge: 403 first, then a script sets a clearance cookie
    // and reloads the same address, which now answers 200 with the real page.
    if (u.pathname === '/cf') {
      if ((req.headers.cookie ?? '').includes('cf_clearance=1')) return res.writeHead(200, { 'content-type': 'text/html' }).end(PRODUCT);
      return res.writeHead(403, { 'content-type': 'text/html', server: 'cloudflare' }).end('<html><head><title>Just a moment...</title></head><body>Checking your browser.<script>document.cookie = "cf_clearance=1; path=/"; location.replace("/cf");</script></body></html>');
    }
    if (u.pathname === '/gone') return res.writeHead(404, { 'content-type': 'text/html' }).end('<html><body>nope</body></html>');
    if (u.pathname === '/blank') return res.writeHead(200, { 'content-type': 'text/html' }).end('<html><head><script>1</script></head><body><div id="app"></div></body></html>');
    // Keeps a fetch outstanding every 200ms forever — well under the 500ms
    // gap `networkidle` needs — so it never settles (Brooklinen/Ikea-shaped:
    // a connection that never goes quiet; campaign 2, 2026-10-11).
    if (u.pathname === '/never-idle') {
      return res.writeHead(200, { 'content-type': 'text/html' }).end(
        `${PRODUCT}<script>setInterval(() => fetch('/poll').catch(() => {}), 200);</script>`,
      );
    }
    if (u.pathname === '/poll') return res.writeHead(204).end();
    if (u.pathname === '/swatch') return res.writeHead(200, { 'content-type': 'text/html' }).end(`${PRODUCT}<div role="radiogroup" aria-label="Colour"><button role="radio" aria-checked="false">16</button><button role="radio" aria-checked="true">17</button></div>`);
    res.writeHead(500).end('boom');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = new PlaywrightBrowser();
  await browser.launch({ headless: true, stealth: false });
}, 60_000);
afterAll(async () => { await browser.close(); await new Promise<void>((r) => server.close(() => r())); });

describe('capture() verdicts', () => {
  it('a normal page is ok with its status', async () => {
    const c = await browser.capture(`${base}/ok`, { waitUntil: 'load', interceptNetworkRequests: false, maxTiles: 1 });
    expect(c.verdict).toEqual({ kind: 'ok', status: 200 });
  }, 30_000);
  it('a 403 Cloudflare page resolves as refused, not a throw', async () => {
    const c = await browser.capture(`${base}/blocked`, { waitUntil: 'load', interceptNetworkRequests: false, maxTiles: 1 });
    expect(c.verdict).toEqual({ kind: 'refused', status: 403, vendor: 'cloudflare' });
    expect(c.html).toContain('Just a moment');
  }, 30_000);
  it('a 200 human check is a challenge; a 404 is not-found; an empty app shell is blank', async () => {
    expect((await browser.capture(`${base}/captcha`, { waitUntil: 'load', interceptNetworkRequests: false, maxTiles: 1 })).verdict.kind).toBe('challenge');
    expect((await browser.capture(`${base}/gone`, { waitUntil: 'load', interceptNetworkRequests: false, maxTiles: 1 })).verdict).toEqual({ kind: 'not-found', status: 404 });
    expect((await browser.capture(`${base}/blank`, { waitUntil: 'load', interceptNetworkRequests: false, maxTiles: 1 })).verdict.kind).toBe('blank');
  }, 60_000);
  it('a page that reloads itself past a 403 challenge is classified by the page it ended on', async () => {
    const c = await browser.capture(`${base}/cf`, { waitUntil: 'load', interceptNetworkRequests: false, maxTiles: 1 });
    expect(c.html).toContain('Real product copy');
    expect(c.verdict).toEqual({ kind: 'ok', status: 200 });
  }, 30_000);
  it('a page that never goes idle still resolves via the load fallback, bounded by the given timeout (finder fix, campaign 2 2026-10-11)', async () => {
    const t0 = Date.now();
    const c = await browser.capture(`${base}/never-idle`, { waitUntil: 'networkidle', interceptNetworkRequests: false, maxTiles: 1, timeout: 3000 });
    // navigateWithFallback's networkidle attempt is bounded by `timeout`
    // (3 s here, 20 s for the finder in production), then falls back to
    // domcontentloaded + a fixed 3 s settle + up to a 10 s `load` wait —
    // never the old unbounded 60 s networkidle wait twice over.
    expect(Date.now() - t0).toBeLessThan(3000 + 3000 + 10_000 + 5000);
    expect(c.verdict).toEqual({ kind: 'ok', status: 200 });
    expect(c.html).toContain('Real product copy');
  }, 30_000);
  it('a page whose picker selects a variant the address does not name is wrong-variant; no selection script → ok', async () => {
    const selection = `(() => { const el = document.querySelector('[role="radio"][aria-checked="true"]'); return el ? { labels: [el.textContent.trim()], pairs: [{ name: 'swatch', value: el.textContent.trim() }] } : null; })()`;
    const c = await browser.capture(`${base}/swatch?swatch=16`, { selection });
    expect(c.verdict).toEqual({ kind: 'wrong-variant', status: 200, named: 'swatch=16' });
    expect(c.pageVariant).toMatchObject({ named: true, selected: true, labels: expect.arrayContaining(['16', '17']) });
    const plain = await browser.capture(`${base}/swatch?swatch=16`);
    expect(plain.verdict).toEqual({ kind: 'ok', status: 200 });
    expect(plain.pageVariant).toMatchObject({ named: true, selected: false });
  }, 60_000);
  it('a dead host rejects with a CaptureError of kind unreachable, its sentence as the message', async () => {
    // A port that was just free: nothing listens on it (port 9 is ERR_UNSAFE_PORT in Chromium).
    const probe = createTcpServer();
    await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
    const port = (probe.address() as AddressInfo).port;
    await new Promise<void>((r) => probe.close(() => r()));
    const p = browser.capture(`http://127.0.0.1:${port}/x`, { waitUntil: 'load', interceptNetworkRequests: false, timeout: 5000 });
    await expect(p).rejects.toBeInstanceOf(CaptureError);
    await expect(p).rejects.toMatchObject({ kind: 'unreachable', message: '127.0.0.1 could not be reached (no response).' });
  }, 30_000);
});
