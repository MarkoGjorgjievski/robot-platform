// What "Find products" (`sources.checkListingPage`) reports about a listing page. The page is read
// by `readListingPage` (@robot/scraper: the live page, loaded more, its links) and grouped by the
// one rule the coverage check and the listing walk use too (`findProductGroup`, spec 2026-10-20):
// a product link is a link on a product card, one product per path, and a page with none has no
// products. No AI involved.

import { detectPaginationFromHtml, verdictSentence, type CaptureErrorKind, type CaptureVerdict } from '@robot/browser';
import { findProductGroup, isOptionLabel, isSwatchLink, onCard, onImageCard, productKey, PRICE_PATTERN, type ListingAnchor, type ListingLinks } from '@robot/scraper';

const absolute = (u: string, base: string): string | undefined => {
  try { const x = new URL(u, base); return /^https?:$/.test(x.protocol) ? x.href : undefined; } catch { return undefined; }
};

/**
 * Names each product of `describeListingPage`'s sample from the listing alone: every link to the
 * same product (spec §3.4: by product key, so `?color=` copies count) that is not a swatch, and
 * the page data's ItemList entry. Title: the card's own title (a link's `name`, ruling D4 — so a card
 * is never named "Save $70 on …", "SHOP … >" or "Option: …"), else the longest link text of a link on a
 * card, else of any link, else a link's `title`, else the ItemList name, else the path. Image: the first
 * link's resolved http(s) image, else the ItemList's.
 */
export function listingProducts(links: ListingLinks, listingUrl: string, urls: string[]) {
  return urls.map((url) => {
    const key = productKey(url);
    const same = (href: string) => key !== null && productKey(absolute(href, listingUrl) ?? '') === key;
    const mine = links.anchors.filter((a) => !isSwatchLink(a) && same(a.href));
    const item = links.itemList.find((i) => same(i.url));
    const longest = (as: ListingAnchor[]) => as.map((a) => a.text.trim()).sort((x, y) => y.length - x.length)[0];
    const text = mine.find((a) => a.name?.trim() && !isOptionLabel(a.name))?.name?.trim()
      || longest(mine.filter((a) => onCard(a.levels) || onImageCard(a.levels)))
      || longest(mine)
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
 * product. The sample starts with three products that differ (`proofProductOrder`, ruling D1),
 * which the board takes as its proof pages; the rest follow in listing order. A page with no products reports zero (the app says "No products found on this page.").
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
  // Ruling D1: the products the board takes first (its three proof pages) are three that differ,
  // chosen from the first PROOF_POOL products; the rest follow in listing order.
  const pool = listingProducts(links, listingUrl, urls.slice(0, PROOF_POOL));
  const prices = cardPrices(links, listingUrl);
  const byUrl = new Map(pool.map((p) => [p.url, p]));
  const order = proofProductOrder(pool.map((p) => ({ url: p.url, title: p.title, price: prices.get(productKey(p.url) ?? '') })));
  const products = order.slice(0, SAMPLE_SIZE).map((u) => byUrl.get(u)!);
  return {
    verdict,
    message: null,
    productLinks: urls.length,
    pagerSeen: detectPaginationFromHtml(html, listingUrl) !== null,
    sample: products.map((p) => p.url),
    products,
  };
}

/** How many products the listing check sends (the board's three, then the queue). */
const SAMPLE_SIZE = 10;
/** Ruling D1: proof pages are chosen among the listing's first this many products, so they stay typical. */
export const PROOF_POOL = 30;
/** How many proof pages the board starts with. */
const PROOF_PAGES = 3;

/** Each product's card price as shown (by product key): its first non-swatch link's `price`, else the first price in a link's text. */
function cardPrices(links: ListingLinks, listingUrl: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const a of links.anchors) {
    if (isSwatchLink(a)) continue;
    const key = productKey(absolute(a.href, listingUrl) ?? '');
    if (key === null || out.has(key)) continue;
    const price = a.price ?? a.text.match(PRICE_PATTERN)?.[0];
    if (price) out.set(key, price);
  }
  return out;
}

const PRICES = new RegExp(PRICE_PATTERN.source, 'g');
/** Colour words a name may end in (a colourway of the same product), with their light/dark modifiers. */
const COLOUR_WORDS = new Set([
  'black', 'white', 'grey', 'gray', 'blue', 'navy', 'red', 'green', 'yellow', 'orange', 'pink', 'purple', 'brown', 'beige',
  'cream', 'ivory', 'silver', 'gold', 'tan', 'khaki', 'olive', 'teal', 'burgundy', 'maroon', 'charcoal', 'lilac', 'mint',
  'multicolour', 'multicolor', 'natural', 'light', 'dark', 'pale', 'deep', 'bright',
]);
/** The first separator that starts a variant part: a spaced dash, a bar, a slash, or a comma. */
const VARIANT_SEPARATOR = /\s[-–—|/]\s|,\s/;

/**
 * A product's name without what tells its colourways apart (ruling D1): no prices, no case, no
 * trailing "(…)", nothing after the first variant separator (" - ", " | ", ", " …), and no trailing
 * colour words, and no leading "Option:" label (a variant option's text). "GLOSTAD 3-seat sofa - Knisa
 * dark grey" and "Everyday Seamless Leggings Black" read as "glostad 3-seat sofa" and "everyday
 * seamless leggings".
 */
export function productBaseName(name: string): string {
  let s = name.replace(PRICES, ' ').toLowerCase().replace(/\s+/g, ' ').trim().replace(/^option\s*:\s*/, '');
  s = s.replace(/\s*\([^)]*\)$/, '').trim();
  const cut = VARIANT_SEPARATOR.exec(s);
  if (cut && cut.index >= 3) s = s.slice(0, cut.index).trim();
  const words = s.split(' ');
  while (words.length > 1 && COLOUR_WORDS.has(words[words.length - 1]!.replace(/[^\p{L}]/gu, ''))) words.pop();
  return words.join(' ').replace(/[\s,;:.\-–—|/]+$/, '');
}

const nameWords = (base: string): string[] => base.split(/[\s,;:|/]+/).map((w) => w.replace(/[^\p{L}\p{N}-]/gu, '')).filter(Boolean);

/**
 * Are two card names one product in two variants (first run, re-run 1)? Their base names
 * (`productBaseName`) are the same, or one's words begin the other's: the part after a comma or a
 * spaced dash/bar is the variant, wherever the shop puts its first comma — "GLOSTAD, 3-seat sofa,
 * Knisa medium blue" and "GLOSTAD 3-seat sofa, Knisa dark grey" are one sofa. "Crusher 720" and
 * "Crusher 540" stay two products.
 */
export function sameProduct(a: string, b: string): boolean {
  const [x, y] = [nameWords(productBaseName(a)), nameWords(productBaseName(b))];
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (short.length === 0) return long.length === 0;
  return short.every((w, i) => long[i] === w);
}

/** A shown price as a number (`£1,299.00` → 1299, `1.234,50 €` → 1234.5), or undefined. */
function amountOf(price: string | undefined): number | undefined {
  const digits = price?.match(/\d[\d.,\s  ']*/)?.[0].replace(/[\s  ']+$/, '');
  if (!digits) return undefined;
  const fraction = /[.,](\d{1,2})$/.exec(digits);
  const whole = (fraction ? digits.slice(0, fraction.index) : digits).replace(/\D/g, '');
  const n = Number(`${whole}.${fraction?.[1] ?? '0'}`);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Ruling D1 (first run 2026-10-25): the order the board takes products in, so its three proof pages
 * differ. The first three (in listing order, earliest first) whose names are not
 * `sameProduct` and whose prices, when all three cards show one, are not all equal; else the
 * first three whose names differ; else the first three. The rest follow in listing order.
 * Deterministic: the same listing gives the same proof pages.
 */
export function proofProductOrder(items: Array<{ url: string; title: string; price?: string }>): string[] {
  const urls = items.map((i) => i.url);
  if (items.length <= PROOF_PAGES) return urls;
  const amounts = items.map((i) => amountOf(i.price));
  const differ = (...ix: number[]) => ix.every((i, n) => ix.slice(n + 1).every((j) => !sameProduct(items[i]!.title, items[j]!.title)));
  const spread = (i: number, j: number, k: number) => {
    const [a, b, c] = [amounts[i], amounts[j], amounts[k]];
    return a === undefined || b === undefined || c === undefined || !(a === b && b === c);
  };
  const first = (ok: (i: number, j: number, k: number) => boolean): number[] | null => {
    const n = items.length;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      if (!differ(i, j)) continue;
      for (let k = j + 1; k < n; k++) if (ok(i, j, k)) return [i, j, k];
    }
    return null;
  };
  const picked = first((i, j, k) => differ(i, j, k) && spread(i, j, k)) ?? first((i, j, k) => differ(i, j, k)) ?? [0, 1, 2];
  return [...picked.map((i) => urls[i]!), ...urls.filter((_, i) => !picked.includes(i))];
}
