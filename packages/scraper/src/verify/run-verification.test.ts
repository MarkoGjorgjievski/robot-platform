import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PlaywrightBrowser, verdictSentence } from '@robot/browser';
import type { IBrowser } from '@robot/browser';
import { runVerification, definitionHash, fieldHash } from './run-verification.js';
import type { FieldVerification, SchemaDefinitionField, VerificationSet } from './types.js';
import { loadShopExample, SHOP_EXAMPLE_URLS as U, loadVerifyFixture, SHOP_EXAMPLE_P4 as P4 } from '../__fixtures__/verify/load.js';

/** A capture with no signal: empty html, nothing intercepted or embedded. */
const emptyCapture = (url: string) => ({
  url,
  html: '<html></html>',
  title: '',
  markdown: '',
  screenshot: Buffer.alloc(0),
  screenshotTiles: [],
  verdict: { kind: 'ok' as const, status: 200 },
  timestamp: 0,
  structuredData: { ldJson: [], nextData: null, initialState: null, meta: {} },
  interceptedRequests: [],
});

/** Offline deps: no real browser, no agent, captures resolve to blank pages. */
function fakeDeps(_set: VerificationSet) {
  return {
    browser: {
      setContentEvaluate: async () => [],
    } as unknown as IBrowser,
    agent: null,
    captureOne: async (_b: IBrowser, url: string) => emptyCapture(url),
  };
}

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

  // I1: a field not checked on a page (blank expected value, allowed on
  // pages four to six) must not be shown that page's evidence when the
  // mechanical pass fails and the AI fallback is asked.
  it('the AI fallback sees only the pages the field is checked on', async () => {
    const stubborn = [{ key: 'sku', name: 'SKU', type: 'text' as const, description: 'item number', concept: 'sku' }];
    const skuSet4: VerificationSet = {
      urls: [...U, P4],
      expected: { sku: { [U[0]!]: 'A1', [U[1]!]: 'B2', [U[2]!]: 'C3', [P4]: '' } }, // blank on P4: not checked there
    };
    const captures4 = { ...loadShopExample(), [P4]: loadVerifyFixture('shop-example', 'p4') };
    let seenPrompt = '';
    const agent = { proposePaths: async (prompt: string) => {
      seenPrompt = prompt;
      return [{ source: 'xpath' as const, path: '//*[@id="main"]/span[@class="sku"]/@data-sku', transform: 'identity' as const }];
    } };
    const run = await runVerification({ fields: stubborn, verificationSet: skuSet4 }, { browser, agent, captures: captures4 });
    expect(run.outcome.aiCalls).toBe(1);
    expect(seenPrompt).not.toContain(P4);
    expect(seenPrompt).not.toMatch(/→\s*(\n|$)/); // no blank-value arrow line for any page
  }, 60_000);

  it('a failing capture marks the column not_captured and records the error', async () => {
    const caps = loadShopExample();
    delete caps[U[2]!];
    const run = await runVerification({ fields: [fields[0]!], verificationSet: set }, { browser, agent: null, captures: caps, captureOne: async () => { throw new Error('blocked'); } });
    expect(run.captureErrors[U[2]!]).toBe('blocked');
    expect(run.outcome.fields.product_name!.cells[U[2]!]).toEqual({ status: 'not_captured' });
    expect(run.outcome.allPassed).toBe(false);
  }, 60_000);

  // I4: a block page served AT the requested path passes `samePath`, so it
  // used to be handed to the certifier as if it were the product page —
  // every field failing `not_found`, blaming the customer's expected values
  // for a page we never actually got. The capture's verdict (decided in the
  // browser, 2026-10-09) makes it an honest `not_captured` instead.
  it('a blocked page at the right URL is not_captured with the block reason, not not_found', async () => {
    const caps = loadShopExample();
    delete caps[U[2]!];
    // A CAPTCHA page the browser classified as a challenge.
    const blocked = {
      url: U[2]!,
      html: '<html><head><title>Captcha</title></head><body><p>Verify you are human.</p></body></html>',
      markdown: '',
      screenshot: Buffer.alloc(0),
      screenshotTiles: [],
      verdict: { kind: 'challenge' as const, status: 200, vendor: 'unknown' as const },
      title: 'Captcha',
      timestamp: 0,
      structuredData: { ldJson: [], nextData: null, initialState: null, meta: {} },
      interceptedRequests: [],
    };
    const stages: string[] = [];

    const run = await runVerification({ fields: [fields[0]!], verificationSet: set }, {
      browser, agent: null, captures: caps,
      captureOne: async () => blocked,
      onProgress: (stage) => stages.push(stage),
    });

    expect(run.captureErrors[U[2]!]).toBe(verdictSentence(blocked.verdict, U[2]!));
    expect(run.captures[U[2]!]).toBeNull();
    expect(run.outcome.fields.product_name!.cells[U[2]!]).toEqual({ status: 'not_captured' });
    expect(run.outcome.fields.product_name!.incomplete).toBe(true);
    expect(run.outcome.allPassed).toBe(false);
    // Progress is still reported for the page we tried and lost.
    expect(stages).toContain(`capturing 3/${U.length}`);
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

describe('fieldHash / definitionHash', () => {
  const set: VerificationSet = {
    urls: ['https://s.example/1', 'https://s.example/2', 'https://s.example/3'],
    expected: {
      price: { 'https://s.example/1': '1', 'https://s.example/2': '2', 'https://s.example/3': '3' },
      title: { 'https://s.example/1': 'a', 'https://s.example/2': 'b', 'https://s.example/3': 'c' },
    },
  };
  const price: SchemaDefinitionField = { key: 'price', name: 'Price', type: 'money', description: 'green', concept: 'price' };
  const title: SchemaDefinitionField = { key: 'title', name: 'Title', type: 'text', description: 'h1', concept: 'product_name' };

  it('is stable and ignores the field name', () => {
    expect(fieldHash(price, set)).toBe(fieldHash({ ...price, name: 'Cost' }, set));
    expect(definitionHash([price, title], set)).toBe(definitionHash([{ ...price, name: 'Cost' }, title], set));
  });
  it('changes with type, description, urls, or that field\'s expected values only', () => {
    const h = fieldHash(price, set);
    expect(fieldHash({ ...price, type: 'number' }, set)).not.toBe(h);
    expect(fieldHash({ ...price, description: 'red' }, set)).not.toBe(h);
    expect(fieldHash(price, { ...set, urls: [...set.urls].reverse() })).not.toBe(h);
    expect(fieldHash(price, { ...set, expected: { ...set.expected, price: { ...set.expected.price, 'https://s.example/1': '9' } } })).not.toBe(h);
    expect(fieldHash(price, { ...set, expected: { ...set.expected, title: { ...set.expected.title, 'https://s.example/1': 'zzz' } } })).toBe(h);
  });
});

describe('runVerification per-field copy-forward', () => {
  it('stamps fieldHash on every computed result and copies a previous result only when its hash still matches', async () => {
    const set: VerificationSet = {
      urls: ['https://s.example/1', 'https://s.example/2', 'https://s.example/3'],
      expected: {
        price: { 'https://s.example/1': '1', 'https://s.example/2': '2', 'https://s.example/3': '3' },
        title: { 'https://s.example/1': 'a', 'https://s.example/2': 'b', 'https://s.example/3': 'c' },
      },
    };
    const price: SchemaDefinitionField = { key: 'price', name: 'Price', type: 'money', description: 'green', concept: 'price' };
    const title: SchemaDefinitionField = { key: 'title', name: 'Title', type: 'text', description: 'h1', concept: 'product_name' };
    const stale: FieldVerification = { key: 'title', cells: {}, certified: [{ source: 'meta', path: 'og:title', transform: 'identity' }], weakEvidence: false, aiCalled: false, incomplete: false, fieldHash: 'not-the-current-hash' };
    const fresh: FieldVerification = { ...stale, fieldHash: fieldHash(title, set) };

    const deps = fakeDeps(set); // offline deps: captures resolve to blank pages, no agent — a re-run finds nothing
    const a = await runVerification({ fields: [price, title], verificationSet: set }, { ...deps, onlyKeys: ['price'], previous: { fields: { title: stale }, allPassed: false, aiCalls: 0 } });
    expect(a.outcome.fields.title.fieldHash).toBe(fieldHash(title, set)); // recomputed, not copied
    expect(a.outcome.fields.title.certified).toEqual([]);                // the stub finds nothing, proving it re-ran
    expect(a.outcome.fields.price.fieldHash).toBe(fieldHash(price, set));

    const b = await runVerification({ fields: [price, title], verificationSet: set }, { ...deps, onlyKeys: ['price'], previous: { fields: { title: fresh }, allPassed: false, aiCalls: 0 } });
    expect(b.outcome.fields.title).toBe(fresh);                          // copied as-is
  });
});

describe('runVerification — a fourth proof page for one field (spec 2026-09-17)', () => {
  const blank = (key: keyof typeof set.expected) => ({ ...set.expected[key], [P4]: '' });
  const set4: VerificationSet = {
    urls: [...U, P4],
    expected: {
      product_name: blank('product_name'), in_stock: blank('in_stock'), image: blank('image'),
      colors: blank('colors'), rating: blank('rating'),
      price: { ...set.expected.price, [P4]: '89.50' },
    },
  };
  const captures4 = () => ({ ...loadShopExample(), [P4]: loadVerifyFixture('shop-example', 'p4') });

  it('certifies price across both layouts mechanically, and leaves the other fields exactly as they were', async () => {
    const before = await runVerification({ fields, verificationSet: set }, { browser, agent: null, captures: loadShopExample() });
    const run = await runVerification({ fields, verificationSet: set4 }, { browser, agent: null, captures: captures4() });
    expect(run.outcome.allPassed).toBe(true);
    expect(run.outcome.aiCalls).toBe(0);
    const price = run.outcome.fields.price!;
    expect(price.certified.length).toBeGreaterThanOrEqual(2);
    expect(price.certified[0]!.provenOn).toEqual(U);
    expect(price.certified.some((p) => p.provenOn?.length === 1 && p.provenOn[0] === P4)).toBe(true);
    expect(price.cells[P4]).toMatchObject({ status: 'pass' });
    expect(price.thinEvidence).toBe(true);
    // The others are not checked on page 4: same cells, same paths, same hash.
    for (const key of ['product_name', 'in_stock', 'image', 'colors', 'rating']) {
      expect(run.outcome.fields[key]!.certified).toEqual(before.outcome.fields[key]!.certified);
      expect(Object.keys(run.outcome.fields[key]!.cells)).toEqual(U);
      expect(run.outcome.fields[key]!.fieldHash).toBe(before.outcome.fields[key]!.fieldHash);
    }
    expect(price.fieldHash).not.toBe(before.outcome.fields.price!.fieldHash);
  }, 60_000);

  it('a scoped re-verify of price reuses the other fields\' stored results even though the url list grew', async () => {
    const before = await runVerification({ fields, verificationSet: set }, { browser, agent: null, captures: loadShopExample() });
    const run = await runVerification(
      { fields, verificationSet: set4 },
      { browser, agent: null, captures: captures4(), onlyKeys: ['price'], previous: before.outcome },
    );
    for (const key of ['product_name', 'in_stock', 'image', 'colors', 'rating']) {
      expect(run.outcome.fields[key]).toBe(before.outcome.fields[key]); // the same object: reused, not recomputed
    }
    expect(run.outcome.fields.price!.cells[P4]).toMatchObject({ status: 'pass' });
  }, 60_000);

  it('still refuses to reuse a stored result proven against a page that is no longer a proof page', async () => {
    const before = await runVerification({ fields, verificationSet: set }, { browser, agent: null, captures: loadShopExample() });
    const moved: VerificationSet = { urls: [U[0]!, U[1]!, P4], expected: Object.fromEntries(Object.entries(set.expected).map(([k, v]) => [k, { [U[0]!]: v[U[0]!]!, [U[1]!]: v[U[1]!]!, [P4]: k === 'price' ? '89.50' : 'x' }])) };
    const run = await runVerification(
      { fields, verificationSet: moved },
      { browser, agent: null, captures: captures4(), onlyKeys: ['price'], previous: before.outcome },
    );
    expect(run.outcome.fields.product_name).not.toBe(before.outcome.fields.product_name);
  }, 60_000);
});

describe('fieldHash — per-field pages', () => {
  const f = fields[1]!; // price
  it('is unchanged for a field with a value on every page (existing certifications stay current)', () => {
    // Pinned literal: computed on main before this change. If this fails, every stored certification goes stale.
    expect(fieldHash(f, set)).toBe('fed4a2b94eb6c4a43d1582e1d4536499b969e14147d7f3b13620165eaf1664f2');
    expect(fieldHash(f, set)).toBe(fieldHash(f, { ...set, expected: { ...set.expected } }));
    expect(fieldHash(fields[0]!, set)).toBe(fieldHash(fields[0]!, { urls: [...U, P4], expected: { ...set.expected, product_name: { ...set.expected.product_name, [P4]: '' } } }));
  });
  it('changes when the field gains a checked page', () => {
    expect(fieldHash(f, set)).not.toBe(fieldHash(f, { urls: [...U, P4], expected: { ...set.expected, price: { ...set.expected.price, [P4]: '89.50' } } }));
  });
});

describe('runVerification — each proof page is captured with a ready check built from its own expected values', () => {
  it('hands captureOne a check that waits for what was typed on THAT page, after the expand round, with a grace', async () => {
    const page4 = 'https://shop.example/p/4';
    const withPage4: VerificationSet = {
      urls: [...U, page4],
      expected: Object.fromEntries(Object.entries(set.expected).map(([k, cells]) => [k, { ...cells, [page4]: k === 'price' ? '89.50' : '' }])),
    };
    const seen: Record<string, { when?: string; graceQuietMs?: number; script: string } | undefined> = {};
    await runVerification({ fields, verificationSet: withPage4 }, {
      browser: { setContentEvaluate: async () => [] } as unknown as IBrowser,
      agent: null,
      captureOne: async (_b, url, ready) => { seen[url] = ready; return emptyCapture(url); },
    });
    expect(Object.keys(seen)).toEqual([...U, page4]);
    expect(seen[U[0]!]!.when).toBe('after-expand');
    expect(seen[U[0]!]!.graceQuietMs).toBeGreaterThan(0);
    // Page one is checked for every field; page four only for price.
    expect(seen[U[0]!]!.script).toContain('"expected":"Widget A"');
    expect(seen[page4]!.script).toContain('"expected":"89.50"');
    expect(seen[page4]!.script).not.toContain('"key":"product_name"');
  });
});

describe('runVerification — a cached certification that rests on a volatile XPath is not replayed as is', () => {
  it('searches again, and the stable paths it finds replace the volatile one', async () => {
    // Resolves on all three fixture pages, and carries a build hash the way Ikea's stored XPaths do.
    const volatile = { source: 'xpath' as const, path: '//div[@id="main" or @data-cv="634a7e0"]/span[@class="rating"]', transform: 'identity' as const };
    const rating = fields.filter((f) => f.key === 'rating');
    const only = { urls: U, expected: { rating: set.expected.rating } };
    const run = await runVerification({ fields: rating, verificationSet: only }, {
      browser, agent: null, captures: loadShopExample(),
      cachedPaths: async () => [volatile],
    });
    const certified = run.outcome.fields.rating!.certified;
    expect(certified.length).toBeGreaterThan(0);
    expect(certified.map((p) => p.path)).not.toContain(volatile.path);
  }, 60_000);
  it('a cached certification built on stable paths is still replayed without a search', async () => {
    const stable = { source: 'api' as const, path: 'item.rating', transform: 'identity' as const };
    const rating = fields.filter((f) => f.key === 'rating');
    const only = { urls: U, expected: { rating: set.expected.rating } };
    const run = await runVerification({ fields: rating, verificationSet: only }, {
      // setContentEvaluate would be the DOM search; it must not be needed.
      browser: { setContentEvaluate: async () => { throw new Error('searched the DOM although the cached path certifies'); } } as unknown as IBrowser,
      agent: null, captures: loadShopExample(),
      cachedPaths: async () => [stable],
    });
    expect(run.outcome.fields.rating!.certified).toEqual([stable]);
  }, 60_000);
});

// Spec 2026-09-29 C1: the path the customer confirmed is part of the field's definition.
describe('fieldHash / definitionHash — confirmed paths', () => {
  const P = ['https://s.example/1', 'https://s.example/2', 'https://s.example/3'];
  const inStock: SchemaDefinitionField = { key: 'in_stock', name: 'In stock', type: 'boolean', description: 'x', concept: 'availability' };
  const base: VerificationSet = {
    urls: P,
    expected: { in_stock: { [P[0]!]: 'yes', [P[1]!]: 'yes', [P[2]!]: 'no' } },
    marks: { in_stock: { [P[0]!]: { xpaths: ['//p'], text: 'In stock', rect: { x: 1, y: 2, w: 3, h: 4 } } } },
  };

  it('is byte-identical for a set without paths (existing verified websites stay current)', () => {
    // Pinned literals: computed on 594d93d (before `paths` existed) for this exact set.
    expect(fieldHash(inStock, base)).toBe('573a8acda4c1322d1b75aebb632f3c16a5b198f4f66df67d6451d2d741c70822');
    expect(definitionHash([inStock], base)).toBe('d8eb28f538b9265b31b9b9a5a2a38d1769a1a58eacbc7e1c8a867a2c6634402c');
    // An empty `paths` record, or one for another field, changes nothing either.
    expect(fieldHash(inStock, { ...base, paths: {} })).toBe(fieldHash(inStock, base));
    expect(fieldHash(inStock, { ...base, paths: { price: { [P[0]!]: { source: 'api', path: 'x' } } } })).toBe(fieldHash(inStock, base));
    expect(definitionHash([inStock], { ...base, paths: {} })).toBe(definitionHash([inStock], base));
  });

  it('changes when a confirmed path is added or changed on a checked page', () => {
    const withPath = { ...base, paths: { in_stock: { [P[0]!]: { source: 'json-ld' as const, path: 'offers.availability' } } } };
    expect(fieldHash(inStock, withPath)).not.toBe(fieldHash(inStock, base));
    expect(definitionHash([inStock], withPath)).not.toBe(definitionHash([inStock], base));
    const changed = { ...base, paths: { in_stock: { [P[0]!]: { source: 'api' as const, path: 'priority' } } } };
    expect(fieldHash(inStock, changed)).not.toBe(fieldHash(inStock, withPath));
    expect(definitionHash([inStock], changed)).not.toBe(definitionHash([inStock], withPath));
  });

  it('ignores a confirmed path on a page the field is not checked on', () => {
    const P4x = 'https://s.example/4';
    const four: VerificationSet = { ...base, urls: [...P, P4x], expected: { in_stock: { ...base.expected.in_stock, [P4x]: '' } } };
    expect(fieldHash(inStock, { ...four, paths: { in_stock: { [P4x]: { source: 'api', path: 'priority' } } } })).toBe(fieldHash(inStock, four));
  });
});

describe('runVerification — confirmed paths and marks reach certification', () => {
  const inStock: SchemaDefinitionField = { key: 'in_stock', name: 'In stock', type: 'boolean', description: 'x', concept: 'availability' };
  // Three in-stock products: an unrelated API field is 1 everywhere, JSON-LD says InStock.
  const capture = (url: string) => ({
    ...emptyCapture(url),
    structuredData: { ldJson: [{ '@type': 'Product', offers: { availability: 'https://schema.org/InStock' } }], nextData: null, initialState: null, meta: {} },
    interceptedRequests: [{ url: `${url}/api`, method: 'GET', status: 200, isJson: true, parsedJson: { priority: 1 } }],
  }) as unknown as import('@robot/browser').PageCapture;
  const caps = Object.fromEntries(U.map((u) => [u, capture(u)]));
  const stockSet: VerificationSet = { urls: U, expected: { in_stock: Object.fromEntries(U.map((u) => [u, 'yes'])) } };
  const offline = { setContentEvaluate: async () => [] } as unknown as IBrowser;
  const priority = { source: 'api' as const, path: 'priority', transform: 'identity' as const };

  it('the domain-cache shortcut does not replay a cached path that does not fit a yes/no field', async () => {
    const run = await runVerification({ fields: [inStock], verificationSet: stockSet }, { browser: offline, agent: null, captures: caps, cachedPaths: async () => [priority] });
    expect(run.outcome.fields.in_stock!.certified.map((p) => `${p.source} ${p.path}`)).toEqual(['json-ld offers.availability']);
  });

  it('a confirmed path reaches the cache shortcut and is certified first', async () => {
    const confirmed: VerificationSet = { ...stockSet, paths: { in_stock: Object.fromEntries(U.map((u) => [u, { source: 'api' as const, path: 'priority' }])) } };
    const run = await runVerification({ fields: [inStock], verificationSet: confirmed }, {
      browser: { setContentEvaluate: async () => { throw new Error('searched although the cached, confirmed path certifies'); } } as unknown as IBrowser,
      agent: null, captures: caps, cachedPaths: async () => [priority],
    });
    expect(run.outcome.fields.in_stock!.certified[0]).toMatchObject({ source: 'api', path: 'priority' });
  });

  it('a confirmed path reaches certification of the gathered set and goes first', async () => {
    const price = fields[1]!;
    const confirmed: VerificationSet = { urls: U, expected: { price: set.expected.price }, paths: { price: { [U[0]!]: { source: 'json-ld', path: 'offers.price' } } } };
    const run = await runVerification({ fields: [price], verificationSet: confirmed }, { browser, agent: null, captures: loadShopExample() });
    expect(run.outcome.fields.price!.certified[0]).toMatchObject({ source: 'json-ld', path: 'offers.price' });
  }, 60_000);

  it('a mark qualifies a yes/no field\'s DOM path; an unmarked one does not', async () => {
    const stock = fields[2]!; // in_stock, yes / yes / no
    const only: VerificationSet = { urls: U, expected: { in_stock: set.expected.in_stock } };
    const plain = await runVerification({ fields: [stock], verificationSet: only }, { browser, agent: null, captures: loadShopExample() });
    expect(plain.outcome.fields.in_stock!.certified.every((p) => p.source !== 'xpath')).toBe(true);
    const MARK = '//*[@id="main"]/p[@class="stock"]';
    const marked: VerificationSet = { ...only, marks: { in_stock: { [U[0]!]: { xpaths: [MARK], text: 'In stock', rect: { x: 0, y: 0, w: 1, h: 1 } } } } };
    const run = await runVerification({ fields: [stock], verificationSet: marked }, { browser, agent: null, captures: loadShopExample() });
    expect(run.outcome.fields.in_stock!.certified.map((p) => p.path)).toContain(MARK);
  }, 60_000);
});

// controller ruling, follow-up 3: a field whose result has every captured
// cell failing with no_fitting_path cannot be rescued by an AI XPath
// proposal — a weak field's DOM hits never qualify unless marked — so the
// paid fallback must not be asked.
describe('runVerification — the AI fallback is skipped when nothing can fit a weak field', () => {
  it('does not ask the agent when every checked page fails with no_fitting_path', async () => {
    const inStock = fields[2]!; // in_stock, boolean, concept 'availability'
    const only: VerificationSet = { urls: U, expected: { in_stock: Object.fromEntries(U.map((u) => [u, 'yes'])) } };
    // Direct `captures` (not `captureOne`) so an empty page is used as-is, never routed through
    // captureProblem's gate — that would turn a non-ok verdict into not_captured, not fail.
    const caps = Object.fromEntries(U.map((u) => [u, emptyCapture(u)])) as unknown as Record<string, import('@robot/browser').PageCapture>;
    const offlineBrowser = { setContentEvaluate: async () => [] } as unknown as IBrowser;
    let calls = 0;
    const agent = { proposePaths: async () => { calls++; return []; } };
    const run = await runVerification({ fields: [inStock], verificationSet: only }, {
      browser: offlineBrowser, agent, captures: caps,
    });
    expect(calls).toBe(0);
    expect(run.outcome.aiCalls).toBe(0);
    for (const url of U) {
      expect(run.outcome.fields.in_stock!.cells[url]).toMatchObject({ status: 'fail', reason: 'no_fitting_path' });
    }
  });

  it('still asks the agent for an ordinary non-weak failure', async () => {
    const stubborn = [{ key: 'sku', name: 'SKU', type: 'text' as const, description: 'item number', concept: 'sku' }];
    const skuSet = { urls: U, expected: { sku: { [U[0]!]: 'A1', [U[1]!]: 'B2', [U[2]!]: 'C3' } } };
    let calls = 0;
    const agent = { proposePaths: async () => { calls++; return [
      { source: 'xpath' as const, path: '//*[@id="main"]/span[@class="sku"]/@data-sku', transform: 'identity' as const },
    ]; } };
    const run = await runVerification({ fields: stubborn, verificationSet: skuSet }, { browser, agent, captures: loadShopExample() });
    expect(calls).toBe(1);
    expect(run.outcome.aiCalls).toBe(1);
  }, 60_000);
});
