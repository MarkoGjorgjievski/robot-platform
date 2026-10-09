// packages/browser/src/capture-verdict.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
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
    if (u.pathname === '/gone') return res.writeHead(404, { 'content-type': 'text/html' }).end('<html><body>nope</body></html>');
    if (u.pathname === '/blank') return res.writeHead(200, { 'content-type': 'text/html' }).end('<html><head><script>1</script></head><body><div id="app"></div></body></html>');
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
  it('a dead host rejects with a CaptureError of kind unreachable', async () => {
    await expect(browser.capture('http://127.0.0.1:9/x', { waitUntil: 'load', interceptNetworkRequests: false, timeout: 5000 })).rejects.toBeInstanceOf(CaptureError);
    await browser.capture('http://127.0.0.1:9/x', { waitUntil: 'load', interceptNetworkRequests: false, timeout: 5000 }).catch((e: CaptureError) => expect(e.kind).toBe('unreachable'));
  }, 30_000);
});
