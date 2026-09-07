// Pure link-ranking for `sources.findProductPages`: given every `<a href>`
// harvested from a listing page (via `withBrowserSession` + `setContentEvaluate`
// in sources.ts — no AI involved), guesses which links are product/detail
// pages by finding the largest same-host group of paths that share a
// "template" (digits and long opaque tokens collapsed to `*`).

/** Drops a trailing slash for path comparison, except the bare root itself. */
const trimTrailingSlash = (p: string): string => (p.length > 1 ? p.replace(/\/+$/, '') : p);

/**
 * Ranking: same hostname as the listing, not the listing page itself (same
 * host + same path — query string and hash ignored, trailing slash trimmed,
 * so `?page=2`/`?sort=new#top`/a trailing-slash variant of the listing all
 * still count as "the listing itself"), grouped by path template (digits and
 * 12+-char alnum/hyphen tokens replaced by `*`), take the largest group,
 * preserve document order, dedupe, cap at `limit`.
 */
export function rankProductLinks(anchors: Array<{ href: string; text: string }>, listingUrl: string, limit: number): string[] {
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
  return best.slice(0, limit);
}
