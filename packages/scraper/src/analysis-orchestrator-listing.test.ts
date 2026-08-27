// Listing analyze (mvp-simplification task 5) — a listing page's schema is a
// ROW shape, not one record: `runAnalysis({ pageType: 'listing' })` must
// report how many rows the page delivered, its pagination strategy, and a
// handful of detail-page links, alongside the usual schema. None of this was
// reachable before: `pageType: 'listing'` used to route through the
// detail-shaped cached-path replay, which never runs row extraction at all.
//
// Exercised entirely offline: the browser is a stub (capture is canned,
// setContentEvaluate returns fixed rows regardless of the script it's given —
// the REAL executor script is proven elsewhere, against real Chromium, in
// analysis-orchestrator-listing-fixture.test.ts).

import { describe, it, expect } from 'vitest';
import type { IBrowser, PageCapture } from '@robot/browser';
import { runAnalysis } from './analysis-orchestrator.js';
import type { AnalysisAgent } from './analysis-orchestrator.js';
import type { DomainCache, FieldPathSet } from './domain-cache.js';
import { DETAIL_URL_FIELD } from './crawl/enumerate-detail-urls.js';

const LISTING_CAPTURE: PageCapture = {
  url: 'https://shop.example.com/listing?page=1',
  html:
    '<html><head><link rel="next" href="https://shop.example.com/listing?page=2"></head>'
    + '<body><main><h1>Widgets</h1><p>Realistic on-page content so checkPageHealth sees a real '
    + 'page rather than an empty interstitial. This paragraph only exists to carry the fixture '
    + 'past the almost-no-content gate.</p></main></body></html>',
  markdown: '', screenshot: Buffer.from('png'), screenshotTiles: [],
  title: 'Widgets', timestamp: 0,
  structuredData: { ldJson: [], nextData: null, initialState: null, meta: {} },
  interceptedRequests: [],
};

const ROWS = [
  { [DETAIL_URL_FIELD]: 'https://shop.example.com/item/1', title: 'Widget One' },
  { [DETAIL_URL_FIELD]: 'https://shop.example.com/item/2', title: 'Widget Two' },
  { [DETAIL_URL_FIELD]: 'https://shop.example.com/item/3', title: 'Widget Three' },
];

const PLAN = {
  row_xpath: '//div[@class="row"]',
  fields: [
    { name: DETAIL_URL_FIELD, xpath: './/a', attribute: 'href', transform: 'absolute_url' as const },
    { name: 'title', xpath: './/h2', attribute: 'textContent', transform: 'trim' as const },
  ],
};

/** Serves one prepared capture; `setContentEvaluate`/`evaluate` return the
 *  canned ROWS for ANY script — the point of this test is the orchestration
 *  (rowsFound / sampleDetailUrls / paginationStrategy plumbing), not the
 *  XPath executor, which has its own coverage. */
function stubBrowser(overrides: Partial<IBrowser> = {}): IBrowser & { captureCalls: number } {
  const b = {
    captureCalls: 0,
    async launch() {},
    async capture() { b.captureCalls++; return LISTING_CAPTURE; },
    async evaluate<T>() { return { data: ROWS } as T; },
    async setContentEvaluate<T>() { return { data: ROWS } as T; },
    async close() {},
    ...overrides,
  };
  return b as IBrowser & { captureCalls: number };
}

function throwingAgent(label: string): AnalysisAgent {
  return {
    async discoverSchema() { throw new Error(`${label}: discoverSchema must not be called`); },
  };
}

/** A stub satisfying both `AnalysisAgent` and `ExtractionAgent` — the same
 *  shape the real `SchemaAgent` has in production. */
function makeAgent(overrides: Partial<{
  discoverSchema: AnalysisAgent['discoverSchema'];
}> = {}) {
  return {
    async discoverSchema(...args: Parameters<AnalysisAgent['discoverSchema']>) {
      if (overrides.discoverSchema) return overrides.discoverSchema(...args);
      return {
        page_type: 'listing' as const,
        description: 'x',
        fields: [{ name: 'title', type: 'string' as const, description: '', required: true, tier: 'discovered' as const }],
      };
    },
    async generateSelectors() { return PLAN; },
    async extractVariants() { throw new Error('extractVariants must not be called'); },
    async extractFromApi() { throw new Error('extractFromApi must not be called'); },
    async retrySelectorGeneration() { throw new Error('retrySelectorGeneration must not be called'); },
  };
}

describe('runAnalysis — listing, cache miss (AI discovery)', () => {
  it('discovers fields, ensures detail_url, and reports rows/pagination/samples from the SAME capture', async () => {
    const browser = stubBrowser();
    const saved: unknown[] = [];
    const out = await runAnalysis(
      { url: LISTING_CAPTURE.url, pageType: 'listing' },
      {
        browser,
        agent: makeAgent(),
        lookupCache: async () => null,
        saveCache: async (o) => { saved.push(o); },
      },
    );

    expect(out.schema.page_type).toBe('listing');
    const names = out.schema.fields.map((f) => f.name);
    expect(names).toContain(DETAIL_URL_FIELD);
    expect(names).toContain('title');
    expect(out.cached).toBe(false);
    expect(out.liveExamples).toBe(true);

    expect(out.listing).toBeDefined();
    expect(out.listing!.rowsFound).toBe(3);
    expect(out.listing!.sampleDetailUrls).toEqual(ROWS.map((r) => r[DETAIL_URL_FIELD]));
    expect(out.listing!.paginationStrategy).toBe('url-pattern');

    // No second navigation: the extraction chain reused the same capture.
    expect(browser.captureCalls).toBe(1);

    // A successful listing analyze warms the listing cache — through the
    // injected hook, never the real database.
    expect(saved).toHaveLength(1);
  });

  it('shows the FIRST row as the live example, with badges that say so', async () => {
    const out = await runAnalysis(
      { url: LISTING_CAPTURE.url, pageType: 'listing' },
      { browser: stubBrowser(), agent: makeAgent(), lookupCache: async () => null, saveCache: async () => {} },
    );

    const title = out.schema.fields.find((f) => f.name === 'title') as { example_value?: string; example_source?: string };
    expect(title.example_value).toBe('Widget One');
    expect(title.example_source).toBe('live');

    const detailUrl = out.schema.fields.find((f) => f.name === DETAIL_URL_FIELD) as { example_value?: string; example_source?: string };
    expect(detailUrl.example_value).toBe('https://shop.example.com/item/1');
    expect(detailUrl.example_source).toBe('live');
  });

  it('fails loudly rather than returning an empty schema when no agent is available', async () => {
    await expect(runAnalysis(
      { url: LISTING_CAPTURE.url, pageType: 'listing' },
      { browser: stubBrowser(), agent: null, lookupCache: async () => null },
    )).rejects.toThrow(/no agent available/i);
  });
});

describe('runAnalysis — listing, cache hit', () => {
  const fieldPaths: Record<string, FieldPathSet> = {
    title: {
      conflictCount: 0,
      paths: [{
        path: './/h2', source: 'xpath', confidence: 0.9,
        hits: 5, misses: 0, lastValue: 'Old Title', lastUsedAt: '2026-05-01T00:00:00.000Z',
      }],
    },
  };
  const cache = {
    domain: 'shop.example.com', pageType: 'listing', fieldPaths,
    totalRuns: 4, successfulRuns: 4, successRate: 100, rowSelector: null,
  } as DomainCache;

  it('uses the cached listing fields and never calls discoverSchema', async () => {
    const out = await runAnalysis(
      { url: LISTING_CAPTURE.url, pageType: 'listing' },
      {
        browser: stubBrowser(),
        agent: makeAgent({ discoverSchema: throwingAgent('cache-hit').discoverSchema }),
        lookupCache: async (_d, pt) => (pt === 'listing' ? cache : null),
        saveCache: async () => {},
      },
    );

    expect(out.cached).toBe(true);
    const names = out.schema.fields.map((f) => f.name);
    expect(names).toContain('title');
    expect(names).toContain(DETAIL_URL_FIELD);
    expect(out.listing!.rowsFound).toBe(3);
  });
});

describe('runAnalysis — listing hints (mvp-simplification task 6)', () => {
  // listingHints itself is unit-tested in page-hints.test.ts; these prove the
  // ATTACHMENT — the hub warning uses the SAME rowsFound/paginationStrategy
  // the caller sees in `out.listing`.

  it('is empty on the happy-path fixture (3 rows, url-pattern pagination)', async () => {
    const out = await runAnalysis(
      { url: LISTING_CAPTURE.url, pageType: 'listing' },
      { browser: stubBrowser(), agent: makeAgent(), lookupCache: async () => null, saveCache: async () => {} },
    );
    expect(out.listing!.rowsFound).toBe(3);
    expect(out.listing!.paginationStrategy).toBe('url-pattern');
    expect(out.hints).toEqual([]);
  });

  it('fires the hub warning when almost nothing came back and no pagination was detected', async () => {
    const THIN_ROWS = [ROWS[0]!];
    // Strip the <link rel="next"> so detectPaginationFromHtml finds nothing.
    const NO_PAGINATION_CAPTURE: PageCapture = {
      ...LISTING_CAPTURE,
      html: LISTING_CAPTURE.html.replace('<link rel="next" href="https://shop.example.com/listing?page=2">', ''),
    };
    const out = await runAnalysis(
      { url: LISTING_CAPTURE.url, pageType: 'listing' },
      {
        browser: stubBrowser({
          async capture() { return NO_PAGINATION_CAPTURE; },
          async evaluate<T>() { return { data: THIN_ROWS } as T; },
          async setContentEvaluate<T>() { return { data: THIN_ROWS } as T; },
        }),
        agent: makeAgent(), lookupCache: async () => null, saveCache: async () => {},
      },
    );
    expect(out.listing!.rowsFound).toBe(1);
    expect(out.listing!.paginationStrategy).toBeNull();
    expect(out.hints).toEqual([
      "This doesn't look like a listing — it may be a hub/featured page; the real listing is often behind a 'shop all' link.",
    ]);
  });
});

describe('runAnalysis — listing, blocked page', () => {
  const BLOCKED: PageCapture = {
    ...LISTING_CAPTURE,
    title: 'Just a moment',
    html: '<html><body>Our system have detected unusual traffic. Verify you are human. Ray ID a312c62f. cloudflare</body></html>',
  };

  it('reports the block, runs no extraction, and produces no listing report', async () => {
    const out = await runAnalysis(
      { url: LISTING_CAPTURE.url, pageType: 'listing' },
      {
        browser: stubBrowser({
          async capture() { return BLOCKED; },
          async setContentEvaluate() { throw new Error('must not be called on a blocked page'); },
        }),
        agent: throwingAgent('blocked'),
        lookupCache: async () => null,
      },
    );

    expect(out.blockedReason).toMatch(/human|cloudflare|block/i);
    expect(out.liveExamples).toBe(false);
    expect(out.listing).toBeUndefined();
    expect(out.hints).toEqual([]);
  });
});
