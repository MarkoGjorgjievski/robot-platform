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

/**
 * A page-style pager that starts at ONE, not zero — the shape Fix 1 exists for.
 *
 * `page`/`p`/`pageNumber` pagers almost always hold 1 on page 1 and advance by
 * 1, so `probeUrl` verifies `page=2` (`from + step`). A walk that computes
 * `step * (page - 1)` and ignores `from` asks for `page=1` first — page 1 again
 * — and never reaches `maxPages`. Offset-style pagers hide this because their
 * `from` happens to be 0, which is exactly why API_CONFIG never caught it.
 */
export const PAGE_STYLE_CONFIG: PaginationConfig = {
  strategy: 'api-param',
  apiTemplate: 'https://listing.example/api?kn=py&page={N}',
  paramName: 'page',
  from: 1,
  step: 1,
  itemsPath: 'results',
  urlPath: 'link',
};

const body = (urls: string[]) => ({ results: urls.map((link) => ({ link })) });

/**
 * A JSON GET that is eligible to BE the listing API — right method, right
 * content type, 2xx — but carries none of page 1's URLs. Something was
 * considered; nothing matched. Distinct from a page that made no JSON XHR at
 * all, which is the case api-param must say nothing about.
 */
export const UNRELATED_API: InterceptedRequest = {
  url: 'https://listing.example/api/recommendations?slot=3',
  method: 'GET', resourceType: 'xhr', responseStatus: 200, responseHeaders: {},
  responseBody: JSON.stringify(body(['https://listing.example/p/999001'])),
  contentType: 'application/json', bodySize: 60, isJson: true,
  parsedJson: body(['https://listing.example/p/999001']), timestamp: 0,
} as InterceptedRequest;

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
  /** Detail URLs served to every probe during cold detection. Must differ from page 1's. */
  probe?: string[];
  /**
   * Page 1's own detail URLs — both what row extraction yields and what the
   * intercepted listing API carries. Overridable because some claims only
   * become testable at a particular page-1 size: the thin-walk ratio is
   * `gained < page1Gain * 0.25`, which with the default three URLs cannot be
   * satisfied by any `gained > 0`.
   */
  page1?: string[];
  /**
   * The capture's intercepted requests, replacing the default listing API.
   * `[]` means "this page made no JSON XHR at all" — the case api-param must
   * stay SILENT about rather than warn on.
   */
  intercepted?: InterceptedRequest[];
}): ApiParamDeps {
  const evaluateCalls: string[] = [];
  const fetchedUrls: string[] = [];
  const crawlCalls: CrawlOptions[] = [];
  const saved: SavedConfig[] = [];
  const page1 = over.page1 ?? PAGE1;
  const pages = over.pages ?? [['https://listing.example/p/200001']];
  const probe = over.probe ?? ['https://listing.example/p/900001', 'https://listing.example/p/900002'];

  // A real intercepted response carrying page 1's URLs, so COLD runs exercise
  // the actual detectApiParam rather than a stub of it.
  const apiRequest = {
    url: 'https://listing.example/api?kn=py&offset=0',
    method: 'GET', resourceType: 'xhr', responseStatus: 200, responseHeaders: {},
    responseBody: JSON.stringify(body(page1)), contentType: 'application/json',
    bodySize: 200, isJson: true, parsedJson: body(page1), timestamp: 0,
  } as InterceptedRequest;

  const capture = {
    url: 'https://listing.example/search',
    html: '<html><body>listing</body></html>',
    screenshot: '',
    screenshotTiles: [],
    interceptedRequests: over.intercepted ?? [apiRequest],
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
      data: [{ [DETAIL_URL_FIELD]: page1[0] }],
      rows: page1.map((u) => ({ [DETAIL_URL_FIELD]: u })),
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
