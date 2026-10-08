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

export type CaptureTimings = {
  /** Navigation until the requested load state (or its fallback) was reached. */
  navigateMs: number;
  /** Time spent polling the ready check (grace excluded); null when none was given. */
  readyMs: number | null;
  /**
   * 'ready': the check passed within its poll deadline. 'settled': it passed
   * only after the bounded networkidle wait that follows the deadline.
   * 'timeout': it never passed — the capture went on regardless, and a path
   * that still misses is an honest miss. null: no ready check was given.
   */
  readyState: 'ready' | 'settled' | 'timeout' | null;
  /** Time spent in the grace period after the ready check passed; absent or null when none was taken. */
  graceMs?: number | null;
  /** Whole capture, navigation to return. */
  totalMs: number;
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
  /** Absent only on captures built outside the browser (fixtures, replays). */
  timings?: CaptureTimings;
  /**
   * The document's scrollHeight in page pixels, measured right before the
   * tiles — how much of it they cover is `tiles.length * TILE_HEIGHT`. Absent
   * on captures built outside the browser (fixtures, replays).
   */
  pageHeight?: number;
  /** The `annotate` script's value, when one was given (box map for a proof page). */
  annotation?: unknown;
};

/** What a ready check sees on each poll: the probe's result from the live page,
 * plus the structured data and JSON responses seen so far. */
export type ReadySnapshot = Pick<PageCapture, 'structuredData' | 'interceptedRequests'> & { probe: unknown };

/**
 * Wait for the values a caller needs instead of for the page to go quiet.
 * A page that holds a connection open never reaches networkidle (Ikea: the
 * full 60 s timeout on every product page, 2026-09-15), while the values a
 * certified run needs are on the page within a second or two.
 */
export type ReadyCheck = {
  /** A self-invoking expression evaluated in the live page on every poll; its value is the snapshot's `probe`. */
  script: string;
  isReady: (snapshot: ReadySnapshot) => boolean;
  /** How long to poll after navigation before giving up on readiness. Default 8 000. */
  timeoutMs?: number;
  /** After the poll deadline, one bounded wait for networkidle before the final check. Default 10 000. */
  settleTimeoutMs?: number;
  /**
   * When to poll. 'after-navigation' (default): at once, before the popup and
   * expand rounds; a certified run's values are there by then. 'after-expand':
   * once those rounds have run, for a caller that reads the page as the capture
   * will serialise it (verification: some values only exist in the DOM after a
   * "show more" click, and polling before it would wait out the deadline for a
   * value the capture is about to reveal).
   */
  when?: 'after-navigation' | 'after-expand';
  /**
   * Once the check has passed, hold the capture until no new response has
   * arrived for this long. A value can show in the visible page a moment before
   * the API response carrying it lands; capturing in that gap would hide the
   * better source. Unset: no grace.
   */
  graceQuietMs?: number;
  /** Upper bound on the grace period. Default 3 000. */
  graceMaxMs?: number;
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
  /**
   * Passed to Playwright's launch. Unset keeps Playwright's default (true): it
   * closes the browser and exits the process on Ctrl+C. A CLI that must write
   * something on Ctrl+C (judge-run's report) sets false and closes it itself.
   */
  handleSIGINT?: boolean;
};

export type CaptureOptions = {
  waitUntil?: 'load' | 'networkidle' | 'domcontentloaded';
  interceptNetworkRequests?: boolean;
  timeout?: number;
  /** Poll the live page for the values the caller needs, right after navigation. Pair with `waitUntil: 'load'`. */
  ready?: ReadyCheck;
  /**
   * A self-invoking expression evaluated once in the live page after the popup
   * and "show more" rounds, right before the screenshot, so what it sees is
   * what the screenshot shows. Its value is `PageCapture.annotation`. A throw
   * leaves `annotation` undefined; it never fails the capture.
   */
  annotate?: string;
  /** How many screenshot tiles to take (default `MAX_TILES`). */
  maxTiles?: number;
};

export interface IBrowser {
  launch(options?: BrowserOptions): Promise<void>;
  capture(url: string, options?: CaptureOptions): Promise<PageCapture>;
  evaluate<T = unknown>(url: string, script: string, options?: CaptureOptions): Promise<T>;
  setContentEvaluate<T = unknown>(html: string, script: string): Promise<T>;
  close(): Promise<void>;
  crawl(startUrl: string, options: CrawlOptions): AsyncGenerator<CrawlPage>;
  scrollPages(startUrl: string, options: ScrollOptions): AsyncGenerator<CrawlPage>;
}

// ─── Pagination & Crawl ─────────────────────────────────────────────────────

export type PaginationConfig = {
  strategy: 'url-pattern' | 'next-button' | 'page-numbers' | 'api-param' | 'dom-scroll';
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
  /**
   * For dom-scroll: the clickable that advances the listing, when one was found.
   * Absent means the listing advances by scrolling alone. Stored so a warm run
   * skips the search rather than re-deriving it.
   */
  loadMoreSelector?: string;
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

export type ScrollOptions = {
  /** The extraction script from buildExtractionScript, scoped by the walk to unstamped rows. */
  extractionScript: string;
  /** Page 1's own row xpath — used to count rows, stamp them, and scope extraction. */
  rowXpath: string;
  /**
   * Stop once this many RAW ROWS have been yielded across all rounds — the
   * generator's own ceiling, counted before anything in Node dedupes them.
   *
   * Not an item budget, and not usable as one: a virtualized listing re-serves
   * recycled cards, so N yielded rows can be far fewer than N distinct items.
   * A caller that wants "plan at most N items" must break the `for await`
   * itself, which runs this generator's `finally` and closes its page — see
   * `walkScrollPages` in @robot/scraper's plan-run.ts, which does exactly that
   * and deliberately passes nothing here.
   */
  maxItems?: number;
  /** When present, advance by clicking this instead of scrolling. */
  loadMoreSelector?: string;
};
