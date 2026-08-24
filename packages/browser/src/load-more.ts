// Which clickable advances this listing?
//
// A pure heuristic over raw HTML, mirroring `detectPaginationFromHtml`: no DOM,
// no browser, so it unit-tests for free. The AI fallback is wired at the call
// site, exactly as it is for HTML pagination detection.
//
// Returning a SELECTOR rather than an element is deliberate — the caller clicks
// it inside the page.

/** Wordings that mean "there is more below". Anything else is not a pager. */
export const LOAD_MORE_TEXT: readonly string[] = [
  'load more', 'show more', 'see more', 'view more', 'more results',
];

const CLICKABLE = /<(button|a)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
const ID_ATTR = /\bid\s*=\s*["']([^"']+)["']/i;
const CLASS_ATTR = /\bclass\s*=\s*["']([^"']+)["']/i;

/** Visible text with tags and entities stripped, collapsed and lowercased. */
function textOf(inner: string): string {
  return inner.replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * A CSS selector for the clickable that advances the listing, or null.
 *
 * `afterText`, when given, enforces the position rule: a control appearing
 * BEFORE the results is a filter or a sidebar toggle, not a pager. "Show more"
 * in a faceted-search sidebar is the common false positive, and clicking it
 * changes the result set rather than extending it.
 *
 * It is a raw string rather than a container selector on purpose: the caller
 * has page 1's own detail URLs and nothing upstream knows what wraps the grid,
 * so a URL page 1 actually produced is the one anchor available as evidence
 * rather than as a guess. A guard the caller cannot supply an argument for is a
 * guard that never fires.
 */
export function findLoadMore(html: string, afterText?: string): string | null {
  const resultsAt = afterText ? html.indexOf(afterText) : -1;

  for (const match of html.matchAll(CLICKABLE)) {
    const [whole, tag, attrs, inner] = match;
    if (!LOAD_MORE_TEXT.includes(textOf(inner ?? ''))) continue;
    if (resultsAt >= 0 && (match.index ?? 0) < resultsAt) continue;

    const id = ID_ATTR.exec(attrs ?? '')?.[1];
    if (id) return `#${id}`;
    const cls = CLASS_ATTR.exec(attrs ?? '')?.[1]?.split(/\s+/).filter(Boolean);
    // Prefer the most specific-looking class — a bare "btn" matches half the page.
    const best = cls?.slice().sort((a, b) => b.length - a.length)[0];
    if (best) return `${tag}.${best}`;
    void whole;
  }
  return null;
}
