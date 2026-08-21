import { vi } from 'vitest';
import type { PaginationConfig, CrawlOptions, CrawlPage, PageCapture } from '@robot/browser';
import type { PlanRunDeps, PlanRunRequest } from './plan-run.js';
import { DETAIL_URL_FIELD } from './enumerate-detail-urls.js';

// Deliberately a shape mechanical detection can never produce from `listingHtml`
// below: that HTML has a <link rel="next"> (a url-pattern source) and no
// `a.cached-next` anywhere. If this were byte-identical to what mechanical
// detection derives, the warm-cache test could pass whether or not the cache
// was ever consulted -- mechanical detection would answer first either way,
// and the assertion would be vacuous. Keep it a next-button config (or
// otherwise divergent from listingHtml's own markup) so a broken cache-read
// path is observable. Do not "simplify" this back to a url-pattern config
// that matches the fixture HTML.
export const CACHED_CONFIG: PaginationConfig = {
  strategy: 'next-button',
  nextSelector: 'a.cached-next',
};

/** Page 1 markup: two products, and a rel=next mechanical detection can find. */
export const listingHtml = `<html><head><link rel="next" href="https://listing.example/search?page=2"></head>
<body><a class="p" href="/p/1">One</a><a class="p" href="/p/2">Two</a></body></html>`;

export type FakeDeps = PlanRunDeps & {
  /** Every options object browser.crawl() was called with, in order. */
  crawlCalls: CrawlOptions[];
  /** Every config handed to savePagination, in order. */
  saved: PaginationConfig[];
};

export function fakeDeps(over: {
  cachedConfig: PaginationConfig | null;
  /** Detail URLs each crawled page yields, in page order. Default: one new page. */
  pages?: string[][];
  agent?: { detectPagination: (html: string) => Promise<unknown> };
  lookupCache?: PlanRunDeps['lookupCache'];
}): FakeDeps {
  const crawlCalls: CrawlOptions[] = [];
  const saved: PaginationConfig[] = [];
  const pages = over.pages ?? [['https://listing.example/p/3']];

  const capture = {
    url: 'https://listing.example/search',
    html: listingHtml,
    screenshot: '',
    screenshotTiles: [],
    interceptedRequests: [],
  } as unknown as PageCapture;

  return {
    browser: {
      capture: async () => capture,
      async *crawl(_url: string, options: CrawlOptions): AsyncGenerator<CrawlPage> {
        crawlCalls.push(options);
        // Which batch of URLs to serve is keyed off how many times crawl has run,
        // so the stale path's SECOND walk can yield different results from the first.
        const batch = pages[crawlCalls.length - 1] ?? [];
        if (batch.length === 0) return;
        yield {
          url: 'https://listing.example/search?page=2',
          pageNumber: 2,
          data: batch.map((u) => ({ [DETAIL_URL_FIELD]: u })),
          totalRows: batch.length,
        } as CrawlPage;
      },
    } as unknown as PlanRunDeps['browser'],
    agent: (over.agent ?? null) as PlanRunDeps['agent'],
    extract: (async () => ({
      data: [{ [DETAIL_URL_FIELD]: 'https://listing.example/p/1' }],
      rows: [
        { [DETAIL_URL_FIELD]: 'https://listing.example/p/1' },
        { [DETAIL_URL_FIELD]: 'https://listing.example/p/2' },
      ],
      plan: { row_xpath: '//a', fields: [{ name: DETAIL_URL_FIELD, xpath: './@href' }] },
      confidence: 1,
      sources: {},
      fieldCount: { found: 1, total: 1 },
      fieldsByTier: { requested: [], discovered: [] },
      cacheHit: false,
    })) as unknown as PlanRunDeps['extract'],
    acquireLock: async () => () => {},
    lookupCache: over.lookupCache
      ?? (vi.fn().mockResolvedValue(
        over.cachedConfig ? { paginationConfig: over.cachedConfig } : null,
      ) as unknown as PlanRunDeps['lookupCache']),
    savePagination: (async (_domain: string, config: PaginationConfig) => { saved.push(config); }) as PlanRunDeps['savePagination'],
    crawlCalls,
    saved,
  };
}

export function fakeRequest(budget: { maxPages: number; maxItems: number }): PlanRunRequest {
  return {
    source: {
      listingMode: 'listing_to_detail',
      inputStrategy: 'direct',
      urlTemplate: 'https://listing.example/search',
      budget: { max_pages: budget.maxPages, max_items: budget.maxItems, mode: 'first_n' },
    },
    schema: [{ name: DETAIL_URL_FIELD, type: 'url', origin: 'listing' }],
    // inputStrategy is 'direct', so buildInputUrls needs an actual row to read the
    // start URL from — an empty rows array yields zero start URLs and the
    // pagination block would never run.
    inputSet: { columns: [{ name: 'url', primary: true }], rows: [{ url: 'https://listing.example/search' }] },
  } as unknown as PlanRunRequest;
}
