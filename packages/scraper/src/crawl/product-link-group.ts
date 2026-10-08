// The ONE mechanical definition of "the product links on a listing page",
// shared by the Verification tab's "Find products" / listing check
// (`describeListingPage` in @robot/api) and the listing walk that Sample and
// Extract plan with (`planRun`). Pure, no AI.
//
// Two definitions used to exist: the finder grouped raw anchors by path
// template, while the walk trusted whatever row selector the extraction chain
// produced. On Allbirds (2026-10-08) the finder found 150 product links on
// /collections/mens and the walk found 1 — an AI row selector that matched one
// stray `<li>` was accepted, cached as verified, and Sample planned 1 product.
// `reconcileWithProductGroup` is how the walk now cross-checks its rows
// against this group.
//
// Links in the page's navigation (menus, sidebars, page header and footer) are
// left out first: on a shop with a mega-menu they outnumber the product grid
// (Everlane's men's tees, 2026-10-08: ~94 menu links to other collections
// against 52 product links), and the largest group was the menu.

/** Drops a trailing slash for path comparison, except the bare root itself. */
const trimTrailingSlash = (p: string): string => (p.length > 1 ? p.replace(/\/+$/, '') : p);

/** A path's "template": digits and 12+-char alnum/hyphen tokens collapsed to `*`. */
export const productPathTemplate = (p: string): string => p.replace(/\d+/g, '*').replace(/[a-z0-9-]{12,}/gi, '*');

/**
 * Same hostname as the listing, not the listing page itself (same host + same
 * path — query string and hash ignored, trailing slash trimmed, so
 * `?page=2`/`?sort=new#top`/a trailing-slash variant of the listing all still
 * count as "the listing itself"), grouped by `productPathTemplate`, the
 * largest group returned in full, in document order, deduped. Anchors marked
 * `chrome` (in page navigation, see `LISTING_ANCHORS_SCRIPT`) are left out,
 * unless what is left forms no group of at least `MIN_CONTENT_GROUP` — a theme
 * that wraps its grid in `nav` or `aside` is then grouped as a whole, rather
 * than a lone breadcrumb or `/pages/about` link being reported as "1 product".
 */
const MIN_CONTENT_GROUP = 3;

export function largestProductGroup(
  anchors: Array<{ href: string; text: string; chrome?: boolean }>,
  listingUrl: string,
): string[] {
  const content = anchors.filter((a) => !a.chrome);
  const best = largestGroup(content, listingUrl);
  return best.length >= MIN_CONTENT_GROUP || content.length === anchors.length ? best : largestGroup(anchors, listingUrl);
}

function largestGroup(anchors: Array<{ href: string }>, listingUrl: string): string[] {
  const base = new URL(listingUrl);
  const basePath = trimTrailingSlash(base.pathname);
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
    const key = productPathTemplate(u.pathname);
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(u.href);
  }
  let best: string[] = [];
  for (const g of groups.values()) if (g.length > best.length) best = g;
  return best;
}

export type ListingAnchor = { href: string; text: string; title?: string; image?: string; chrome?: boolean };

/**
 * Runs inside the listing page (`setContentEvaluate`). Per link: its href as
 * written, its text, a title from `title`/`aria-label`/an inner img's `alt`,
 * and an image — one inside the link, else the first in the nearest ancestor
 * (up to three levels) that holds no other product link. Lazy images keep
 * their URL in `data-src`/`srcset`. Relative URLs are resolved later, against
 * the listing URL, because `setContent` pages have no base URL.
 * `chrome: true` marks a link in page navigation: inside `nav`, `aside`, a
 * navigation/banner/contentinfo/complementary role, or a `header`/`footer`
 * that belongs to the page (not one inside an article, section, main, aside
 * or nav — a product card's own header is content). Two layouts slip through:
 * an app that wraps the whole page in `main`, and a theme that wraps its page
 * header in a `section` (seen on Shopify); their header links count as
 * content, which is no worse than before navigation was left out.
 *
 * This is JavaScript source inside a TS template literal: every regex escape
 * must be doubled (`\\s`), or the page receives `/s+/` instead of `/\s+/`.
 */
export const LISTING_ANCHORS_SCRIPT = `(() => {
  const imgUrl = (img) => img ? (img.getAttribute('src') || img.getAttribute('data-src') || (img.getAttribute('srcset') || '').split(/[ ,]/)[0] || '') : '';
  const near = (a) => {
    let el = a.parentElement;
    for (let i = 0; el && i < 3; i++, el = el.parentElement) {
      if (el.querySelectorAll('a[href]').length > 3) break;
      const img = el.querySelector('img');
      if (img) return img;
    }
    return null;
  };
  const chrome = (a) => {
    if (a.closest('nav, aside, [role~=navigation i], [role~=banner i], [role~=contentinfo i], [role~=complementary i]')) return true;
    const hf = a.closest('header, footer');
    return !!hf && !(hf.parentElement && hf.parentElement.closest('article, section, main, aside, nav'));
  };
  return Array.from(document.querySelectorAll('a[href]')).map((a) => {
    const inner = a.querySelector('img');
    return {
      href: a.getAttribute('href') || '',
      text: (a.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 200),
      title: a.getAttribute('title') || a.getAttribute('aria-label') || (inner && inner.getAttribute('alt')) || undefined,
      image: imgUrl(inner || near(a)) || undefined,
      chrome: chrome(a) || undefined,
    };
  });
})()`;

/** Host + path template of a URL, so a group is only confirmed by a URL of the same site and shape. */
const shapeOf = (url: string): string | null => {
  try { const u = new URL(url); return `${u.hostname}${productPathTemplate(u.pathname)}`; } catch { return null; }
};

export type ReconciledRows = {
  rows: Array<Record<string, unknown>>;
  /** How many of `rows` came from the page's links alone — they carry only the URL field. */
  added: number;
};

/**
 * Should the listing walk plan from the page's product-link group instead of
 * (only) the rows its extraction produced?
 *
 * To rescue a row selector that under-matched. With at least one extracted
 * URL, the group must be CORROBORATED as product links — an extracted URL, or
 * a known product page (the website's verified proof pages), has the group's
 * host and path template — and hold URLs the extraction missed. With zero
 * rows, only a `directListing` input is rescued, and only when a proof page
 * corroborates the group; a search or template input stays "nothing found",
 * so an empty result page showing "You may also like" cards never plans the
 * recommendations. Without corroboration the group is left alone: a walk
 * must never queue menu links.
 *
 * Returns `null` when the extraction's rows stand as they are; otherwise the
 * rows to plan from, in the group's document order, each extracted row's
 * listing values kept on its URL, and any extracted URL outside the group
 * appended after it. On a page below budget this may also take in
 * product-shaped links outside the grid (a promo tile, "recently viewed"),
 * in page order — the same links the finder counts.
 */
export function reconcileWithProductGroup(args: {
  rows: Array<Record<string, unknown>>;
  urlField: string;
  group: string[];
  listingUrl: string;
  knownDetailUrls?: string[];
  /** The input is a listing URL the customer gave (input strategy `direct`), not a search or template result. */
  directListing?: boolean;
}): ReconciledRows | null {
  const { rows, urlField, group, listingUrl, knownDetailUrls = [], directListing = false } = args;
  if (group.length === 0) return null;
  const groupShape = shapeOf(group[0]!);
  if (groupShape === null) return null;

  const resolve = (v: unknown): string | null => {
    if (typeof v !== 'string' || v.trim() === '') return null;
    try { const u = new URL(v, listingUrl); u.hash = ''; return u.href; } catch { return null; }
  };
  const byUrl = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const url = resolve(row[urlField]);
    if (url && !byUrl.has(url)) byUrl.set(url, row);
  }
  // Zero rows is rescued only on a listing URL the customer gave directly, and
  // only on the proof pages' word: a stale cached selector that matches
  // nothing (Allbirds, 2026-10-08) must not end the walk, while an empty
  // search/template result page must stay empty.
  if (byUrl.size === 0 && !directListing) return null;

  const witnesses = byUrl.size === 0 ? knownDetailUrls : [...byUrl.keys(), ...knownDetailUrls];
  const corroborated = witnesses.some((u) => shapeOf(u) === groupShape);
  if (!corroborated) return null;
  const missed = group.filter((u) => !byUrl.has(u));
  if (missed.length === 0) return null;

  const inGroup = new Set(group);
  const merged: Array<Record<string, unknown>> = group.map((url) => ({ ...(byUrl.get(url) ?? {}), [urlField]: url }));
  for (const [url, row] of byUrl) if (!inGroup.has(url)) merged.push(row);
  return { rows: merged, added: missed.length };
}
