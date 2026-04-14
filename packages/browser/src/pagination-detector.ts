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
    detectUrlPattern(html, currentUrl) ??
    detectNextButton(html) ??
    detectPageNumbers(html) ??
    null
  );
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

const NEXT_BUTTON_PATTERNS: Array<{ regex: RegExp; selector: string }> = [
  { regex: /rel=["']next["']/i, selector: 'a[rel="next"]' },
  { regex: /aria-label=["']Next page["']/i, selector: '[aria-label="Next page"]' },
  { regex: /aria-label=["']Next["']/i, selector: '[aria-label="Next"]' },
  { regex: /class=["'][^"']*\bnext\b[^"']*["'][^>]*>.*?(Next|→|›|»)/is, selector: '.next a, a.next, .next button, button.next' },
  { regex: /<(?:a|button)[^>]*>(?:\s*(?:<[^>]+>\s*)*)?Next(?:\s*(?:<[^>]+>\s*)*)?<\/(?:a|button)>/i, selector: 'a:has-text("Next"), button:has-text("Next")' },
];

function detectNextButton(html: string): PaginationConfig | null {
  for (const pattern of NEXT_BUTTON_PATTERNS) {
    if (pattern.regex.test(html)) {
      return { strategy: 'next-button', nextSelector: pattern.selector };
    }
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
