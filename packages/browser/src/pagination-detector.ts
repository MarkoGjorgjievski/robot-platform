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
  // that changed against the current URL — that is the page cursor.
  const template = deriveTemplate(currentUrl, nextUrl);
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
 * Works on the parameter that actually changed rather than on a list of known
 * page-parameter names, because sites disagree about what to call it — this one
 * uses `p` alongside `sp` and `spo`, none of which is named "page".
 */
function deriveTemplate(currentUrl: string, nextUrl: string): string | null {
  try {
    const current = new URL(currentUrl);
    const next = new URL(nextUrl);
    if (current.origin !== next.origin || current.pathname !== next.pathname) return null;

    for (const [key, nextValue] of next.searchParams) {
      const currentValue = current.searchParams.get(key);
      if (currentValue === nextValue) continue;
      if (!/^\d+$/.test(nextValue)) continue;
      // The cursor advanced (or appeared). Everything else stays as the page set it.
      const template = new URL(next.href);
      template.searchParams.set(key, '{N}');
      return decodeURIComponent(template.href);
    }
    return null;
  } catch {
    return null;
  }
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
