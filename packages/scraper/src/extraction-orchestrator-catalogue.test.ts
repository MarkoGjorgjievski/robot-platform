// v2.5 task 6: the cold-catalogue discovery trigger. The catalogue is an
// enrichment, never a dependency — it must run once per domain (only while
// cold), only after a successful extraction, and it must never be able to
// fail the run itself. These three cases pin exactly that contract against
// the injected `discoverCatalogue`/`saveCatalogue` deps, never importing
// `discoverCandidateCatalogue` directly (that would give @robot/scraper an
// agent dependency in tests it doesn't need — see Task 5's ruling).

import { describe, it, expect, vi } from 'vitest';
import type { IBrowser, PageCapture, CrawlPage, CrawlOptions, ScrollOptions } from '@robot/browser';
import { runExtraction } from './extraction-orchestrator.js';
import type { DomainCache } from './domain-cache.js';
import type { CandidateCatalogue } from './candidate-catalogue.js';

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

// Rebuilt from the real DomainCache shape (domain-cache.ts), same as the
// cached-XPath test's fixture — the brief's sketch is indicative, not literal.
function makeCache(candidateCatalogue: CandidateCatalogue): DomainCache {
  return {
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
    candidateCatalogue,
  };
}

class RecordingBrowser implements IBrowser {
  async launch(): Promise<void> {}
  async capture(): Promise<PageCapture> { return CAPTURE; }
  async evaluate<T>(): Promise<T> {
    return { data: [{ title: 'Kallax' }], fieldCount: 1 } as T;
  }
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

const DISCOVERED_CATALOGUE: CandidateCatalogue = {
  price: [{ label: 'displayed', source: 'xpath', path: '//span[@id="price"]', sampleValue: '9.99' }],
};

describe('cold-catalogue discovery trigger', () => {
  it('runs discovery after a successful extraction when the domain catalogue is empty', async () => {
    const browser = new RecordingBrowser();
    const discoverCatalogue = vi.fn().mockResolvedValue(DISCOVERED_CATALOGUE);
    const saveCatalogue = vi.fn().mockResolvedValue(undefined);

    await runExtraction(
      { url: 'https://example.com/p/1', fields: [{ name: 'title', type: 'string' }], pageType: 'detail' },
      {
        browser,
        agent: null,
        capture: CAPTURE,
        lookupCache: async () => makeCache({}),
        saveCache: async () => {},
        acquireLock: async () => () => {},
        discoverCatalogue,
        saveCatalogue,
      },
    );

    expect(discoverCatalogue).toHaveBeenCalledTimes(1);
    expect(saveCatalogue).toHaveBeenCalledWith('example.com', 'detail', DISCOVERED_CATALOGUE);
  });

  it('does NOT run discovery when the catalogue is already populated', async () => {
    const browser = new RecordingBrowser();
    const discoverCatalogue = vi.fn().mockResolvedValue(DISCOVERED_CATALOGUE);
    const saveCatalogue = vi.fn().mockResolvedValue(undefined);

    await runExtraction(
      { url: 'https://example.com/p/1', fields: [{ name: 'title', type: 'string' }], pageType: 'detail' },
      {
        browser,
        agent: null,
        capture: CAPTURE,
        lookupCache: async () => makeCache({ price: [{ label: 'displayed', source: 'xpath', path: '//x', sampleValue: '9.99' }] }),
        saveCache: async () => {},
        acquireLock: async () => () => {},
        discoverCatalogue,
        saveCatalogue,
      },
    );

    expect(discoverCatalogue).not.toHaveBeenCalled();
    expect(saveCatalogue).not.toHaveBeenCalled();
  });

  it('a discovery failure never fails the extraction', async () => {
    const browser = new RecordingBrowser();
    const discoverCatalogue = vi.fn().mockRejectedValue(new Error('boom'));
    const saveCatalogue = vi.fn().mockResolvedValue(undefined);

    const outcome = await runExtraction(
      { url: 'https://example.com/p/1', fields: [{ name: 'title', type: 'string' }], pageType: 'detail' },
      {
        browser,
        agent: null,
        capture: CAPTURE,
        lookupCache: async () => makeCache({}),
        saveCache: async () => {},
        acquireLock: async () => () => {},
        discoverCatalogue,
        saveCatalogue,
      },
    );

    expect(outcome.data[0]?.title).toBe('Kallax');
    expect(discoverCatalogue).toHaveBeenCalledTimes(1);
    expect(saveCatalogue).not.toHaveBeenCalled();
  });

  it('does NOT run discovery after a failed extraction (low confidence)', async () => {
    // A NullBrowser that resolves nothing — no cached xpath data, no xpath
    // plan fields matched — so `title`, the only requested field, stays
    // unresolved and overallConfidence is 0, below EXTRACTION_SUCCESS_THRESHOLD.
    class NullBrowser implements IBrowser {
      async launch(): Promise<void> {}
      async capture(): Promise<PageCapture> { return CAPTURE; }
      async evaluate<T>(): Promise<T> { return { data: [], fieldCount: 0 } as T; }
      async setContentEvaluate<T>(): Promise<T> { return { data: [], fieldCount: 0 } as T; }
      async close(): Promise<void> {}
      async *crawl(_startUrl: string, _options: CrawlOptions): AsyncGenerator<CrawlPage> {}
      // eslint-disable-next-line require-yield
      async *scrollPages(_startUrl: string, _options: ScrollOptions): AsyncGenerator<CrawlPage> {
        throw new Error('not used');
      }
    }
    const browser = new NullBrowser();
    const discoverCatalogue = vi.fn().mockResolvedValue(DISCOVERED_CATALOGUE);
    const saveCatalogue = vi.fn().mockResolvedValue(undefined);

    const outcome = await runExtraction(
      { url: 'https://example.com/p/1', fields: [{ name: 'title', type: 'string' }], pageType: 'detail' },
      {
        browser,
        agent: null,
        capture: CAPTURE,
        // Cache with an empty catalogue AND no fieldPaths for `title` — the
        // cache-tier has nothing to resolve either, so the field genuinely
        // stays missing and confidence is 0.
        lookupCache: async () => makeCache({}),
        saveCache: async () => {},
        acquireLock: async () => () => {},
        discoverCatalogue,
        saveCatalogue,
      },
    );

    expect(outcome.confidence).toBe(0);
    expect(discoverCatalogue).not.toHaveBeenCalled();
    expect(saveCatalogue).not.toHaveBeenCalled();
  });

  it('runs discovery on a domain\'s first-ever extraction, when no cache row exists yet', async () => {
    const browser = new RecordingBrowser();
    const discoverCatalogue = vi.fn().mockResolvedValue(DISCOVERED_CATALOGUE);
    const saveCatalogue = vi.fn().mockResolvedValue(undefined);
    // With `cache` null, STEP 1.5 (the cached-path tier) never runs — nothing
    // resolves `title` unless mechanical extraction can, on its own. A meta
    // tag gives it exactly that, so this stays a genuinely successful
    // extraction (confidence 1, clears EXTRACTION_SUCCESS_THRESHOLD) rather
    // than accidentally relying on the now-gated "cold cache, 0% confidence"
    // case that the sibling test above covers.
    const captureWithMeta: PageCapture = {
      ...CAPTURE,
      structuredData: { ...CAPTURE.structuredData, meta: { 'og:title': 'Kallax' } },
    };

    await runExtraction(
      { url: 'https://example.com/p/1', fields: [{ name: 'title', type: 'string' }], pageType: 'detail' },
      {
        browser,
        agent: null,
        capture: captureWithMeta,
        // No domain_intelligence row exists yet — lookupCache returns null, the
        // paradigm cold case. saveCache upserts one during this very run; the
        // gate must still treat this as "empty" and fire discovery.
        lookupCache: async () => null,
        saveCache: async () => {},
        acquireLock: async () => () => {},
        discoverCatalogue,
        saveCatalogue,
      },
    );

    expect(discoverCatalogue).toHaveBeenCalledTimes(1);
    expect(saveCatalogue).toHaveBeenCalledWith('example.com', 'detail', DISCOVERED_CATALOGUE);
  });
});
