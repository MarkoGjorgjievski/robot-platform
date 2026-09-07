import { chromium, type Browser, type BrowserContext, type Page, type Locator } from 'playwright';
import { NodeHtmlMarkdown } from 'node-html-markdown';
import type { IBrowser, BrowserOptions, CaptureOptions, PageCapture, StructuredData, InterceptedRequest, CrawlOptions, CrawlPage, PaginationConfig, ScrollOptions } from './types.js';
import { detectPaginationFromHtml } from './pagination-detector.js';
import { computeTileClips } from './screenshot-tiles.js';
import { isThirdPartyNoise } from './intercept-noise.js';
import { rankInterceptedRequests } from './rank-requests.js';
import { rowCountScript, stampScript, scopeExtractionScript } from './scroll-pages.js';

// A fullPage render on a heavy commercial page routinely exceeds Playwright's 30s
// default. Raised deliberately: a slow screenshot costs seconds, a failed one costs
// the entire capture and every judge verdict that depended on it.
const SCREENSHOT_TIMEOUT_MS = 60_000;

/**
 * A current, ordinary desktop Chrome UA. Playwright's default advertises
 * HeadlessChrome, which is the single loudest automation tell.
 *
 * This will go stale — a UA claiming a Chrome version years behind the real one
 * is its own signal. Worth refreshing when the stealth spike is next repeated.
 */
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36';

/**
 * playwright-extra + the stealth plugin, loaded lazily and memoised.
 *
 * Lazy because it is a heavy import on a module every package pulls in, and
 * because a failure to load it must not take down capture entirely — a vanilla
 * browser that gets blocked on some sites beats no browser at all.
 */
let stealthLauncher: Promise<typeof chromium> | null = null;
function stealthChromium(): Promise<typeof chromium> {
  stealthLauncher ??= (async () => {
    try {
      const [{ chromium: extra }, { default: StealthPlugin }] = await Promise.all([
        import('playwright-extra'),
        import('puppeteer-extra-plugin-stealth'),
      ]);
      extra.use(StealthPlugin());
      return extra as unknown as typeof chromium;
    } catch (err) {
      console.warn(`[browser] stealth unavailable, falling back to vanilla chromium: ${(err as Error).message}`);
      return chromium;
    }
  })();
  return stealthLauncher;
}

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

/**
 * Given the nearest enclosing anchor (or null), would clicking it leave the page?
 *
 * An anchor is only dangerous if it actually goes somewhere. `<a href="#">` and
 * `href="javascript:void(0)"` are the standard way to build a close button, and a
 * blanket "never click an anchor" rule would break dismissal on many real sites —
 * so the guard has to be about the destination, not the tag.
 */
export function hrefNavigates(link: { href: string | null; target: string | null } | null): boolean {
  if (!link?.href) return false;
  const href = link.href.trim().toLowerCase();
  if (href === '' || href === '#' || href.startsWith('#')) return false;
  if (href.startsWith('javascript:')) return false;
  // Opens a new tab; the page we are capturing stays put.
  if (link.target === '_blank') return false;
  return true;
}

/**
 * Would clicking this element leave the page?
 *
 * A dismissal list broad enough to close real cookie banners is broad enough to
 * match a link. Rather than trying to enumerate safe selectors, check the element
 * itself at click time — that also covers selectors added later.
 *
 * An anchor is only dangerous if it actually goes somewhere: `<a href="#">` and
 * `href="javascript:void(0)"` are the standard way to build a close button, and
 * refusing to click those would break dismissal on many sites.
 */
async function navigatesAway(el: Locator): Promise<boolean> {
  try {
    // The DOM lookup happens in the page; the decision itself is hrefNavigates,
    // which is pure and unit-tested. Inlined rather than imported because this
    // body is serialised into the browser context.
    const link = await el.evaluate((node) => {
      const anchor = (node as Element).closest('a');
      return anchor ? { href: anchor.getAttribute('href'), target: anchor.getAttribute('target') } : null;
    });
    return hrefNavigates(link);
  } catch {
    // If it cannot be inspected, treat it as safe — the post-capture URL check
    // still catches a navigation, and being over-cautious here means never
    // dismissing anything on pages that resist evaluation.
    return false;
  }
}

export class PlaywrightBrowser implements IBrowser {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;

  async launch(options: BrowserOptions = {}): Promise<void> {
    // Stealth is ON by default. A headless Chromium announces itself through a
    // dozen small tells (navigator.webdriver, missing plugin arrays, a headless
    // UA string), and the sites we most want are the ones checking. Measured
    // 2026-08-18 on the three sites that blocked a vanilla launch:
    //   B&H Photo  Cloudflare block  -> full product page, JSON-LD intact
    //   Wayfair    CAPTCHA           -> full listing, 82KB of content
    //   Etsy       CAPTCHA           -> still blocked; needs proxies or a solver
    // Newegg, which already worked, was unaffected — this does not trade away
    // sites that were fine.
    const useStealth = options.stealth ?? true;
    const launcher = useStealth ? await stealthChromium() : chromium;

    this.browser = await launcher.launch({ headless: options.headless ?? true });

    // A default context also leaks tells: no locale, no timezone, and a UA that
    // says HeadlessChrome. Only defaults — per-source browser config (v1.5
    // Phase 3) still overrides them.
    //
    // The viewport is deliberately left at 1280x800. Widening it was tempting
    // while here, but viewport changes layout on responsive sites and can move
    // XPath results, which has nothing to do with fingerprinting and was not
    // what the spike measured. Two changes, one commit, no way to attribute a
    // regression.
    this.context = await this.browser.newContext({
      viewport: options.viewport ?? { width: 1280, height: 800 },
      userAgent: options.userAgent ?? (useStealth ? DEFAULT_USER_AGENT : undefined),
      ...(useStealth ? { locale: 'en-US', timezoneId: 'America/New_York' } : {}),
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
      const stage = async (name: string) => {
        if (!process.env.CAPTURE_DEBUG) return;
        const m = await page.evaluate(`(() => ({
          y: Math.round(window.scrollY), h: document.body.scrollHeight,
          links: document.querySelectorAll('a[href]').length,
          nodes: document.getElementsByTagName('*').length,
        }))()`).catch(() => null) as Record<string, number> | null;
        if (m) console.log(`[capture] ${name.padEnd(20)} scrollY=${m.y} height=${m.h} links=${m.links} nodes=${m.nodes}`);
      };

      await this.navigateWithFallback(page, url, options);
      await stage('after navigate');
      await this.dismissPopups(page);
      await stage('after dismissPopups');
      await this.expandHiddenContent(page);
      await stage('after expandHidden');
      await this.returnIfNavigatedAway(page, url, options);

      const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
      const clips = computeTileClips(pageHeight);

      const [html, title, structuredData] = await Promise.all([
        page.content(),
        page.title(),
        this.extractStructuredData(page),
      ]);
      // fullPage:true expands the captured image to the full scrollable page,
      // so clips beyond the 800px viewport (any tile past the first) are in
      // bounds. Without it Playwright clips against the viewport and throws
      // "Clipped area is either empty or outside the resulting image" on any
      // page taller than the viewport (i.e. essentially every real page).
      //
      // Taken sequentially, not with Promise.all: every tile is a fullPage render
      // of the same page, so running them concurrently makes them contend for one
      // renderer rather than going faster. On a heavy page (Newegg) three parallel
      // fullPage renders blew the 30s default and the whole capture failed —
      // which meant analyze returned no screenshot at all and the Tier 2 judge
      // silently marked all 18 fields 'error'.
      //
      // Failures are also per-tile now. Tiles are ordered top-down and only the
      // first is always used, so losing a lower tile costs some below-the-fold
      // escalation; losing the capture entirely costs everything.
      const screenshotTiles: Buffer[] = [];
      for (const [i, clip] of clips.entries()) {
        try {
          const buf = await page.screenshot({ type: 'png', fullPage: true, clip, timeout: SCREENSHOT_TIMEOUT_MS });
          screenshotTiles.push(Buffer.from(buf));
        } catch (err) {
          console.warn(`[browser] tile ${i} screenshot failed (${(err as Error).message.split('\n')[0]});`
            + ` continuing with ${screenshotTiles.length} tile(s)`);
          break; // lower tiles will not do better on a page this slow
        }
      }
      if (screenshotTiles.length === 0) {
        throw new Error(`page.screenshot failed for every tile on ${url} — no usable screenshot`);
      }

      const cleanedHtml = await this.extractReadableContent(page, html);
      const markdown = nhm.translate(cleanedHtml);

      // Rank and filter the intercepted requests
      const rankedRequests = rankInterceptedRequests(intercepted, url);

      if (rankedRequests.length > 0) {
        console.log(`[browser] Intercepted ${intercepted.length} requests, ${rankedRequests.length} contain JSON data`);
        console.log(`[browser] Top API: ${rankedRequests[0].url.slice(0, 120)} (${rankedRequests[0].bodySize} bytes)`);
      }

      return {
        url: page.url(),
        html,
        markdown,
        screenshot: screenshotTiles[0],
        screenshotTiles,
        title,
        timestamp: Date.now(),
        structuredData,
        interceptedRequests: rankedRequests,
      };
    } finally {
      await page.close();
    }
  }

  /**
   * Undo a navigation caused by our own popup dismissal or content expansion.
   *
   * Both passes click things. The dismissal selector list is deliberately broad
   * ("Close", "OK", `[aria-label="Close"]`, `[role="dialog"] button`), and on a
   * real page a broad click list eventually hits a link.
   *
   * Barnes & Noble, 2026-08-19: three captures in four ended on
   * `/nook-glowlight-4-and-4e-cover-in-daffodil-.../1140326163` after requesting
   * `/nook-glowlight-4-.../1145507276`. Everything downstream then described a
   * $9.99 accessory instead of a $149.99 e-reader — and described it perfectly
   * consistently, because the page really was the accessory's. That failure is
   * invisible to every content-level guard: the JSON-LD was valid, the price was
   * real, the name matched the page. Only the URL gave it away.
   *
   * Compares pathname only: query and fragment change legitimately (tracking
   * params, SPA state) without meaning a different page.
   */
  private async returnIfNavigatedAway(page: Page, requestedUrl: string, options: CaptureOptions): Promise<void> {
    let requestedPath: string;
    let currentPath: string;
    try {
      requestedPath = new URL(requestedUrl).pathname.replace(/\/+$/, '');
      currentPath = new URL(page.url()).pathname.replace(/\/+$/, '');
    } catch {
      return; // Unparseable URL — nothing safe to compare.
    }
    if (requestedPath === currentPath) return;

    console.warn(
      `[browser] popup dismissal navigated away from ${requestedPath} to ${currentPath} — returning.`
      + ' Capturing the wrong page yields data that is wrong and self-consistent.',
    );
    // Deliberately no second dismissal pass: it is what moved us, and a popup
    // left standing costs far less than silently capturing another product.
    await this.navigateWithFallback(page, requestedUrl, options);
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

  async setContentEvaluate<T = unknown>(html: string, script: string): Promise<T> {
    if (!this.browser) throw new Error('Browser not launched. Call launch() first.');
    const context = await this.browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    try {
      // Offline by construction, not by claim: `setContent({ waitUntil: 'load' })`
      // alone does NOT stop Chromium from fetching real subresources a captured
      // page references (trackers, ad tags, remote <script src>) — on a heavy real
      // page one of those can hang and blow the timeout (a real currys.co.uk
      // capture did exactly this). The route abort below intercepts and cancels
      // every outgoing request before setContent runs, so no network request ever
      // leaves this page; 'domcontentloaded' then only waits for the (offline) DOM
      // to parse, and any remote <script> is aborted before it can execute.
      await page.route('**/*', (route) => route.abort());
      await page.setContent(html, { waitUntil: 'domcontentloaded' });
      // Playwright evaluates a string argument as a JS expression. The scripts we feed
      // (e.g. buildCachedXPathScript) are self-invoking IIFEs that return a value.
      const result = await page.evaluate(script);
      return result as T;
    } finally {
      await context.close();
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
          if (!(await el.isVisible({ timeout: 200 }))) continue;
          if (await navigatesAway(el)) {
            // On Barnes & Noble a dismissal selector matched an accessory tile's
            // link and clicked through to a different product; three captures in
            // four ended on the wrong page, and the data that came back was wrong
            // AND self-consistent. Refusing to click navigating elements removes
            // the whole class — returnIfNavigatedAway remains as the net.
            continue;
          }
          await el.click({ timeout: 2000, force: true });
          await page.waitForTimeout(800);
          dismissed = true;
          break; // One per round — check if more popups appeared
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
          // Re-enable scrolling if body was locked.
          // Body can be null on pages still loading or non-HTML responses.
          if (document.body) document.body.style.overflow = '';
          if (document.documentElement) document.documentElement.style.overflow = '';
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

      // Phase 1: Click elements matching structural selectors (details, aria-expanded).
      //
      // Done IN THE PAGE, not through a Playwright locator, because a locator
      // click scrolls its element into view first — and on a listing that loads
      // lazily, scrolling is not a neutral act. It appends products. Measured
      // against a fixture whose grid grows near the bottom: with an
      // `aria-expanded` control below the fold, capture's own scrollY went
      // 0 -> ~2655 inside this method and the captured HTML held 2 cards on one
      // run and 3 on the next, from an identical page. The same mechanism made
      // one real listing capture 144, 144, 72 and 108 rows across four runs —
      // whatever happened to have loaded became "page 1", and a downstream walk
      // then had to guess what it already had.
      //
      // Expanding a collapsed panel reveals DOM that already exists, which is
      // what this method is for and is idempotent. Loading more of an unbounded
      // list is a different thing entirely, and it is not capture's job — that
      // is what pagination and the scroll walk are for. `element.click()` fires
      // a real bubbling event without moving the viewport, which is exactly the
      // trade Phase 2 below already makes.
      try {
        const clicked = await page.evaluate((selectors) => {
          let found = 0;
          for (const selector of selectors) {
            const els = Array.prototype.slice.call(document.querySelectorAll(selector), 0, 10);
            for (const el of els) {
              // offsetParent is null for display:none — the cheap "is it really
              // there" check. Being outside the VIEWPORT is fine and expected:
              // that is the case a locator click would have scrolled to.
              if ((el as HTMLElement).offsetParent === null) continue;
              try { (el as HTMLElement).click(); found++; } catch { /* not clickable */ }
            }
          }
          return found;
        }, EXPAND_SELECTORS.slice(0, 6));
        if (clicked > 0) expanded = true;
      } catch {
        // JS execution failed — non-fatal
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
      const startPage = options.startPage ?? 1;

      // Page 1: navigate, extract, detect pagination. Skipped when the caller
      // already captured it and only wants the pages after it.
      await this.navigateWithFallback(page, startUrl);
      await this.dismissPopups(page);
      await this.expandHiddenContent(page);

      const page1Html = await page.content();

      if (startPage <= 1) {
        const page1Data = await page.evaluate(options.extractionScript) as { data: Record<string, unknown>[]; totalRows: number };
        yield { url: startUrl, pageNumber: 1, data: page1Data.data, totalRows: page1Data.totalRows };
        totalItems += page1Data.data.length;
        if (totalItems >= maxItems || maxPages <= 1) return;
      }

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

  /** Consecutive rounds yielding nothing new before the listing is called finished. */
  private static readonly QUIET_ROUNDS = 2;
  /** How long to wait for the row count to grow before treating a round as quiet. */
  private static readonly GROWTH_TIMEOUT_MS = 3000;
  /** Hard bound so a page that grows forever cannot loop forever. Not a budget knob. */
  private static readonly MAX_SCROLL_ROUNDS = 50;
  /** Pacing between rounds. Scrolling in a tight loop is a louder bot signal than fetching. */
  private static readonly SCROLL_PACING_MS = 500;

  /**
   * Walk a listing that only reveals more rows on scroll (or on clicking a
   * "load more" control), yielding each round's newly-seen rows.
   *
   * Lives on IBrowser beside crawl() rather than as a Node-driven loop because
   * evaluate(url, script) NAVIGATES — reloading the page every round would
   * destroy everything already loaded into it.
   */
  async *scrollPages(startUrl: string, options: ScrollOptions): AsyncGenerator<CrawlPage> {
    if (!this.context) throw new Error('Browser not launched. Call launch() first.');
    const maxItems = options.maxItems ?? Number.MAX_SAFE_INTEGER;
    const page = await this.context.newPage();
    let yielded = 0;

    try {
      await this.navigateWithFallback(page, startUrl);
      await this.dismissPopups(page);

      let quiet = 0;
      if (process.env.SCROLL_DEBUG) {
        console.log(
          `[scroll] start url=${page.url()} ` +
          `rows=${await page.evaluate(rowCountScript(options.rowXpath))} ` +
          `title=${JSON.stringify(await page.title().catch(() => '?'))}`,
        );
      }
      for (let round = 2; round <= PlaywrightBrowser.MAX_SCROLL_ROUNDS; round++) {
        if (yielded >= maxItems) break;

        const before = await page.evaluate(rowCountScript(options.rowXpath)) as number;

        // Stamp BEFORE advancing, so the next extraction sees only what arrived
        // since — but NOT on the first round.
        //
        // The old code stamped here unconditionally, reasoning that everything
        // currently on the page "belongs to page 1, which the caller already
        // has". That is false, and it cost a live run 72 of its 220 items. This
        // generator opens its OWN page: how much a lazy listing has loaded by
        // the time it starts is a race, measured at 36, 108 and ~144 rows on
        // three runs of the same URL. Page 1's rows come from `capture`, a
        // different navigation, measured at 144, 144 and 72. The two views
        // overlap only by coincidence, and everything in the gap was stamped
        // unseen and never yielded — silently, because a stamped row is
        // indistinguishable from one already reported.
        //
        // So the first round yields whatever it can see and lets the caller's
        // `absorb` discard what it already has. That is the spec's own rule —
        // correctness comes from the caller's dedupe, stamping is only an
        // optimisation — and stamping here had quietly made the label
        // load-bearing for correctness.
        if (round > 2) await page.evaluate(stampScript(options.rowXpath));

        if (options.loadMoreSelector) {
          const btn = page.locator(options.loadMoreSelector).first();
          if (!await btn.isVisible({ timeout: 1000 }).catch(() => false)) break;
          await btn.click({ timeout: 5000 }).catch(() => {});
        } else {
          // UP, then down — not straight to the bottom. Chromium's scroll
          // anchoring keeps the viewport pinned to the bottom as content grows,
          // so by the next round `scrollTo(0, scrollHeight)` is already at max:
          // it moves nothing and fires no scroll event, and a listing that
          // advances on scroll never advances again.
          //
          // Measured against the fixture, four batches, one round each:
          //   scrollTo(bottom) alone      → [1, 2, 2, 2]  (stalls after one)
          //   scrollTo(0) then bottom     → [1, 2, 3, 4]
          await page.evaluate('window.scrollTo(0, 0); window.scrollTo(0, document.body.scrollHeight);');
        }

        // Wait for growth rather than a fixed delay: a fast site proceeds at once,
        // a slow one still gets its chance, and the timeout only binds when
        // nothing is coming.
        const grew = await page.waitForFunction(
          `(${rowCountScript(options.rowXpath)}) > ${before}`,
          undefined,
          { timeout: PlaywrightBrowser.GROWTH_TIMEOUT_MS },
        ).then(() => true).catch(() => false);

        // Also force LISTING mode. buildExtractionScript's 'auto' page-type
        // heuristic decides listing-vs-detail from the matched row COUNT
        // (`rows.length > 1`) — fine for a normal page, wrong here, because the
        // unseen-scoped count legitimately swings to 0 or 1 every round. At 0 or
        // 1 it drops into DETAIL mode, whose fallback re-searches the whole
        // DOCUMENT with an absolute xpath when a field doesn't match the row —
        // surfacing an already-seen field from elsewhere on the page instead of
        // an empty result. That defeats the quiet-round check below: a truly
        // quiet round no longer reports zero rows, so `quiet` never reaches
        // QUIET_ROUNDS and the walk runs every round out to MAX_SCROLL_ROUNDS.
        // Measured against `/done` (a page that never grows again): without
        // this the walk takes ~50 rounds x 3s to time out instead of stopping
        // after 2 quiet rounds (~6s). LISTING mode has no such fallback — zero
        // matched rows is simply zero results.
        const extracted = await page.evaluate(
          scopeExtractionScript(options.extractionScript, options.rowXpath),
        ) as { data: Record<string, unknown>[]; totalRows: number };

        // The audit trail on the caller's side records what was YIELDED, which
        // by construction cannot show a quiet round — the round that ends a
        // walk is exactly the one that yields nothing. Gated because a walk of
        // 50 rounds would otherwise print 50 lines on every production run.
        if (process.env.SCROLL_DEBUG) {
          const after = await page.evaluate(rowCountScript(options.rowXpath)) as number;
          console.log(
            `[scroll] round ${round}: rows ${before} -> ${after} (grew=${grew}) ` +
            `extracted=${extracted.data.length} of ${extracted.totalRows} unstamped, quiet=${quiet}`,
          );
        }

        if (!grew && extracted.data.length === 0) {
          if (++quiet >= PlaywrightBrowser.QUIET_ROUNDS) break;
          continue;
        }
        quiet = 0;

        if (extracted.data.length > 0) {
          yield { url: page.url(), pageNumber: round, data: extracted.data, totalRows: extracted.totalRows };
          yielded += extracted.data.length;
        }
        await page.waitForTimeout(PlaywrightBrowser.SCROLL_PACING_MS);
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
