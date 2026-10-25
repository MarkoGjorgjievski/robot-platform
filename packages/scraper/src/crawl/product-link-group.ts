// The ONE mechanical definition of "the product links on a listing page",
// shared by the Verification tab's "Find products" / listing check
// (`describeListingPage` in @robot/api), the coverage check that samples the
// same group, and the listing walk that Sample and Extract plan with
// (`planRun`, which cross-checks its rows against it). Pure, no AI.
//
// Spec 2026-10-20 (the finder reads product links): a product link is a link
// on a product card, and one product is one path.
// - Shape per path segment (§3.1): a segment with a digit, `-` or `_`, or of
//   12+ characters is `*`; a file extension is kept; the host is kept.
// - On a card (§3.2): an ancestor at most 6 levels up holds at most 3 distinct
//   link paths, under 800 characters of text, an image and a price. A group is
//   ranked by its distinct product keys on cards, never by raw link count, so a
//   menu or a set of category tiles (images, no prices) never wins.
// - Image cards (§5.2, a listing that shows no prices): when the page has no
//   priced-card group, a group of cards with an image and no price required,
//   ranked the same way, counts from 6 distinct product keys — a price-less
//   grid still finds its products; a handful of category tiles stays nothing,
//   and so do image tiles in navigation (a mega-menu's tiles have images).
// - One-segment merge (§3.3): shapes with carded keys that differ in one literal
//   segment (`/{seller}/product/*`) are one group when at least 3 of them carry
//   2+ carded keys each and the merged shape keeps a literal path segment
//   (never `*/*`).
// - One product, one path (§3.4): the key is host + path (+ the id-like query
//   params when the path's last segment is literal or a server script:
//   `/product?id=7`, `/product_info.php?products_id=7`); the first
//   address seen is the one offered; swatch links and "+2" are not product links.
// - JSON-LD ItemList (§3.5): 3+ same-site items are a group of their own.
// - Zero is an answer (§3.6): no carded group (priced, else image) and no
//   ItemList group → null.
// Every threshold came from 13 live listings (docs/testing/results/2026-10-20-finder-links/).
// No rule here names a site, a domain or a platform (spec §5.1).

import { isKeyValueFragment } from '@robot/browser';

/** One ancestor level of a link (index 0 is the link itself): distinct link paths in it, an image, a price, its text length. */
export type CardLevel = { d: number; img: boolean; price: boolean; len: number };

export type ListingAnchor = {
  href: string;
  text: string;
  title?: string;
  /**
   * The card's own title (ruling D4, first run 2026-10-25): a heading, else an element whose class names a
   * title or a name (`product-title`, `grid-product__title`, `…__product-name`), else a name-like image alt
   * (short, not a sentence) — found in the link or the ancestors that hold this product's links only, so a
   * card never takes another product's title. Absent when there is none; the link text names it then.
   */
  name?: string;
  image?: string;
  /** In page navigation: nav, aside, a navigation/banner/contentinfo/complementary role, or the page's own header/footer. */
  chrome?: boolean;
  /** A colour/size swatch or a "+2" link (spec §3.4): never a product link. */
  swatch?: boolean;
  /** The link itself, then up to six ancestors (see `LISTING_LINKS_SCRIPT`). Absent: the link is on no card. */
  levels?: CardLevel[];
  /**
   * The card's price as shown (`£38.00`, `RM1,299`): the first price in the link's own text, else in the
   * lowest of its levels that shows one. Absent when none does. Read only to choose proof pages that
   * differ (ruling D1, first run 2026-10-25); never part of the product link rule.
   */
  price?: string;
};

/** One `ItemList` entry from the page's JSON-LD. */
export type ListingItem = { url: string; name?: string; image?: string };

/** What `LISTING_LINKS_SCRIPT` returns from a listing page. */
export type ListingLinks = { anchors: ListingAnchor[]; itemList: ListingItem[] };

export type ProductGroup = {
  /** Host + path shape (`shop.example/products/*`); a merged group has `*` where its shapes differ; null for an ItemList-only group. */
  shape: string | null;
  /** One address per product (the first seen): carded products first, then the shape's other links, each in page order; ItemList items the cards missed last. */
  urls: string[];
  /** What the group was ranked by: its distinct product keys on cards, or the ItemList's distinct items. */
  carded: number;
};

/** Spec §3.2: how far up a card may be, and what it may hold. */
export const CARD_MAX_LEVELS = 7; // the link itself + 6 ancestors
export const CARD_MAX_LINKS = 3;
export const CARD_MAX_TEXT = 800;
/** Spec §3.3, as measured (`rule.mjs`): shapes that differ in one literal segment merge when at least this many carry carded keys. */
export const MERGE_MIN_SHAPES = 3;
/** A merge qualifies on shapes carrying at least this many carded keys each: a card's one link to a sale or a brand page never counts. */
export const MERGE_MIN_CARDED = 2;
/** Spec §3.5: an ItemList is a group from this many distinct same-site items. */
export const ITEM_LIST_MIN = 3;
/** Spec §5.2: with no priced-card group, an image-card group counts from this many distinct product keys on image cards. */
export const IMAGE_CARD_MIN = 6;

/** Currency codes in capitals: also a price when glued to a lowercase word ("sierra rugRM810.00", inline spans in `innerText`). */
const UPPER_CODES = String.raw`US\$|AU\$|CA\$|NZ\$|HK\$|S\$|R\$|USD|EUR|GBP|JPY|CNY|INR|AUD|CAD|NZD|CHF|SEK|NOK|DKK|PLN|CZK|HUF|MYR|SGD|HKD|AED|SAR|ZAR|BRL|MXN|TRY|RM`;
/** Codes in their own case: the Indian rupee's `Rs`/`Rs.` (never a bare `R`), the Nordic `kr`, the złoty, koruna, forint, leu. */
const OTHER_CODES = String.raw`Rs\.?|kr|zł|Kč|Ft|lei`;
const CURRENCY = `(?:[$€£¥₹₩₽₺₪฿₫₱]|(?:(?<![A-Za-z])(?:${UPPER_CODES}|${OTHER_CODES})|(?<=[a-z])(?:${UPPER_CODES}))(?![A-Za-z]))`;
const AMOUNT = String.raw`(?:\d{1,3}(?:[.,\s\u00a0\u202f']\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)`;
/**
 * Spec §3.2: a number with a currency symbol or code next to it, either side,
 * in any common locale format (`$1,234.50`, `1.234,50 €`, `RM810.00`, `MYR 620`,
 * `£25`, `₹1,299`, `¥3,980`, `199 kr`, `CHF 49.90`, `Rs. 1,299`). Codes are case-sensitive
 * (no 'i' flag: "Try 2 colours", "6 ft sofa", "Sek 5" are not prices) and count only when no
 * letter touches them ("Europe", "Kraków") — except a capitals code right after a lowercase
 * letter, a name and its price glued together in `innerText` ("sierra rugRM810.00").
 */
export const PRICE_PATTERN = new RegExp(`${CURRENCY}\\s?${AMOUNT}|${AMOUNT}\\s?${CURRENCY}`);

const bareHost = (h: string): string => h.toLowerCase().replace(/^www\./, '');
const trimSlash = (p: string): string => p.replace(/\/+$/, '');

/** Spec §3.1, one segment: a digit, `-` or `_`, or 12+ characters → `*`; the extension stays. */
function segmentShape(s: string): string {
  const m = /^(.*?)(\.[a-z]{2,5})$/i.exec(s);
  const [stem, ext] = m ? [m[1]!, m[2]!] : [s, ''];
  return (/[\d_-]/.test(stem) || stem.length >= 12 ? '*' : stem) + ext;
}

/** Spec §3.1: a path's shape, per whole segment (`/products/union-3-seat-sofa` → `/products/*`, `/de/a_b.htm` → `/de/*.htm`). */
export function productPathShape(pathname: string): string {
  return '/' + pathname.split('/').filter(Boolean).map(segmentShape).join('/');
}

/** Host (without `www.`) + path shape; the query and fragment are not part of it. Null for an unparseable or non-http(s) URL. */
export function urlShape(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return bareHost(u.hostname) + productPathShape(u.pathname);
  } catch { return null; }
}

/**
 * Spec §3.4 (amended): id-like query parameter names, in any case — `id`, `pid`, `sku`, `item`,
 * `product`, `code`, `route`; a name ending in `_id`/`-id` (`products_id`) or starting `id_`/`id-`
 * (`id_product`); and the whole-word compounds `productid`, `itemid`, `articleid`, `goodsid`,
 * `prodid` (`ProductID`, `PRODUCTID`). Never a word that merely ends in "id" (`paid`, `grid`, `valid`).
 */
export const ID_PARAM_NAME = /^(?:id|pid|sku|item|product|code|route)$|[_-]id$|^id[_-]|^(?:products?|items?|articles?|goods|prod)id$/i;
/** Spec §3.4 (amended): a camelCase id, case-sensitive — `Id`/`ID` right after a lowercase letter (`itemId`, `productID`, `CategoryID`), never `paid`. */
export const ID_PARAM_CAMEL = /[a-z](?:Id|ID)$/;
/** Does this query parameter name a product (`ID_PARAM_NAME` or `ID_PARAM_CAMEL`)? */
export function isIdParam(name: string): boolean {
  return ID_PARAM_NAME.test(name) || ID_PARAM_CAMEL.test(name);
}
/** A server script as the last segment (`product_info.php`, `ProductDetails.aspx`): its query names the page, whatever the script is called. */
export const SCRIPT_SEGMENT = /\.(?:php|aspx?|jsp|cfm|cgi|pl)$/i;

/**
 * Spec §3.4: host (without `www.`) + path, trailing slash trimmed. When the path's last segment is
 * literal in its shape (`/product`, `/item.php`, `/index.php`), is a server script whatever its name
 * (`/product_info.php`, `/ProductDetails.aspx` — `SCRIPT_SEGMENT`), or there is no path, the query
 * names the product: its id-like parameters (`isIdParam`) are appended, sorted. Any other slug path
 * (`*` last) drops the whole query — `?color=red`, `?variant=…` are copies of one product.
 */
function keyOf(u: URL): string {
  const host = bareHost(u.hostname);
  // Percent-escapes in one case (`%C3%A9` and `%c3%a9` are one path); other letters keep theirs.
  const path = trimSlash(u.pathname).replace(/%[0-9a-f]{2}/gi, (m) => m.toLowerCase());
  const last = path.slice(path.lastIndexOf('/') + 1);
  if (path !== '' && segmentShape(last).includes('*') && !SCRIPT_SEGMENT.test(last)) return host + path;
  const ids = [...u.searchParams].filter(([n]) => isIdParam(n)).map(([n, v]) => `${n}=${v}`).sort();
  return ids.length > 0 ? `${host}${path}?${ids.join('&')}` : host + path;
}

/** Spec §3.4: a product's key (`keyOf`) — query and fragment dropped, except id-like params on a literal path; null for a non-http(s) URL. */
export function productKey(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return keyOf(u);
  } catch { return null; }
}

/** Does `url` fit `shape` (a group's, which may hold `*` where merged shapes differed)? `*` takes any one segment, never the host. */
export function fitsShape(shape: string, url: string): boolean {
  const own = urlShape(url);
  if (own === null) return false;
  const a = shape.split('/');
  const b = own.split('/');
  return a.length === b.length && a.every((s, i) => s === b[i] || (i > 0 && s === '*'));
}

/** Spec §3.2: one level within reach holds at most 3 link paths, under 800 characters, an image — and a price, when `requirePrice`. */
function cardAt(levels: CardLevel[] | undefined, requirePrice: boolean): boolean {
  return (levels ?? []).slice(0, CARD_MAX_LEVELS)
    .some((l) => l.d <= CARD_MAX_LINKS && l.len < CARD_MAX_TEXT && l.img && (l.price || !requirePrice));
}

/** Spec §3.2: the link is on a product card (an image and a price). */
export function onCard(levels: CardLevel[] | undefined): boolean {
  return cardAt(levels, true);
}

/** Spec §5.2, the fallback when a page has no priced cards: a card as in `onCard`, with no price required. */
export function onImageCard(levels: CardLevel[] | undefined): boolean {
  return cardAt(levels, false);
}

/** The page script's value, checked: anything malformed reads as a page with no links. */
export function asListingLinks(value: unknown): ListingLinks {
  const v = (value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}) as { anchors?: unknown; itemList?: unknown };
  const anchors = Array.isArray(v.anchors)
    ? v.anchors.filter((a): a is ListingAnchor => !!a && typeof a === 'object' && typeof (a as ListingAnchor).href === 'string')
      .map((a) => {
        const { name, ...rest } = a;
        return { ...rest, text: typeof a.text === 'string' ? a.text : '', ...(typeof name === 'string' && name.trim() ? { name } : {}) };
      })
    : [];
  const itemList = Array.isArray(v.itemList)
    ? v.itemList.filter((i): i is ListingItem => !!i && typeof i === 'object' && typeof (i as ListingItem).url === 'string')
    : [];
  return { anchors, itemList };
}

/** A same-site link that is not the listing itself or the site's root: its address (variant fragment kept), key and shape. */
type Resolved = { href: string; key: string; shape: string };

function resolver(listingUrl: string): (href: string) => Resolved | null {
  const base = new URL(listingUrl);
  const host = bareHost(base.hostname);
  const self = keyOf(base);
  return (href) => {
    let u: URL;
    try { u = new URL(href, listingUrl); } catch { return null; }
    if ((u.protocol !== 'http:' && u.protocol !== 'https:') || bareHost(u.hostname) !== host) return null;
    // The listing itself and the bare root, by full key: `/?product=oak` is a product, `/?page=2` is the root.
    const key = keyOf(u);
    if (key === host || key === self) return null;
    // Spec 2026-10-14 §8: a fragment whose every part is key=value names a variant and stays on the address.
    if (!isKeyValueFragment(u.hash)) u.hash = '';
    return { href: u.href, key, shape: host + productPathShape(u.pathname) };
  };
}

type ShapeGroup = { shapes: string[]; first: Map<string, { href: string; order: number }>; carded: Set<string> };

/**
 * The best group of `anchors` whose keys are on cards by `isCard` (`onCard`, or `onImageCard` for the
 * §5.2 fallback); a group with fewer than `min` carded keys does not count.
 */
function cardGroup(
  anchors: ListingAnchor[], listingUrl: string, isCard: (levels: CardLevel[] | undefined) => boolean, min: number,
): { shape: string; urls: string[]; carded: number } | null {
  const resolve = resolver(listingUrl);
  const byShape = new Map<string, ShapeGroup>();
  anchors.forEach((a, order) => {
    if (a.swatch) return;
    const r = resolve(a.href);
    if (!r) return;
    let g = byShape.get(r.shape);
    if (!g) { g = { shapes: [r.shape], first: new Map(), carded: new Set() }; byShape.set(r.shape, g); }
    if (!g.first.has(r.key)) g.first.set(r.key, { href: r.href, order });
    if (isCard(a.levels)) g.carded.add(r.key);
  });

  // §3.3: shapes with carded keys that differ in one literal segment are one group (with the shape
  // that already has `*` there, if the page has one) when three or more of them carry 2+ carded keys
  // each — a card's single link to a sale or a brand page never makes a "shape" — and never into a
  // shape with no literal path segment left (`*/product/*` merges; `*/*` would be any two-segment
  // link). Once a merge qualifies, a member with one carded key joins it (a seller showing one product).
  const parent = new Map<string, string>();
  const root = (s: string): string => { let x = s; while (parent.get(x) !== x) x = parent.get(x)!; return x; };
  const holes = new Map<string, string[]>();
  for (const [shape, g] of byShape) {
    if (g.carded.size === 0) continue;
    const segs = shape.split('/');
    segs.forEach((seg, i) => {
      if (i === 0 || seg === '' || seg.startsWith('*')) return;
      const hole = segs.map((x, j) => (j === i ? '*' : x)).join('/');
      if (!hole.split('/').slice(1).some((x) => x !== '' && !x.includes('*'))) return;
      (holes.get(hole) ?? holes.set(hole, []).get(hole)!).push(shape);
    });
  }
  for (const [hole, members] of holes) {
    if (members.filter((m) => byShape.get(m)!.carded.size >= MERGE_MIN_CARDED).length < MERGE_MIN_SHAPES) continue;
    const all = byShape.has(hole) ? [...members, hole] : members;
    for (const s of all) if (!parent.has(s)) parent.set(s, s);
    for (const s of all.slice(1)) parent.set(root(s), root(all[0]!));
  }
  const groups = new Map<string, ShapeGroup>();
  for (const [shape, g] of byShape) {
    const r = parent.has(shape) ? root(shape) : shape;
    const m = groups.get(r);
    if (!m) { groups.set(r, { shapes: [shape], first: new Map(g.first), carded: new Set(g.carded) }); continue; }
    m.shapes.push(shape);
    for (const [k, v] of g.first) if (!m.first.has(k) || m.first.get(k)!.order > v.order) m.first.set(k, v);
    for (const k of g.carded) m.carded.add(k);
  }

  let best: ShapeGroup | null = null;
  for (const g of groups.values()) {
    if (g.carded.size === 0 || g.carded.size < min) continue;
    if (!best || g.carded.size > best.carded.size || (g.carded.size === best.carded.size && g.first.size > best.first.size)) best = g;
  }
  if (!best) return null;
  const winner = best;
  const segs = winner.shapes.map((s) => s.split('/'));
  const shape = segs[0]!.map((x, i) => (segs.every((s) => s[i] === x) ? x : '*')).join('/');
  const urls = [...winner.first.entries()]
    .sort(([ka, a], [kb, b]) => Number(!winner.carded.has(ka)) - Number(!winner.carded.has(kb)) || a.order - b.order)
    .map(([, v]) => v.href);
  return { shape, urls, carded: winner.carded.size };
}

/**
 * The listing's product group (spec 2026-10-20 §3), or null when the page has
 * none — a page of policy links, a blog post, a menu (§3.6). Navigation links
 * (`chrome`) are left out first; when what is left holds no carded group, the
 * whole page is read, so a theme that wraps its grid in `nav` or `aside` is
 * still found (a menu has no prices, so it never qualifies either way). A page
 * with no priced-card group is read again for image cards (§5.2), outside
 * navigation only (a mega-menu's tiles have images): a price-less grid of at
 * least `IMAGE_CARD_MIN` products is still a group.
 */
export function findProductGroup(links: ListingLinks, listingUrl: string): ProductGroup | null {
  try { new URL(listingUrl); } catch { return null; }
  const content = links.anchors.filter((a) => !a.chrome);
  const cards = cardGroup(content, listingUrl, onCard, 1)
    ?? (content.length < links.anchors.length ? cardGroup(links.anchors, listingUrl, onCard, 1) : null)
    // Image cards are read outside navigation only: a menu has images too (a mega-menu's category tiles).
    ?? cardGroup(content, listingUrl, onImageCard, IMAGE_CARD_MIN);

  const resolve = resolver(listingUrl);
  const items = new Map<string, string>();
  for (const it of links.itemList) {
    const r = resolve(it.url);
    if (r && !items.has(r.key)) items.set(r.key, r.href);
  }
  const itemGroup = items.size >= ITEM_LIST_MIN;

  if (cards && itemGroup) {
    const cardKeys = new Set(cards.urls.map((u) => productKey(u)));
    // §3.5: an ItemList that overlaps the card group confirms it; what the cards missed is added after them.
    if ([...items.keys()].some((k) => cardKeys.has(k))) {
      const extra = [...items].filter(([k]) => !cardKeys.has(k)).map(([, href]) => href);
      return { shape: cards.shape, urls: [...cards.urls, ...extra], carded: cards.carded };
    }
  }
  if (itemGroup && (!cards || items.size > cards.carded)) return { shape: null, urls: [...items.values()], carded: items.size };
  return cards ? { shape: cards.shape, urls: cards.urls, carded: cards.carded } : null;
}

/**
 * Runs inside the live listing page, as the capture's `annotate` script (after
 * popups, "show more" and the bounded loading — `readListingPage`), so text and
 * prices read as the page shows them. Per link: its href as written, its text,
 * a title, an image (inside the link, else in the nearest ancestor up to three
 * levels that holds no more than three links), `chrome` for page navigation,
 * `swatch` (§3.4: inside a radio, an `aria-checked` or `data-swatch` element, or
 * an element whose class names a swatch and whose own text shows no price — a
 * card's wrapper named `has-swatches` shows its price; or own text "+N"), and
 * `levels`: the link itself, then up to six ancestors, each with its distinct
 * link paths (`d`, counted to 4) and — when `d` ≤ 3 — an image, a price and its
 * text length. And the JSON-LD ItemList items, with their name and image.
 *
 * `String.raw`: the page receives every backslash as written here. The price
 * pattern is `PRICE_PATTERN`, passed through as its source. A relative href in
 * a page with no base URL (a `setContentEvaluate` test) is counted by its path.
 */
export const LISTING_LINKS_SCRIPT = String.raw`(() => {
  const PRICE = new RegExp(${JSON.stringify(PRICE_PATTERN.source)}, ${JSON.stringify(PRICE_PATTERN.flags)});
  const UP = ${CARD_MAX_LEVELS - 1};
  const MAX_LINKS = ${CARD_MAX_LINKS};
  const ID_NAME = new RegExp(${JSON.stringify(ID_PARAM_NAME.source)}, ${JSON.stringify(ID_PARAM_NAME.flags)});
  const ID_CAMEL = new RegExp(${JSON.stringify(ID_PARAM_CAMEL.source)}, ${JSON.stringify(ID_PARAM_CAMEL.flags)});
  const SCRIPT = new RegExp(${JSON.stringify(SCRIPT_SEGMENT.source)}, ${JSON.stringify(SCRIPT_SEGMENT.flags)});
  // The product key's own rule (keyOf): a literal last segment, or a server script whatever its
  // name, keeps its id-like query params, so a grid of /product?id=N or /product_info.php?products_id=N
  // links is that many link paths, not one.
  const slug = (seg) => { const m = /^(.*?)(\.[a-z]{2,5})$/i.exec(seg); const stem = m ? m[1] : seg; return (/[\d_-]/.test(stem) || stem.length >= 12) && !SCRIPT.test(seg); };
  const pathOf = (href) => {
    try {
      const u = new URL(href, location.href);
      const p = u.pathname.replace(/\/+$/, '').replace(/%[0-9a-f]{2}/gi, (m) => m.toLowerCase());
      if (p !== '' && slug(p.slice(p.lastIndexOf('/') + 1))) return u.host + p;
      const ids = [];
      u.searchParams.forEach((v, n) => { if (ID_NAME.test(n) || ID_CAMEL.test(n)) ids.push(n + '=' + v); });
      ids.sort();
      return u.host + p + (ids.length ? '?' + ids.join('&') : '');
    } catch (e) { return href.split(/[?#]/)[0] || null; }
  };
  const memo = new Map();
  // The first price an element's text shows, kept by level() for each card level that shows one.
  const priceText = new Map();
  const level = (el) => {
    const hit = memo.get(el);
    if (hit) return hit;
    const seen = new Set();
    for (const x of el.querySelectorAll('a[href]')) {
      const p = pathOf(x.getAttribute('href') || '');
      if (p) { seen.add(p); if (seen.size > MAX_LINKS) break; }
    }
    let r;
    if (seen.size > MAX_LINKS) r = { d: seen.size, img: false, price: false, len: 0 };
    else {
      const t = el.innerText || '';
      const m = t.match(PRICE);
      r = { d: seen.size, img: !!el.querySelector('img, picture'), price: !!m, len: t.length };
      if (m) priceText.set(el, m[0]);
    }
    memo.set(el, r);
    return r;
  };
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
  // An element whose class names a swatch and whose own text shows no price — read once per element
  // (as level() is): a grid named "has-swatches" around 2,000 cards is read once, not once per link.
  const swatchMemo = new Map();
  const swatchEl = (el) => {
    let v = swatchMemo.get(el);
    if (v === undefined) { v = /swatch/i.test(el.getAttribute('class') || '') && !PRICE.test(el.innerText || ''); swatchMemo.set(el, v); }
    return v;
  };
  // levels[i] is the element i levels up from the link. The walk stops at the first level that shows
  // a price (a card): every element above it holds that price too, so none is a swatch-without-price.
  const swatch = (a, text, levels) => {
    if (/^\+\s?\d+$/.test(text)) return true;
    if (a.closest('[role=radio], [role=radiogroup], [aria-checked], [data-swatch]')) return true;
    let i = 0;
    for (let el = a; el && el !== document.body; el = el.parentElement, i++) {
      if (levels[i] && levels[i].price) return false;
      if (swatchEl(el)) return true;
    }
    return false;
  };
  // The card's own title (ruling D4): searched in the link and its ancestors while they hold this product's
  // links only (levels[i].d <= 1), lowest first: a heading, then a title/name class, then a name-like image alt.
  const HEADING = 'h1, h2, h3, h4, h5, h6, [role=heading]';
  const TITLE_CLASS = /(?:^|[_-])(?:title|name)$/i;
  const clean = (t) => {
    const s = (t || '').replace(/\s+/g, ' ').trim();
    return s && s.length <= 200 && /\p{L}/u.test(s.replace(PRICE, '')) ? s : '';
  };
  const titled = (el) => Array.from(el.classList || []).some((c) => TITLE_CLASS.test(c));
  const cardName = (a, levels) => {
    const scope = [];
    let el = a;
    for (let i = 0; el && el !== document.body && i < levels.length && levels[i].d <= 1; i++, el = el.parentElement) scope.push(el);
    for (const s of scope) {
      const h = s.matches(HEADING) ? s : s.querySelector(HEADING);
      const t = h ? clean(h.innerText) : '';
      if (t) return t;
    }
    for (const s of scope) {
      const tEl = titled(s) ? s : Array.from(s.querySelectorAll('[class]')).find(titled);
      const t = tEl ? clean(tEl.innerText) : '';
      if (t) return t;
    }
    for (const s of scope) {
      for (const img of s.querySelectorAll('img[alt]')) {
        const t = clean(img.getAttribute('alt'));
        if (t && t.length <= 100 && !/[.!?]$/.test(t)) return t;
      }
    }
    return undefined;
  };
  const anchors = [];
  for (const a of document.querySelectorAll('a[href]')) {
    const text = (a.textContent || '').replace(/\s+/g, ' ').trim();
    const inner = a.querySelector('img');
    const own = a.innerText || '';
    const ownPrice = own.match(PRICE);
    const levels = [{ d: 1, img: !!a.querySelector('img, picture'), price: !!ownPrice, len: own.length }];
    let price = ownPrice ? ownPrice[0] : undefined;
    let el = a.parentElement;
    for (let i = 0; el && el !== document.body && i < UP; i++, el = el.parentElement) {
      levels.push(level(el));
      if (price === undefined && priceText.has(el)) price = priceText.get(el);
    }
    anchors.push({
      href: a.getAttribute('href') || '',
      text: text.slice(0, 200),
      title: a.getAttribute('title') || a.getAttribute('aria-label') || (inner && inner.getAttribute('alt')) || undefined,
      name: cardName(a, levels),
      image: imgUrl(inner || near(a)) || undefined,
      chrome: chrome(a) || undefined,
      swatch: swatch(a, text, levels) || undefined,
      levels,
      price: price ? price.replace(/\s+/g, ' ').trim() : undefined,
    });
  }
  const itemList = [];
  const urlOf = (x) => typeof x === 'string' ? x : (x && typeof x === 'object' ? (typeof x.url === 'string' ? x.url : (typeof x['@id'] === 'string' ? x['@id'] : null)) : null);
  const imageOf = (x) => typeof x === 'string' ? x : (Array.isArray(x) ? imageOf(x[0]) : (x && typeof x === 'object' && typeof x.url === 'string' ? x.url : undefined));
  const isList = (t) => t === 'ItemList' || (Array.isArray(t) && t.indexOf('ItemList') >= 0);
  const walk = (x, depth) => {
    if (depth > 6 || !x || typeof x !== 'object') return;
    if (Array.isArray(x)) { for (const y of x) walk(y, depth + 1); return; }
    if (isList(x['@type']) && Array.isArray(x.itemListElement)) {
      for (const e of x.itemListElement) {
        if (!e) continue;
        const item = typeof e === 'object' && e.item !== undefined ? e.item : e;
        const url = (typeof e === 'object' && typeof e.url === 'string' ? e.url : null) || urlOf(item);
        if (!url) continue;
        const name = item && typeof item === 'object' && typeof item.name === 'string' ? item.name : (typeof e === 'object' && typeof e.name === 'string' ? e.name : undefined);
        itemList.push({ url, name, image: item && typeof item === 'object' ? imageOf(item.image) : undefined });
      }
    }
    if (x['@graph']) walk(x['@graph'], depth + 1);
    if (x.mainEntity) walk(x.mainEntity, depth + 1);
  };
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try { walk(JSON.parse(s.textContent || ''), 0); } catch (e) { /* a broken block is skipped */ }
  }
  return { anchors, itemList };
})()`;

export type ReconciledRows = {
  rows: Array<Record<string, unknown>>;
  /** How many of `rows` came from the page's links alone — they carry only the URL field. */
  added: number;
};

/**
 * Should the listing walk plan from the page's product group instead of (only)
 * the rows its extraction produced? Spec 2026-10-20 §3.9: the walk keeps its
 * own row selector; the group is its cross-check and its rescue when it finds
 * zero rows — on the same terms as before.
 *
 * To rescue a row selector that under-matched (Allbirds, 2026-10-08: one row on
 * a 150-product listing). With at least one extracted URL, the group must be
 * CORROBORATED as product links — an extracted URL, or a known product page
 * (the website's verified proof pages), fits the group's shape — and hold
 * products the extraction missed. With zero rows, only a `directListing` input
 * is rescued, and only when a proof page corroborates the group; a search or
 * template input stays "nothing found". Without corroboration the group is
 * left alone: a walk must never queue menu links.
 *
 * Rows and group meet by product key (§3.4): a row at `/p/a?color=red` covers
 * the group's `/p/a`. Every extracted row is kept with its own address —
 * variants are decided up front, never folded here.
 *
 * Returns `null` when the extraction's rows stand as they are; otherwise the
 * rows to plan from, in the group's order — each product's extracted rows in
 * its place, a product the extraction missed as its URL alone — then any
 * extracted row outside the group.
 */
export function reconcileWithProductGroup(args: {
  rows: Array<Record<string, unknown>>;
  urlField: string;
  group: ProductGroup | null;
  listingUrl: string;
  knownDetailUrls?: string[];
  /** The input is a listing URL the customer gave (input strategy `direct`), not a search or template result. */
  directListing?: boolean;
}): ReconciledRows | null {
  const { rows, urlField, group, listingUrl, knownDetailUrls = [], directListing = false } = args;
  if (!group || group.urls.length === 0) return null;

  const resolve = (v: unknown): string | null => {
    if (typeof v !== 'string' || v.trim() === '') return null;
    // The group's own fragment rule, so a row at `/p/a#sku=…` keeps its variant.
    try { const u = new URL(v, listingUrl); if (!isKeyValueFragment(u.hash)) u.hash = ''; return u.href; } catch { return null; }
  };
  const rowsByKey = new Map<string, Array<Record<string, unknown>>>();
  const seenUrls = new Set<string>();
  const extracted: string[] = [];
  for (const row of rows) {
    const url = resolve(row[urlField]);
    if (!url || seenUrls.has(url)) continue;
    const key = productKey(url);
    if (!key) continue;
    seenUrls.add(url);
    extracted.push(url);
    (rowsByKey.get(key) ?? rowsByKey.set(key, []).get(key)!).push({ ...row, [urlField]: url });
  }
  // Zero rows is rescued only on a listing URL the customer gave directly, and only on the proof
  // pages' word: a stale cached selector that matches nothing must not end the walk, while an
  // empty search/template result page must stay empty.
  if (extracted.length === 0 && !directListing) return null;

  const witnesses = [...extracted, ...knownDetailUrls];
  const fits = (u: string): boolean => (group.shape !== null ? fitsShape(group.shape, u) : group.urls.some((g) => urlShape(g) === urlShape(u)));
  if (!witnesses.some(fits)) return null;

  const groupKeys = group.urls.map((u) => productKey(u));
  const missed = groupKeys.filter((k) => k !== null && !rowsByKey.has(k)).length;
  if (missed === 0) return null;

  const merged: Array<Record<string, unknown>> = [];
  const placed = new Set<string>();
  group.urls.forEach((url, i) => {
    const key = groupKeys[i];
    if (!key || placed.has(key)) return;
    placed.add(key);
    merged.push(...(rowsByKey.get(key) ?? [{ [urlField]: url }]));
  });
  for (const [key, keyed] of rowsByKey) if (!placed.has(key)) merged.push(...keyed);
  return { rows: merged, added: missed };
}
