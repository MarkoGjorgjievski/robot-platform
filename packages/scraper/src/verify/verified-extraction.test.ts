// packages/scraper/src/verify/verified-extraction.test.ts
// Certified-only extraction at scale: given a Source's certified paths (the
// output of Task 8's runVerification), does runVerifiedExtraction reproduce
// the exact values those paths certified — and honestly null out a field
// whose only path no longer resolves — against a REAL headless Chromium page
// (no AI, no cache/mechanical fallback chain, no network).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { PlaywrightBrowser, pageVariantFrom } from '@robot/browser';
import type { PageCapture, ReadySnapshot } from '@robot/browser';
import { runVerifiedExtraction, buildReadyCheck, type VerifiedField } from './verified-extraction.js';
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
    // The companion shown map (spec 2026-10-12 §3): the money and text values
    // are both on the rendered page; in_stock and image are unchecked types.
    expect(result.shown).toEqual({ price: true, product_name: true, in_stock: null, image: null });
  }, 30_000);

  it('the shown map flags a json-ld value the page text does not carry, alongside byte-identical data and stats for the rest (property 1)', async () => {
    const fixture = loadVerifyFixture('shop-example', 'p1');
    const ldJson = fixture.structuredData.ldJson as Array<Record<string, unknown>>;
    const capture = {
      ...fixture,
      structuredData: { ...fixture.structuredData, ldJson: [{ ...ldJson[0], description: 'SEO text nobody shows' }] },
    };
    const DESCRIPTION: VerifiedField = {
      key: 'description', type: 'text', concept: 'description',
      paths: [{ source: 'json-ld', path: 'description', transform: 'identity' }],
    };
    const result = await runVerifiedExtraction(
      { url: URL, fields: [PRICE, PRODUCT_NAME, IN_STOCK, IMAGE, DESCRIPTION] },
      { browser, capture },
    );
    expect(result.data).toEqual({
      price: 129.99,
      product_name: 'Widget A',
      in_stock: true,
      image: 'https://shop.example/img/a.jpg',
      description: 'SEO text nobody shows',
    });
    expect(result.stats.filter((s) => s.hit)).toHaveLength(5);
    expect(result.shown).toEqual({ price: true, product_name: true, in_stock: null, image: null, description: false });
  }, 30_000);

  it('returns the supplied capture', async () => {
    const capture = loadVerifyFixture('shop-example', 'p1');
    const result = await runVerifiedExtraction({ url: URL, fields: [PRICE] }, { browser, capture });
    expect(result.capture).toBe(capture);
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

describe('runVerifiedExtraction — two certified layouts, tried in order', () => {
  const PRICE_TWO: VerifiedField = {
    key: 'price', type: 'money', concept: 'price',
    paths: [
      { source: 'api', path: 'item.priceCents', transform: 'cents_to_units' },
      { source: 'api', path: 'clearance.amount', transform: 'identity' },
    ],
  };
  it('a layout-1 page yields the first path\'s value', async () => {
    const r = await runVerifiedExtraction({ url: URL, fields: [PRICE_TWO] }, { browser, capture: loadVerifyFixture('shop-example', 'p1') });
    expect(r.data.price).toBe(129.99);
    expect(r.stats).toEqual([expect.objectContaining({ hit: true, path: PRICE_TWO.paths[0] })]);
  }, 30_000);
  it('a layout-2 page misses the first path honestly and yields the second', async () => {
    const r = await runVerifiedExtraction({ url: 'https://shop.example/p/4', fields: [PRICE_TWO] }, { browser, capture: loadVerifyFixture('shop-example', 'p4') });
    expect(r.data.price).toBe(89.5);
    expect(r.stats.map((s) => s.hit)).toEqual([false, true]);
  }, 30_000);
});

describe('runVerifiedExtraction — a website\'s default (spec 2026-10-13 §5)', () => {
  const BRAND: VerifiedField = {
    key: 'brand', type: 'text', concept: 'brand',
    paths: [{ source: 'json-ld', path: 'vendor.name', transform: 'identity' }],
    defaultValue: 'Widgetco',
  };

  it('a field whose paths all miss takes the default; the path stat stays a miss and the flag is not checked (property 5)', async () => {
    const result = await runVerifiedExtraction({ url: URL, fields: [PRICE, BRAND] }, { browser, capture: loadVerifyFixture('shop-example', 'p1') });
    expect(result.data).toEqual({ price: 129.99, brand: 'Widgetco' });
    expect(result.stats).toEqual([
      { key: 'price', concept: 'price', path: PRICE.paths[0], hit: true, value: 129.99 },
      { key: 'brand', concept: 'brand', path: BRAND.paths[0], hit: false },
    ]);
    expect(result.defaulted).toEqual(['brand']);
    expect(result.shown).toEqual({ price: true, brand: null });
  }, 30_000);

  it('a path that reads a value wins over the default', async () => {
    const named: VerifiedField = { ...PRODUCT_NAME, defaultValue: 'Nameless' };
    const result = await runVerifiedExtraction({ url: URL, fields: [named] }, { browser, capture: loadVerifyFixture('shop-example', 'p1') });
    expect(result.data).toEqual({ product_name: 'Widget A' });
    expect(result.defaulted).toEqual([]);
    expect(result.shown).toEqual({ product_name: true });
  }, 30_000);

  it('a default-only field (no path) is filled on every product and records no stat', async () => {
    const result = await runVerifiedExtraction({ url: URL, fields: [{ ...BRAND, paths: [] }] }, { browser, capture: loadVerifyFixture('shop-example', 'p1') });
    expect(result.data).toEqual({ brand: 'Widgetco' });
    expect(result.stats).toEqual([]);
    expect(result.defaulted).toEqual(['brand']);
  }, 30_000);

  it('a run without defaults reports an empty defaulted list (property 9)', async () => {
    const result = await runVerifiedExtraction({ url: URL, fields: [PRICE] }, { browser, capture: loadVerifyFixture('shop-example', 'p1') });
    expect(result.defaulted).toEqual([]);
  }, 30_000);
});

describe('buildReadyCheck with defaults (spec 2026-10-13 §5, Review Focus 3)', () => {
  const snap = (ld: Record<string, unknown>): ReadySnapshot => ({ probe: {}, structuredData: { ldJson: [ld], nextData: null, initialState: null, meta: {} }, interceptedRequests: [] });
  const BRAND: VerifiedField = { key: 'brand', type: 'text', concept: 'brand', paths: [{ source: 'json-ld', path: 'brand.name', transform: 'identity' }], defaultValue: 'Widgetco' };
  it('a defaulted field does not block: ready once the other field resolves', () => {
    const check = buildReadyCheck([PRODUCT_NAME, BRAND], URL);
    expect(check.isReady(snap({ name: 'Widget A' }))).toBe(true);
    expect(check.isReady(snap({}))).toBe(false);
  });
  it('with only defaulted fields, the check waits for them', () => {
    const check = buildReadyCheck([BRAND], URL);
    expect(check.isReady(snap({}))).toBe(false);
    expect(check.isReady(snap({ brand: { name: 'X' } }))).toBe(true);
  });
});

describe('runVerifiedExtraction — the [page] address form (spec 2026-10-14 §4)', () => {
  const fx = JSON.parse(readFileSync(new globalThis.URL('./__fixtures__/page-variant/ruggable.json', import.meta.url), 'utf8'));
  const fakeCapture = (url: string, ldJson: Record<string, unknown>[]): PageCapture => ({
    ...loadVerifyFixture('shop-example', 'p1'),
    url, interceptedRequests: [],
    structuredData: { ldJson, nextData: null, initialState: null, meta: {} },
  });
  const fields: VerifiedField[] = [{ key: 'price', type: 'money', concept: 'price', paths: [{ source: 'json-ld', path: 'hasVariant[page].offers.price', transform: 'identity' }] }];

  it('a certified [page] path writes the variant the address names and misses honestly when none matches', async () => {
    const capture = { ...fakeCapture(fx.url, fx.ldJson), pageVariant: pageVariantFrom(fx.url, null, {}) };
    const r = await runVerifiedExtraction({ url: fx.url, fields }, { browser, capture });
    expect(r.data.price).toBe(569);
    const otherUrl = 'https://ruggable.com/products/ryder?size=12x18&system=rug-cvr';
    const other = { ...capture, url: otherUrl, pageVariant: pageVariantFrom(otherUrl, null, {}) };
    const miss = await runVerifiedExtraction({ url: other.url, fields }, { browser, capture: other });
    expect(miss.data.price).toBeNull();
    expect(miss.stats[0]).toMatchObject({ hit: false });
  }, 30_000);

  it('a [page] miss on a named page leaves the cell empty, never the certified index twin; with no page variant the index fills', async () => {
    const twins: VerifiedField[] = [{ key: 'price', type: 'money', concept: 'price', paths: [
      { source: 'json-ld', path: 'hasVariant[page].offers.price', transform: 'identity' },
      { source: 'json-ld', path: 'hasVariant[0].offers.price', transform: 'identity' },
    ] }];
    const otherUrl = 'https://ruggable.com/products/ryder?size=12x18&system=rug-cvr';
    const named = { ...fakeCapture(otherUrl, fx.ldJson), pageVariant: pageVariantFrom(otherUrl, null, {}) };
    const miss = await runVerifiedExtraction({ url: otherUrl, fields: twins }, { browser, capture: named });
    expect(miss.data.price).toBeNull();
    expect(miss.stats).toEqual([{ key: 'price', concept: 'price', path: twins[0]!.paths[0], hit: false }]);
    const plainUrl = 'https://ruggable.com/products/ryder';
    for (const pageVariant of [undefined, pageVariantFrom(plainUrl, null, {})]) {
      const plain = { ...fakeCapture(plainUrl, fx.ldJson), pageVariant };
      const r = await runVerifiedExtraction({ url: plainUrl, fields: twins }, { browser, capture: plain });
      expect(r.data.price).not.toBeNull();
      expect(r.stats.at(-1)).toMatchObject({ path: twins[0]!.paths[1], hit: true });
    }
    const snap: ReadySnapshot = { probe: {}, structuredData: { ldJson: fx.ldJson, nextData: null, initialState: null, meta: {} }, interceptedRequests: [] };
    expect(buildReadyCheck(twins, otherUrl, pageVariantFrom(otherUrl, null, {})).isReady(snap)).toBe(false);
    expect(buildReadyCheck(twins, plainUrl).isReady(snap)).toBe(true);
  }, 30_000);

  it('the ready check reads [page] by the page variant it is given, and waits without one', () => {
    const snap: ReadySnapshot = { probe: {}, structuredData: { ldJson: fx.ldJson, nextData: null, initialState: null, meta: {} }, interceptedRequests: [] };
    expect(buildReadyCheck(fields, fx.url, pageVariantFrom(fx.url, null, {})).isReady(snap)).toBe(true);
    expect(buildReadyCheck(fields, fx.url).isReady(snap)).toBe(false);
  });
});
