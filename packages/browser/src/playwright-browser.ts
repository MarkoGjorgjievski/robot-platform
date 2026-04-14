import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { NodeHtmlMarkdown } from 'node-html-markdown';
import type { IBrowser, BrowserOptions, CaptureOptions, PageCapture, StructuredData, InterceptedRequest, CrawlOptions, CrawlPage, PaginationConfig } from './types.js';
import { detectPaginationFromHtml } from './pagination-detector.js';

const nhm = new NodeHtmlMarkdown();

// Common popup/consent selectors to auto-dismiss before capture
const POPUP_DISMISS_SELECTORS = [
  // Cookie consent
  'button[id*="cookie" i][id*="accept" i]',
  'button[id*="cookie" i][id*="close" i]',
  'button[id*="consent" i][id*="accept" i]',
  'button[class*="cookie" i][class*="accept" i]',
  'button[class*="consent" i][class*="accept" i]',
  'button[data-testid*="cookie" i]',
  '#onetrust-accept-btn-handler',
  '#accept-cookie-notification',
  '.cookie-banner button',
  '.cookie-notice button',
  '[aria-label*="cookie" i][aria-label*="accept" i]',
  '[aria-label*="cookie" i][aria-label*="close" i]',

  // Generic consent/privacy modals
  'button[id*="consent" i][id*="close" i]',
  'button[class*="consent" i][class*="close" i]',
  '[data-testid="close-consent"]',
  'button[class*="privacy" i][class*="accept" i]',

  // Health data consent (Target-style)
  'button[class*="consent" i][class*="continue" i]',
  'button:has-text("Continue shopping")',
  'button:has-text("Accept all")',
  'button:has-text("Accept cookies")',
  'button:has-text("Accept All Cookies")',
  'button:has-text("I Accept")',
  'button:has-text("I agree")',
  'button:has-text("Got it")',
  'button:has-text("OK")',
  'button:has-text("Close")',

  // Newsletter/email modals
  '[aria-label="Close dialog"]',
  '[aria-label="Close modal"]',
  '[aria-label="Close"]',
  'button[class*="modal" i][class*="close" i]',
  '.modal-close',
  '.popup-close',
  '[data-dismiss="modal"]',

  // Generic overlay close buttons (last resort — might close wrong thing)
  'dialog button[aria-label*="close" i]',
  '[role="dialog"] button[aria-label*="close" i]',
];

export class PlaywrightBrowser implements IBrowser {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;

  async launch(options: BrowserOptions = {}): Promise<void> {
    this.browser = await chromium.launch({
      headless: options.headless ?? true,
    });
    this.context = await this.browser.newContext({
      viewport: options.viewport ?? { width: 1280, height: 800 },
      userAgent: options.userAgent,
    });
  }

  async capture(url: string, options: CaptureOptions = {}): Promise<PageCapture> {
    if (!this.context) throw new Error('Browser not launched. Call launch() first.');

    const page = await this.context.newPage();

    // Set up network interception BEFORE navigating
    const intercepted: InterceptedRequest[] = [];
    const shouldIntercept = options.interceptNetworkRequests ?? true;

    if (shouldIntercept) {
      await this.setupNetworkInterception(page, intercepted);
    }

    try {
      await this.navigateWithFallback(page, url, options);
      await this.dismissPopups(page);
      await this.expandHiddenContent(page);

      const [html, title, screenshotBuffer, structuredData] = await Promise.all([
        page.content(),
        page.title(),
        page.screenshot({
          type: 'png',
          fullPage: false,
          clip: options.screenshotFullPage ? undefined : { x: 0, y: 0, width: 1280, height: 1600 },
        }),
        this.extractStructuredData(page),
      ]);

      const cleanedHtml = await this.extractReadableContent(page, html);
      const markdown = nhm.translate(cleanedHtml);

      // Rank and filter the intercepted requests
      const rankedRequests = this.rankInterceptedRequests(intercepted, url);

      if (rankedRequests.length > 0) {
        console.log(`[browser] Intercepted ${intercepted.length} requests, ${rankedRequests.length} contain JSON data`);
        console.log(`[browser] Top API: ${rankedRequests[0].url.slice(0, 120)} (${rankedRequests[0].bodySize} bytes)`);
      }

      return {
        url: page.url(),
        html,
        markdown,
        screenshot: Buffer.from(screenshotBuffer),
        title,
        timestamp: Date.now(),
        structuredData,
        interceptedRequests: rankedRequests,
      };
    } finally {
      await page.close();
    }
  }

  async close(): Promise<void> {
    await this.context?.close();
    await this.browser?.close();
    this.context = null;
    this.browser = null;
  }

  async evaluate<T = unknown>(url: string, script: string, options: CaptureOptions = {}): Promise<T> {
    if (!this.context) throw new Error('Browser not launched. Call launch() first.');

    const page = await this.context.newPage();
    try {
      await this.navigateWithFallback(page, url, options);
      await this.dismissPopups(page);
      return await page.evaluate(script) as T;
    } finally {
      await page.close();
    }
  }

  /**
   * Navigate with fallback strategy:
   * 1. Try networkidle (best for simple pages)
   * 2. Fall back to domcontentloaded + manual wait (for heavy sites)
   */
  private async navigateWithFallback(page: Page, url: string, options: CaptureOptions = {}): Promise<void> {
    const timeout = options.timeout ?? 60000;
    const preferred = options.waitUntil ?? 'networkidle';

    try {
      await page.goto(url, {
        waitUntil: preferred,
        timeout,
      });
    } catch (err) {
      if (preferred === 'networkidle') {
        console.warn(`networkidle timed out for ${url}, falling back to domcontentloaded`);
        await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout,
        });
        await page.waitForTimeout(3000);
        try {
          await page.waitForLoadState('load', { timeout: 10000 });
        } catch {
          // load state timeout is fine
        }
      } else {
        throw err;
      }
    }
  }

  /**
   * Try to dismiss common popups, consent banners, and modals.
   * Makes multiple passes — popups can appear with a delay.
   */
  private async dismissPopups(page: Page): Promise<void> {
    // Wait a moment for popups to appear (many load after page content)
    await page.waitForTimeout(1500);

    // Try up to 3 rounds (some sites stack multiple popups)
    for (let round = 0; round < 3; round++) {
      let dismissed = false;

      for (const selector of POPUP_DISMISS_SELECTORS) {
        try {
          const el = page.locator(selector).first();
          if (await el.isVisible({ timeout: 200 })) {
            await el.click({ timeout: 2000, force: true });
            await page.waitForTimeout(800);
            dismissed = true;
            break; // One per round — check if more popups appeared
          }
        } catch {
          // Selector not found or not clickable — try next
        }
      }

      // Also try using JavaScript to remove overlay/modal elements directly
      if (!dismissed) {
        const removed = await page.evaluate(() => {
          let found = false;
          // Remove common overlay elements
          const overlaySelectors = [
            '[class*="overlay" i][class*="modal" i]',
            '[class*="overlay" i][class*="consent" i]',
            '[class*="modal" i][class*="backdrop" i]',
            '[id*="consent" i][role="dialog"]',
            '[role="dialog"][aria-modal="true"]',
          ];
          for (const sel of overlaySelectors) {
            const els = document.querySelectorAll(sel);
            els.forEach(el => {
              el.remove();
              found = true;
            });
          }
          // Also remove any fixed/sticky overlays blocking content
          document.querySelectorAll('body > div').forEach(el => {
            const style = window.getComputedStyle(el);
            if (
              (style.position === 'fixed' || style.position === 'absolute') &&
              parseFloat(style.zIndex) > 1000 &&
              el.querySelector('button')
            ) {
              el.remove();
              found = true;
            }
          });
          // Re-enable scrolling if body was locked
          document.body.style.overflow = '';
          document.documentElement.style.overflow = '';
          return found;
        });

        if (removed) {
          await page.waitForTimeout(500);
        } else {
          break; // No more popups found
        }
      }
    }
  }

  /**
   * Expand hidden content (accordions, "show more" links, collapsed sections)
   * before capturing the page. Runs after popup dismissal, before screenshot.
   */
  private async expandHiddenContent(page: Page): Promise<void> {
    const EXPAND_SELECTORS = [
      // Native HTML details elements
      'main details:not([open]) summary',
      'article details:not([open]) summary',
      // ARIA expandable elements
      'main [aria-expanded="false"]',
      'article [aria-expanded="false"]',
      // Bootstrap-style collapsibles
      'main [data-toggle="collapse"]',
      'article [data-toggle="collapse"]',
      // "Show more" / "See more" buttons (text-based, main content only)
      'main button',
      'article button',
      'main a[role="button"]',
    ];

    const EXPAND_TEXT_PATTERNS = /^(show more|see more|see all|view details|read more|expand|view all|load more|\+ more|show all)$/i;

    for (let round = 0; round < 2; round++) {
      let expanded = false;

      // Phase 1: Click elements matching structural selectors (details, aria-expanded)
      for (const selector of EXPAND_SELECTORS.slice(0, 6)) {
        try {
          const elements = page.locator(selector);
          const count = await elements.count();
          for (let i = 0; i < Math.min(count, 10); i++) {
            const el = elements.nth(i);
            if (await el.isVisible({ timeout: 200 })) {
              await el.click({ timeout: 1000, force: true });
              expanded = true;
            }
          }
        } catch {
          // Not found or not clickable
        }
      }

      // Phase 2: Click buttons/links with "show more" text patterns
      try {
        const expanded2 = await page.evaluate((pattern) => {
          let found = false;
          const re = new RegExp(pattern, 'i');
          const main = document.querySelector('main') ?? document.querySelector('article') ?? document.body;
          const buttons = main.querySelectorAll('button, a[role="button"], [class*="expand"], [class*="show-more"], [class*="read-more"]');
          buttons.forEach(el => {
            const text = el.textContent?.trim() ?? '';
            if (re.test(text) && (el as HTMLElement).offsetParent !== null) {
              (el as HTMLElement).click();
              found = true;
            }
          });
          // Also open all <details> elements
          main.querySelectorAll('details:not([open])').forEach(el => {
            el.setAttribute('open', '');
            found = true;
          });
          return found;
        }, EXPAND_TEXT_PATTERNS.source);
        if (expanded2) expanded = true;
      } catch {
        // JS execution failed — non-fatal
      }

      if (expanded) {
        await page.waitForTimeout(500);
      } else {
        break;
      }
    }

    // Phase 3: Click through tabs to load all tab panel content into the DOM
    try {
      const tabsClicked = await page.evaluate(() => {
        const main = document.querySelector('main') ?? document.querySelector('article') ?? document.body;
        const clicked: HTMLElement[] = [];
        const seen = new Set<HTMLElement>();

        function clickTab(el: HTMLElement) {
          if (seen.has(el) || !el.offsetParent) return;
          seen.add(el);
          clicked.push(el);
        }

        // 1. ARIA tabs: [role="tab"]
        main.querySelectorAll('[role="tab"]').forEach(el => clickTab(el as HTMLElement));

        // 2. data-tab attribute: <button data-tab="...">
        main.querySelectorAll('[data-tab]').forEach(el => clickTab(el as HTMLElement));

        // 3. Class-based tabs: elements with "tab" in class inside a tab container
        main.querySelectorAll('[class*="tab" i]').forEach(el => {
          const classes = el.className.toLowerCase();
          // Match tab triggers, not tab panels/content
          if ((classes.includes('tab__') || classes.includes('tab-') || classes.includes('tabs__'))
              && !classes.includes('panel') && !classes.includes('content') && !classes.includes('body')) {
            if (el.matches('button, a, [role="tab"]')) {
              clickTab(el as HTMLElement);
            }
          }
        });

        // Stagger clicks
        clicked.forEach((el, i) => {
          setTimeout(() => el.click(), i * 300);
        });

        return clicked.length;
      });

      if (tabsClicked > 0) {
        await page.waitForTimeout(Math.min(tabsClicked * 300 + 500, 3000));
      }
    } catch {
      // Tab clicking failed — non-fatal
    }
  }

  /**
   * Extract structured data embedded in the page:
   * - JSON-LD (Schema.org) from <script type="application/ld+json">
   * - Next.js data from <script id="__NEXT_DATA__">
   * - Common JS initial state variables
   * - Open Graph and meta tags
   */
  private async extractStructuredData(page: Page): Promise<StructuredData> {
    return page.evaluate(() => {
      const result = {
        ldJson: [] as Record<string, unknown>[],
        nextData: null as Record<string, unknown> | null,
        initialState: null as Record<string, unknown> | null,
        meta: {} as Record<string, string>,
      };

      // 1. JSON-LD (Schema.org structured data)
      document.querySelectorAll('script[type="application/ld+json"]').forEach(el => {
        try {
          const data = JSON.parse(el.textContent ?? '');
          if (Array.isArray(data)) {
            result.ldJson.push(...data);
          } else if (data && typeof data === 'object') {
            result.ldJson.push(data);
          }
        } catch {}
      });

      // 2. Next.js page data
      const nextDataEl = document.getElementById('__NEXT_DATA__');
      if (nextDataEl) {
        try {
          result.nextData = JSON.parse(nextDataEl.textContent ?? '');
        } catch {}
      }

      // 3. Common initial state patterns from window globals
      try {
        const win = window as unknown as Record<string, unknown>;
        const stateKeys = ['__INITIAL_STATE__', '__PRELOADED_STATE__', '__NUXT__', '__APP_DATA__'];
        for (const key of stateKeys) {
          if (win[key] && typeof win[key] === 'object') {
            result.initialState = win[key] as Record<string, unknown>;
            break;
          }
        }
      } catch {}

      // 4. Meta tags (Open Graph, Twitter, standard)
      document.querySelectorAll('meta[property], meta[name]').forEach(el => {
        const key = el.getAttribute('property') ?? el.getAttribute('name') ?? '';
        const content = el.getAttribute('content') ?? '';
        if (key && content) {
          result.meta[key] = content;
        }
      });

      return result;
    });
  }

  /**
   * Intercept all network responses during page load.
   * Captures response bodies for JSON API calls.
   */
  private async setupNetworkInterception(page: Page, intercepted: InterceptedRequest[]): Promise<void> {
    // Patterns to skip (tracking, analytics, ads, images, fonts)
    const SKIP_PATTERNS = [
      /google-analytics|googletagmanager|doubleclick|googlesyndication/i,
      /facebook\.com\/tr|fbevents|pixel/i,
      /hotjar|fullstory|segment\.io|amplitude|mixpanel/i,
      /sentry\.io|bugsnag|datadog/i,
      /\.png$|\.jpg$|\.jpeg$|\.gif$|\.svg$|\.webp$|\.ico$/i,
      /\.woff$|\.woff2$|\.ttf$|\.eot$/i,
      /\.css$|\.map$/i,
    ];

    page.on('response', async (response) => {
      try {
        const url = response.url();
        const status = response.status();
        const contentType = response.headers()['content-type'] ?? '';

        // Skip non-successful responses
        if (status < 200 || status >= 400) return;

        // Skip known tracking/analytics/static resources
        if (SKIP_PATTERNS.some(p => p.test(url))) return;

        // Only capture JSON or API-like responses
        const isJson = contentType.includes('application/json') ||
                       contentType.includes('text/json') ||
                       url.includes('/api/') ||
                       url.includes('/graphql');

        if (!isJson) return;

        // Get the response body
        let responseBody: string | null = null;
        let parsedJson: unknown | null = null;
        let bodySize = 0;

        try {
          responseBody = await response.text();
          bodySize = responseBody.length;

          // Skip tiny responses (likely empty or error)
          if (bodySize < 50) return;
          // Skip huge responses (likely not product data, maybe a full page)
          if (bodySize > 500000) return;

          parsedJson = JSON.parse(responseBody);
        } catch {
          return; // Not valid JSON
        }

        intercepted.push({
          url,
          method: response.request().method(),
          resourceType: response.request().resourceType(),
          responseStatus: status,
          responseHeaders: response.headers(),
          responseBody,
          contentType,
          bodySize,
          isJson: true,
          parsedJson,
          timestamp: Date.now(),
        });
      } catch {
        // Response might be disposed if page navigated — ignore
      }
    });
  }

  /**
   * Rank intercepted requests by likelihood of containing useful data.
   * Filters out tracking/analytics and sorts by relevance.
   */
  private rankInterceptedRequests(requests: InterceptedRequest[], pageUrl: string): InterceptedRequest[] {
    // Score each request
    const scored = requests
      .filter(r => r.isJson && r.parsedJson !== null)
      .map(r => {
        let score = 0;
        const url = r.url.toLowerCase();
        const body = r.responseBody ?? '';

        // URL signals
        if (url.includes('/api/')) score += 3;
        if (url.includes('/graphql')) score += 3;
        if (url.includes('/product')) score += 5;
        if (url.includes('/item')) score += 4;
        if (url.includes('/listing')) score += 4;
        if (url.includes('/search')) score += 3;
        if (url.includes('/catalog')) score += 3;
        if (url.includes('/price')) score += 4;
        if (url.includes('/detail')) score += 4;
        if (url.includes('/pdp')) score += 5; // Product Detail Page
        if (url.includes('/v1/') || url.includes('/v2/') || url.includes('/v3/')) score += 2;

        // Penalize known non-data endpoints
        if (url.includes('/log') || url.includes('/track') || url.includes('/beacon')) score -= 10;
        if (url.includes('/auth') || url.includes('/session') || url.includes('/token')) score -= 5;
        if (url.includes('/config') || url.includes('/feature-flag')) score -= 3;

        // Body content signals — look for product-like data
        if (body.includes('"price"') || body.includes('"Price"')) score += 5;
        if (body.includes('"title"') || body.includes('"name"') || body.includes('"productName"')) score += 4;
        if (body.includes('"description"') || body.includes('"Description"')) score += 3;
        if (body.includes('"image"') || body.includes('"imageUrl"')) score += 2;
        if (body.includes('"rating"') || body.includes('"review"')) score += 3;
        if (body.includes('"sku"') || body.includes('"upc"') || body.includes('"gtin"')) score += 4;
        if (body.includes('"availability"') || body.includes('"inStock"')) score += 3;
        if (body.includes('"brand"') || body.includes('"manufacturer"')) score += 3;

        // Count how many product-like keys appear (more = more likely product data)
        const productKeyCount = [
          '"price"', '"title"', '"name"', '"description"', '"image"',
          '"rating"', '"review"', '"sku"', '"brand"', '"availability"',
          '"category"', '"url"', '"stock"', '"shipping"', '"seller"',
        ].filter(k => body.includes(k)).length;
        score += productKeyCount * 2; // Each matching key adds 2 points

        // Penalize responses that look like UI/layout config
        if (body.includes('"modules"') && body.includes('"layout"') && body.includes('"zones"')) score -= 3;
        if (body.includes('"components"') && body.includes('"template"')) score -= 2;
        if (body.includes('"featureFlags"') || body.includes('"experiments"')) score -= 5;

        // Size signal — sweet spot is 1KB-50KB for product data
        if (r.bodySize > 500 && r.bodySize < 100000) score += 2;
        if (r.bodySize > 2000 && r.bodySize < 50000) score += 3;
        // Penalize very large responses — likely UI framework data, not product data
        if (r.bodySize > 100000) score -= 2;

        return { request: r, score };
      })
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score);

    // Return top results (don't need to keep all)
    return scored.slice(0, 10).map(s => s.request);
  }

  /**
   * Crawl paginated listing pages, yielding extracted data from each page.
   * Detects pagination mechanically from page 1 HTML unless config is provided.
   */
  async *crawl(startUrl: string, options: CrawlOptions): AsyncGenerator<CrawlPage> {
    if (!this.context) throw new Error('Browser not launched. Call launch() first.');

    const maxPages = options.maxPages ?? 5;
    const maxItems = options.maxItems ?? Infinity;
    let totalItems = 0;
    let paginationConfig = options.paginationConfig ?? null;

    const page = await this.context.newPage();

    try {
      // Page 1: navigate, extract, detect pagination
      await this.navigateWithFallback(page, startUrl);
      await this.dismissPopups(page);
      await this.expandHiddenContent(page);

      const page1Html = await page.content();
      const page1Data = await page.evaluate(options.extractionScript) as { data: Record<string, unknown>[]; totalRows: number };

      yield {
        url: startUrl,
        pageNumber: 1,
        data: page1Data.data,
        totalRows: page1Data.totalRows,
      };

      totalItems += page1Data.data.length;
      if (totalItems >= maxItems || maxPages <= 1) return;

      // Detect pagination from page 1 HTML if not provided
      if (!paginationConfig) {
        paginationConfig = detectPaginationFromHtml(page1Html, startUrl);
        if (paginationConfig) {
          console.log(`[crawl] Detected pagination: ${paginationConfig.strategy}`);
        }
      }

      if (!paginationConfig) {
        console.log('[crawl] No pagination detected — single page listing');
        return;
      }

      // Pages 2+
      for (let pageNum = 2; pageNum <= maxPages; pageNum++) {
        if (totalItems >= maxItems) break;

        const navigated = await this.navigateToPage(page, paginationConfig, pageNum, startUrl);
        if (!navigated) {
          console.log(`[crawl] No more pages after page ${pageNum - 1}`);
          break;
        }

        // Wait for content to settle
        await page.waitForTimeout(1000);

        const pageData = await page.evaluate(options.extractionScript) as { data: Record<string, unknown>[]; totalRows: number };

        // Stop if no new items
        if (pageData.data.length === 0) {
          console.log(`[crawl] Page ${pageNum} returned 0 items — stopping`);
          break;
        }

        yield {
          url: page.url(),
          pageNumber: pageNum,
          data: pageData.data,
          totalRows: pageData.totalRows,
        };

        totalItems += pageData.data.length;
        console.log(`[crawl] Page ${pageNum}: ${pageData.data.length} items (${totalItems} total)`);
      }
    } finally {
      await page.close();
    }
  }

  /**
   * Navigate to a specific page number using the detected pagination strategy.
   * Returns false if navigation failed (no more pages).
   */
  private async navigateToPage(
    page: Page,
    config: PaginationConfig,
    pageNum: number,
    startUrl: string,
  ): Promise<boolean> {
    try {
      switch (config.strategy) {
        case 'url-pattern': {
          if (!config.urlTemplate) return false;
          const targetUrl = config.urlTemplate.replace('{N}', String(pageNum));
          await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
          return true;
        }

        case 'next-button': {
          if (!config.nextSelector) return false;
          const nextEl = page.locator(config.nextSelector).first();
          if (!await nextEl.isVisible({ timeout: 3000 })) return false;
          await nextEl.click({ timeout: 5000 });
          await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
          return true;
        }

        case 'page-numbers': {
          if (!config.pageSelector) return false;
          const pageLink = page.locator(`${config.pageSelector}`).filter({ hasText: String(pageNum) }).first();
          if (!await pageLink.isVisible({ timeout: 3000 })) return false;
          await pageLink.click({ timeout: 5000 });
          await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
          return true;
        }

        default:
          return false;
      }
    } catch (err) {
      console.error(`[crawl] Navigation to page ${pageNum} failed:`, err);
      return false;
    }
  }

  private async extractReadableContent(page: Page, fallbackHtml: string): Promise<string> {
    const result = await page.evaluate(() => {
      const clone = document.cloneNode(true) as Document;
      // Remove non-content elements
      clone.querySelectorAll([
        'script', 'style', 'noscript', 'iframe',
        'nav', 'footer', 'header',
        '[role="navigation"]', '[role="banner"]', '[role="dialog"]',
        '[aria-hidden="true"]', '[aria-modal="true"]',
        // Popups, modals, overlays
        '[class*="modal" i]', '[class*="overlay" i]', '[class*="popup" i]',
        '[class*="consent" i]', '[class*="cookie" i]',
        '[id*="modal" i]', '[id*="overlay" i]', '[id*="consent" i]',
      ].join(', ')).forEach(el => el.remove());
      return clone.body?.innerHTML ?? '';
    });

    return result || fallbackHtml;
  }
}
