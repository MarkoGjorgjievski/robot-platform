import type { WallVendor } from './types.js';

/**
 * Detect blocked, error, or empty pages before processing.
 * Returns null if page is healthy, or an error description if blocked.
 */
/**
 * Visible-text length above which a page is treated as having real content, and
 * therefore not a bot-detection interstitial. Sits an order of magnitude clear of
 * both sides of the measured gap (blocked: 8–168 chars, real: 8,111–45,807).
 */
const SUBSTANTIAL_CONTENT_CHARS = 1000;

/**
 * The text a visitor would read: comments, scripts, styles and tags stripped,
 * whitespace collapsed. The one definition every reading of a page uses
 * (detectWall, checkPageHealth, classifyVerdict's blank rule), so inline CSS or a
 * JSON blob in a script never counts as content in one place and not another.
 */
export function visibleText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export type PageHealthResult = {
  healthy: boolean;
  reason?: string;
  statusCode?: number;
};

/**
 * Check page health from HTML content + title.
 * Should be called AFTER page capture, BEFORE AI analysis.
 */
export function checkPageHealth(html: string, title: string, url: string): PageHealthResult {
  const lowerHtml = html.toLowerCase();
  const lowerTitle = title.toLowerCase();

  // 1. HTTP error pages
  const errorPatterns = [
    { match: '403 forbidden', reason: 'HTTP 403 Forbidden — site is blocking access', code: 403 },
    { match: '401 unauthorized', reason: 'HTTP 401 Unauthorized — authentication required', code: 401 },
    { match: '404 not found', reason: 'HTTP 404 Not Found — page does not exist', code: 404 },
    { match: '429 too many requests', reason: 'HTTP 429 Too Many Requests — rate limited', code: 429 },
    { match: '503 service unavailable', reason: 'HTTP 503 Service Unavailable', code: 503 },
    { match: '502 bad gateway', reason: 'HTTP 502 Bad Gateway', code: 502 },
  ];

  for (const pattern of errorPatterns) {
    if (lowerTitle.includes(pattern.match) || lowerHtml.slice(0, 2000).includes(pattern.match)) {
      return { healthy: false, reason: pattern.reason, statusCode: pattern.code };
    }
  }

  // 2. Bot detection / CAPTCHA pages
  const botPatterns = [
    { match: 'captcha', reason: 'CAPTCHA detected — site requires human verification' },
    { match: 'recaptcha', reason: 'reCAPTCHA detected — site requires human verification' },
    { match: 'hcaptcha', reason: 'hCaptcha detected — site requires human verification' },
    { match: 'robot', includes: ['are you a robot', 'not a robot', 'verify you are human', 'robot or human', 'confirm that you\'re human'] },
    { match: 'cloudflare', includes: ['checking your browser', 'just a moment', 'ray id'] },
    { match: 'perimeterx', reason: 'PerimeterX bot detection — site blocked automated access' },
    { match: 'datadome', reason: 'DataDome bot detection — site blocked automated access' },
    { match: 'access denied', reason: 'Access denied — site is blocking automated access' },
    { match: 'akamai', includes: ['access denied', 'reference #', 'akamaighost'] },
    // AWS WAF / generic human checks: body phrases, so they need thin content
    // (the `includes` form) — a real page titled "Human Verification Kit" is not a wall.
    { match: 'human verification', includes: ['confirm you are human', 'complete the security check', 'verify you are human'] },
    { match: 'confirm you are human', includes: ['human verification', 'security check', 'awswaf'] },
    { match: 'blocked', includes: ['your request has been blocked', 'this request was blocked', 'automated access'] },
  ];

  // A challenge interstitial is content-free; a real page that merely *references*
  // a bot-detection vendor is not. Measured 2026-08-18: Wayfair's block page
  // carried 168 chars of visible text and Etsy's 8, while the corpus product pages
  // carried 8,111 (Target) to 45,807 (Newegg) — and Newegg and Target BOTH contain
  // "captcha" in their markup. They were judged healthy only because the string
  // happens to fall after byte 5000, which is luck, not detection. Requiring the
  // absence of real content turns that accident into a rule.
  //
  // Body phrases are matched against what a visitor reads, not raw markup: a thin
  // page that merely loads a CAPTCHA widget script for its review form, or a
  // cdnjs.cloudflare.com library, says nothing about a wall (review I1, 2026-10-09).
  const text = visibleText(html);
  const lowerText = text.toLowerCase();
  const hasSubstantialContent = text.length >= SUBSTANTIAL_CONTENT_CHARS;
  // Widget names, not walls: "This site is protected by reCAPTCHA" is form copy.
  const TITLE_ONLY = new Set(['recaptcha', 'hcaptcha']);
  const bodySays = (w: string): boolean => (w === 'captcha' ? /\bcaptcha\b/.test(lowerText) : lowerText.includes(w));

  for (const pattern of botPatterns) {
    if ('includes' in pattern && pattern.includes) {
      // Must match the main keyword AND one of the secondary phrases
      if ((lowerTitle.includes(pattern.match) || bodySays(pattern.match)) && !hasSubstantialContent) {
        const hasSecondary = pattern.includes.some(s => lowerTitle.includes(s) || bodySays(s));
        if (hasSecondary) {
          return { healthy: false, reason: `Bot detection (${pattern.match}) — site blocked automated access` };
        }
      }
    } else if (
      // A matching TITLE is precise on its own — a page titled "Captcha" is a
      // challenge page whatever its markup weight. A match in the BODY is not,
      // so it only counts when the page has no real content to show.
      lowerTitle.includes(pattern.match)
      || (!hasSubstantialContent && !TITLE_ONLY.has(pattern.match) && bodySays(pattern.match))
    ) {
      if (pattern.reason) {
        return { healthy: false, reason: pattern.reason };
      }
    }
  }

  // 3. Soft 404 / error pages (HTTP 200 but page is an error)
  const soft404Patterns = [
    // Amazon "dogs of Amazon" error page
    { title: ["sorry", "page not found", "couldn't find"], body: ["try searching", "go to", "home page"] },
    // Generic soft 404s
    // A bare "404" is not enough ("Levi's 404 Jeans"): see the \b404\b rule below.
    { title: ["not found", "page not found", "doesn't exist", "no longer available"], body: [] },
    // "Oops" error pages
    { title: ["oops", "something went wrong", "error"], body: ["try again", "go back", "home page"] },
  ];

  // "404" in a title names an error page only as a whole word with "not found"
  // or "error" beside it, or on a page that has nothing else to show.
  if (/\b404\b/.test(lowerTitle) && (/not found|error/.test(lowerTitle) || !hasSubstantialContent)) {
    return { healthy: false, reason: 'Soft 404 — page title indicates error or not found', statusCode: 404 };
  }

  for (const pattern of soft404Patterns) {
    const titleMatch = pattern.title.some(t => lowerTitle.includes(t));
    if (titleMatch) {
      if (pattern.body.length === 0) {
        return { healthy: false, reason: 'Soft 404 — page title indicates error or not found', statusCode: 404 };
      }
      const bodyMatch = pattern.body.some(b => lowerHtml.slice(0, 10000).includes(b));
      if (bodyMatch) {
        return { healthy: false, reason: 'Soft 404 — page appears to be an error page', statusCode: 404 };
      }
    }
  }

  // 4. Empty or minimal page
  // Strip tags and check text content length
  if (text.length < 100) {
    return { healthy: false, reason: 'Page has almost no content (less than 100 characters of text)' };
  }

  // 5. Check if body is essentially empty (only scripts/styles)
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (bodyMatch) {
    const bodyContent = bodyMatch[1]
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<link[^>]*>/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (bodyContent.length < 50) {
      return { healthy: false, reason: 'Page body is empty (only scripts/styles, no visible content)' };
    }
  }

  return { healthy: true };
}

/**
 * The anti-bot vendor this response names, from headers first (they are
 * authoritative), then the markup. A name only: every Cloudflare-proxied site
 * sends `cf-ray` on healthy pages, and `cdnjs.cloudflare.com` is a library CDN,
 * so a vendor alone never makes a page a wall (review I1, 2026-10-09).
 */
export function wallVendor(html: string, title: string, headers: Record<string, string>): WallVendor | null {
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).toLowerCase()]));
  const lowerHtml = html.toLowerCase();
  const lowerTitle = title.toLowerCase();
  return h['x-amzn-waf-action'] || lowerHtml.includes('awswaf') ? 'aws-waf'
    : h['cf-ray'] || h['server'] === 'cloudflare' || lowerHtml.includes('cloudflare') || lowerHtml.includes('ray id') ? 'cloudflare'
    : (h['server'] ?? '').includes('akamai') || lowerHtml.includes('akamaighost') || (lowerTitle.includes('access denied') && lowerHtml.includes('reference #')) ? 'akamai'
    : lowerHtml.includes('px-captcha') || lowerHtml.includes('_pxhd') || lowerHtml.includes('_pxvid') || lowerHtml.includes('perimeterx') ? 'perimeterx'
    : lowerHtml.includes('datadome') ? 'datadome'
    : null;
}

/** Markup only a vendor's challenge page carries (not its tag on a normal page). */
const CHALLENGE_MARKERS = ['px-captcha', 'captcha.awswaf.com', 'captcha-delivery.com'];
const CHALLENGE_WORDS = ['just a moment', 'checking your browser', 'verify you are human', 'confirm you are human', "confirm that you're human", 'are you a robot', 'not a robot', 'press & hold', 'press and hold', 'quick verification', 'human verification'];
const DENIED_WORDS = ['access denied', 'you have been blocked', 'your request has been blocked', 'this request was blocked', 'restricted access'];

/**
 * Which wall, if any, this document is. Returns `challenge` for an
 * interstitial the visitor could pass (CAPTCHA, "Just a moment", press-and-hold)
 * and `refused` for a flat denial (Access Denied, block page). Null for a normal
 * page. A wall is something the page SAYS — words in its title or visible text,
 * or a vendor's challenge-only markup — and only on a thin page; the vendor
 * just names it.
 */
export function detectWall(html: string, title: string, headers: Record<string, string>): { kind: 'challenge' | 'refused'; vendor: WallVendor } | null {
  const text = visibleText(html).toLowerCase();
  if (text.length >= SUBSTANTIAL_CONTENT_CHARS) return null;
  const lowerHtml = html.toLowerCase();
  const lowerTitle = title.toLowerCase();
  const says = (w: string): boolean => lowerTitle.includes(w) || text.includes(w);
  const vendor = wallVendor(html, title, headers) ?? 'unknown';
  // "captcha" as a word ("Complete the CAPTCHA"), never "protected by reCAPTCHA".
  const isChallenge = CHALLENGE_WORDS.some(says)
    || /\bcaptcha\b/.test(lowerTitle) || /\bcaptcha\b/.test(text)
    || CHALLENGE_MARKERS.some((m) => lowerHtml.includes(m));
  if (isChallenge) return { kind: 'challenge', vendor };
  if (DENIED_WORDS.some(says)) return { kind: 'refused', vendor };
  return null;
}
