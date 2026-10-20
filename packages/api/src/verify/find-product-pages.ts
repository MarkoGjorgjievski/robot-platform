// What "Find products" (`sources.checkListingPage`) reports about a listing page. The page is read
// by `readListingPage` (@robot/scraper: the live page, loaded more, its links) and grouped by the
// one rule the coverage check and the listing walk use too (`findProductGroup`, spec 2026-10-20):
// a product link is a link on a product card, one product per path, and a page with none has no
// products. No AI involved.

import { detectPaginationFromHtml, verdictSentence, type CaptureErrorKind, type CaptureVerdict } from '@robot/browser';
import { findProductGroup, productKey, type ListingLinks } from '@robot/scraper';

const absolute = (u: string, base: string): string | undefined => {
  try { const x = new URL(u, base); return /^https?:$/.test(x.protocol) ? x.href : undefined; } catch { return undefined; }
};

/**
 * Names each product of `describeListingPage`'s sample from the listing alone: every link to the
 * same product (spec §3.4: by product key, so `?color=` copies count) that is not a swatch, and
 * the page data's ItemList entry. Title: the longest link text, else a link's `title`, else the
 * ItemList name, else the path. Image: the first link's resolved http(s) image, else the ItemList's.
 */
export function listingProducts(links: ListingLinks, listingUrl: string, urls: string[]) {
  return urls.map((url) => {
    const key = productKey(url);
    const same = (href: string) => key !== null && productKey(absolute(href, listingUrl) ?? '') === key;
    const mine = links.anchors.filter((a) => !a.swatch && same(a.href));
    const item = links.itemList.find((i) => same(i.url));
    const text = mine.map((a) => a.text.trim()).sort((x, y) => y.length - x.length)[0]
      || mine.find((a) => a.title?.trim())?.title?.trim()
      || item?.name?.trim()
      || '';
    const image = [...mine.map((a) => (a.image ? absolute(a.image, listingUrl) : undefined)), item?.image ? absolute(item.image, listingUrl) : undefined].find(Boolean);
    return { url, title: (text || new URL(url).pathname).slice(0, 120), ...(image ? { image } : {}) };
  });
}

/**
 * The listing check: how many products the page's product group has (before any `limit` cut), a
 * 10-item sample, whether a pager was seen (`detectPaginationFromHtml`, no AI), and the sample's
 * products (title + image), so the Verification tab's product cards fill without visiting any
 * product. A page with no products reports zero (the app says "No products found on this page.").
 *
 * `verdict` is the browser's word on the listing page itself (spec 2026-10-09 §A1): anything but
 * ok means the links are not the shop's (a block page, a CAPTCHA, a 404), so nothing is counted
 * and `message` carries the verdict's customer sentence instead. `message` is null when ok.
 */
export type ListingPageCheck = {
  verdict: CaptureVerdict | { kind: CaptureErrorKind };
  message: string | null;
  productLinks: number;
  pagerSeen: boolean;
  sample: string[];
  products: ReturnType<typeof listingProducts>;
};

/** The check for a listing page the browser never got a document for (a `CaptureError`), or one whose verdict is not ok. */
export function unreadListingPage(verdict: CaptureVerdict | { kind: CaptureErrorKind }, listingUrl: string): ListingPageCheck {
  return { verdict, message: verdictSentence(verdict, listingUrl), productLinks: 0, pagerSeen: false, sample: [], products: [] };
}

export function describeListingPage(links: ListingLinks, listingUrl: string, html: string, verdict: CaptureVerdict): ListingPageCheck {
  if (verdict.kind !== 'ok') return unreadListingPage(verdict, listingUrl);
  const urls = findProductGroup(links, listingUrl)?.urls ?? [];
  const sample = urls.slice(0, 10);
  return {
    verdict,
    message: null,
    productLinks: urls.length,
    pagerSeen: detectPaginationFromHtml(html, listingUrl) !== null,
    sample,
    products: listingProducts(links, listingUrl, sample),
  };
}
