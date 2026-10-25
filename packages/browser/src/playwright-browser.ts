import { chromium, type Browser, type BrowserContext, type Page, type JSHandle, type Response } from 'playwright';
import { NodeHtmlMarkdown } from 'node-html-markdown';
import type { IBrowser, BrowserOptions, CaptureOptions, CaptureTimings, CaptureVerdict, ReadyCheck, ReadySnapshot, PageCapture, StructuredData, InterceptedRequest, CrawlOptions, CrawlPage, PaginationConfig, ProxySettings, ScrollOptions } from './types.js';
import { CaptureError } from './types.js';
import { classifyVerdict, classifyNavigationError, isProxyFailure } from './verdict.js';
import { pageVariantFrom, selectedInPageData, wrongVariant, type Selection } from './page-variant.js';
import { detectPaginationFromHtml } from './pagination-detector.js';
import { computeTileClips } from './screenshot-tiles.js';
import { assertBrowserLaunchAllowed, browserOwnerArgs } from './launch-guard.js';
import { isThirdPartyNoise } from './intercept-noise.js';
import { checkProxy, type ProxyCheck } from './proxy-preflight.js';
import { startProxyForwarder, type ProxyForwarder } from './proxy-forwarder.js';
import { rankInterceptedRequests } from './rank-requests.js';
import { rowCountScript, stampScript, scopeExtractionScript } from './scroll-pages.js';
import {
  findLoadMore, loadMoreTargetScript, LOAD_MORE_MAX_ROUNDS, LOAD_MORE_QUIET_ROUNDS, LOAD_MORE_SETTLE_MS, LOAD_MORE_BUDGET_MS,
  MARK_DOCUMENT_SCRIPT, SAME_DOCUMENT_SCRIPT, STEP_SCROLL_SCRIPT,
} from './load-more.js';
import {
  hrefNavigates, EXPAND_START_SCRIPT, EXPAND_ROUND_SCRIPT, NEW_OVERLAYS_SCRIPT,
  REMOVE_NEW_OVERLAYS_SCRIPT, TABS_SCRIPT, NEXT_DISMISS_CANDIDATE_SCRIPT, NEXT_DISMISS_CANDIDATE_FINAL_SCRIPT, LAST_DISMISS_WORKED_SCRIPT,
  REMOVAL_PASS_SCRIPT, CENTRE_OVERLAY_SCRIPT, TOPMOST_OVERLAY_SCRIPT, TOPMOST_WITHOUT_CLOSE_SCRIPT, NOTE_ESCAPE_SCRIPT, overlayWarning, type OverlayDescription,
} from './overlays.js';

// A fullPage render on a heavy commercial page routinely exceeds Playwright's 30s
// default. Raised deliberately: a slow screenshot costs seconds, a failed one costs
// the entire capture and every judge verdict that depended on it.
const SCREENSHOT_TIMEOUT_MS = 60_000;

// Ready-check polling (CaptureOptions.ready). The values a certified run needs
// are usually on the page within a second or two of `load`; the deadline is
// generous for a slow API, and the settle wait after it is the bounded
// networkidle that replaces the unbounded 60 s one.
const READY_POLL_INTERVAL_MS = 250;
const READY_POLL_TIMEOUT_MS = 8_000;
const READY_SETTLE_TIMEOUT_MS = 10_000;
const READY_GRACE_MAX_MS = 3_000;
const READY_GRACE_POLL_MS = 50;

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
 * The stealth evasions we leave off, and why.
 *
 * `iframe.contentWindow` (2026-10-16): together with `user-agent-override` it makes some sites'
 * layout scripts write `width: 4000px` onto `<body>` — Ruggable, Ridge and Mejuri all rendered
 * 4000 px wide at a 1280 px viewport, so the product column fell outside every screenshot (blank
 * proof-page tiles; nothing to mark; nothing for the judge or Jev to read). Removing either evasion
 * fixes it; this one is the less important disguise (the UA override hides "HeadlessChrome").
 * Before/after on the campaign's walled and borderline sites (Thomann, Kith, Bombas, Skims): no
 * site that got through started getting walled.
 *
 * Note: `user-agent-override` replaces the context's `userAgent` too — sites see the bundled
 * Chromium's own version, not DEFAULT_USER_AGENT.
 */
export const STEALTH_EVASIONS_OFF = ['iframe.contentWindow'] as const;

/** A stealth plugin with `STEALTH_EVASIONS_OFF` removed from its enabled evasions. */
export function stealthPlugin<P extends { enabledEvasions: Set<string> }>(make: () => P): P {
  const plugin = make();
  for (const e of STEALTH_EVASIONS_OFF) plugin.enabledEvasions.delete(e);
  return plugin;
}

/** Stealth's own language disguise (navigator.languages, Accept-Language) is en-US; a website's country replaces it. */
const DEFAULT_LOCALE = 'en-US';
// No types ship for the evasions' own modules (CommonJS, default export = (opts) => plugin).
const UA_OVERRIDE = 'puppeteer-extra-plugin-stealth/evasions/user-agent-override/index.js';
const NAV_LANGUAGES = 'puppeteer-extra-plugin-stealth/evasions/navigator.languages/index.js';

/**
 * playwright-extra + the stealth plugin, loaded lazily and memoised — one launcher per locale.
 *
 * Lazy because it is a heavy import on a module every package pulls in, and
 * because a failure to load it must not take down capture entirely — a vanilla
 * browser that gets blocked on some sites beats no browser at all.
 *
 * With no locale (or en-US) it is exactly the launcher it always was (spec 2026-10-24 proxy §3.3). Another locale gets
 * its own instance (`addExtra`) whose `user-agent-override` and `navigator.languages` evasions carry that locale:
 * stealth's defaults would otherwise put en-US back over the context's locale on every page.
 */
const stealthLaunchers = new Map<string, Promise<typeof chromium>>();
export function stealthChromium(locale?: string): Promise<typeof chromium> {
  const key = locale && locale !== DEFAULT_LOCALE ? locale : '';
  let launcher = stealthLaunchers.get(key);
  if (!launcher) {
    launcher = key ? localeStealthLauncher(key) : (async () => {
      try {
        const [{ chromium: shared }, { default: StealthPlugin }] = await Promise.all([
          import('playwright-extra'),
          import('puppeteer-extra-plugin-stealth'),
        ]);
        shared.use(stealthPlugin(StealthPlugin));
        return shared as unknown as typeof chromium;
      } catch (err) {
        console.warn(`[browser] stealth unavailable, falling back to vanilla chromium: ${(err as Error).message}`);
        return chromium;
      }
    })();
    stealthLaunchers.set(key, launcher);
  }
  return launcher;
}

type EvasionFactory = (o: object) => object;
/** The two evasions a locale re-creates; a parameter only so a test can make them fail to load. */
type LoadEvasions = () => Promise<[EvasionFactory, EvasionFactory]>;
const loadLocaleEvasions: LoadEvasions = async () => {
  const [ua, nav] = await Promise.all([
    import(UA_OVERRIDE as string) as Promise<{ default: EvasionFactory }>,
    import(NAV_LANGUAGES as string) as Promise<{ default: EvasionFactory }>,
  ]);
  return [ua.default, nav.default];
};
let warnedLocaleStealth = false;

/**
 * Stealth for a non-US locale (not memoised; `stealthChromium` is). If the locale's evasions cannot be set up, the
 * default stealth launcher instead — en-US in navigator.languages, the context's own locale and zone — never vanilla
 * Chromium (Task 2 review, minor 8); said once per process.
 */
export async function localeStealthLauncher(locale: string, loadEvasions: LoadEvasions = loadLocaleEvasions): Promise<typeof chromium> {
  try {
    const [{ addExtra }, { default: StealthPlugin }, [UserAgentOverride, NavigatorLanguages]] = await Promise.all([
      import('playwright-extra'),
      import('puppeteer-extra-plugin-stealth'),
      loadEvasions(),
    ]);
    const extra = addExtra(chromium);
    const stealth = stealthPlugin(StealthPlugin);
    stealth.enabledEvasions.delete('user-agent-override');
    stealth.enabledEvasions.delete('navigator.languages');
    extra.use(stealth);
    const languages = [locale, locale.split('-')[0]!];
    type Plugin = Parameters<typeof extra.use>[0];
    extra.use(UserAgentOverride({ locale: languages.join(',') }) as Plugin);
    extra.use(NavigatorLanguages({ languages }) as Plugin);
    return extra as unknown as typeof chromium;
  } catch (err) {
    if (!warnedLocaleStealth) {
      warnedLocaleStealth = true;
      console.warn(`[browser] per-locale stealth unavailable, using the default stealth: ${(err as Error).message}`);
    }
    return stealthChromium();
  }
}

/**
 * Spec 2026-10-24 proxy §3.1 (nothing direct): a page's WebRTC/STUN would otherwise send UDP straight out and show the
 * worker's own address past the proxy. Proxied browsers only; a browser with no proxy launches exactly as before.
 */
export const WEBRTC_PROXY_ONLY = '--force-webrtc-ip-handling-policy=disable_non_proxied_udp';

/** Chromium's launch flags for these options: the owner switch, and with a proxy the WebRTC policy. */
export function launchArgs(options: BrowserOptions): string[] {
  return [...browserOwnerArgs(), ...(options.proxy ? [WEBRTC_PROXY_ONLY] : [])];
}

const nhm = new NodeHtmlMarkdown();

/** Playwright reports a dead renderer as "Target crashed" / "Page crashed". */
const isCrash = (err: unknown): boolean => /crashed/i.test(String((err as Error)?.message ?? err));

// Moved to overlays.ts (the page needs it too); re-exported for existing importers.
export { hrefNavigates };

// Dismissal (spec 2026-10-19 §3.3). The rules and the page code are in overlays.ts.
/** Before the first pass, a moment for popups that arrive just after load (not before the final pass). */
const DISMISS_SETTLE_MS = 1500;
/** Rounds per pass; a round that closed and removed nothing ends the pass. */
const DISMISS_MAX_ROUNDS = 4;
/** Clicks per pass, worked or not: each waits DISMISS_CLICK_SETTLE_MS, and a dead one is never retried. */
const DISMISS_MAX_CLICKS = 6;
/** How long a click gets to take effect before it is judged. */
const DISMISS_CLICK_SETTLE_MS = 800;
/** How long an Escape gets to close the topmost overlay (and its page to take the scrim away). */
const DISMISS_ESCAPE_SETTLE_MS = 500;

export class PlaywrightBrowser implements IBrowser {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  /** This browser's pages go through a proxy (spec 2026-10-24 proxy §2.2): its failures are the proxy's, never retried direct. */
  private proxied = false;
  /** The proxy itself, for the Node-side check before a host's first page. */
  private proxy: ProxySettings | null = null;
  /** Per target origin, this session's one proxy check (spec 2026-10-24 proxy §2.2; Task 2 review, issue 1). */
  private proxyChecks = new Map<string, Promise<ProxyCheck>>();
  /** A credentialed proxy's session forwarder (final review I1): Chromium holds only its throwaway credential. */
  private forwarder: ProxyForwarder | null = null;

  async launch(options: BrowserOptions = {}): Promise<void> {
    assertBrowserLaunchAllowed();
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
    const launcher = useStealth ? await stealthChromium(options.locale) : chromium;
    await this.closeForwarder();

    this.browser = await launcher.launch({ headless: options.headless ?? true, handleSIGINT: options.handleSIGINT, args: launchArgs(options) });

    // A default context also leaks tells: no locale, no timezone, and a UA that
    // says HeadlessChrome. Only defaults — a website's country (spec
    // 2026-10-24 proxy) overrides them.
    //
    // The viewport is deliberately left at 1280x800. Widening it was tempting
    // while here, but viewport changes layout on responsive sites and can move
    // XPath results, which has nothing to do with fingerprinting and was not
    // what the spike measured. Two changes, one commit, no way to attribute a
    // regression.
    //
    // Spec 2026-10-24 proxy §2.2: a website's country and proxy. An explicit locale or zone wins over stealth's
    // defaults; with neither, the defaults are exactly what they were (§3.3). Playwright 1.62 hands a per-context
    // proxy to Chromium with no launch flag, and sends loopback addresses through it too.
    const locale = options.locale ?? (useStealth ? DEFAULT_LOCALE : undefined);
    const timezoneId = options.timezoneId ?? (useStealth ? 'America/New_York' : undefined);
    // Final review I1: Playwright answers every HTTP auth challenge — a website's 401 too — with the context proxy's
    // credentials, so a credentialed proxy never reaches Chromium. Chromium talks to this session's loopback forwarder
    // with a throwaway credential instead, and the forwarder adds the real one upstream. A proxy without credentials
    // has nothing to collect and stays direct to the upstream, as before.
    let contextProxy = options.proxy;
    if (options.proxy && (options.proxy.username !== undefined || options.proxy.password !== undefined)) {
      try {
        this.forwarder = await startProxyForwarder(options.proxy);
      } catch (err) {
        await this.browser.close().catch(() => {});
        this.browser = null;
        throw err;
      }
      contextProxy = { server: this.forwarder.server, username: this.forwarder.username, password: this.forwarder.password };
    }
    try {
      this.context = await this.browser.newContext({
        viewport: options.viewport ?? { width: 1280, height: 800 },
        userAgent: options.userAgent ?? (useStealth ? DEFAULT_USER_AGENT : undefined),
        ...(locale ? { locale } : {}),
        ...(timezoneId ? { timezoneId } : {}),
        ...(contextProxy ? { proxy: contextProxy } : {}),
      });
    } catch (err) {
      await this.closeForwarder();
      throw err;
    }
    this.proxied = !!options.proxy;
    this.proxy = options.proxy ?? null;
    this.proxyChecks.clear();
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

      // No document at all is the only reason capture() rejects: a wall, a
      // 404 or an empty shell is still a page, and resolves with its verdict.
      const t0 = Date.now();
      let response: Response | null = null;
      // The verdict reads the LAST main-frame document response, not goto's: a
      // Cloudflare JS challenge answers 403 and reloads to a 200 product page,
      // and returnIfNavigatedAway may navigate again (review I2, 2026-10-09).
      let lastDocument: Response | null = null;
      page.on('response', (r) => {
        try {
          if (r.request().isNavigationRequest() && r.frame() === page.mainFrame()) lastDocument = r;
        } catch { /* a response with no frame (a service worker's) is not the document */ }
      });
      try {
        response = await this.navigateWithFallback(page, url, options);
      } catch (err) {
        if (err instanceof CaptureError) throw err; // the proxy's (spec 2026-10-24 proxy §2.2), already classified
        const kind = classifyNavigationError(err);
        const detail = (err as Error).message;
        console.warn(`[browser] capture of ${url} failed (${kind}): ${detail.split('\n')[0]}`);
        throw new CaptureError(kind, url, detail);
      }
      const navigateMs = Date.now() - t0;
      try {
        await stage('after navigate');
        const readyWhen = options.ready?.when ?? 'after-navigation';
        let ready = options.ready && readyWhen === 'after-navigation' ? await this.waitUntilReady(page, url, intercepted, options.ready) : null;
        if (ready) await stage(`ready: ${ready.state}`);
        // Spec 2026-10-23 run speed §3.1: a lean capture closes nothing — a popup changes no JSON-LD, meta or API
        // body, and its text is not a field value: certified paths read the product, not the popup — and expands
        // only when asked (certified XPaths were proven on the expanded page).
        const lean = options.lean;
        if (!lean) {
          await this.dismissPopups(page);
          await stage('after dismissPopups');
        }
        if (!lean || lean.expand) {
          await this.expandHiddenContent(page, { tabs: options.expandTabs ?? false });
          await stage('after expandHidden');
        }
        await this.returnIfNavigatedAway(page, url, options);
        // 'after-expand': poll the page as it will be serialised, once the popup
        // and "show more" rounds have revealed whatever they reveal.
        if (options.ready && readyWhen === 'after-expand') {
          ready = await this.waitUntilReady(page, url, intercepted, options.ready);
          await stage(`ready (after expand): ${ready.state}`);
        }

        // Spec 2026-10-20 §3.7: a listing reader loads more of the page before it is read. Not on an
        // error response: a wall or a 404 has no grid to grow.
        const documentStatus = (lastDocument ?? response)?.status() ?? 0;
        if (options.loadMore && documentStatus < 400) {
          await this.loadMoreOfListing(page, url, options);
          await stage('after loadMore');
        }

        if (!lean) {
          // Spec 2026-10-19 §3.4: one more dismissal pass for what arrived late (a consent manager
          // that renders after the first pass), with no settle wait — a page with nothing over it
          // costs no time. A close button can navigate by script, so the check runs again. Then
          // back to the top: a dismissal click scrolls its element into view.
          await this.dismissPopups(page, { settleMs: 0, final: true });
          // The mouse rests where dismissal last clicked; its hover state (a size button's border) would
          // be on the screenshot. Park it in the corner (review round 1).
          await page.mouse.move(0, 0).catch((err) => { if (isCrash(err)) throw err; });
          await this.returnIfNavigatedAway(page, url, options);
          await page.evaluate('window.scrollTo(0, 0)').catch((err) => { if (isCrash(err)) throw err; });
          const covering = (await page.evaluate(CENTRE_OVERLAY_SCRIPT).catch((err) => {
            if (isCrash(err)) throw err;
            return null;
          })) as OverlayDescription | null;
          if (covering) console.warn(overlayWarning(url, covering));
          await stage('after final pass');
        }

        let annotation: unknown = undefined;
        if (options.annotate) {
          annotation = await page.evaluate(options.annotate).catch((err) => {
            if (isCrash(err)) throw err;
            console.warn(`[browser] annotate script failed on ${url}: ${(err as Error).message.split('\n')[0]}`);
            return undefined;
          });
        }

        let probe: unknown = undefined;
        // Awaited with no timeout of its own: the probe must be synchronous and quick (CaptureOptions.finalProbe).
        if (options.finalProbe) {
          probe = await page.evaluate(options.finalProbe).catch((err) => {
            if (isCrash(err)) throw err;
            console.warn(`[browser] final probe failed on ${url}: ${(err as Error).message.split('\n')[0]}`);
            return undefined;
          });
        }
        const pictures = !lean && (options.pictures ?? true);

        const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
        // A page laid out far wider than the window puts content outside every tile (the
        // 2026-10-16 stealth case). Said out loud, so a new cause is noticed, not silently blank.
        if (pictures) {
          const pageWidth = await page.evaluate(() => document.documentElement.scrollWidth).catch(() => 0);
          const viewportWidth = page.viewportSize()?.width ?? 1280;
          if (pageWidth > viewportWidth * 1.25) console.warn(`[browser] ${url} is laid out ${pageWidth}px wide in a ${viewportWidth}px window; screenshots will miss content to the right`);
        }
        const clips = pictures ? computeTileClips(pageHeight, options.maxTiles) : [];

        const [html, title, structuredData] = await Promise.all([
          page.content(),
          page.title(),
          this.extractStructuredData(page),
        ]);
        // Spec 2026-10-14 §3: which variant this page shows. The picker's
        // selection comes from the caller's script (scraper's variant-dom),
        // the data's `selected…` keys from what was captured. Never throws.
        let picker: Selection | null = null;
        if (options.selection) {
          picker = await page.evaluate(options.selection).then((v) => (v && typeof v === 'object' ? (v as Selection) : null)).catch((err) => {
            if (isCrash(err)) throw err;
            console.warn(`[browser] selection script failed on ${url}: ${(err as Error).message.split('\n')[0]}`);
            return null;
          });
        }
        const apiBodies = intercepted.filter((r) => r.isJson && r.parsedJson !== null).map((r) => r.parsedJson);
        const pageData = selectedInPageData(structuredData, apiBodies);
        const pageVariant = pageVariantFrom(page.url(), picker, pageData);
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
            if (isCrash(err)) throw err; // a dead renderer is not a slow page
            console.warn(`[browser] tile ${i} screenshot failed (${(err as Error).message.split('\n')[0]});`
              + ` continuing with ${screenshotTiles.length} tile(s)`);
            break; // lower tiles will not do better on a page this slow
          }
          // A crash mid-tiles rethrows above and discards the tiles already taken,
          // on purpose: a dead renderer's page is not handed back half-captured.
        }
        if (pictures && screenshotTiles.length === 0) {
          throw new Error(`page.screenshot failed for every tile on ${url} — no usable screenshot`);
        }

        const markdown = pictures ? nhm.translate(await this.extractReadableContent(page, html)) : '';

        // Rank and filter the intercepted requests
        const rankedRequests = rankInterceptedRequests(intercepted, url);

        if (rankedRequests.length > 0) {
          console.log(`[browser] Intercepted ${intercepted.length} requests, ${rankedRequests.length} contain JSON data`);
          console.log(`[browser] Top API: ${rankedRequests[0].url.slice(0, 120)} (${rankedRequests[0].bodySize} bytes)`);
        }

        // The verdict reads the real main response, not the rendered page alone.
        // The box-map annotate script returns an array of boxes; zero boxes on
        // thin text is one of the blank signals.
        const main: Response | null = lastDocument ?? response;
        const headers = main ? main.headers() : {};
        const boxCount = Array.isArray(annotation) ? annotation.length
          : Array.isArray((annotation as { boxes?: unknown[] } | undefined)?.boxes) ? (annotation as { boxes: unknown[] }).boxes.length
          : undefined;
        const verdict = classifyVerdict({ requestedUrl: url, finalUrl: page.url(), status: main ? main.status() : null, headers, html, title, boxCount });
        // Spec 2026-10-14 §7: the REQUESTED address names the variant the
        // customer asked for; only an otherwise-ok page can be the wrong one.
        const named = verdict.kind === 'ok' ? wrongVariant(url, picker, pageData) : null;
        const finalVerdict: CaptureVerdict = named !== null ? { kind: 'wrong-variant', status: verdict.status, named } : verdict;

        return {
          url: page.url(),
          verdict: finalVerdict,
          html,
          markdown,
          screenshot: screenshotTiles[0] ?? Buffer.alloc(0),
          screenshotTiles,
          title,
          timestamp: Date.now(),
          structuredData,
          interceptedRequests: rankedRequests,
          pageHeight,
          pageVariant,
          mode: lean ? 'lean' : 'full',
          ...(probe !== undefined ? { probe } : {}),
          ...(annotation !== undefined ? { annotation } : {}),
          timings: {
            navigateMs,
            readyMs: ready?.ms ?? null,
            readyState: ready?.state ?? null,
            graceMs: ready?.graceMs ?? null,
            totalMs: Date.now() - t0,
          } satisfies CaptureTimings,
        };
      } catch (err) {
        // The renderer died after the document arrived: no page to hand back.
        if (isCrash(err)) {
          console.warn(`[browser] renderer crashed on ${url}: ${(err as Error).message.split('\n')[0]}`);
          throw new CaptureError('crashed', url, (err as Error).message);
        }
        throw err;
      }
    } finally {
      await page.close();
    }
  }

  /**
   * Poll the live page until the caller's ready check passes.
   *
   * Runs right after navigation, before popup dismissal, so a page that holds
   * a connection open (Ikea) is not made to wait out networkidle when the
   * values it was asked for are already there. Past the poll deadline, one
   * bounded networkidle wait is the honest last try: a slow API still gets
   * its chance, and only then is a still-missing value a miss.
   *
   * The check itself never fails the capture: a throwing probe reads as
   * "not ready", a throwing predicate the same. What the caller does with a
   * 'timeout' state is its own business — the capture goes on regardless.
   */
  private async waitUntilReady(page: Page, url: string, intercepted: InterceptedRequest[], check: ReadyCheck): Promise<{ state: NonNullable<CaptureTimings['readyState']>; ms: number; graceMs: number | null }> {
    const t0 = Date.now();
    const deadline = t0 + (check.timeoutMs ?? READY_POLL_TIMEOUT_MS);
    const emptyStructured: StructuredData = { ldJson: [], nextData: null, initialState: null, meta: {} };
    const snapshot = async (): Promise<ReadySnapshot> => ({
      probe: await page.evaluate(check.script).catch(() => null),
      structuredData: await this.extractStructuredData(page).catch(() => emptyStructured),
      interceptedRequests: rankInterceptedRequests(intercepted, url),
    });
    const isReady = async (): Promise<boolean> => {
      try { return check.isReady(await snapshot()); } catch { return false; }
    };

    for (;;) {
      if (await isReady()) return { state: 'ready', ms: Date.now() - t0, graceMs: await this.graceAfterReady(page, intercepted, check) };
      if (Date.now() >= deadline) break;
      await page.waitForTimeout(READY_POLL_INTERVAL_MS);
    }
    await page.waitForLoadState('networkidle', { timeout: check.settleTimeoutMs ?? READY_SETTLE_TIMEOUT_MS }).catch(() => {});
    const state = (await isReady()) ? 'settled' : 'timeout';
    if (state === 'timeout') console.warn(`[browser] ready check never passed for ${url} (${Date.now() - t0}ms); capturing as is`);
    const ms = Date.now() - t0;
    // No grace after a 'timeout': the check never passed, so there is no better source to wait for.
    return { state, ms, graceMs: state === 'settled' ? await this.graceAfterReady(page, intercepted, check) : null };
  }

  /**
   * Hold the capture until responses stop arriving (ReadyCheck.graceQuietMs).
   *
   * Counted on intercepted RESPONSES, not on in-flight requests: a page that
   * holds a connection open (Ikea) has a request in flight forever, and would
   * cost the full cap on every page. Quiet is measured from the last arrival,
   * so a response landing mid-grace restarts the clock, up to the cap.
   */
  private async graceAfterReady(page: Page, intercepted: InterceptedRequest[], check: ReadyCheck): Promise<number | null> {
    if (!check.graceQuietMs || check.graceQuietMs <= 0) return null;
    const t0 = Date.now();
    const max = check.graceMaxMs ?? READY_GRACE_MAX_MS;
    let seen = intercepted.length;
    let lastArrival = t0;
    for (;;) {
      const now = Date.now();
      if (intercepted.length !== seen) { seen = intercepted.length; lastArrival = now; }
      if (now - lastArrival >= check.graceQuietMs || now - t0 >= max) return now - t0;
      await page.waitForTimeout(READY_GRACE_POLL_MS);
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
    // No dismissal here. capture() runs one final pass after the first return and
    // then calls this once more; after that second return nothing clicks again —
    // a popup left standing costs far less than silently capturing another product.
    await this.navigateWithFallback(page, requestedUrl, options);
  }

  /**
   * `CaptureOptions.loadMore` (spec 2026-10-20 §3.7): grow a listing that loads on scroll or on a
   * "load more" click, bounded by rounds (`LOAD_MORE_MAX_ROUNDS`), quiet rounds
   * (`LOAD_MORE_QUIET_ROUNDS`) and wall time (`LOAD_MORE_BUDGET_MS`, controller ruling §5.3) — the
   * time budget is checked before each round, each settle and each click, so once it is spent
   * only the step under way and the closing measure still run. A probe or
   * a count that throws reads as 0 (a quiet round); a dead renderer still rethrows. The found
   * control is never clicked when it is a link that would navigate away or a variant control (a
   * swatch or similar — §3.3.2's `isVariantChoice`, via `loadMoreTargetScript`). A round that left
   * the document anyway (a load-more that was a link after all, a script redirect) goes back to
   * the address, as `returnIfNavigatedAway` does, and ends the loading; the page is read as it
   * first loaded.
   */
  private async loadMoreOfListing(page: Page, url: string, options: CaptureOptions): Promise<void> {
    const lm = options.loadMore;
    if (!lm) return;
    const rethrowCrash = (err: unknown) => { if (isCrash(err)) throw err; };
    const rounds = Math.max(0, Math.min(Math.floor(lm.rounds), LOAD_MORE_MAX_ROUNDS));
    const measure = async (): Promise<number> => {
      const value = await page.evaluate(lm.probe).catch((err) => { rethrowCrash(err); return null; });
      try {
        const n = lm.count(value);
        return Number.isFinite(n) ? n : 0;
      } catch { return 0; }
    };

    const start = Date.now();
    const spent = () => Date.now() - start >= LOAD_MORE_BUDGET_MS;
    let have = await measure();
    let quiet = 0;
    await page.evaluate(MARK_DOCUMENT_SCRIPT).catch(rethrowCrash);
    for (
      let round = 0;
      round < rounds && have < lm.enough && quiet < LOAD_MORE_QUIET_ROUNDS && !spent();
      round++
    ) {
      await page.evaluate(STEP_SCROLL_SCRIPT).catch(rethrowCrash);
      // The budget is checked before every settle and click too: a slow scroll that spent it is
      // the round's last step (what it loaded is still measured below).
      if (!spent()) await page.waitForTimeout(LOAD_MORE_SETTLE_MS);
      const html = spent() ? '' : await page.content().catch((err) => { rethrowCrash(err); return ''; });
      const selector = html ? findLoadMore(html) : null;
      if (selector) {
        const target = (await page.evaluate(loadMoreTargetScript(selector)).catch((err) => { rethrowCrash(err); return null; })) as
          { visible: boolean; href: string | null; target: string | null; variant: boolean } | null;
        if (target?.visible && !target.variant && !hrefNavigates(target) && !spent()) {
          await page.locator(selector).first().click({ timeout: 3_000 }).catch(rethrowCrash);
          if (!spent()) await page.waitForTimeout(LOAD_MORE_SETTLE_MS);
        }
      }
      const same = await page.evaluate(SAME_DOCUMENT_SCRIPT).catch((err) => { rethrowCrash(err); return false; });
      if (same !== true) {
        console.warn(`[browser] loading more of ${url} left the page; returning to it and reading it as it first loaded`);
        await this.navigateWithFallback(page, url, options);
        await this.dismissPopups(page);
        return;
      }
      const now = await measure();
      quiet = now > have ? 0 : quiet + 1;
      have = Math.max(have, now);
    }
  }

  async close(): Promise<void> {
    try {
      await this.context?.close();
      await this.browser?.close();
    } finally {
      this.context = null;
      this.browser = null;
      this.proxied = false;
      this.proxy = null;
      this.proxyChecks.clear();
      await this.closeForwarder();
    }
  }

  /** The session forwarder closes with the browser (final review I1), every open tunnel with it. */
  private async closeForwarder(): Promise<void> {
    const f = this.forwarder;
    this.forwarder = null;
    await f?.close();
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
    // No proxy here on purpose: every request and every WebSocket is stopped below, so nothing leaves this context.
    const context = await this.browser.newContext({ viewport: { width: 1280, height: 800 } });
    // page.route never sees a WebSocket, and the stored page's inline scripts still run: an inline `new WebSocket(…)`
    // would connect straight out from the worker (final review M1). Routed with no server, it never connects. Set on
    // the context before the page exists, so the page's first document already has it.
    await context.routeWebSocket(/.*/, (ws) => { ws.close().catch(() => {}); }).catch(async (err: unknown) => { await context.close(); throw err; });
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
  private async navigateWithFallback(page: Page, url: string, options: CaptureOptions = {}): Promise<Response | null> {
    const timeout = options.timeout ?? 60000;
    const preferred = options.waitUntil ?? 'networkidle';
    await this.checkProxyFor(url);

    try {
      return this.throughProxy(url, await page.goto(url, { waitUntil: preferred, timeout }));
    } catch (err) {
      // Spec 2026-10-24 proxy §3.1: a proxy failure is never retried, and never retried direct.
      if (err instanceof CaptureError) throw err;
      this.throwIfProxyFailed(err, url);
      if (preferred === 'networkidle') {
        console.warn(`networkidle timed out for ${url}, falling back to domcontentloaded`);
        const response = this.throughProxy(url, await page.goto(url, { waitUntil: 'domcontentloaded', timeout }).catch((e: unknown) => {
          this.throwIfProxyFailed(e, url);
          throw e;
        }));
        await page.waitForTimeout(3000);
        try {
          await page.waitForLoadState('load', { timeout: 10000 });
        } catch {
          // load state timeout is fine
        }
        return response;
      } else {
        throw err;
      }
    }
  }

  /**
   * Spec 2026-10-24 proxy §2.2: before a host's first page, ask the proxy from Node whether it will carry us there
   * (`checkProxy`: talks to the proxy only). Chromium never surfaces a 407 on an https CONNECT — it hangs until the
   * navigation timeout — so a wrong password, a refused or silent proxy is caught here, before any navigation. A pass
   * and a lasting failure (a wrong password, a refusal) are kept for the session; any other failure (no answer, a
   * reset, a 5xx from a bad exit) fails that page only and the next page checks again (Task 2 re-review).
   */
  private async checkProxyFor(url: string): Promise<void> {
    if (!this.proxy) return;
    let origin: string;
    try { origin = new URL(url).origin; } catch { return; }
    if (!/^https?:/.test(origin)) return;
    let check = this.proxyChecks.get(origin);
    if (!check) {
      check = checkProxy(this.proxy, url);
      this.proxyChecks.set(origin, check);
    }
    const result = await check;
    if (result.ok) return;
    if (!result.lasting && this.proxyChecks.get(origin) === check) this.proxyChecks.delete(origin);
    console.warn(`[browser] the proxy check failed for ${url}: ${result.detail}`);
    throw new CaptureError('proxy', url, result.detail);
  }

  /** Spec 2026-10-24 proxy §2.2: through a proxy, a connection the proxy could not make is the proxy's failure. */
  private throwIfProxyFailed(err: unknown, url: string): void {
    if (!this.proxied) return;
    const detail = String((err as Error)?.message ?? err);
    if (!isProxyFailure(detail)) return;
    console.warn(`[browser] the proxy failed for ${url}: ${detail.split('\n')[0]}`);
    throw new CaptureError('proxy', url, detail);
  }

  /** A 407 is the proxy refusing us (wrong or missing credentials): the website was never asked. */
  private throughProxy(url: string, response: Response | null): Response | null {
    if (this.proxied && response?.status() === 407) {
      console.warn(`[browser] the proxy refused ${url} (407)`);
      throw new CaptureError('proxy', url, 'The proxy answered 407 (authentication required).');
    }
    return response;
  }

  /**
   * Close what the page put over the product, without touching the page (spec 2026-10-19 §3.3).
   *
   * Each round: first a close word inside the topmost overlay, then today's steps — whole names,
   * never a variant, settings or navigating control (on Barnes & Noble a broad selector once
   * clicked through to another product: wrong AND self-consistent data). A click counts only if
   * the element or its layer went away; a dead one is never clicked again and the round tries the
   * next. Then the removal pass, every round. A round that changed nothing ends the pass.
   *
   * `settleMs: 0` is the final pass before the screenshot (§3.4): no wait on a clean page.
   * `final: true` marks that pass. It runs after the expand pass, so today's page-wide steps are
   * offered only inside an overlay or a consent-like layer, never to a panel the expand pass
   * opened (final review I1).
   */
  private async dismissPopups(page: Page, opts: { settleMs?: number; final?: boolean } = {}): Promise<void> {
    const settleMs = opts.settleMs ?? DISMISS_SETTLE_MS;
    const candidateScript = opts.final ? NEXT_DISMISS_CANDIDATE_FINAL_SCRIPT : NEXT_DISMISS_CANDIDATE_SCRIPT;
    if (settleMs > 0) await page.waitForTimeout(settleMs);

    let clicksLeft = DISMISS_MAX_CLICKS;
    for (let round = 0; round < DISMISS_MAX_ROUNDS; round++) {
      let closedByClick = false;
      const escape = async (): Promise<void> => {
        await page.keyboard.press('Escape').catch((err) => { if (isCrash(err)) throw err; });
        await page.evaluate(NOTE_ESCAPE_SCRIPT).catch((err) => { if (isCrash(err)) throw err; });
        await page.waitForTimeout(DISMISS_ESCAPE_SETTLE_MS);
      };
      // An overlay that offers no close control: Escape before any click, so the page closes it its
      // own way and takes away what it put with it — a "modal open" class on body whose ::before is
      // the scrim (kith's welcome mat, live check 2026-10-19) — and so a click on a banner beneath
      // does not land on that scrim instead. Only when an overlay is there: a clean page gets no
      // key press and no wait.
      let escaped = await page.evaluate(TOPMOST_WITHOUT_CLOSE_SCRIPT).then(Boolean).catch((err) => { if (isCrash(err)) throw err; return false; });
      if (escaped) await escape();
      while (!closedByClick && clicksLeft > 0) {
        // A string script's handle is typed JSHandle<unknown>; asElement() needs to know it may be a Node.
        const handle = await page.evaluateHandle(candidateScript)
          .then((h) => (h as JSHandle<Node | null>).asElement())
          .catch((err) => { if (isCrash(err)) throw err; return null; });
        if (!handle) break;
        clicksLeft--;
        try {
          await handle.click({ timeout: 2000, force: true });
        } catch (err) {
          if (isCrash(err)) throw err; // a click that throws changed nothing; judged below
        }
        await page.waitForTimeout(DISMISS_CLICK_SETTLE_MS);
        closedByClick = await page.evaluate(LAST_DISMISS_WORKED_SCRIPT).then(Boolean).catch((err) => { if (isCrash(err)) throw err; return false; });
        await handle.dispose().catch(() => {});
      }

      // An overlay its close controls did not close: Escape, once a round, before the removal pass
      // hides what is left (hiding leaves the page's scrim behind).
      if (!closedByClick && !escaped) {
        const top = await page.evaluate(TOPMOST_OVERLAY_SCRIPT).catch((err) => { if (isCrash(err)) throw err; return null; });
        if (top) { escaped = true; await escape(); }
      }

      const removed = Number(await page.evaluate(REMOVAL_PASS_SCRIPT).catch((err) => { if (isCrash(err)) throw err; return 0; }));
      if (removed > 0) await page.waitForTimeout(500);
      if (!closedByClick && removed === 0) break;
    }
  }

  /**
   * Reveal what belongs in the page — accordions, `<details>`, "show more", tabs — and never leave
   * an overlay over it (spec 2026-10-19 §3.2). The rules and the page code are in overlays.ts:
   * layer triggers are skipped, each control is clicked at most once (one already expanded counts),
   * and an overlay that appears during a round is closed — Escape, then removed — before the next.
   * Each round and the tabs step note the overlays already there right before their first click.
   * Runs after popup dismissal, before the screenshot.
   *
   * The tabs step is OFF unless `tabs: true` (capture()'s `expandTabs`): until this rewrite it
   * never ran under tsx at all, so turning it on changes the DOM for every certified source, and it
   * stays off until a free replay of certified sources shows no drift (final review I3). crawl()
   * never turns it on: a listing's category tabs would leave the grid on the last tab.
   */
  private async expandHiddenContent(page: Page, { tabs: clickTabs = false }: { tabs?: boolean } = {}): Promise<void> {
    await page.evaluate(EXPAND_START_SCRIPT).catch(() => 0);
    for (let round = 0; round < 2; round++) {
      const expanded = Number(await page.evaluate(EXPAND_ROUND_SCRIPT).catch(() => 0));
      if (!expanded) break;
      await page.waitForTimeout(500);
      await this.undoNewOverlays(page);
    }
    if (!clickTabs) return;

    // Tabs: load every panel's content into the DOM. Same skips, same undo.
    const tabs = Number(await page.evaluate(TABS_SCRIPT).catch(() => 0));
    if (tabs > 0) {
      await page.waitForTimeout(Math.min(tabs * 300 + 500, 3000));
      await this.undoNewOverlays(page);
    }
  }

  /**
   * Close every overlay that appeared since the last baseline (§3.2.4): Escape once, then remove
   * what is still there and lift the scroll lock. This is the net for controls nothing gives away
   * (colourpop's `Zoom`). Costs nothing when no overlay appeared.
   */
  private async undoNewOverlays(page: Page): Promise<void> {
    const fresh = Number(await page.evaluate(NEW_OVERLAYS_SCRIPT).catch(() => 0));
    if (!fresh) return;
    await page.keyboard.press('Escape').catch(() => {});
    await page.evaluate(NOTE_ESCAPE_SCRIPT).catch(() => {});
    await page.waitForTimeout(300);
    const removed = (await page.evaluate(REMOVE_NEW_OVERLAYS_SCRIPT).catch(() => [])) as OverlayDescription[];
    if (process.env.CAPTURE_DEBUG) {
      const names = removed.map((d) => `${d.tag}${d.id ? `#${d.id}` : ''}`).join(', ') || 'none';
      console.log(`[capture] expand opened ${fresh} overlay(s); removed after Escape: ${names}`);
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
      await this.expandHiddenContent(page, { tabs: false });

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
