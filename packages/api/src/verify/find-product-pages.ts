// Pure link-ranking for `sources.findProductPages` / `sources.checkListingPage`:
// given every `<a href>` harvested from a listing page (via `withBrowserSession`
// + `setContentEvaluate` in sources.ts — no AI involved), guesses which links
// are product/detail pages by finding the largest same-host group of paths
// that share a "template" (digits and long opaque tokens collapsed to `*`).
// Links in the page's navigation (menus, sidebars, page header and footer) are
// left out first: on a shop with a mega-menu they outnumber the product grid
// (Everlane's men's tees, 2026-10-08: ~94 menu links to other collections
// against 52 product links), and the largest group was the menu.

import { detectPaginationFromHtml } from '@robot/browser';

/** Drops a trailing slash for path comparison, except the bare root itself. */
const trimTrailingSlash = (p: string): string => (p.length > 1 ? p.replace(/\/+$/, '') : p);

/**
 * Grouping used by `describeListingPage`: same hostname as the listing, not
 * the listing page itself (same host + same path — query string and hash
 * ignored, trailing slash trimmed, so `?page=2`/`?sort=new#top`/a
 * trailing-slash variant of the listing all still count as "the listing
 * itself"), grouped by path template (digits and 12+-char alnum/hyphen
 * tokens replaced by `*`), the largest group returned in full, in document
 * order, deduped. Anchors marked `chrome` (in page navigation, see
 * `LISTING_ANCHORS_SCRIPT`) are left out, unless nothing else is left —
 * a page that marks every link as navigation is grouped as a whole.
 */
export function largestProductGroup(anchors: Array<{ href: string; text: string; chrome?: boolean }>, listingUrl: string): string[] {
  const content = anchors.filter((a) => !a.chrome);
  const best = largestGroup(content, listingUrl);
  return best.length > 0 || content.length === anchors.length ? best : largestGroup(anchors, listingUrl);
}

function largestGroup(anchors: Array<{ href: string }>, listingUrl: string): string[] {
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
 * or nav — a product card's own header is content).
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
    if (a.closest('nav, aside, [role=navigation], [role=banner], [role=contentinfo], [role=complementary]')) return true;
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

const absolute = (u: string, base: string): string | undefined => {
  try { const x = new URL(u, base); return /^https?:$/.test(x.protocol) ? x.href : undefined; } catch { return undefined; }
};

/**
 * Names each product from `describeListingPage`'s sample: for each url,
 * merges every anchor that resolves (relative to `listingUrl`, hash
 * ignored — matching `largestProductGroup`'s own normalisation) to that url.
 * Title is the longest anchor text, else the first anchor's `title`, else the
 * url's path. Image is the first anchor's resolved, http(s) image.
 */
export function listingProducts(anchors: ListingAnchor[], listingUrl: string, urls: string[]) {
  return urls.map((url) => {
    const mine = anchors.filter((a) => absolute(a.href, listingUrl)?.replace(/#.*$/, '') === url);
    const text = mine.map((a) => a.text.trim()).sort((x, y) => y.length - x.length)[0] || mine.find((a) => a.title?.trim())?.title?.trim() || '';
    const image = mine.map((a) => (a.image ? absolute(a.image, listingUrl) : undefined)).find(Boolean);
    return { url, title: (text || new URL(url).pathname).slice(0, 120), ...(image ? { image } : {}) };
  });
}

/**
 * The Extract tab's free per-row listing check (`sources.checkListingPage`):
 * how many product links the largest same-template group has (before any
 * `limit` cut), a 10-item sample of them, whether a pager was seen on the
 * page (`detectPaginationFromHtml`, `@robot/browser` — no AI), and the
 * sample's products (title + image), so the Verification tab's product
 * cards fill without visiting any product.
 */
export function describeListingPage(
  anchors: ListingAnchor[],
  listingUrl: string,
  html: string,
): { productLinks: number; pagerSeen: boolean; sample: string[]; products: ReturnType<typeof listingProducts> } {
  const group = largestProductGroup(anchors, listingUrl);
  const sample = group.slice(0, 10);
  return {
    productLinks: group.length,
    pagerSeen: detectPaginationFromHtml(html, listingUrl) !== null,
    sample,
    products: listingProducts(anchors, listingUrl, sample),
  };
}
