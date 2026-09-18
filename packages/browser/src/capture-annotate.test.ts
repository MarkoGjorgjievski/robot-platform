// `annotate` runs once, after the expand rounds, and its value rides on the capture.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { PlaywrightBrowser } from './playwright-browser.js';

let server: http.Server;
let baseUrl: string;
let browser: PlaywrightBrowser;

beforeAll(async () => {
  server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!doctype html><html><body><main id="main"><h1>Widget</h1><span id="price">$12.50</span></main></body></html>');
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
  browser = new PlaywrightBrowser();
  await browser.launch({ headless: true });
});
afterAll(async () => {
  await browser.close();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('PlaywrightBrowser.capture with annotate', () => {
  it('returns the script value as annotation', async () => {
    const c = await browser.capture(`${baseUrl}/p/1`, {
      waitUntil: 'load', interceptNetworkRequests: false,
      annotate: `(() => ({ price: document.getElementById('price').textContent }))()`,
    });
    expect(c.annotation).toEqual({ price: '$12.50' });
  });
  it('a throwing script leaves annotation undefined and the capture intact', async () => {
    const c = await browser.capture(`${baseUrl}/p/1`, { waitUntil: 'load', interceptNetworkRequests: false, annotate: `(() => { throw new Error('boom'); })()` });
    expect(c.annotation).toBeUndefined();
    expect(c.html).toContain('Widget');
  });
  it('without annotate there is no annotation key', async () => {
    const c = await browser.capture(`${baseUrl}/p/1`, { waitUntil: 'load', interceptNetworkRequests: false });
    expect('annotation' in c).toBe(false);
  });
});
