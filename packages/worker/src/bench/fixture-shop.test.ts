// The fixture shop the run-speed benchmark measures (spec 2026-10-23 run speed §5.1): every website on its own
// loopback host, deterministic products, and certified paths that today's full capture reads as the truth says.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PlaywrightBrowser } from '@robot/browser';
import { runVerifiedExtraction, type VerifiedField } from '@robot/scraper';
import { startFixtureShop, INSTANT, FIXTURE_FIELDS, product, renderedTruth, type FixtureShop } from './fixture-shop.js';

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
