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
  html: '<html><body><main><h1>Widget</h1></main></body></html>',
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
    expect(browser.closed).toBe(true);
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

  it('still answers when the live capture fails', async () => {
    // A cache hit is worth returning without fresh examples. Refusing to answer
    // because a screenshot timed out would be worse than answering with stale ones.
    const browser = stubBrowser({ async capture() { throw new Error('page.screenshot: Timeout'); } });
    const out = await runAnalysis(
      { url: CAPTURE.url },
      { browser, agent: null, lookupCache: async (_d, pt) => (pt === 'detail' ? cache : null) },
    );
    expect(out.cached).toBe(true);
    expect(out.schema.fields.length).toBeGreaterThan(0);
    expect(browser.closed).toBe(true);
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
