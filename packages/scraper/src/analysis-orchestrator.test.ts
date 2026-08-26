// Schema discovery, exercised without a browser, a database or an API key.
//
// None of this was reachable from a test while it lived inside the tRPC
// procedure: the cache-hit path is the one that runs for every known domain, and
// it is where the wizard's example values come from.

import { describe, it, expect } from 'vitest';
import type { IBrowser, PageCapture } from '@robot/browser';
import { runAnalysis } from './analysis-orchestrator.js';
import type { DomainCache, FieldPathSet } from './domain-cache.js';

const CAPTURE: PageCapture = {
  url: 'https://shop.example.com/p/1',
  html: '<html><body><main><h1>Widget</h1><p>Realistic on-page content so checkPageHealth sees a real page rather than an empty interstitial. This paragraph only exists to carry the fixture past the almost-no-content gate.</p></main></body></html>',
  markdown: '', screenshot: Buffer.from('png'), screenshotTiles: [],
  title: 'Widget', timestamp: 0,
  structuredData: { ldJson: [], nextData: null, initialState: null, meta: {} },
  interceptedRequests: [],
};

/** Serves one prepared capture and refuses to evaluate anything. */
function stubBrowser(overrides: Partial<IBrowser> = {}): IBrowser & { closed: boolean } {
  const b = {
    closed: false,
    async launch() {},
    async capture() { return CAPTURE; },
    async evaluate<T>() { return { data: [] } as T; },
    async setContentEvaluate<T>() { return { data: [] } as T; },
    async close() { b.closed = true; },
    ...overrides,
  };
  return b as IBrowser & { closed: boolean };
}

const fieldPaths: Record<string, FieldPathSet> = {
  title: {
    conflictCount: 0,
    paths: [{
      path: '//h1', source: 'xpath', confidence: 0.9,
      hits: 3, misses: 0, lastValue: 'Old Widget', lastUsedAt: '2026-05-01T00:00:00.000Z',
    }],
  },
};

const cache = {
  domain: 'shop.example.com', pageType: 'detail', fieldPaths,
  totalRuns: 3, successfulRuns: 3, successRate: 100, rowSelector: null,
} as DomainCache;

describe('runAnalysis — known domain', () => {
  it('returns the cached schema without calling the model', async () => {
    const browser = stubBrowser();
    const out = await runAnalysis(
      { url: CAPTURE.url },
      { browser, agent: null, lookupCache: async (_d, pt) => (pt === 'detail' ? cache : null) },
    );

    expect(out.cached).toBe(true);
    expect(out.schema.fields.map((f) => f.name)).toContain('title');
    // The caller owns the browser's lifecycle — see AnalysisDeps.browser and
    // analysis-orchestrator-browser-lifecycle.test.ts for the regression this guards.
    expect(browser.closed).toBe(false);
  });

  it('adds a user-requested field the cache has never seen', async () => {
    const out = await runAnalysis(
      { url: CAPTURE.url, requestedFields: 'shipping_weight' },
      { browser: stubBrowser(), agent: null, lookupCache: async (_d, pt) => (pt === 'detail' ? cache : null) },
    );
    const names = out.schema.fields.map((f) => f.name);
    expect(names).toContain('shipping_weight');
    expect(names).toContain('title');
  });

  it('still answers when the live capture fails — but SAYS the examples are not live', async () => {
    // A cache hit is worth returning without fresh examples. Refusing to answer
    // because a screenshot timed out would be worse than answering with stale
    // ones — but presenting stale examples as if they came from this page is
    // worse still (2026-08-26: a Newegg category page showed a Samsung SSD's
    // values with no hint anything was wrong).
    const browser = stubBrowser({ async capture() { throw new Error('page.screenshot: Timeout'); } });
    const out = await runAnalysis(
      { url: CAPTURE.url },
      { browser, agent: null, lookupCache: async (_d, pt) => (pt === 'detail' ? cache : null) },
    );
    expect(out.cached).toBe(true);
    expect(out.schema.fields.length).toBeGreaterThan(0);
    expect(out.liveExamples).toBe(false);
    expect(browser.closed).toBe(false);
  });

  it('reports liveExamples: true when the capture worked', async () => {
    const out = await runAnalysis(
      { url: CAPTURE.url },
      { browser: stubBrowser(), agent: null, lookupCache: async (_d, pt) => (pt === 'detail' ? cache : null) },
    );
    expect(out.liveExamples).toBe(true);
  });

  it('persists a screenshot through the injected hook, not the filesystem', async () => {
    const seen: Buffer[] = [];
    const out = await runAnalysis(
      { url: CAPTURE.url },
      {
        browser: stubBrowser(), agent: null,
        lookupCache: async (_d, pt) => (pt === 'detail' ? cache : null),
        persistScreenshot: async (s) => { seen.push(s); return { id: 'abc', url: '/captures/abc.png' }; },
      },
    );
    expect(seen).toHaveLength(1);
    expect(out.captureId).toBe('abc');
    expect(out.screenshotUrl).toBe('/captures/abc.png');
  });
});

describe('runAnalysis — a domain cached under BOTH page types', () => {
  // 2026-08-26: a Newegg LISTING url analyzed as "detail" because the detail
  // cache had more fields — page type was chosen by cache size, and the wizard
  // then showed 18 detail fields (with another product's stale examples) for a
  // category page. The page itself must have the deciding vote: whichever
  // cache's paths actually RESOLVE on the live capture is what this page is.
  const detailPaths: Record<string, FieldPathSet> = Object.fromEntries(
    ['sku', 'brand', 'model', 'price_field'].map((name) => [name, {
      conflictCount: 0,
      paths: [{
        path: `Product.${name}`, source: 'api', confidence: 0.9,
        hits: 5, misses: 0, lastValue: `stale-${name}`, lastUsedAt: '2026-05-01T00:00:00.000Z',
      }],
    }]),
  );
  const listingPaths: Record<string, FieldPathSet> = {
    category_name: {
      conflictCount: 0,
      paths: [{
        path: 'Listing.category', source: 'api', confidence: 0.9,
        hits: 5, misses: 0, lastValue: 'Old Category', lastUsedAt: '2026-05-01T00:00:00.000Z',
      }],
    },
  };
  const detailCache = { ...cache, pageType: 'detail', fieldPaths: detailPaths } as DomainCache;
  const listingCache = { ...cache, pageType: 'listing', fieldPaths: listingPaths } as DomainCache;
  const both = async (_d: string, pt: string) => (pt === 'detail' ? detailCache : listingCache);

  // The captured page carries ONLY the listing api shape — no detail paths resolve.
  const listingCapture: PageCapture = {
    ...CAPTURE,
    interceptedRequests: [{
      url: 'https://shop.example.com/api/listing', method: 'GET', resourceType: 'xhr',
      responseBody: '{"Listing":{"category":"GPUs"}}', parsedJson: { Listing: { category: 'GPUs' } },
    } as PageCapture['interceptedRequests'][0]],
  };

  it('picks the page type whose cached paths resolve on the LIVE page, not the bigger cache', async () => {
    const out = await runAnalysis(
      { url: 'https://shop.example.com/Category/ID-38' },
      { browser: stubBrowser({ async capture() { return listingCapture; } }), agent: null, lookupCache: both },
    );
    expect(out.schema.page_type).toBe('listing');
    expect(out.schema.fields.map((f) => f.name)).toContain('category_name');
    expect(out.liveExamples).toBe(true);
  });

  it('falls back to the bigger cache when the capture fails — flagged as not live', async () => {
    const out = await runAnalysis(
      { url: 'https://shop.example.com/Category/ID-38' },
      {
        browser: stubBrowser({ async capture() { throw new Error('Timeout'); } }),
        agent: null, lookupCache: both,
      },
    );
    expect(out.schema.page_type).toBe('detail'); // old size rule, honestly labelled
    expect(out.liveExamples).toBe(false);
  });
});

describe('runAnalysis — blocked page', () => {
  // 2026-08-26, second incident: Newegg served a Cloudflare "verify you are
  // human" interstitial. The capture SUCCEEDED mechanically, so the page voted
  // on its own page type (nothing resolved, size-fallback picked detail) and
  // stale examples shipped with liveExamples: true. A block page is not
  // evidence about the page — it is a reason, and the reason must surface.
  const BLOCKED: PageCapture = {
    ...CAPTURE,
    title: 'Just a moment',
    html: '<html><body>Our system have detected unusual traffic. Verify you are human. Ray ID a312c62f. cloudflare</body></html>',
  };

  it('a cached domain reports the block, keeps stale examples flagged, and does not let the block page vote', async () => {
    const out = await runAnalysis(
      { url: CAPTURE.url },
      { browser: stubBrowser({ async capture() { return BLOCKED; } }), agent: null, lookupCache: async (_d, pt) => (pt === 'detail' ? cache : null) },
    );
    expect(out.cached).toBe(true);
    expect(out.liveExamples).toBe(false);
    expect(out.blockedReason).toMatch(/human|cloudflare|block/i);
  });

  it('an unknown domain fails loudly instead of asking the model to describe a block page', async () => {
    const agent = { async discoverSchema() { throw new Error('must not be called'); } };
    await expect(runAnalysis(
      { url: 'https://unknown.example.com/p/1' },
      { browser: stubBrowser({ async capture() { return BLOCKED; } }), agent: agent as never, lookupCache: async () => null },
    )).rejects.toThrow(/human|cloudflare|block/i);
  });
});

describe('runAnalysis — unknown domain', () => {
  it('fails loudly rather than returning an empty schema when no agent is available', async () => {
    await expect(runAnalysis(
      { url: CAPTURE.url },
      { browser: stubBrowser(), agent: null, lookupCache: async () => null },
    )).rejects.toThrow(/no agent available/i);
  });

  it('promotes and appends user fields around what discovery found', async () => {
    const agent = {
      async discoverSchema() {
        return {
          page_type: 'detail', description: 'x',
          fields: [{ name: 'title', type: 'string', description: '', required: true, tier: 'discovered' as const }],
        } as never;
      },
    };
    const out = await runAnalysis(
      { url: CAPTURE.url, requestedFields: 'price\ntitle' },
      { browser: stubBrowser(), agent, lookupCache: async () => null },
    );
    expect(out.cached).toBe(false);
    const byName = new Map(out.schema.fields.map((f) => [f.name, f]));
    expect(byName.get('price')).toBeDefined();          // appended
    expect(byName.get('title')?.tier).toBe('requested'); // promoted
  });
});
