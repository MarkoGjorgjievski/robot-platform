// Regression coverage for the same shared-browser lifecycle bug fixed in
// extraction-orchestrator.ts (see extraction-orchestrator-browser-lifecycle.test.ts
// and docs/handoff.md): `runAnalysis` closed the browser it was given, on
// both its paths (cache hit and cache miss), even though it never launched
// it. A caller that reuses one browser across multiple `runAnalysis` calls —
// exactly the shape Phase 2's item loop uses for `runExtraction` — would hit
// the identical "Browser not launched" failure on call 2 the moment such a
// caller exists.
//
// The fix: whoever launches the browser closes it. `runAnalysis` never closes
// a browser it did not launch itself (it never launches one either), on
// either path.

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

function stubBrowser(overrides: Partial<IBrowser> = {}): IBrowser & { closeCalls: number } {
  const b = {
    closeCalls: 0,
    async launch() {},
    async capture() { return CAPTURE; },
    async evaluate<T>() { return { data: [] } as T; },
    async setContentEvaluate<T>() { return { data: [] } as T; },
    async close() { b.closeCalls++; },
    ...overrides,
  };
  return b as IBrowser & { closeCalls: number };
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

describe('runAnalysis — browser lifecycle', () => {
  it('does not close the browser on the cache-hit path', async () => {
    const browser = stubBrowser();
    await runAnalysis(
      { url: CAPTURE.url, pageType: 'detail' },
      { browser, agent: null, lookupCache: async (_d, pt) => (pt === 'detail' ? cache : null) },
    );
    expect(browser.closeCalls).toBe(0);
  });

  it('does not close the browser when the cache-hit capture fails (non-fatal path)', async () => {
    const browser = stubBrowser({ async capture() { throw new Error('page.screenshot: Timeout'); } });
    await runAnalysis(
      { url: CAPTURE.url, pageType: 'detail' },
      { browser, agent: null, lookupCache: async (_d, pt) => (pt === 'detail' ? cache : null) },
    );
    expect(browser.closeCalls).toBe(0);
  });

  it('does not close the browser on the cache-miss (AI discovery) path', async () => {
    const browser = stubBrowser();
    const agent = {
      async discoverSchema() {
        return {
          page_type: 'detail', description: 'x',
          fields: [{ name: 'title', type: 'string', description: '', required: true, tier: 'discovered' as const }],
        } as never;
      },
    };
    await runAnalysis(
      { url: CAPTURE.url, pageType: 'detail' },
      { browser, agent, lookupCache: async () => null },
    );
    expect(browser.closeCalls).toBe(0);
  });

  it('the actual regression: two sequential calls on the same browser both succeed', async () => {
    const browser = stubBrowser();
    const first = await runAnalysis(
      { url: CAPTURE.url, pageType: 'detail' },
      { browser, agent: null, lookupCache: async (_d, pt) => (pt === 'detail' ? cache : null) },
    );
    const second = await runAnalysis(
      { url: CAPTURE.url, pageType: 'detail' },
      { browser, agent: null, lookupCache: async (_d, pt) => (pt === 'detail' ? cache : null) },
    );
    expect(first.cached).toBe(true);
    expect(second.cached).toBe(true);
    expect(browser.closeCalls).toBe(0);
  });
});
