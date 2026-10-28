// The fixture shop the run-speed benchmark measures (spec 2026-10-23 run speed §5.1): every website on its own
// loopback host, deterministic products, and certified paths that today's full capture reads as the truth says.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PlaywrightBrowser } from '@robot/browser';
import { runVerifiedExtraction, type VerifiedField } from '@robot/scraper';
import { startFixtureShop, INSTANT, FIXTURE_FIELDS, product, renderedTruth, WALL_HTML, type FixtureShop } from './fixture-shop.js';

const fields: VerifiedField[] = FIXTURE_FIELDS.map((f) => ({ key: f.name, type: f.type, concept: f.name, paths: f.paths }));
let shop: FixtureShop;
let browser: PlaywrightBrowser;
beforeAll(async () => {
  shop = await startFixtureShop({ sites: 4, latency: INSTANT });
  browser = new PlaywrightBrowser();
  await browser.launch({ headless: true });
});
afterAll(async () => { await browser?.close(); await shop?.close(); });

describe('the fixture shop', () => {
  it('serves each website on its own loopback host', () => {
    expect(shop.sites.map((s) => s.host)).toEqual(['127.0.0.11', '127.0.0.12', '127.0.0.13', '127.0.0.14']);
    expect(shop.sites.map((s) => s.consentGated)).toEqual([false, false, false, true]);
  });

  it('is deterministic', () => {
    expect(product(2, 9)).toEqual(product(2, 9));
    expect(product(0, 7).rating).toBeNull();
    expect(product(0, 3).readMore).toBe(true);
  });

  it('today\'s full capture reads every certified field as the truth says, the read-more text in full', async () => {
    for (const id of [3, 7]) {
      const r = await runVerifiedExtraction({ url: shop.sites[0]!.productUrl(id), fields }, { browser, acquireLock: async () => () => {} });
      expect(r.data).toEqual(renderedTruth(product(0, id)));
    }
  }, 90_000);

  it('the consent-gated website shows its stock once the full capture accepts the cookies', async () => {
    const site = shop.sites[3]!;
    const r = await runVerifiedExtraction({ url: site.productUrl(1), fields }, { browser, acquireLock: async () => () => {} });
    expect(r.data.Stock).toBe(product(3, 1).stock);
  }, 90_000);
});

describe('gone pages (the email live check)', () => {
  it('a path in `gone` answers 404 until it is taken out again', async () => {
    const url = shop.sites[0]!.productUrl(2);
    expect((await fetch(url)).status).toBe(200);
    shop.gone.add('/p/2');
    try { expect((await fetch(url)).status).toBe(404); } finally { shop.gone.delete('/p/2'); }
    expect((await fetch(url)).status).toBe(200);
  });
});

describe('the shop for the proxy live check (spec 2026-10-24 proxy §4)', () => {
  it('reports every request with its headers, and can write what the page believes onto <html>', async () => {
    const seen: Array<{ site: number; path: string; marker: unknown }> = [];
    const s = await startFixtureShop({ sites: 1, latency: INSTANT, envProbe: true, onRequest: (r) => seen.push({ site: r.site, path: r.path, marker: r.headers['x-test-proxy-forwarded'] }) });
    try {
      const html = await (await fetch(s.sites[0]!.productUrl(1), { headers: { 'x-test-proxy-forwarded': '1' } })).text();
      expect(seen).toEqual([{ site: 0, path: '/p/1', marker: '1' }]);
      expect(html).toContain("document.documentElement.setAttribute('data-env'");
      const plain = await startFixtureShop({ sites: 1, latency: INSTANT });
      try { expect(await (await fetch(plain.sites[0]!.productUrl(1))).text()).not.toContain('data-env'); } finally { await plain.close(); }
    } finally {
      await s.close();
    }
  });
});

describe('the shop for the turned-away live check (spec 2026-10-28 turned away §5)', () => {
  it('walls what `wall` names with a 403 denial page, serves the rest, and reads a product under a locale prefix', async () => {
    const s = await startFixtureShop({ sites: 1, latency: INSTANT, wall: (r) => r.headers['x-test-proxy-forwarded'] !== '1' });
    try {
      const url = `${s.sites[0]!.origin}/de-de/p/1`;
      const walled = await fetch(url);
      expect(walled.status).toBe(403);
      expect(await walled.text()).toBe(WALL_HTML);
      const through = await fetch(url, { headers: { 'x-test-proxy-forwarded': '1' } });
      expect(through.status).toBe(200);
      expect(await through.text()).toContain(product(0, 1).title);
    } finally {
      await s.close();
    }
  });
});
