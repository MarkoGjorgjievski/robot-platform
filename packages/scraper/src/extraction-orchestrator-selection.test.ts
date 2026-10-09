// Task 7 fix round: the reviewer's trace showed the selection/displayed hoist
// added in 7dba85d never changes served values through the real pipeline.
// `finalData` is field-name-keyed and every writer goes through `tryAssign`,
// which writes it once — so by the time `resolveFromCache`'s hoist ran, every
// candidate for a field resolved to the SAME already-decided value. These
// tests exercise the fix through `runExtraction` end-to-end: a selection (or
// displayed-default) must change what actually ends up in `outcome.data`,
// not just reorder a list nobody reads.

import { describe, it, expect } from 'vitest';
import type { IBrowser, PageCapture, CrawlPage, CrawlOptions, ScrollOptions, InterceptedRequest } from '@robot/browser';
import { runExtraction } from './extraction-orchestrator.js';
import type { DomainCache } from './domain-cache.js';
import type { CandidateCatalogue } from './candidate-catalogue.js';

function makeCapture(overrides: Partial<PageCapture> = {}): PageCapture {
  return {
    url: 'https://example.com/p/1',
    html: '<html><body><p>Realistic on-page content so checkPageHealth sees a real page rather than an empty interstitial. This paragraph only exists to carry the fixture past the almost-no-content gate.</p></body></html>',
    markdown: '',
    screenshot: Buffer.alloc(0),
    screenshotTiles: [],
    verdict: { kind: 'ok', status: 200 },
    title: 'Widget',
    timestamp: 0,
    structuredData: { ldJson: [], nextData: null, initialState: null, meta: {} },
    interceptedRequests: [],
    ...overrides,
  };
}

function makeCache(candidateCatalogue: CandidateCatalogue, fieldPaths: DomainCache['fieldPaths'] = {}): DomainCache {
  return {
    id: 'cache-1',
    domain: 'example.com',
    pageType: 'detail',
    apiEndpoints: [],
    fieldPaths,
    popupSelectors: [],
    hasJsonLd: false,
    hasNextData: false,
    totalRuns: 3,
    successfulRuns: 3,
    consecutiveFailures: 0,
    successRate: 100,
    paginationConfig: null,
    rowSelector: null,
    candidateCatalogue,
  };
}

class StaticBrowser implements IBrowser {
  setContentCalls: string[] = [];
  constructor(private pageCapture: PageCapture, private xpathData: Record<string, unknown> = {}) {}
  async launch(): Promise<void> {}
  async capture(): Promise<PageCapture> { return this.pageCapture; }
  async evaluate<T>(): Promise<T> { return { data: [], fieldCount: 0 } as T; }
  async setContentEvaluate<T>(_html: string, script: string): Promise<T> {
    this.setContentCalls.push(script);
    return { data: [this.xpathData], fieldCount: Object.keys(this.xpathData).length } as T;
  }
  async close(): Promise<void> {}
  async *crawl(_startUrl: string, _options: CrawlOptions): AsyncGenerator<CrawlPage> {}
  // eslint-disable-next-line require-yield
  async *scrollPages(_startUrl: string, _options: ScrollOptions): AsyncGenerator<CrawlPage> {
    throw new Error('not used');
  }
}

const INTERCEPTED: InterceptedRequest[] = [
  {
    url: 'https://example.com/api/product/1',
    method: 'GET',
    resourceType: 'xhr',
    responseStatus: 200,
    responseHeaders: {},
    responseBody: JSON.stringify({ MainItem: { FinalPrice: 399.99 } }),
    contentType: 'application/json',
    bodySize: 40,
    isJson: true,
    parsedJson: { MainItem: { FinalPrice: 399.99 } },
    timestamp: 0,
  },
];

describe('v2.5 selection/displayed serving through the real pipeline (task 7 fix)', () => {
  it('an explicit api-sourced selection ends up in outcome data even though mechanical would answer differently', async () => {
    const capture = makeCapture({
      // Mechanical extraction resolves `price` from json-ld (offers.price) —
      // a DIFFERENT value than the selected api candidate. Both are live
      // evidence; the point is that the selection must win over mechanical
      // even though mechanical also has a legitimate answer.
      structuredData: { ldJson: [{ offers: { price: 24.99 } }], nextData: null, initialState: null, meta: {} },
      interceptedRequests: INTERCEPTED,
    });
    const catalogue: CandidateCatalogue = {
      price: [
        { label: 'msrp', source: 'json-ld', path: 'offers.price', sampleValue: 24.99 },
        { label: 'final', source: 'api', path: 'MainItem.FinalPrice', sampleValue: 399.99 },
      ],
    };
    const browser = new StaticBrowser(capture);

    const outcome = await runExtraction(
      {
        url: 'https://example.com/p/1',
        fields: [{ name: 'price', type: 'number', candidate: { concept: 'price', label: 'final' } }],
        pageType: 'detail',
      },
      {
        browser,
        agent: null,
        capture,
        lookupCache: async () => makeCache(catalogue),
        saveCache: async () => {},
        acquireLock: async () => () => {},
      },
    );

    expect(outcome.data[0]?.price).toBe(399.99);
    expect(outcome.sources.price).toBe('api');
  });

  it('a selection whose path misses leaves the mechanical value in place', async () => {
    const capture = makeCapture({
      structuredData: { ldJson: [{ offers: { price: 24.99 } }], nextData: null, initialState: null, meta: {} },
      // No intercepted requests at all — the selected api candidate's path
      // cannot resolve to anything.
      interceptedRequests: [],
    });
    const catalogue: CandidateCatalogue = {
      price: [
        { label: 'msrp', source: 'json-ld', path: 'offers.price', sampleValue: 24.99 },
        { label: 'final', source: 'api', path: 'MainItem.FinalPrice', sampleValue: 399.99 },
      ],
    };
    const browser = new StaticBrowser(capture);

    const outcome = await runExtraction(
      {
        url: 'https://example.com/p/1',
        fields: [{ name: 'price', type: 'number', candidate: { concept: 'price', label: 'final' } }],
        pageType: 'detail',
      },
      {
        browser,
        agent: null,
        capture,
        lookupCache: async () => makeCache(catalogue),
        saveCache: async () => {},
        acquireLock: async () => () => {},
      },
    );

    // The selected path missed (no evidence) — the chain fell through to
    // mechanical extraction's own json-ld answer, as the spec requires.
    expect(outcome.data[0]?.price).toBe(24.99);
    expect(outcome.sources.price).toBe('json-ld');
  });

  it('without a selection, a displayed api/json-ld/meta candidate outranks mechanical', async () => {
    const capture = makeCapture({
      structuredData: { ldJson: [{ offers: { price: 24.99 } }], nextData: null, initialState: null, meta: {} },
      interceptedRequests: INTERCEPTED,
    });
    const catalogue: CandidateCatalogue = {
      price: [
        { label: 'msrp', source: 'json-ld', path: 'offers.price', sampleValue: 24.99 },
        { label: 'final', source: 'api', path: 'MainItem.FinalPrice', sampleValue: 399.99, displayed: true },
      ],
    };
    const browser = new StaticBrowser(capture);

    const outcome = await runExtraction(
      { url: 'https://example.com/p/1', fields: [{ name: 'price', type: 'number' }], pageType: 'detail' },
      {
        browser,
        agent: null,
        capture,
        lookupCache: async () => makeCache(catalogue),
        saveCache: async () => {},
        acquireLock: async () => () => {},
      },
    );

    expect(outcome.data[0]?.price).toBe(399.99);
    expect(outcome.sources.price).toBe('api');
  });

  it('an xpath-sourced selection overrides a value mechanical already assigned', async () => {
    // Mechanical resolves `price` from json-ld (offers.price = 24.99). The
    // customer's selection points at a DIFFERENT candidate — a "displayed"
    // marquee price rendered only in the DOM, so it can only be resolved by
    // executing its XPath against the captured HTML (STEP 1.5b's job). This
    // proves the override actually replaces mechanical's value, not just
    // that it resolves alongside it.
    const capture = makeCapture({
      html: '<html><body><span id="marquee-price">19.99</span><p>Realistic on-page content so checkPageHealth sees a real page rather than an empty interstitial. This paragraph only exists to carry the fixture past the almost-no-content gate.</p></body></html>',
      structuredData: { ldJson: [{ offers: { price: 24.99 } }], nextData: null, initialState: null, meta: {} },
      interceptedRequests: [],
    });
    const catalogue: CandidateCatalogue = {
      price: [
        { label: 'msrp', source: 'json-ld', path: 'offers.price', sampleValue: 24.99 },
        { label: 'displayed', source: 'xpath', path: '//span[@id="marquee-price"]', sampleValue: 19.99, displayed: true },
      ],
    };
    // Faked browser: whatever script STEP 1.5b builds, hand back the marquee value.
    const browser = new StaticBrowser(capture, { price: 19.99 });

    const outcome = await runExtraction(
      {
        url: 'https://example.com/p/1',
        fields: [{ name: 'price', type: 'number', candidate: { concept: 'price', label: 'displayed' } }],
        pageType: 'detail',
      },
      {
        browser,
        agent: null,
        capture,
        // No cached field paths — the pre-existing STEP 1.5 cached-XPath tier
        // (`buildCachedXPathScript(cache.fieldPaths, ...)`) has nothing to run
        // on, so the single setContentEvaluate call observed here is
        // unambiguously STEP 1.5b's override, not a coincidence of ordering.
        lookupCache: async () => makeCache(catalogue, {}),
        saveCache: async () => {},
        acquireLock: async () => () => {},
      },
    );

    expect(outcome.data[0]?.price).toBe(19.99);
    expect(outcome.sources.price).toBe('xpath');
    expect(browser.setContentCalls.length).toBe(1);
  });
});

describe('a pin outranks the displayed default through the real pipeline (final-review fix)', () => {
  // Neither candidate's dot-path (`Item.ValueA` / `Item.ValueB`) matches any
  // FIELD_ALIASES entry for "price", so mechanical extraction cannot resolve
  // the field on its own — the only routes to a value are STEP 0.4's
  // selection/displayed pass and STEP 1.5's cached-path tier, which is
  // exactly the seam under test.
  const INTERCEPTED_AB: InterceptedRequest[] = [
    {
      url: 'https://example.com/api/product/1',
      method: 'GET',
      resourceType: 'xhr',
      responseStatus: 200,
      responseHeaders: {},
      responseBody: JSON.stringify({ Item: { ValueA: 111, ValueB: 222 } }),
      contentType: 'application/json',
      bodySize: 40,
      isJson: true,
      parsedJson: { Item: { ValueA: 111, ValueB: 222 } },
      timestamp: 0,
    },
  ];
  const catalogue: CandidateCatalogue = {
    price: [
      { label: 'pinned', source: 'api', path: 'Item.ValueA', sampleValue: 111 },
      { label: 'displayed', source: 'api', path: 'Item.ValueB', sampleValue: 222, displayed: true },
    ],
  };
  const pinnedFieldPaths: DomainCache['fieldPaths'] = {
    price: {
      paths: [{
        path: 'Item.ValueA', source: 'api', confidence: 0.9, hits: 5, misses: 0,
        lastValue: 111, lastUsedAt: new Date().toISOString(), pinned: true,
      }],
      conflictCount: 0,
    },
  };
  const capture = makeCapture({
    structuredData: { ldJson: [], nextData: null, initialState: null, meta: {} },
    interceptedRequests: INTERCEPTED_AB,
  });

  it('without a selection, the operator pin serves — not the displayed default', async () => {
    const browser = new StaticBrowser(capture);
    const outcome = await runExtraction(
      { url: 'https://example.com/p/1', fields: [{ name: 'price', type: 'number' }], pageType: 'detail' },
      {
        browser,
        agent: null,
        capture,
        lookupCache: async () => makeCache(catalogue, pinnedFieldPaths),
        saveCache: async () => {},
        acquireLock: async () => () => {},
      },
    );

    expect(outcome.data[0]?.price).toBe(111);
  });

  it('an explicit selection still overrides the pin', async () => {
    const browser = new StaticBrowser(capture);
    const outcome = await runExtraction(
      {
        url: 'https://example.com/p/1',
        fields: [{ name: 'price', type: 'number', candidate: { concept: 'price', label: 'displayed' } }],
        pageType: 'detail',
      },
      {
        browser,
        agent: null,
        capture,
        lookupCache: async () => makeCache(catalogue, pinnedFieldPaths),
        saveCache: async () => {},
        acquireLock: async () => () => {},
      },
    );

    expect(outcome.data[0]?.price).toBe(222);
  });
});
