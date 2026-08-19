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
  strategy: 'url-pattern' | 'next-button' | 'page-numbers';
  /** For url-pattern: URL with {N} placeholder, e.g. "https://example.com/search?page={N}" */
  urlTemplate?: string;
  /** For next-button: CSS selector for the next page element */
  nextSelector?: string;
  /** For page-numbers: CSS selector for page number links container */
  pageSelector?: string;
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
   * First page to yield. Default 1. Phase 1 of the crawler captures page 1
   * itself (it needs the full capture for selector generation), so it resumes
   * pagination at 2 rather than paying for that page load twice.
   */
  startPage?: number;
};

export type CrawlPage = {
  url: string;
  pageNumber: number;
  data: Record<string, unknown>[];
  totalRows: number;
};
