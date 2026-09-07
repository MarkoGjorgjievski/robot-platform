// packages/scraper/src/verify/verified-extraction.test.ts
// Certified-only extraction at scale: given a Source's certified paths (the
// output of Task 8's runVerification), does runVerifiedExtraction reproduce
// the exact values those paths certified — and honestly null out a field
// whose only path no longer resolves — against a REAL headless Chromium page
// (no AI, no cache/mechanical fallback chain, no network).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PlaywrightBrowser } from '@robot/browser';
import { runVerifiedExtraction, type VerifiedField } from './verified-extraction.js';
import { loadVerifyFixture } from '../__fixtures__/verify/load.js';

const URL = 'https://shop.example/p/1';

// Certified paths for shop-example/p1, taken verbatim from Task 8's passing
// run (run-verification.test.ts's first test + the p1 fixture): the api
// price path with its cents transform, the json-ld name and availability
// paths, and the hero image's xpath.
const PRICE: VerifiedField = {
  key: 'price', type: 'money', concept: 'price',
  paths: [{ source: 'api', path: 'item.priceCents', transform: 'cents_to_units' }],
};
const PRODUCT_NAME: VerifiedField = {
  key: 'product_name', type: 'text', concept: 'product_name',
  paths: [{ source: 'json-ld', path: 'name', transform: 'identity' }],
};
const IN_STOCK: VerifiedField = {
  key: 'in_stock', type: 'boolean', concept: 'availability',
  paths: [{ source: 'json-ld', path: 'offers.availability', transform: 'identity' }],
};
const IMAGE: VerifiedField = {
  key: 'image', type: 'image', concept: 'image_url',
  paths: [{ source: 'xpath', path: '//*[@id="main"]/img[@class="hero"]/@src', transform: 'identity' }],
};

let browser: PlaywrightBrowser;
beforeAll(async () => { browser = new PlaywrightBrowser(); await browser.launch({ headless: true }); });
afterAll(async () => { await browser.close(); });

describe('runVerifiedExtraction (shop-example/p1, real Chromium)', () => {
  it('reproduces every certified field\'s value exactly', async () => {
    const capture = loadVerifyFixture('shop-example', 'p1');
    const result = await runVerifiedExtraction(
      { url: URL, fields: [PRICE, PRODUCT_NAME, IN_STOCK, IMAGE] },
      { browser, capture },
    );
    expect(result.data).toEqual({
      price: 129.99,
      product_name: 'Widget A',
      in_stock: true,
      image: 'https://shop.example/img/a.jpg',
    });
    expect(result.stats.filter((s) => s.hit)).toHaveLength(4);
  }, 30_000);

  it('a field whose only path misses yields null and a miss stat', async () => {
    const capture = loadVerifyFixture('shop-example', 'p1');
    const dead: VerifiedField = {
      key: 'ghost', type: 'text', concept: 'ghost',
      paths: [{ source: 'xpath', path: '//*[@id="nope"]', transform: 'identity' }],
    };
    const result = await runVerifiedExtraction({ url: URL, fields: [dead] }, { browser, capture });
    expect(result.data.ghost).toBeNull();
    expect(result.stats).toEqual([{ key: 'ghost', concept: 'ghost', path: dead.paths[0], hit: false }]);
  }, 30_000);

  it('a field whose first path misses and second hits records one miss then one hit', async () => {
    const capture = loadVerifyFixture('shop-example', 'p1');
    const missThenHit: VerifiedField = {
      key: 'name_or_nothing', type: 'text', concept: 'product_name',
      paths: [
        { source: 'xpath', path: '//*[@id="nope"]', transform: 'identity' },
        { source: 'json-ld', path: 'name', transform: 'identity' },
      ],
    };
    const result = await runVerifiedExtraction({ url: URL, fields: [missThenHit] }, { browser, capture });
    expect(result.data.name_or_nothing).toBe('Widget A');
    expect(result.stats).toEqual([
      { key: 'name_or_nothing', concept: 'product_name', path: missThenHit.paths[0], hit: false },
      { key: 'name_or_nothing', concept: 'product_name', path: missThenHit.paths[1], hit: true, value: 'Widget A' },
    ]);
  }, 30_000);
});
