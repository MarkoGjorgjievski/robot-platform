import type { PaginationConfig, PageCapture, InterceptedRequest, CrawlOptions } from '@robot/browser';
import type { PlanRunDeps, PlanRunRequest } from './plan-run.js';
import { DETAIL_URL_FIELD } from './enumerate-detail-urls.js';

/** Detail URLs page 1's own extraction yields. Long enough to be identifiers. */
export const PAGE1 = [
  'https://listing.example/p/100001',
  'https://listing.example/p/100002',
  'https://listing.example/p/100003',
];

/**
 * `step: 2` is deliberate. With a step of 1, page 2's `offset=1` is
 * indistinguishable from a plain page counter, so a walker that ignored `step`
 * entirely and just counted pages would produce identical URLs and the
 * substitution test would pass while broken. Two makes the two behaviours
 * diverge on the very first page.
 */
export const API_CONFIG: PaginationConfig = {
  strategy: 'api-param',
  apiTemplate: 'https://listing.example/api?kn=py&offset={N}',
  paramName: 'offset',
  step: 2,
  itemsPath: 'results',
  urlPath: 'link',
};

const body = (urls: string[]) => ({ results: urls.map((link) => ({ link })) });

export type SavedConfig = { domain: string; config: PaginationConfig };

export type ApiParamDeps = PlanRunDeps & {
  /** The page URL each `browser.evaluate` call navigated to, in order. */
  evaluateCalls: string[];
  /** Every URL requested inside a fetch script, flattened, in order. */
  fetchedUrls: string[];
  /** Populated only if something wrongly routes an api-param config to crawl(). */
  crawlCalls: CrawlOptions[];
  saved: SavedConfig[];
};

export function apiParamDeps(over: {
  cachedConfig: PaginationConfig | null;
  /** Detail URLs served for the walk's 1st, 2nd, … fetched URL. */
  pages?: string[][];
  /** Detail URLs served to every probe during cold detection. Must differ from PAGE1. */
  probe?: string[];
}): ApiParamDeps {
  const evaluateCalls: string[] = [];
  const fetchedUrls: string[] = [];
  const crawlCalls: CrawlOptions[] = [];
  const saved: SavedConfig[] = [];
  const pages = over.pages ?? [['https://listing.example/p/200001']];
  const probe = over.probe ?? ['https://listing.example/p/900001', 'https://listing.example/p/900002'];

  // A real intercepted response carrying page 1's URLs, so COLD runs exercise
  // the actual detectApiParam rather than a stub of it.
  const apiRequest = {
    url: 'https://listing.example/api?kn=py&offset=0',
    method: 'GET', resourceType: 'xhr', responseStatus: 200, responseHeaders: {},
    responseBody: JSON.stringify(body(PAGE1)), contentType: 'application/json',
    bodySize: 200, isJson: true, parsedJson: body(PAGE1), timestamp: 0,
  } as InterceptedRequest;

  const capture = {
    url: 'https://listing.example/search',
    html: '<html><body>listing</body></html>',
    screenshot: '',
    screenshotTiles: [],
    interceptedRequests: [apiRequest],
  } as unknown as PageCapture;

  return {
    browser: {
      capture: async () => capture,
      // Mirrors Task 4's buildFetchScript contract: read the URL list out of the
      // generated script, answer one FetchedBody per URL.
      evaluate: async (pageUrl: string, script: string) => {
        evaluateCalls.push(pageUrl);
        const urls: string[] = JSON.parse(script.match(/const urls = (\[.*?\]);/s)![1]!);
        urls.forEach((u) => fetchedUrls.push(u));
        // On a cold run the FIRST evaluate is detection's probe batch; every
        // later one is the walk. With a cached config there is no probe, so the
        // first evaluate is already the walk.
        const isProbe = over.cachedConfig === null && evaluateCalls.length === 1;
        return urls.map((url, i) => ({
          url,
          status: 200,
          json: body(isProbe ? probe : (pages[i] ?? [])),
          error: null,
        }));
      },
      async *crawl(_url: string, options: CrawlOptions) {
        // An api-param config must never reach here. Recorded so a test can say so.
        crawlCalls.push(options);
      },
    } as unknown as PlanRunDeps['browser'],
    agent: null,
    extract: (async () => ({
      data: [{ [DETAIL_URL_FIELD]: PAGE1[0] }],
      rows: PAGE1.map((u) => ({ [DETAIL_URL_FIELD]: u })),
      plan: { row_xpath: '//a', fields: [{ name: DETAIL_URL_FIELD, xpath: './@href' }] },
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
    savePagination: (async (domain: string, config: PaginationConfig) => {
      saved.push({ domain, config });
    }) as PlanRunDeps['savePagination'],
    evaluateCalls,
    fetchedUrls,
    crawlCalls,
    saved,
  };
}

export function apiParamRequest(budget: { maxPages: number; maxItems: number }): PlanRunRequest {
  return {
    source: {
      listingMode: 'listing_to_detail',
      inputStrategy: 'direct',
      urlTemplate: 'https://listing.example/search',
      budget: { max_pages: budget.maxPages, max_items: budget.maxItems, mode: 'first_n' },
    },
    schema: [{ name: DETAIL_URL_FIELD, type: 'url', origin: 'listing' }],
    // inputStrategy is 'direct', so buildInputUrls needs a real row to read the
    // start URL from — an empty rows array yields zero start URLs and the
    // pagination block never runs at all.
    inputSet: { columns: [{ name: 'url', primary: true }], rows: [{ url: 'https://listing.example/search' }] },
  } as unknown as PlanRunRequest;
}
