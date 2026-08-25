import type { PaginationConfig } from './types.js';

/**
 * Detect pagination from raw HTML string.
 * Tries three strategies in order: URL pattern, next button, page numbers.
 * Returns null if no pagination detected.
 */
export function detectPaginationFromHtml(
  html: string,
  currentUrl: string,
): PaginationConfig | null {
  return (
    detectLinkRelNext(html, currentUrl) ??
    detectUrlPattern(html, currentUrl) ??
    detectNextButton(html) ??
    detectPageNumbers(html) ??
    null
  );
}

// ─── Strategy 0: <link rel="next"> ─────────────────────────────────────────
//
// The strongest evidence a page can give, and it was being thrown away. A real
// AbeBooks search page declares its next page in the document head:
//
//   <link rel="next" href="…/SearchResults?kn=python&p=1&sp=0&spo=30">
//
// The old code saw the substring `rel="next"` anywhere in the document and
// returned the selector `a[rel="next"]` — which matches no element, because this
// is a <link>, not an anchor. So the crawl stopped after page 1 while the exact
// URL it needed sat unused in that tag.

function detectLinkRelNext(html: string, currentUrl: string): PaginationConfig | null {
  const tag = html.match(/<link\b[^>]*rel=["']next["'][^>]*>/i);
  if (!tag) return null;
  const href = tag[0].match(/href=["']([^"']+)["']/i);
  if (!href) return null;

  const nextUrl = resolveUrl(currentUrl, decodeEntities(href[1]!));
  // Turn the concrete next-page URL into a template by finding the parameter
  // that changed against the current URL — that is the page cursor. The page's
  // own markup goes along, because when SEVERAL params changed, the (current,
  // next) pair alone cannot say which one is the cursor — the pager-link
  // series in the page can.
  const template = deriveTemplate(currentUrl, nextUrl, html);
  return template
    ? { strategy: 'url-pattern', urlTemplate: template }
    : { strategy: 'url-pattern', urlTemplate: nextUrl };
}

function decodeEntities(value: string): string {
  return value.replace(/&amp;/g, '&');
}

/**
 * Given this page's URL and the declared next page's URL, produce a template
 * with `{N}` where the page cursor sits.
 *
 * Works on the parameters that actually changed rather than on a list of known
 * page-parameter names alone, because sites disagree about what to call the
 * cursor. When SEVERAL numeric params changed, the pair of URLs cannot say
 * which one pages — AbeBooks' next URL grows `ds=30` (page size), `p=1` (the
 * pager), `sp=0` and `spo=30` (an offset) all at once, and templating the
 * first one walked pages sized 2 and 3 items on the 2026-08-21 live proof.
 * The discriminating evidence is the page's own pager-link series, so the
 * html rides along and `choosePageParam` reads it.
 */
function deriveTemplate(currentUrl: string, nextUrl: string, html: string): string | null {
  try {
    const current = new URL(currentUrl);
    const next = new URL(nextUrl);
    if (current.origin !== next.origin || current.pathname !== next.pathname) return null;

    // Every numeric param that advanced (or appeared) is a candidate cursor.
    const candidates: string[] = [];
    for (const [key, nextValue] of next.searchParams) {
      const currentValue = current.searchParams.get(key);
      if (currentValue === nextValue) continue;
      if (!/^\d+$/.test(nextValue)) continue;
      if (!candidates.includes(key)) candidates.push(key);
    }
    if (candidates.length === 0) return null;

    const chosen = choosePageParam(candidates, next, html) ?? candidates[0]!;
    // The cursor varies. Everything else stays as the page set it.
    const template = new URL(next.href);
    template.searchParams.set(chosen, '{N}');
    return decodeURIComponent(template.href);
  } catch {
    return null;
  }
}

/**
 * Parameter names only ever used for a page cursor. A prior, not a gate: it
 * breaks ties among series-corroborated candidates and stands in when the page
 * offers no series at all — it never overrules the series evidence.
 */
const KNOWN_PAGE_PARAMS = /^(page|p|pg|pn|pageindex|page_?num(?:ber)?)$/i;

/**
 * Pick the candidate that the page's own pager-link series says is the cursor.
 *
 * Across the same-origin, same-path links in the page, the real page parameter
 * takes several values in steps of 1 (`p`: 1, 2, …); an offset steps by the
 * page size (`spo`: 30, 60, …); a constant like `ds=30` never varies at all —
 * a constant is not a cursor, whatever position it holds in the URL. Ranking:
 * stride-1 series param > any series-varying param > (no series evidence) a
 * known pager name among the candidates > null, which sends the caller to the
 * pre-2026-08-25 first-changed-param behaviour.
 */
function choosePageParam(candidates: string[], next: URL, html: string): string | null {
  const seriesValues = new Map<string, Set<number>>(candidates.map((k) => [k, new Set()]));
  for (const match of html.matchAll(/href=["']([^"']+)["']/gi)) {
    let url: URL;
    try {
      url = new URL(decodeEntities(match[1]!), next.href);
    } catch {
      continue;
    }
    if (url.origin !== next.origin || url.pathname !== next.pathname) continue;
    for (const key of candidates) {
      const value = url.searchParams.get(key);
      if (value !== null && /^\d+$/.test(value)) seriesValues.get(key)!.add(Number(value));
    }
  }

  const varying = candidates.filter((k) => seriesValues.get(k)!.size >= 2);
  if (varying.length > 0) {
    const strideOne = varying.filter((k) => {
      const values = [...seriesValues.get(k)!].sort((a, b) => a - b);
      return values.some((v, i) => i > 0 && v - values[i - 1]! === 1);
    });
    const pool = strideOne.length > 0 ? strideOne : varying;
    return pool.find((k) => KNOWN_PAGE_PARAMS.test(k)) ?? pool[0]!;
  }

  return candidates.find((k) => KNOWN_PAGE_PARAMS.test(k)) ?? null;
}

// ─── Strategy 1: URL Pattern ───────────────────────────────────────────────

const URL_PAGE_PATTERNS = [
  { regex: /href="([^"]*[?&]page=)(\d+)([^"]*)"/gi, param: 'page' },
  { regex: /href="([^"]*[?&]p=)(\d+)([^"]*)"/gi, param: 'p' },
  { regex: /href="([^"]*[?&]offset=)(\d+)([^"]*)"/gi, param: 'offset' },
  { regex: /href="([^"]*[?&]start=)(\d+)([^"]*)"/gi, param: 'start' },
  { regex: /href="([^"]*\/page\/)(\d+)(\/[^"]*)"/gi, param: 'path' },
];

function detectUrlPattern(html: string, currentUrl: string): PaginationConfig | null {
  for (const pattern of URL_PAGE_PATTERNS) {
    pattern.regex.lastIndex = 0;
    const matches: Array<{ prefix: string; num: number; suffix: string }> = [];

    let match;
    while ((match = pattern.regex.exec(html)) !== null) {
      matches.push({
        prefix: match[1],
        num: parseInt(match[2], 10),
        suffix: match[3],
      });
    }

    const hasHigherPage = matches.some(m => m.num > 1);
    if (matches.length > 0 && hasHigherPage) {
      const first = matches[0];
      // Resolve using a numeric placeholder to avoid URL-encoding {N}, then replace it
      const PLACEHOLDER = '99999';
      const resolved = resolveUrl(currentUrl, `${first.prefix}${PLACEHOLDER}${first.suffix}`);
      const urlTemplate = resolved.replace(PLACEHOLDER, '{N}');
      return { strategy: 'url-pattern', urlTemplate };
    }
  }

  return null;
}

// ─── Strategy 2: Next Button ───────────────────────────────────────────────

/** Carousel and slider libraries use "next" for their own arrows. Matching those
 *  reported pagination on a page that had none — Newegg's category page carries
 *  `swiper-slide-next` and `aria-label="Next slide"` and paginates nowhere. */
const CAROUSEL_WORDS = /(swiper|slide|slider|carousel|gallery|thumb|banner|marquee)/i;

const NEXT_BUTTON_PATTERNS: Array<{ regex: RegExp; selector: string }> = [
  // Scoped to an ANCHOR: `rel="next"` on a <link> in the head is a URL, not a
  // clickable element, and is handled by detectLinkRelNext above.
  { regex: /<a\b[^>]*rel=["']next["']/i, selector: 'a[rel="next"]' },
  { regex: /aria-label=["']Next page["']/i, selector: '[aria-label="Next page"]' },
  { regex: /aria-label=["']Next["']/i, selector: '[aria-label="Next"]' },
  { regex: /class=["'][^"']*\bnext\b[^"']*["'][^>]*>.*?(Next|→|›|»)/is, selector: '.next a, a.next, .next button, button.next' },
  { regex: /<(?:a|button)[^>]*>(?:\s*(?:<[^>]+>\s*)*)?Next(?:\s*(?:<[^>]+>\s*)*)?<\/(?:a|button)>/i, selector: 'a:has-text("Next"), button:has-text("Next")' },
];

function detectNextButton(html: string): PaginationConfig | null {
  for (const pattern of NEXT_BUTTON_PATTERNS) {
    const match = html.match(pattern.regex);
    if (!match) continue;
    // Reject a match that is part of a carousel rather than a pager. Checking the
    // surrounding markup rather than the match alone, because the give-away
    // (`swiper-slide`, `aria-label="Next slide"`) usually sits on a neighbouring
    // attribute of the same element.
    const at = match.index ?? 0;
    const context = html.slice(Math.max(0, at - 200), at + 200);
    if (CAROUSEL_WORDS.test(context)) continue;
    return { strategy: 'next-button', nextSelector: pattern.selector };
  }
  return null;
}

// ─── Strategy 3: Page Numbers ──────────────────────────────────────────────

function detectPageNumbers(html: string): PaginationConfig | null {
  const containerPatterns = [
    /(<nav[^>]*aria-label=["'][^"']*paginat[^"']*["'][^>]*>[\s\S]*?<\/nav>)/i,
    /(<[^>]+class=["'][^"']*pagination[^"']*["'][^>]*>[\s\S]*?<\/\w+>)/i,
    /(<[^>]+role=["']navigation["'][^>]*>[\s\S]*?<\/\w+>)/i,
  ];

  for (const pattern of containerPatterns) {
    const containerMatch = html.match(pattern);
    if (!containerMatch) continue;

    const container = containerMatch[1];
    const numericLinks = container.match(/<a[^>]+>\s*\d+\s*<\/a>/g);
    if (numericLinks && numericLinks.length >= 2) {
      const classMatch = containerMatch[0].match(/class=["']([^"']+)["']/);
      const ariaMatch = containerMatch[0].match(/aria-label=["']([^"']+)["']/);

      let selector: string;
      if (ariaMatch) {
        selector = `[aria-label="${ariaMatch[1]}"] a`;
      } else if (classMatch) {
        const mainClass = classMatch[1].split(/\s+/)[0];
        selector = `.${mainClass} a`;
      } else {
        selector = 'nav a';
      }

      return { strategy: 'page-numbers', pageSelector: selector };
    }
  }

  return null;
}

// ─── Utils ─────────────────────────────────────────────────────────────────

function resolveUrl(base: string, relative: string): string {
  if (relative.startsWith('http')) return relative;
  try {
    return new URL(relative, base).href;
  } catch {
    return relative;
  }
}
