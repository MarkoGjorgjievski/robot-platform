// Pure link-ranking for `sources.findProductPages` / `sources.checkListingPage`:
// given every `<a href>` harvested from a listing page (via `withBrowserSession`
// + `setContentEvaluate` in sources.ts — no AI involved), guesses which links
// are product/detail pages by finding the largest same-host group of paths
// that share a "template" (digits and long opaque tokens collapsed to `*`).

import { detectPaginationFromHtml } from '@robot/browser';

/** Drops a trailing slash for path comparison, except the bare root itself. */
const trimTrailingSlash = (p: string): string => (p.length > 1 ? p.replace(/\/+$/, '') : p);

/**
 * Grouping shared by `rankProductLinks` and `describeListingPage`: same
 * hostname as the listing, not the listing page itself (same host + same
 * path — query string and hash ignored, trailing slash trimmed, so
 * `?page=2`/`?sort=new#top`/a trailing-slash variant of the listing all
 * still count as "the listing itself"), grouped by path template (digits and
 * 12+-char alnum/hyphen tokens replaced by `*`), the largest group returned
 * in full, in document order, deduped — uncapped, unlike `rankProductLinks`.
 */
export function largestProductGroup(anchors: Array<{ href: string; text: string }>, listingUrl: string): string[] {
  const base = new URL(listingUrl);
  const basePath = trimTrailingSlash(base.pathname);
  const template = (p: string) => p.replace(/\d+/g, '*').replace(/[a-z0-9-]{12,}/gi, '*');
  const groups = new Map<string, string[]>();
  const seen = new Set<string>();
  for (const a of anchors) {
    let u: URL;
    try { u = new URL(a.href, listingUrl); } catch { continue; }
    if (u.hostname !== base.hostname || (u.protocol !== 'http:' && u.protocol !== 'https:')) continue;
    u.hash = '';
    if (trimTrailingSlash(u.pathname) === basePath || u.pathname === '/') continue;
    if (seen.has(u.href)) continue;
    seen.add(u.href);
    const key = template(u.pathname);
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(u.href);
  }
  let best: string[] = [];
  for (const g of groups.values()) if (g.length > best.length) best = g;
  return best;
}

/** `rankProductLinks`: `largestProductGroup`, capped at `limit`. */
export function rankProductLinks(anchors: Array<{ href: string; text: string }>, listingUrl: string, limit: number): string[] {
  return largestProductGroup(anchors, listingUrl).slice(0, limit);
}

/**
 * The Extract tab's free per-row listing check (`sources.checkListingPage`):
 * how many product links the largest same-template group has (before any
 * `limit` cut), a 10-item sample of them, and whether a pager was seen on
 * the page (`detectPaginationFromHtml`, `@robot/browser` — no AI).
 */
export function describeListingPage(
  anchors: Array<{ href: string; text: string }>,
  listingUrl: string,
  html: string,
): { productLinks: number; pagerSeen: boolean; sample: string[] } {
  const group = largestProductGroup(anchors, listingUrl);
  return {
    productLinks: group.length,
    pagerSeen: detectPaginationFromHtml(html, listingUrl) !== null,
    sample: group.slice(0, 10),
  };
}
