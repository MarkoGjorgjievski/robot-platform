// Pure link-ranking for `sources.findProductPages` / `sources.checkListingPage`:
// given every `<a href>` harvested from a listing page (via `withBrowserSession`
// + `setContentEvaluate` in sources.ts — no AI involved), guesses which links
// are product/detail pages by finding the largest same-host group of paths
// that share a "template" (digits and long opaque tokens collapsed to `*`).
// Links in the page's navigation (menus, sidebars, page header and footer) are
// left out first: on a shop with a mega-menu they outnumber the product grid
// (Everlane's men's tees, 2026-10-08: ~94 menu links to other collections
// against 52 product links), and the largest group was the menu.
//
// The grouping itself (`largestProductGroup`, navigation filter included) and
// the anchor harvest script live in @robot/scraper's
// crawl/product-link-group.ts, because the listing walk that Sample and
// Extract plan with cross-checks against the very same group — two
// definitions of "the product links" is how Allbirds' finder saw 150 links
// where the walk saw 1.

import { detectPaginationFromHtml } from '@robot/browser';
import { largestProductGroup, LISTING_ANCHORS_SCRIPT, type ListingAnchor } from '@robot/scraper';

export { largestProductGroup, LISTING_ANCHORS_SCRIPT, type ListingAnchor };

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
