// The cached-XPath tier used to call `browser.evaluate(url, script)`, which opens
// a new page and re-navigates the URL — so every warm item (the common case at
// crawl scale) loaded its page twice. `setContentEvaluate` runs the same
// generated script against HTML we already captured, in real Chromium, with no
// second navigation. This test proves the tier now uses it, and that it is not
// a vacuous pass: the cached XPath is the ONLY way `title` can resolve here
// (structuredData is empty, so mechanical extraction yields nothing), so a
// green test means the tier actually ran and actually produced the value.

import { describe, it, expect } from 'vitest';
import type { IBrowser, PageCapture, CrawlPage, CrawlOptions, ScrollOptions } from '@robot/browser';
import { runExtraction } from './extraction-orchestrator.js';
import type { DomainCache } from './domain-cache.js';

const CAPTURE: PageCapture = {
  url: 'https://example.com/p/1',
  html: '<html><body><h1 id="t">Kallax</h1></body></html>',
  markdown: '',
  screenshot: Buffer.alloc(0),
  screenshotTiles: [],
  title: 'Kallax',
  timestamp: 0,
  structuredData: { ldJson: [], nextData: null, initialState: null, meta: {} },
  interceptedRequests: [],
};

// Rebuilt from the real types in domain-cache.ts (FieldPath / FieldPathSet /
// DomainCache) — the brief's fixture invented a `uses` key on the field path
// and omitted several required DomainCache fields; neither compiles against
// the real types.
const CACHE: DomainCache = {
  id: 'cache-1',
  domain: 'example.com',
  pageType: 'detail',
  apiEndpoints: [],
  fieldPaths: {
    title: {
      paths: [
        {
          path: '//h1[@id="t"]',
          source: 'xpath',
          confidence: 0.85,
          hits: 3,
          misses: 0,
          lastValue: 'Kallax',
          lastUsedAt: new Date().toISOString(),
        },
      ],
      conflictCount: 0,
    },
  },
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
};

class RecordingBrowser implements IBrowser {
  navigations = 0;
  setContentCalls = 0;
  async launch(): Promise<void> {}
  async capture(): Promise<PageCapture> { return CAPTURE; }
  async evaluate<T>(): Promise<T> {
    this.navigations++;
    return { data: [{ title: 'Kallax' }], fieldCount: 1 } as T;
  }
  async setContentEvaluate<T>(): Promise<T> {
    this.setContentCalls++;
    return { data: [{ title: 'Kallax' }], fieldCount: 1 } as T;
  }
  async close(): Promise<void> {}
  async *crawl(_startUrl: string, _options: CrawlOptions): AsyncGenerator<CrawlPage> {}

  // eslint-disable-next-line require-yield
  async *scrollPages(_startUrl: string, _options: ScrollOptions): AsyncGenerator<CrawlPage> {
    throw new Error('not used');
  }
}

describe('cached XPath tier', () => {
  it('resolves against the captured HTML without navigating a second time', async () => {
    const browser = new RecordingBrowser();
    const outcome = await runExtraction(
      { url: 'https://example.com/p/1', fields: [{ name: 'title', type: 'string' }], pageType: 'detail' },
      {
        browser,
        agent: null,
        capture: CAPTURE,
        lookupCache: async () => CACHE,
        saveCache: async () => {},
        acquireLock: async () => () => {},
      },
    );

    // Proves the tier actually ran (not a vacuous pass): the cached XPath is
    // the only source that could have resolved `title` here.
    expect(outcome.data[0]?.title).toBe('Kallax');
    expect(outcome.sources.title).toBe('xpath-cached');

    expect(browser.setContentCalls).toBe(1);
    expect(browser.navigations).toBe(0);
  });
});
