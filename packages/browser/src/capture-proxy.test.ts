// A capture through a website's proxy, in its country (spec 2026-10-24 proxy §2.2, §3.1, §3.3, §4 "Browser"): local
// Chromium, a local page that records every request, and the local recording proxy — never a real provider.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http, { type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { PlaywrightBrowser } from './playwright-browser.js';
import { CaptureError, type BrowserOptions } from './types.js';
import { PROXY_REFUSED } from './verdict-copy.js';
import { FORWARDED_HEADER, startRecordingProxy } from './__fixtures__/proxy.js';

const PAGE = `<!doctype html><html><head><title>Lamp</title></head><body><main><h1>Lamp</h1>${'<p>Hand finished, tested for daily use, delivered in recyclable packaging.</p>'.repeat(30)}</main></body></html>`;
/** What the page itself believes: its language, languages and time zone. */
const ENV = `(() => ({ lang: navigator.language, langs: [...navigator.languages], tz: Intl.DateTimeFormat().resolvedOptions().timeZone }))()`;
type Env = { lang: string; langs: string[]; tz: string };
const basic = (user: string, pass: string) => `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;

let site: http.Server;
let pageUrl = '';
/** The same page asked for over https: Chromium tunnels it through the proxy with CONNECT (TLS then fails on this
 *  plain-http listener, which is fine — the assertions are on the proxy, the kind and the website). */
let httpsUrl = '';
/** Every request the website received, in order. */
const seen: IncomingHttpHeaders[] = [];
beforeAll(async () => {
  site = http.createServer((req, res) => { seen.push(req.headers); res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(PAGE); });
  await new Promise<void>((r) => site.listen(0, '127.0.0.1', () => r()));
  pageUrl = `http://127.0.0.1:${(site.address() as AddressInfo).port}/p/1`;
  httpsUrl = pageUrl.replace(/^http:/, 'https:');
});
afterAll(() => { site.closeAllConnections(); site.close(); });
beforeEach(() => { seen.length = 0; });

/** One browser per profile, as a worker session has: launched, one capture, closed. */
async function captureWith(opts: BrowserOptions, url = pageUrl) {
  const b = new PlaywrightBrowser();
  try {
    await b.launch({ headless: true, ...opts });
    return await b.capture(url, { waitUntil: 'load', timeout: 30_000, pictures: false, finalProbe: ENV });
  } finally {
    await b.close();
  }
}

describe('capture through a proxy (spec 2026-10-24 proxy §2.2)', () => {
  it('goes through the proxy: the proxy logged the page, and the website saw only the proxy’s requests', async () => {
    const proxy = await startRecordingProxy();
    try {
      const c = await captureWith({ proxy: { server: proxy.url } });
      expect(c.verdict.kind).toBe('ok');
      expect(proxy.log.map((e) => `${e.method} ${e.url}`)).toContain(`GET ${pageUrl}`);
      expect(seen.length).toBeGreaterThan(0);
      expect(seen.every((h) => h[FORWARDED_HEADER] === '1')).toBe(true);
    } finally { await proxy.close(); }
  }, 60_000);

  it('RF3: the proxy receives a password with reserved characters exactly', async () => {
    const proxy = await startRecordingProxy({ auth: { username: 'shop-user', password: 'p@ss:w/rd' } });
    try {
      const c = await captureWith({ proxy: { server: proxy.url, username: 'shop-user', password: 'p@ss:w/rd' } });
      expect(c.verdict.kind).toBe('ok');
      expect(proxy.log.some((e) => e.allowed && e.headers['proxy-authorization'] === basic('shop-user', 'p@ss:w/rd'))).toBe(true);
      expect(seen.length).toBeGreaterThan(0);
    } finally { await proxy.close(); }
  }, 60_000);

  it('wrong credentials: the proxy sentence, and the website is never reached directly', async () => {
    const proxy = await startRecordingProxy({ auth: { username: 'shop-user', password: 'right' } });
    try {
      const err = await captureWith({ proxy: { server: proxy.url, username: 'shop-user', password: 'wrong' } }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(CaptureError);
      expect(err).toMatchObject({ kind: 'proxy', message: PROXY_REFUSED });
      expect(proxy.log.length).toBeGreaterThan(0);
      expect(seen).toEqual([]);
    } finally { await proxy.close(); }
  }, 60_000);

  it('a proxy that is not there: the proxy sentence, and still nothing direct', async () => {
    const gone = await startRecordingProxy();
    await gone.close();
    const err = await captureWith({ proxy: { server: gone.url } }).catch((e: unknown) => e);
    expect(err).toMatchObject({ kind: 'proxy', message: PROXY_REFUSED });
    expect(seen).toEqual([]);
  }, 60_000);

  it('in a country: the page reads de-DE and Europe/Berlin, and the request asks for German first', async () => {
    const proxy = await startRecordingProxy();
    try {
      const c = await captureWith({ proxy: { server: proxy.url }, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
      const env = c.probe as Env;
      expect(env.lang).toBe('de-DE');
      expect(env.langs[0]).toBe('de-DE');
      expect(env.tz).toBe('Europe/Berlin');
      const get = proxy.log.find((e) => e.method === 'GET' && e.url === pageUrl)!;
      expect(String(get.headers['accept-language'])).toMatch(/^de-DE/);
    } finally { await proxy.close(); }
  }, 60_000);

  it('without a proxy nothing goes through one, and the page reads en-US / New York as before', async () => {
    const proxy = await startRecordingProxy();
    try {
      const c = await captureWith({});
      expect(c.verdict.kind).toBe('ok');
      expect(proxy.log).toEqual([]);
      expect(seen.length).toBeGreaterThan(0);
      expect(seen.some((h) => h[FORWARDED_HEADER] !== undefined)).toBe(false);
      expect(c.probe as Env).toMatchObject({ lang: 'en-US', tz: 'America/New_York' });
    } finally { await proxy.close(); }
  }, 60_000);
});

describe('an https page through a proxy: the tunnel (Task 2 review, issues 1–2)', () => {
  const tunnelTo = () => `127.0.0.1:${new URL(httpsUrl).port}`;

  it('a wrong password: the proxy sentence at once, not a timeout, and the website never asked', async () => {
    const proxy = await startRecordingProxy({ auth: { username: 'shop-user', password: 'right' } });
    try {
      const t0 = Date.now();
      const err = await captureWith({ proxy: { server: proxy.url, username: 'shop-user', password: 'wrong' } }, httpsUrl).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(CaptureError);
      expect(err).toMatchObject({ kind: 'proxy', message: PROXY_REFUSED });
      expect(Date.now() - t0).toBeLessThan(15_000);
      expect(proxy.log.some((e) => e.method === 'CONNECT' && e.url === tunnelTo() && !e.allowed)).toBe(true);
      expect(proxy.log.some((e) => e.allowed)).toBe(false);
      expect(seen).toEqual([]);
    } finally { await proxy.close(); }
  }, 60_000);

  it('no password at all: the proxy sentence at once', async () => {
    const proxy = await startRecordingProxy({ auth: { username: 'shop-user', password: 'right' } });
    try {
      const t0 = Date.now();
      const err = await captureWith({ proxy: { server: proxy.url } }, httpsUrl).catch((e: unknown) => e);
      expect(err).toMatchObject({ kind: 'proxy', message: PROXY_REFUSED });
      expect(Date.now() - t0).toBeLessThan(15_000);
      expect(seen).toEqual([]);
    } finally { await proxy.close(); }
  }, 60_000);

  it('the right password: the proxy carried the CONNECT with the exact header, and the failure is not the proxy’s', async () => {
    const proxy = await startRecordingProxy({ auth: { username: 'shop-user', password: 'p@ss:w/rd' } });
    try {
      const err = await captureWith({ proxy: { server: proxy.url, username: 'shop-user', password: 'p@ss:w/rd' } }, httpsUrl).catch((e: unknown) => e);
      // TLS to this plain-http listener fails inside the tunnel: the website's failure, never the proxy's.
      expect(err).toBeInstanceOf(CaptureError);
      expect((err as CaptureError).kind).not.toBe('proxy');
      const connects = proxy.log.filter((e) => e.method === 'CONNECT' && e.url === tunnelTo());
      expect(connects.some((e) => e.allowed && e.headers['proxy-authorization'] === basic('shop-user', 'p@ss:w/rd'))).toBe(true);
      expect(seen).toEqual([]);
    } finally { await proxy.close(); }
  }, 60_000);

  it.each([[403, 'refused'], [502, 'bad gateway']] as const)('a CONNECT answered %i (%s): the proxy sentence at once', async (status, _what) => {
    const proxy = await startRecordingProxy({ connectAnswer: status });
    try {
      const t0 = Date.now();
      const err = await captureWith({ proxy: { server: proxy.url } }, httpsUrl).catch((e: unknown) => e);
      expect(err).toMatchObject({ kind: 'proxy', message: PROXY_REFUSED });
      expect(Date.now() - t0).toBeLessThan(15_000);
      expect(proxy.log.some((e) => e.method === 'CONNECT')).toBe(true);
      expect(seen).toEqual([]);
    } finally { await proxy.close(); }
  }, 60_000);

  it('a proxy that is not there: the proxy sentence', async () => {
    const gone = await startRecordingProxy();
    await gone.close();
    const err = await captureWith({ proxy: { server: gone.url } }, httpsUrl).catch((e: unknown) => e);
    expect(err).toMatchObject({ kind: 'proxy', message: PROXY_REFUSED });
    expect(seen).toEqual([]);
  }, 60_000);
});
