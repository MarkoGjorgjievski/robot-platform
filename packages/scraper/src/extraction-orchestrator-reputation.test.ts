// The replay tiers must feed the reputation loop (cache-reputation fixes,
// 2026-09-02). Before: a cached-xpath hit reached `saveCache` as
// `{ source: 'xpath-cached', path: '' }` — an identity no stored path carries,
// so the stored path's stats stayed frozen at creation forever — and a cached
// api path that was tried and rejected (corroboration) or resolved nothing left
// no trace at all, keeping the prune unreachable for poisoned paths.

import { describe, it, expect } from 'vitest';
import type { IBrowser, PageCapture, CrawlPage, CrawlOptions, ScrollOptions, InterceptedRequest } from '@robot/browser';
import { runExtraction } from './extraction-orchestrator.js';
import { mergeFieldPaths, type DomainCache, type ExtractionOutcome } from './domain-cache.js';

function makeReq(url: string, body: object): InterceptedRequest {
  const responseBody = JSON.stringify(body);
  return {
    url,
    method: 'GET',
    resourceType: 'xhr',
    responseStatus: 200,
    responseHeaders: {},
    responseBody,
    contentType: 'application/json',
    bodySize: responseBody.length,
    isJson: true,
    parsedJson: body,
    timestamp: 0,
  };
}

const HTML = '<html><body><h1 id="t">Kallax</h1><p>Realistic on-page content so checkPageHealth sees a real page rather than an empty interstitial. This paragraph only exists to carry the fixture past the almost-no-content gate.</p></body></html>';

const capture = (interceptedRequests: InterceptedRequest[] = []): PageCapture => ({
  url: 'https://example.com/p/1',
  html: HTML,
  markdown: '',
  screenshot: Buffer.alloc(0),
  screenshotTiles: [],
  title: 'Kallax',
  timestamp: 0,
  structuredData: { ldJson: [], nextData: null, initialState: null, meta: {} },
  interceptedRequests,
});

const makeCache = (fieldPaths: DomainCache['fieldPaths']): DomainCache => ({
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
  candidateCatalogue: {},
});

class StubBrowser implements IBrowser {
  async launch(): Promise<void> {}
  async capture(): Promise<PageCapture> { throw new Error('capture injected'); }
  async evaluate<T>(): Promise<T> { throw new Error('not used'); }
  async setContentEvaluate<T>(): Promise<T> {
    return { data: [{ title: 'Kallax' }], fieldCount: 1 } as T;
  }
  async close(): Promise<void> {}
  async *crawl(_startUrl: string, _options: CrawlOptions): AsyncGenerator<CrawlPage> {}
  // eslint-disable-next-line require-yield
  async *scrollPages(_startUrl: string, _options: ScrollOptions): AsyncGenerator<CrawlPage> {
    throw new Error('not used');
  }
}

describe('replay tiers feed the reputation loop', () => {
  it('a cached-xpath hit reaches saveCache with the stored path, and merging credits it', async () => {
    const stored = {
      title: {
        paths: [{
          path: '//h1[@id="t"]',
          source: 'xpath' as const,
          confidence: 0.85,
          hits: 3,
          misses: 0,
          lastValue: 'Kallax',
          lastUsedAt: new Date().toISOString(),
        }],
        conflictCount: 0,
      },
    };
    let saved: ExtractionOutcome | null = null;
    await runExtraction(
      { url: 'https://example.com/p/1', fields: [{ name: 'title', type: 'string' }], pageType: 'detail' },
      {
        browser: new StubBrowser(),
        agent: null,
        capture: capture(),
        lookupCache: async () => makeCache(stored),
        saveCache: async (outcome) => { saved = outcome; },
        acquireLock: async () => () => {},
      },
    );

    expect(saved).not.toBeNull();
    expect(saved!.fieldResults.title!.path).toBe('//h1[@id="t"]');

    const merged = mergeFieldPaths(
      stored, saved!.fieldResults, saved!.discoveredFieldNames,
      new Date().toISOString(), saved!.url, saved!.attemptedFailures,
    );
    expect(merged.title!.paths).toHaveLength(1);
    expect(merged.title!.paths[0]!.hits).toBe(4);
  });

  it('a corroboration-rejected api path and a resolves-nothing api path both land in attemptedFailures', async () => {
    const stored = {
      // Poisoned: resolves a title that appears nowhere in the rendered page.
      title: {
        paths: [{
          path: 'bibliographicDetail.title',
          source: 'api' as const,
          confidence: 0.9,
          hits: 0,
          misses: 0,
          lastValue: 'Wrong Book Entirely',
          lastUsedAt: new Date().toISOString(),
        }],
        conflictCount: 0,
      },
      // Stale: resolves nothing in any intercepted body.
      price: {
        paths: [{
          path: 'offers.gone',
          source: 'api' as const,
          confidence: 0.9,
          hits: 1,
          misses: 0,
          lastValue: '9.99',
          lastUsedAt: new Date().toISOString(),
        }],
        conflictCount: 0,
      },
    };
    let saved: ExtractionOutcome | null = null;
    await runExtraction(
      {
        url: 'https://example.com/p/1',
        fields: [{ name: 'title', type: 'string' }, { name: 'price', type: 'string' }],
        pageType: 'detail',
      },
      {
        browser: new StubBrowser(),
        agent: null,
        capture: capture([
          makeReq('https://example.com/api/p/1', {
            bibliographicDetail: { title: 'Completely Unrelated Antiquarian Volume' },
          }),
        ]),
        lookupCache: async () => makeCache(stored),
        saveCache: async (outcome) => { saved = outcome; },
        acquireLock: async () => () => {},
      },
    );

    expect(saved).not.toBeNull();
    expect(saved!.attemptedFailures?.title).toEqual([
      { source: 'api', path: 'bibliographicDetail.title' },
    ]);
    expect(saved!.attemptedFailures?.price).toEqual([
      { source: 'api', path: 'offers.gone' },
    ]);

    const merged = mergeFieldPaths(
      stored, saved!.fieldResults, saved!.discoveredFieldNames,
      new Date().toISOString(), saved!.url, saved!.attemptedFailures,
    );
    expect(merged.title!.paths[0]!.misses).toBe(1);
    expect(merged.price!.paths[0]!.misses).toBe(1);
  });
});
