// The finder's rule (spec 2026-10-20 §3), pure. The harvest table is the evidence: per-link
// features read from 13 live listings on 2026-10-20 (docs/testing/results/2026-10-20-finder-links/),
// fed through the rule exactly as the page script would hand them over.
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  asListingLinks, CARD_MAX_LEVELS, findProductGroup, fitsShape, onCard, PRICE_PATTERN, productKey, productPathShape, urlShape,
  type CardLevel, type ListingAnchor, type ListingLinks,
} from './product-link-group.js';

const HARVESTS = new URL('../../../../docs/testing/results/2026-10-20-finder-links/harvests/', import.meta.url);
type Harvest = {
  url: string;
  anchors: Array<{ href: string; text: string; chrome: boolean; swatch: boolean; selfPrice: boolean; selfImg: boolean; lv: CardLevel[] }>;
  itemList: Array<string | null>;
};
/** A harvest as `ListingLinks`. Its `lv` starts at the parent; the link itself (its own image and price) is level 0, whose text length was not kept (0). */
function harvest(name: string): { url: string; links: ListingLinks } {
  const h = JSON.parse(readFileSync(new URL(`${name}.json`, HARVESTS), 'utf8')) as Harvest;
  return {
    url: h.url,
    links: {
      anchors: h.anchors.map((a) => ({
        href: a.href, text: a.text, chrome: a.chrome || undefined, swatch: a.swatch || undefined,
        levels: [{ d: 1, img: a.selfImg, price: a.selfPrice, len: 0 }, ...a.lv.slice(0, CARD_MAX_LEVELS - 1)],
      })),
      itemList: h.itemList.filter((u): u is string => typeof u === 'string').map((url) => ({ url })),
    },
  };
}

const CARD: CardLevel[] = [{ d: 1, img: true, price: true, len: 40 }];
const TILE: CardLevel[] = [{ d: 1, img: true, price: false, len: 20 }];
const carded = (href: string, extra: Partial<ListingAnchor> = {}): ListingAnchor => ({ href, text: 'x', levels: CARD, ...extra });
const plain = (href: string, extra: Partial<ListingAnchor> = {}): ListingAnchor => ({ href, text: 'x', ...extra });
const links = (anchors: ListingAnchor[], itemList: ListingLinks['itemList'] = []): ListingLinks => ({ anchors, itemList });
const L = 'https://shop.example/collections/sofas';
const paths = (urls: string[]) => urls.map((u) => { const x = new URL(u); return x.pathname + x.search + x.hash; });

describe('the 13 campaign listings (harvests, 2026-10-20)', () => {
  // [harvest, shape, products offered, of them on cards] — null: no products (§3.6).
  const TABLE: Array<[string, string | null, number, number]> = [
    ['bombas', 'bombas.com/products/*', 27, 3],
    ['burrow', 'burrow.com/products/*', 25, 25],
    ['gymshark', 'gymshark.com/products/*', 64, 64],
    ['ikea', 'ikea.com/my/en/p/*', 89, 52],
    ['ikea-blog', null, 0, 0],
    ['lacoste', 'lacoste.com/gb/lacoste/men/clothing/*/*/*.html', 13, 13],
    ['noths', 'notonthehighstreet.com/*/product/*', 60, 60],
    ['puma', 'us.puma.com/us/en/pd/*/*', 14, 14],
    ['ridge', null, 0, 0],
    ['ruggable', 'ruggable.com/products/*', 47, 47],
    ['skullcandy', 'skullcandy.com/products/*', 41, 39],
    ['thomann', 'thomann.de/de/*.htm', 51, 51],
    ['thomann-cat', 'thomann.de/de/*.htm', 99, 99],
  ];
  for (const [name, shape, n, onCards] of TABLE) {
    it(`${name}: ${shape === null ? 'no products' : `${n} products (${onCards} on cards), ${shape}`}`, () => {
      const { url, links: l } = harvest(name);
      const g = findProductGroup(l, url);
      if (shape === null) { expect(g).toBeNull(); return; }
      expect(g).not.toBeNull();
      expect(g!.shape).toBe(shape);
      expect(g!.urls).toHaveLength(n);
      expect(g!.carded).toBe(onCards);
      expect(new Set(g!.urls.map(productKey)).size).toBe(n); // one address per product
    });
  }

  it('bombas: the products, never the /collections/ menu that won before', () => {
    const { url, links: l } = harvest('bombas');
    const g = findProductGroup(l, url)!;
    expect(g.urls.every((u) => new URL(u).pathname.startsWith('/products/'))).toBe(true);
    // Carded first: the three cards whose image had loaded lead the list.
    expect(paths(g.urls.slice(0, 1))).toEqual(['/products/mens-merino-wool-socks?variant=rouge']);
  });

  it('noths: the seller-segment shapes merge without the ItemList too (§3.3)', () => {
    const { url, links: l } = harvest('noths');
    const g = findProductGroup({ ...l, itemList: [] }, url)!;
    expect(g.shape).toBe('notonthehighstreet.com/*/product/*');
    expect(g.urls).toHaveLength(60);
  });

  it('lacoste: four products in several colours are one address each, the first seen', () => {
    const { url, links: l } = harvest('lacoste');
    const g = findProductGroup(l, url)!;
    expect(paths(g.urls.slice(0, 1))).toEqual(['/gb/lacoste/men/clothing/polo-shirts/short-sleeves/L1212-00.html?color=02S']);
  });

  it('puma: the ItemList (24 entries, 14 products) confirms the cards and adds nothing', () => {
    const { url, links: l } = harvest('puma');
    expect(l.itemList).toHaveLength(24);
    const g = findProductGroup(l, url)!;
    expect(g.urls).toHaveLength(14);
    expect(g.shape).toBe('us.puma.com/us/en/pd/*/*');
  });
});

describe('productPathShape (§3.1)', () => {
  it('blanks whole segments with a digit, - or _, or of 12+ characters; keeps words and extensions', () => {
    expect(productPathShape('/products/union-3-seat-sofa')).toBe('/products/*');
    expect(productPathShape('/products/range-plus-armchair')).toBe('/products/*');
    expect(productPathShape('/gb/men/polo-shirts/short-sleeves/L1212-00.html')).toBe('/gb/men/*/*/*.html');
    expect(productPathShape('/gb/men/polo-shirts/long-sleeve/PH2481-00.html')).toBe('/gb/men/*/*/*.html');
    expect(productPathShape('/de/yamaha_c40_konzertgitarre.htm')).toBe('/de/*.htm');
    expect(productPathShape('/de/e-gitarren.html')).toBe('/de/*.html');
    expect(productPathShape('/products/set')).toBe('/products/set');
    expect(productPathShape('/collections/everything')).toBe('/collections/everything');
    expect(productPathShape('/collections/accessoriesall')).toBe('/collections/*');
    expect(productPathShape('/')).toBe('/');
    expect(productPathShape('/p/9/')).toBe('/p/*');
  });
  it('urlShape keeps the host (without www.) and drops the query and fragment', () => {
    expect(urlShape('https://www.shop.example/products/oak-chair?color=red#reviews')).toBe('shop.example/products/*');
    expect(urlShape('mailto:a@b.example')).toBeNull();
    expect(urlShape('not a url')).toBeNull();
  });
  it('fitsShape: `*` takes any one segment, never the host; segment counts must match', () => {
    expect(fitsShape('shop.example/*/product/*', 'https://shop.example/oakhouse/product/oak-chair')).toBe(true);
    expect(fitsShape('shop.example/products/*', 'https://www.shop.example/products/oak-chair')).toBe(true);
    expect(fitsShape('shop.example/products/*', 'https://shop.example/pages/about')).toBe(false);
    expect(fitsShape('shop.example/products/*', 'https://other.example/products/oak-chair')).toBe(false);
    expect(fitsShape('shop.example/products/*', 'https://shop.example/products/a-b/reviews')).toBe(false);
  });
});

describe('PRICE_PATTERN (§3.2)', () => {
  it('reads a number with a currency next to it, in common locale formats', () => {
    for (const s of ['$1,234.50', '1.234,50 €', '1 234,50 €', 'RM810.00', 'MYR 620', '£25', '₹1,299', '¥3,980', '199 kr', '199kr', 'CHF 49.90', '49,90 CHF', 'US$ 20', 'From $99']) {
      expect(PRICE_PATTERN.test(s), s).toBe(true);
    }
  });
  it('is not fooled by ratings, sizes, counts, discounts, years or words that hold a code', () => {
    for (const s of ['4.5 stars', 'Size 10', '2 colours', '-20%', '© 2026', '+2', 'Europe 2026', '12 Kraków', 'Free shipping', 'Rso 5']) {
      expect(PRICE_PATTERN.test(s), s).toBe(false);
    }
  });
  it('reads Rs. before a number, and an uppercase code glued to a name ("sierra rugRM810.00", inline spans in innerText)', () => {
    for (const s of ['Rs. 1,299', 'Rs.499', 'Rs 499', 'sierra rugRM810.00', 'oak chairMYR 620', 'teeUSD 20', 'teeUS$ 20']) {
      expect(PRICE_PATTERN.test(s), s).toBe(true);
    }
  });
  it('codes are case-sensitive: words that merely look like a code in another case are not prices', () => {
    for (const s of ['Try 2 colours', '6 ft sofa', 'rm 2', 'Sek 5', '12 rs', 'R 50', 'R50', 'eur 5', 'usd 5', 'BRUSD 5', 'Chf 5']) {
      expect(PRICE_PATTERN.test(s), s).toBe(false);
    }
  });
});

describe('productKey and onCard', () => {
  it('a product is host + path: query, fragment, trailing slash and www. do not make another', () => {
    expect(productKey('https://www.shop.example/p/oak-chair/?color=red#sku=1')).toBe('shop.example/p/oak-chair');
    expect(productKey('https://shop.example/p/oak-chair')).toBe('shop.example/p/oak-chair');
    expect(productKey('javascript:void(0)')).toBeNull();
  });
  it('a literal last segment (or no path) keeps its id-like query params, sorted; a slug path drops the query (§3.4 amended)', () => {
    expect(productKey('https://shop.example/product?id=12&color=red')).toBe('shop.example/product?id=12');
    expect(productKey('https://shop.example/item.php?id=7')).toBe('shop.example/item.php?id=7');
    expect(productKey('https://shop.example/index.php?route=product/product&product_id=5&path=20'))
      .toBe('shop.example/index.php?product_id=5&route=product/product');
    expect(productKey('https://www.shop.example/?product=oak-chair&utm_source=x')).toBe('shop.example?product=oak-chair');
    expect(productKey('https://shop.example/catalog?pid=3&sku=A1&itemId=9&code=x&item=4&page=2'))
      .toBe('shop.example/catalog?code=x&item=4&itemId=9&pid=3&sku=A1');
    expect(productKey('https://shop.example/products/oak-chair?id=12')).toBe('shop.example/products/oak-chair');
    expect(productKey('https://shop.example/product?color=red')).toBe('shop.example/product');
  });
  it('a script named like a slug (.php .aspx .asp .jsp .cfm .cgi .pl) keeps its id-like query params too (final review I1)', () => {
    expect(productKey('https://shop.example/product_info.php?products_id=12&osCsid=abc')).toBe('shop.example/product_info.php?products_id=12');
    expect(productKey('https://shop.example/ProductDetails.aspx?ProductID=7&utm_source=x')).toBe('shop.example/ProductDetails.aspx?ProductID=7');
    expect(productKey('https://shop.example/shop/product-detail.php?id=3')).toBe('shop.example/shop/product-detail.php?id=3');
    expect(productKey('https://shop.example/cgi-bin/show_item.cgi?itemid=9')).toBe('shop.example/cgi-bin/show_item.cgi?itemid=9');
    expect(productKey('https://shop.example/item?ID=3')).toBe('shop.example/item?ID=3');
    // Not a script: a slug page's query is still a copy of one product.
    expect(productKey('https://shop.example/p/oak-chair.html?id=12')).toBe('shop.example/p/oak-chair.html');
  });
  it('a card is a level with at most 3 link paths, under 800 characters, an image and a price — within 7 levels', () => {
    expect(onCard(CARD)).toBe(true);
    expect(onCard(TILE)).toBe(false); // an image alone is not a card (category tiles)
    expect(onCard([{ d: 4, img: true, price: true, len: 40 }])).toBe(false);
    expect(onCard([{ d: 1, img: true, price: true, len: 800 }])).toBe(false);
    expect(onCard([...Array.from({ length: 7 }, () => ({ d: 1, img: false, price: false, len: 0 })), CARD[0]!])).toBe(false);
    expect(onCard(undefined)).toBe(false);
  });
  it('asListingLinks reads garbage as no links', () => {
    expect(asListingLinks(undefined)).toEqual({ anchors: [], itemList: [] });
    expect(asListingLinks([1, 2])).toEqual({ anchors: [], itemList: [] });
    expect(asListingLinks({ anchors: [{ href: '/p/a' }, { nope: 1 }, null], itemList: [{ url: '/p/b' }, 'x'] }))
      .toEqual({ anchors: [{ href: '/p/a', text: '' }], itemList: [{ url: '/p/b' }] });
  });
});

describe('findProductGroup (§3.2–§3.6)', () => {
  it('a menu of 40 links beside a priced grid of 12: the grid', () => {
    const menu = Array.from({ length: 40 }, (_, i) => plain(`/collections/category-${i}`));
    const grid = Array.from({ length: 12 }, (_, i) => carded(`/products/oak-chair-${i}`));
    const g = findProductGroup(links([...menu, ...grid]), L)!;
    expect(g.shape).toBe('shop.example/products/*');
    expect(paths(g.urls)).toEqual(grid.map((a) => a.href));
  });
  it('a page of 4 image-only category tiles: no products', () => {
    expect(findProductGroup(links(Array.from({ length: 4 }, (_, i) => ({ href: `/collections/sofas-${i}`, text: 'x', levels: TILE }))), L)).toBeNull();
  });
  it('a price-less listing of 8 image cards: 8 products (the image-card fallback, spec §5.2)', () => {
    const grid = Array.from({ length: 8 }, (_, i) => ({ href: `/products/oak-chair-${i}`, text: 'x', levels: TILE }));
    const g = findProductGroup(links([...Array.from({ length: 20 }, (_, i) => plain(`/pages/info-${i}`)), ...grid]), L)!;
    expect(g.shape).toBe('shop.example/products/*');
    expect(paths(g.urls)).toEqual(grid.map((a) => a.href));
    expect(g.carded).toBe(8);
  });
  it('image cards fall back only from 6 distinct products, and a priced group always wins over them', () => {
    expect(findProductGroup(links(Array.from({ length: 5 }, (_, i) => ({ href: `/products/oak-chair-${i}`, text: 'x', levels: TILE }))), L)).toBeNull();
    const tiles = Array.from({ length: 20 }, (_, i) => ({ href: `/collections/sofas-${i}`, text: 'x', levels: TILE }));
    const g = findProductGroup(links([...tiles, carded('/products/a-1'), carded('/products/b-2')]), L)!;
    expect(g.shape).toBe('shop.example/products/*');
    expect(g.urls).toHaveLength(2);
  });
  it('image tiles in navigation never count, however many (a mega-menu; as in the ridge harvest)', () => {
    const menu = Array.from({ length: 12 }, (_, i) => ({ href: `/collections/wallets-${i}`, text: 'x', levels: TILE, chrome: true }));
    expect(findProductGroup(links([...menu, plain('/pages/about')]), L)).toBeNull();
  });
  it('image cards: one product per path, ranked by the products on image cards, not by raw links', () => {
    const grid = ['a', 'b', 'c', 'd', 'e', 'f'].flatMap((c) => [
      { href: `/p/item-${c}?color=red`, text: 'x', levels: TILE },
      { href: `/p/item-${c}?color=blue`, text: 'x', levels: TILE },
    ]);
    const menu = Array.from({ length: 30 }, (_, i) => plain(`/c/menu-${i}`));
    const g = findProductGroup(links([...menu, ...grid]), L)!;
    expect(g.shape).toBe('shop.example/p/*');
    expect(paths(g.urls)).toEqual(['a', 'b', 'c', 'd', 'e', 'f'].map((c) => `/p/item-${c}?color=red`));
  });
  it('policy pages, a language link and a blog post: no products', () => {
    expect(findProductGroup(links([plain('/pages/terms'), plain('/policies/refund-policy'), plain('/en-gb/'), plain('/blogs/news/a-story')]), L)).toBeNull();
  });
  it('one product in four colours is one product; the first address seen is the one offered', () => {
    const g = findProductGroup(links(['red', 'blue', 'green', 'black'].flatMap((c) => [carded(`/p/polo-a?color=${c}`), carded(`/p/polo-b?color=${c}`)])), L)!;
    expect(paths(g.urls)).toEqual(['/p/polo-a?color=red', '/p/polo-b?color=red']);
  });
  it('swatch links and "+2" are not products', () => {
    const g = findProductGroup(links([carded('/products/rug-a'), carded('/products/rug-a-blue', { swatch: true }), carded('/products/rug-b'), carded('/products/rug-c')]), L)!;
    expect(paths(g.urls)).toEqual(['/products/rug-a', '/products/rug-b', '/products/rug-c']);
  });
  it('a key=value fragment stays on the first address; a later variant of the same path folds into it (§3.4 over 2026-10-14 §8)', () => {
    const g = findProductGroup(links([
      carded('https://shop.example/products/alpha-runner-shoe#sku=a-blue'),
      carded('https://shop.example/products/bravo-runner-shoe#reviews'),
      carded('https://shop.example/products/charlie-runner-shoe'),
      carded('https://shop.example/products/charlie-runner-shoe#sku=c-red'),
    ]), L)!;
    expect(g.urls).toEqual([
      'https://shop.example/products/alpha-runner-shoe#sku=a-blue',
      'https://shop.example/products/bravo-runner-shoe',
      'https://shop.example/products/charlie-runner-shoe',
    ]);
  });
  it('the listing itself, the root, other hosts and non-http links are never products', () => {
    const g = findProductGroup(links([carded(L), carded(`${L}?page=2`), carded('/'), carded('https://other.example/products/a-b'), carded('javascript:void(0)'),
      carded('/products/a-1'), carded('/products/b-2'), carded('/products/c-3')]), L)!;
    expect(paths(g.urls)).toEqual(['/products/a-1', '/products/b-2', '/products/c-3']);
  });
  it('three seller shapes with carded products merge; two do not; shapes without cards never do (§3.3)', () => {
    const sellers = (names: string[]) => names.flatMap((s) => [carded(`/${s}/product/oak-chair`), carded(`/${s}/product/pine-stool`)]);
    const three = findProductGroup(links(sellers(['oakhouse', 'fernly', 'marlow'])), L)!;
    expect(three.shape).toBe('shop.example/*/product/*');
    expect(three.urls).toHaveLength(6);
    const two = findProductGroup(links(sellers(['oakhouse', 'fernly'])), L)!;
    expect(two.urls).toHaveLength(2);
    // A seller showing one product joins a merge three sellers with two each qualify (noths: 7 of 17 sellers);
    // three sellers showing one product each do not qualify one.
    const plusOne = findProductGroup(links([...sellers(['oakhouse', 'fernly', 'marlow']), carded('/tindle/product/ash-table')]), L)!;
    expect(plusOne.urls).toHaveLength(7);
    const singles = findProductGroup(links(['oakhouse', 'fernly', 'marlow'].map((s) => carded(`/${s}/product/oak-chair`))), L)!;
    expect(singles.urls).toHaveLength(1);
    const menu = findProductGroup(links([...['a', 'b', 'c'].map((s) => plain(`/${s}/product/x-1`)), carded('/products/p-1')]), L)!;
    expect(menu.shape).toBe('shop.example/products/*');
  });
  it('a merge needs a literal segment in its shape and 2+ carded products per member: cards linking a sale and a brand are not three "shapes" (§3.3)', () => {
    const cards = Array.from({ length: 10 }, (_, i) => [carded(`/products/chair-${i}`), carded('/collections/sale-items'), carded('/brands/acme-co')]).flat();
    const menu = Array.from({ length: 30 }, (_, i) => plain(`/collections/cat-${i}`));
    const g = findProductGroup(links([...menu, ...cards]), L)!;
    expect(g.shape).toBe('shop.example/products/*');
    expect(paths(g.urls)).toEqual(Array.from({ length: 10 }, (_, i) => `/products/chair-${i}`));
    // Nothing merges into `*/*` even when every member has carded products.
    const loose = findProductGroup(links(['alpha', 'bravo', 'charlie'].flatMap((s) => [carded(`/${s}/oak-chair`), carded(`/${s}/pine-stool`)])), L)!;
    expect(loose.shape).not.toBe('shop.example/*/*');
    expect(loose.urls).toHaveLength(2);
  });
  describe('products named by a query id (§3.4 amended): 12 products each, the listing itself left out', () => {
    const twelve = (href: (i: number) => string) => Array.from({ length: 12 }, (_, i) => carded(href(i + 1)));
    const CASES: Array<[string, string, (i: number) => string, string]> = [
      ['/product?id=N', 'https://shop.example/catalog?category=5', (i) => `/product?id=${i}`, 'shop.example/product'],
      ['/item.php?id=N', 'https://shop.example/list.php?cat=3', (i) => `/item.php?id=${i}`, 'shop.example/item.php'],
      ['a route-and-id shop (/index.php?route=…&product_id=N)', 'https://shop.example/index.php?route=product/category&path=20', (i) => `/index.php?route=product/product&product_id=${i}`, 'shop.example/index.php'],
      ['/?product=slug', 'https://shop.example/?category=sofas', (i) => `/?product=oak-chair-${i}`, 'shop.example/'],
      // A script named like a slug, or an upper-case id (final review I1): the query still names the product.
      ['/product_info.php?products_id=N', 'https://shop.example/index.php?cPath=3', (i) => `/product_info.php?products_id=${i}`, 'shop.example/*.php'],
      ['/ProductDetails.aspx?ProductID=N', 'https://shop.example/SearchResults.aspx?CategoryID=7', (i) => `/ProductDetails.aspx?ProductID=${i}`, 'shop.example/*.aspx'],
      ['/shop/product-detail.php?id=N', 'https://shop.example/shop/category.php?cat=2', (i) => `/shop/product-detail.php?id=${i}`, 'shop.example/shop/*.php'],
      ['/item?ID=N', 'https://shop.example/list?cat=4', (i) => `/item?ID=${i}`, 'shop.example/item'],
    ];
    for (const [name, listing, href, shape] of CASES) {
      it(name, () => {
        const self = new URL(listing);
        const g = findProductGroup(links([carded(self.pathname + self.search), carded(`${self.pathname + self.search}&page=2`), ...twelve(href)]), listing)!;
        expect(g.shape).toBe(shape);
        expect(paths(g.urls)).toEqual(Array.from({ length: 12 }, (_, i) => href(i + 1)));
        expect(g.carded).toBe(12);
      });
    }
  });
  it('ranks by products on cards, not by raw links', () => {
    const many = Array.from({ length: 30 }, (_, i) => plain(`/products/menu-item-${i}`));
    const few = Array.from({ length: 5 }, (_, i) => carded(`/p/real-${i}`));
    expect(findProductGroup(links([...many, ...few]), L)!.shape).toBe('shop.example/p/*');
  });
  it('offers the products on cards first, then the same shape\'s links whose card has not loaded, each in page order', () => {
    const g = findProductGroup(links([plain('/products/lazy-1'), carded('/products/card-1'), plain('/products/lazy-2'), carded('/products/card-2')]), L)!;
    expect(paths(g.urls)).toEqual(['/products/card-1', '/products/card-2', '/products/lazy-1', '/products/lazy-2']);
    expect(g.carded).toBe(2);
  });
  it('a grid wrapped in navigation is still found when nothing outside it is a card', () => {
    const grid = Array.from({ length: 5 }, (_, i) => carded(`/products/shoe-${i}`, { chrome: true }));
    expect(findProductGroup(links([...grid, plain('/pages/about')]), L)!.urls).toHaveLength(5);
  });
  it('ItemList only (products are not links): its items are the group, shape null (§3.5)', () => {
    const g = findProductGroup(links([plain('/pages/terms')], ['/p/a-1', '/p/b-2', '/p/c-3', '/p/a-1'].map((url) => ({ url }))), L)!;
    expect(g).toEqual({ shape: null, urls: ['https://shop.example/p/a-1', 'https://shop.example/p/b-2', 'https://shop.example/p/c-3'], carded: 3 });
  });
  it('ItemList: same site only, relative resolved, three or more', () => {
    expect(findProductGroup(links([], [{ url: 'https://cdn.example/p/a-1' }, { url: 'https://cdn.example/p/b-2' }, { url: '/p/c-3' }, { url: '/p/d-4' }]), L)).toBeNull();
    expect(findProductGroup(links([], [{ url: 'p/a-1' }, { url: 'https://www.shop.example/p/b-2' }, { url: '/p/c-3' }]), L)!.urls)
      .toEqual(['https://shop.example/collections/p/a-1', 'https://www.shop.example/p/b-2', 'https://shop.example/p/c-3']);
  });
  it('an ItemList that overlaps the cards confirms them and adds what they missed; one that does not and is larger wins', () => {
    const cards = [carded('/p/a-1'), carded('/p/b-2')];
    const overlap = findProductGroup(links(cards, ['/p/a-1', '/p/c-3', '/p/d-4'].map((url) => ({ url }))), L)!;
    expect(paths(overlap.urls)).toEqual(['/p/a-1', '/p/b-2', '/p/c-3', '/p/d-4']);
    expect(overlap.shape).toBe('shop.example/p/*');
    const apart = findProductGroup(links(cards, ['/item/x-1', '/item/y-2', '/item/z-3'].map((url) => ({ url }))), L)!;
    expect(apart.shape).toBeNull();
    expect(paths(apart.urls)).toEqual(['/item/x-1', '/item/y-2', '/item/z-3']);
  });
  it('an unparseable listing address is no products, not a throw', () => {
    expect(findProductGroup(links([carded('/p/a-1')]), 'not a url')).toBeNull();
  });
});

describe('isIdParam never takes a word that merely ends in "id" (controller, fix round; final review I1)', () => {
  it('keeps id-like names in any case and drops paid / grid / valid', async () => {
    const { isIdParam } = await import('./product-link-group.js');
    for (const n of ['id', 'ID', 'Id', 'pid', 'PID', 'sku', 'SKU', 'item', 'Item', 'product', 'code', 'route', 'product_id', 'products_id', 'item-id',
      'itemId', 'productID', 'ProductID', 'productid', 'PRODUCTID', 'itemid', 'articleid', 'goodsid', 'prodid', 'id_product', 'id-item']) expect(isIdParam(n), n).toBe(true);
    for (const n of ['paid', 'PAID', 'Paid', 'grid', 'Grid', 'valid', 'VALID', 'Id2', 'color', 'squid', 'android', 'osCsid', 'video', 'idea']) expect(isIdParam(n), n).toBe(false);
  });
});
