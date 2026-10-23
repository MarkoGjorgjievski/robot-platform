// A certified run's lean capture (spec 2026-10-23 run speed §3.1): no popup rounds, no pictures, the expand pass only
// when asked, the probe evaluated in the live tab — and a full capture can drop its pictures without changing a value.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { PlaywrightBrowser } from './playwright-browser.js';

const FULL = 'The long story of this lamp, told in full once you ask for it.';
const SHORT = 'The long story of this…';
const PAGE = `<!doctype html><html><head><title>Lamp</title></head><body><main><h1>Lamp</h1>
<div class="desc"><p class="text">${SHORT}</p><button type="button" class="read-more" aria-expanded="false">Read more</button></div>
<section>${'<p>Hand finished, tested for daily use, delivered in recyclable packaging.</p>'.repeat(12)}</section></main>
<script>
document.querySelector('.read-more').addEventListener('click', function () { document.querySelector('.desc .text').textContent = ${JSON.stringify(FULL)}; this.setAttribute('aria-expanded', 'true'); });
// The consent popup is there before the capture starts: one that arrives during the expand pass is removed by its
// new-overlay undo (spec 2026-10-19 §3.2.4), which a lean capture keeps.
(function () {
  var d = document.createElement('div'); d.id = 'cookie-consent'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true');
  d.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000';
  d.innerHTML = '<div style="background:#fff;margin:20vh auto;width:420px;padding:24px"><h2>We use cookies</h2><button type="button" class="accept">Accept all</button></div>';
  d.querySelector('.accept').addEventListener('click', function () { d.remove(); });
  document.body.appendChild(d);
})();
</script></body></html>`;
const PROBE = `(() => ({ text: document.querySelector('.desc .text')?.textContent ?? null }))()`;

let server: http.Server;
let url = '';
let browser: PlaywrightBrowser;
beforeAll(async () => {
  server = http.createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(PAGE); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/p/1`;
  browser = new PlaywrightBrowser();
  await browser.launch({ headless: true });
});
afterAll(async () => { await browser.close(); server.closeAllConnections(); server.close(); });

describe('capture — lean (spec 2026-10-23 run speed §3.1)', () => {
  it('closes nothing, takes no pictures, expands, and returns the live probe', async () => {
    const c = await browser.capture(url, { waitUntil: 'load', lean: { expand: true }, finalProbe: PROBE });
    expect(c.mode).toBe('lean');
    expect(c.verdict.kind).toBe('ok');
    expect(c.screenshotTiles).toEqual([]);
    expect(c.screenshot.length).toBe(0);
    expect(c.markdown).toBe('');
    expect(c.html).toContain('id="cookie-consent"');
    expect(c.probe).toEqual({ text: FULL });
  }, 30_000);

  it('without the expand pass reads the page as loaded', async () => {
    const c = await browser.capture(url, { waitUntil: 'load', lean: { expand: false }, finalProbe: PROBE });
    expect(c.html).toContain('id="cookie-consent"');
    expect(c.probe).toEqual({ text: SHORT });
  }, 30_000);
});

describe('capture — full, with and without pictures', () => {
  it('pictures: false closes the popup as always, reads the same probe, and takes no pictures', async () => {
    const c = await browser.capture(url, { waitUntil: 'load', pictures: false, finalProbe: PROBE });
    expect(c.mode).toBe('full');
    expect(c.screenshotTiles).toEqual([]);
    expect(c.markdown).toBe('');
    expect(c.html).not.toContain('id="cookie-consent"');
    expect(c.probe).toEqual({ text: FULL });
  }, 30_000);

  it('by default still takes its pictures and markdown, and has no probe', async () => {
    const c = await browser.capture(url, { waitUntil: 'load' });
    expect(c.mode).toBe('full');
    expect(c.screenshotTiles.length).toBeGreaterThan(0);
    expect(c.markdown.length).toBeGreaterThan(0);
    expect(c.probe).toBeUndefined();
  }, 30_000);
});
