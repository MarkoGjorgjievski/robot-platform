import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PlaywrightBrowser } from '@robot/browser';
import { runVerification, definitionHash } from './run-verification.js';
import { loadShopExample, SHOP_EXAMPLE_URLS as U } from '../__fixtures__/verify/load.js';

const fields = [
  { key: 'product_name', name: 'Product name', type: 'text' as const, description: 'big heading', concept: 'product_name' },
  { key: 'price', name: 'Price', type: 'money' as const, description: 'green number, not the crossed-out one', concept: 'price' },
  { key: 'in_stock', name: 'In stock', type: 'boolean' as const, description: 'availability line', concept: 'availability' },
  { key: 'image', name: 'Image', type: 'image' as const, description: 'main product photo', concept: 'image_url' },
  { key: 'colors', name: 'Colours', type: 'text_list' as const, description: 'colour chips', concept: 'colors' },
  { key: 'rating', name: 'Rating', type: 'number' as const, description: 'stars', concept: 'rating' },
];
const set = {
  urls: U,
  expected: {
    product_name: { [U[0]!]: 'Widget A', [U[1]!]: 'Widget B', [U[2]!]: 'Widget C' },
    price: { [U[0]!]: '129.99', [U[1]!]: '219.99', [U[2]!]: '149.00' },
    in_stock: { [U[0]!]: 'yes', [U[1]!]: 'yes', [U[2]!]: 'no' },
    image: { [U[0]!]: 'https://shop.example/img/a.jpg', [U[1]!]: 'https://shop.example/img/b.jpg', [U[2]!]: 'https://shop.example/img/c.jpg' },
    colors: { [U[0]!]: 'Red, Blue', [U[1]!]: 'Green', [U[2]!]: 'Black, White, Grey' },
    rating: { [U[0]!]: '4.5', [U[1]!]: '3.8', [U[2]!]: '4.9' },
  },
};

let browser: PlaywrightBrowser;
beforeAll(async () => { browser = new PlaywrightBrowser(); await browser.launch({ headless: true }); });
afterAll(async () => { await browser.close(); });

describe('runVerification (shop-example, offline)', () => {
  it('certifies every field mechanically with zero AI calls', async () => {
    const run = await runVerification({ fields, verificationSet: set }, { browser, agent: null, captures: loadShopExample() });
    expect(run.outcome.allPassed).toBe(true);
    expect(run.outcome.aiCalls).toBe(0);
    expect(run.outcome.fields.price!.certified[0]).toEqual({ source: 'api', path: 'item.priceCents', transform: 'cents_to_units' });
    expect(run.outcome.fields.price!.certified.some((p) => p.source === 'xpath' && p.path.endsWith('span[@class="now"]'))).toBe(true);
    expect(run.outcome.fields.price!.certified.some((p) => p.path.includes("'129.99'"))).toBe(false);
  }, 60_000);

  it('a wrong expected value fails one cell with different_value and the field stays uncertified', async () => {
    const bad = { ...set, expected: { ...set.expected, price: { ...set.expected.price, [U[2]!]: '145.00' } } };
    const run = await runVerification({ fields: [fields[1]!], verificationSet: bad }, { browser, agent: null, captures: loadShopExample() });
    expect(run.outcome.allPassed).toBe(false);
    expect(run.outcome.fields.price!.cells[U[2]!]).toMatchObject({ status: 'fail', reason: 'different_value', found: expect.stringContaining('149') });
  }, 60_000);

  it('a stubborn field asks the agent once; a bad proposal is discarded, a good one certifies', async () => {
    const stubborn = [{ key: 'sku', name: 'SKU', type: 'text' as const, description: 'item number', concept: 'sku' }];
    // The SKU is readable only as an attribute (span.sku's data-sku) that the mechanical
    // DOM search never scans (it only scans href/src/content), and `item.code` never equals
    // the customer's typed short code ("SKU-A1" ≠ "A1") — nothing matches mechanically.
    const skuSet = { urls: U, expected: { sku: { [U[0]!]: 'A1', [U[1]!]: 'B2', [U[2]!]: 'C3' } } };
    let calls = 0;
    const agent = { proposePaths: async () => { calls++; return [
      { source: 'api' as const, path: 'item.code', transform: 'identity' as const },      // "SKU-A1" ≠ "A1" → discarded
      { source: 'xpath' as const, path: '//*[@id="main"]/span[@class="sku"]/@data-sku', transform: 'identity' as const }, // "A1" → certifies
    ]; } };
    const run = await runVerification({ fields: stubborn, verificationSet: skuSet }, { browser, agent, captures: loadShopExample() });
    expect(calls).toBe(1);
    expect(run.outcome.aiCalls).toBe(1);
    expect(run.outcome.fields.sku!.aiCalled).toBe(true);
    expect(run.outcome.fields.sku!.certified).toEqual([{ source: 'xpath', path: '//*[@id="main"]/span[@class="sku"]/@data-sku', transform: 'identity' }]);

    // Without an agent, the mechanical pass genuinely cannot find it — proving the field
    // is authentically stubborn rather than certifying by coincidence.
    const noAgentRun = await runVerification({ fields: stubborn, verificationSet: skuSet }, { browser, agent: null, captures: loadShopExample() });
    expect(noAgentRun.outcome.fields.sku!.certified).toEqual([]);
    for (const url of U) {
      expect(noAgentRun.outcome.fields.sku!.cells[url]).toMatchObject({ status: 'fail', reason: 'not_found' });
    }
  }, 60_000);

  it('a failing capture marks the column not_captured and records the error', async () => {
    const caps = loadShopExample();
    delete caps[U[2]!];
    const run = await runVerification({ fields: [fields[0]!], verificationSet: set }, { browser, agent: null, captures: caps, captureOne: async () => { throw new Error('blocked'); } });
    expect(run.captureErrors[U[2]!]).toBe('blocked');
    expect(run.outcome.fields.product_name!.cells[U[2]!]).toEqual({ status: 'not_captured' });
    expect(run.outcome.allPassed).toBe(false);
  }, 60_000);

  it('onlyKeys re-runs a subset and copies the rest from previous', async () => {
    const first = await runVerification({ fields, verificationSet: set }, { browser, agent: null, captures: loadShopExample() });
    const second = await runVerification({ fields, verificationSet: set }, { browser, agent: null, captures: loadShopExample(), onlyKeys: ['price'], previous: first.outcome });
    expect(second.outcome.fields.product_name).toEqual(first.outcome.fields.product_name);
    expect(second.outcome.allPassed).toBe(true);
  }, 60_000);

  it('cached verified paths are tried first and skip the search', async () => {
    let searched = false;
    const run = await runVerification({ fields: [fields[1]!], verificationSet: set }, {
      browser, agent: null, captures: loadShopExample(),
      cachedPaths: async (concept) => concept === 'price' ? [{ source: 'json-ld', path: 'offers.price', transform: 'identity' }] : [],
      captureOne: async () => { searched = true; throw new Error('should not capture'); },
    });
    expect(run.outcome.fields.price!.certified).toEqual([{ source: 'json-ld', path: 'offers.price', transform: 'identity' }]);
    expect(searched).toBe(false);
  }, 60_000);
});

describe('definitionHash', () => {
  it('is stable across key order and changes with any value', () => {
    const a = definitionHash(fields, set);
    const b = definitionHash([...fields].reverse(), set);
    expect(a).not.toBe(b); // order is part of the definition
    expect(definitionHash(fields, { ...set, listing_url: 'https://shop.example/c' })).not.toBe(a);
    expect(definitionHash(fields, set)).toBe(a);
  });
});
