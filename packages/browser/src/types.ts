export type InterceptedRequest = {
  url: string;
  method: string;
  resourceType: string;
  responseStatus: number;
  responseHeaders: Record<string, string>;
  responseBody: string | null;
  contentType: string | null;
  bodySize: number;
  isJson: boolean;
  parsedJson: unknown | null;
  timestamp: number;
};

export type StructuredData = {
  ldJson: Record<string, unknown>[];
  nextData: Record<string, unknown> | null;
  initialState: Record<string, unknown> | null;
  meta: Record<string, string>;
};

export type PageCapture = {
  url: string;
  html: string;
  markdown: string;
  screenshot: Buffer;
  screenshotTiles: Buffer[];
  title: string;
  timestamp: number;
  structuredData: StructuredData;
  interceptedRequests: InterceptedRequest[];
};

export type BrowserOptions = {
  headless?: boolean;
  blockAds?: boolean;
  blockImages?: boolean;
  viewport?: { width: number; height: number };
  userAgent?: string;
  timeout?: number;
  /**
   * Apply anti-fingerprinting (playwright-extra + stealth) and realistic context
   * defaults. Defaults to TRUE — the sites worth scraping are the ones checking.
   * Set false to reproduce a vanilla launch when diagnosing whether stealth is
   * itself the problem on some domain.
   */
  stealth?: boolean;
};

export type CaptureOptions = {
  waitUntil?: 'load' | 'networkidle' | 'domcontentloaded';
  interceptNetworkRequests?: boolean;
  timeout?: number;
};

export interface IBrowser {
  launch(options?: BrowserOptions): Promise<void>;
  capture(url: string, options?: CaptureOptions): Promise<PageCapture>;
  evaluate<T = unknown>(url: string, script: string, options?: CaptureOptions): Promise<T>;
  setContentEvaluate<T = unknown>(html: string, script: string): Promise<T>;
  close(): Promise<void>;
  crawl(startUrl: string, options: CrawlOptions): AsyncGenerator<CrawlPage>;
}

// ─── Pagination & Crawl ─────────────────────────────────────────────────────

export type PaginationConfig = {
  strategy: 'url-pattern' | 'next-button' | 'page-numbers' | 'api-param';
  /** For url-pattern: URL with {N} placeholder, e.g. "https://example.com/search?page={N}" */
  urlTemplate?: string;
  /** For next-button: CSS selector for the next page element */
  nextSelector?: string;
  /** For page-numbers: CSS selector for page number links container */
  pageSelector?: string;
  /**
   * For api-param: the listing endpoint with the paging parameter's value
   * replaced by {N}. A template, not a captured URL, for the same reason
   * `urlTemplate` is one — a captured URL carries a value that is wrong on
   * every subsequent page.
   */
  apiTemplate?: string;
  /** For api-param: the query parameter that pages, e.g. "offset". */
  paramName?: string;
  /** For api-param: how much to advance it per page — 1 for page-style, the page size for offset-style. */
  step?: number;
  /**
   * For api-param: the paging parameter's value on PAGE 1 — the base the walk
   * counts up from. `apiTemplate` replaces that value with `{N}` wholesale, so
   * without this the walk has no way to know where the pager starts, and a
   * page-style pager (which starts at 1, not 0) gets re-served page 1 while
   * never reaching the last page. Optional, defaulting to 0, so configs cached
   * before this field existed — all of them offset-style, all of them starting
   * at 0 — keep behaving exactly as they did.
   */
  from?: number;
  /** For api-param: dot path to the results array inside the response. */
  itemsPath?: string;
  /** For api-param: dot path to the detail URL inside each result. */
  urlPath?: string;
};

export type CrawlOptions = {
  /** Maximum number of pages to crawl. Default: 5 */
  maxPages?: number;
  /** Stop after extracting this many total items across all pages */
  maxItems?: number;
  /** The extraction script to run on each page (from buildExtractionScript) */
  extractionScript: string;
  /** Skip detection if pagination config is already known (from cache) */
  paginationConfig?: PaginationConfig;
  /**
   * First page to YIELD. Default 1. Phase 1 of the crawler captures page 1
   * itself (it needs the full capture for selector generation), so passing 2
   * suppresses the duplicate extraction and the duplicate yield.
   *
   * It does NOT skip the page-1 navigation: pagination is detected from page 1's
   * live DOM inside crawl(), and the next-button / page-numbers strategies click
   * their way forward from it. So page 1 is still loaded twice until a cached
   * `paginationConfig` can be passed in instead.
   */
  startPage?: number;
};

export type CrawlPage = {
  url: string;
  pageNumber: number;
  data: Record<string, unknown>[];
  totalRows: number;
};
