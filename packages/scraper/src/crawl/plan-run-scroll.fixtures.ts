import type { PaginationConfig, PageCapture, CrawlPage, ScrollOptions } from '@robot/browser';
import type { PlanRunDeps, PlanRunRequest } from './plan-run.js';
import { DETAIL_URL_FIELD } from './enumerate-detail-urls.js';

/** Detail URLs page 1's own extraction yields. */
export const PAGE1 = ['https://listing.example/p/100001', 'https://listing.example/p/100002'];

export const SCROLL_CONFIG: PaginationConfig = { strategy: 'dom-scroll' };

export type SavedConfig = { domain: string; config: PaginationConfig };

export type ScrollDeps = PlanRunDeps & {
  scrollCalls: ScrollOptions[];
  crawlCalls: unknown[];
  saved: SavedConfig[];
};

/**
 * `html` carries no pagination markup at all, so every other rung of the ladder
 * comes back empty and the scroll fallback is the only thing that can fire.
 */
export const plainHtml = '<html><body><div data-row><a href="/p/100001">x</a></div></body></html>';

export function scrollDeps(over: {
  cachedConfig?: PaginationConfig | null;
  /** Detail URLs each scroll round yields, in order. */
  rounds?: string[][];
  html?: string;
}): ScrollDeps {
  const scrollCalls: ScrollOptions[] = [];
  const crawlCalls: unknown[] = [];
  const saved: SavedConfig[] = [];
  const rounds = over.rounds ?? [['https://listing.example/p/200001']];

  const capture = {
    url: 'https://listing.example/list',
    html: over.html ?? plainHtml,
    screenshot: '',
    screenshotTiles: [],
    interceptedRequests: [],
  } as unknown as PageCapture;

  return {
    browser: {
      capture: async () => capture,
      async *crawl(_url: string, options: unknown) { crawlCalls.push(options); },
      async *scrollPages(_url: string, options: ScrollOptions): AsyncGenerator<CrawlPage> {
        scrollCalls.push(options);
        for (let i = 0; i < rounds.length; i++) {
          const batch = rounds[i]!;
          if (batch.length === 0) continue;
          yield {
            url: 'https://listing.example/list',
            pageNumber: i + 2,
            data: batch.map((u) => ({ [DETAIL_URL_FIELD]: u })),
            totalRows: batch.length,
          };
        }
      },
    } as unknown as PlanRunDeps['browser'],
    agent: null,
    extract: (async () => ({
      data: [{ [DETAIL_URL_FIELD]: PAGE1[0] }],
      rows: PAGE1.map((u) => ({ [DETAIL_URL_FIELD]: u })),
      plan: { row_xpath: '//div[@data-row]', fields: [{ name: DETAIL_URL_FIELD, xpath: './/a/@href' }] },
      confidence: 1,
      sources: {},
      fieldCount: { found: 1, total: 1 },
      fieldsByTier: { requested: [], discovered: [] },
      cacheHit: false,
    })) as unknown as PlanRunDeps['extract'],
    acquireLock: async () => () => {},
    lookupCache: (async () => (
      over.cachedConfig ? { paginationConfig: over.cachedConfig } : null
    )) as unknown as PlanRunDeps['lookupCache'],
    savePagination: (async (domain: string, config: PaginationConfig) => { saved.push({ domain, config }); }) as PlanRunDeps['savePagination'],
    scrollCalls,
    crawlCalls,
    saved,
  };
}

export function scrollRequest(budget: { maxPages: number; maxItems: number }): PlanRunRequest {
  return {
    source: {
      listingMode: 'listing_to_detail',
      inputStrategy: 'direct',
      urlTemplate: 'https://listing.example/list',
      budget: { max_pages: budget.maxPages, max_items: budget.maxItems, mode: 'first_n' },
    },
    schema: [{ name: DETAIL_URL_FIELD, type: 'url', origin: 'listing' }],
    inputSet: { columns: [{ name: 'url', primary: true }], rows: [{ url: 'https://listing.example/list' }] },
  } as unknown as PlanRunRequest;
}
