import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PlaywrightBrowser, okVerdict } from '@robot/browser';
import { LISTING_LINKS_SCRIPT, type CardLevel, type ListingAnchor, type ListingLinks } from '@robot/scraper';
import { describeListingPage, listingProducts } from './find-product-pages.js';

const CARD: CardLevel[] = [{ d: 1, img: true, price: true, len: 40 }];
const carded = (href: string, text: string, extra: Partial<ListingAnchor> = {}): ListingAnchor => ({ href, text, levels: CARD, ...extra });
const links = (anchors: ListingAnchor[], itemList: ListingLinks['itemList'] = []): ListingLinks => ({ anchors, itemList });

describe('describeListingPage', () => {
  const listingUrl = 'https://shop.example/c/shoes';
  // 12 product cards plus 2 category links (no card): the count is the products only.
  const bigGroup = Array.from({ length: 12 }, (_, i) => carded(`/p/air-${i}-123456789012`, `Air ${i}`));
  const smallGroup = [{ href: '/c/running-123456789012', text: 'Running' }, { href: '/c/casual-123456789012', text: 'Casual' }];
  const all = links([...bigGroup, ...smallGroup]);

  it('reports the full group size, a 10-item sample, and pagerSeen true when a pager is present', () => {
    const html = '<html><head><link rel="next" href="?page=2"></head><body></body></html>';
    const result = describeListingPage(all, listingUrl, html, okVerdict(200));
    expect(result.productLinks).toBe(12);
    expect(result.pagerSeen).toBe(true);
    expect(result.sample).toEqual(bigGroup.slice(0, 10).map((a) => new URL(a.href, listingUrl).href));
  });

  it('reports pagerSeen false when the html has no pagination markup', () => {
    const result = describeListingPage(all, listingUrl, '<html><body><p>no pager here</p></body></html>', okVerdict(200));
    expect(result.productLinks).toBe(12);
    expect(result.pagerSeen).toBe(false);
  });

  it('a page with no products is zero, with no sentence of its own (the app says "No products found on this page.")', () => {
    const r = describeListingPage(links([{ href: '/pages/terms', text: 'Terms' }, { href: '/en-gb/', text: 'English' }]), listingUrl, '<html></html>', okVerdict(200));
    expect(r).toMatchObject({ productLinks: 0, sample: [], products: [], message: null });
  });

  it('describeListingPage carries a non-ok verdict and reports no links', () => {
    const r = describeListingPage(links([carded('/p/1', 'A')]), 'https://shop.example/l', '<html></html>', { kind: 'refused', status: 403, vendor: 'cloudflare' });
    expect(r.productLinks).toBe(0);
    expect(r.verdict.kind).toBe('refused');
    expect(r.message).toBe("shop.example refused the browser (HTTP 403, Cloudflare). We can't read this website from here yet.");
  });
});

const L = 'https://shop.example/c/chairs';

describe('listingProducts', () => {
  it('merges the several links to one product, by product: the longest text wins, the first image wins', () => {
    const anchors: ListingAnchor[] = [
      { href: '/p/1?color=red', text: '', image: '/img/1.jpg' },
      { href: '/p/1', text: 'Chair' },
      { href: 'https://shop.example/p/1', text: 'Oak chair, natural' },
      { href: '/p/1?color=blue', text: 'blue — a much longer swatch label', swatch: true },
    ];
    expect(listingProducts(links(anchors), L, ['https://shop.example/p/1?color=red'])).toEqual([{ url: 'https://shop.example/p/1?color=red', title: 'Oak chair, natural', image: 'https://shop.example/img/1.jpg' }]);
  });
  it('falls back to the title attribute, then the ItemList name and image, then the path', () => {
    expect(listingProducts(links([{ href: '/p/2', text: '', title: 'Pine stool' }]), L, ['https://shop.example/p/2'])).toEqual([{ url: 'https://shop.example/p/2', title: 'Pine stool' }]);
    expect(listingProducts(links([], [{ url: '/p/4', name: 'Ash table', image: '/img/4.jpg' }]), L, ['https://shop.example/p/4'])).toEqual([{ url: 'https://shop.example/p/4', title: 'Ash table', image: 'https://shop.example/img/4.jpg' }]);
    expect(listingProducts(links([{ href: '/p/3', text: '  ' }]), L, ['https://shop.example/p/3'])).toEqual([{ url: 'https://shop.example/p/3', title: '/p/3' }]);
  });
  it('drops an image that is not http(s) and keeps the order of the urls asked for', () => {
    const anchors: ListingAnchor[] = [{ href: '/p/b', text: 'B', image: 'data:image/png;base64,xx' }, { href: '/p/a', text: 'A' }];
    expect(listingProducts(links(anchors), L, ['https://shop.example/p/a', 'https://shop.example/p/b']).map((p) => [p.title, p.image])).toEqual([['A', undefined], ['B', undefined]]);
  });
});

describe('LISTING_LINKS_SCRIPT in Chromium (offline page)', () => {
  let browser: PlaywrightBrowser;
  beforeAll(async () => { browser = new PlaywrightBrowser(); await browser.launch({ headless: true }); });
  afterAll(async () => { await browser.close(); });

  it('reads an image inside the link, a lazy one, and one beside the link in the same card', async () => {
    const html = `<html><body>
      <a href="/p/1"><img src="/i/1.jpg"><span>Oak chair</span></a>
      <a href="/p/2" aria-label="Pine stool"><img data-src="/i/2.jpg"></a>
      <div class="card"><img src="/i/3.jpg"><a href="/p/3">Birch table</a></div>
    </body></html>`;
    const { anchors } = await browser.setContentEvaluate<ListingLinks>(html, LISTING_LINKS_SCRIPT);
    const byHref = Object.fromEntries(anchors.map((a) => [a.href, a]));
    expect(byHref['/p/1']).toMatchObject({ text: 'Oak chair', image: '/i/1.jpg' });
    expect(byHref['/p/2']).toMatchObject({ title: 'Pine stool', image: '/i/2.jpg' });
    expect(byHref['/p/3']).toMatchObject({ text: 'Birch table', image: '/i/3.jpg' });
  });

  it('flags nav, role=navigation, aside and page-level header/footer links, but not a header inside a product card', async () => {
    const html = `<html><body>
      <header><a href="/c/top">Top</a></header>
      <nav><a href="/c/nav">Nav</a></nav>
      <div role="navigation"><a href="/c/role">Role</a></div>
      <ul role="Navigation menubar"><li><a href="/c/menubar">Menubar</a></li></ul>
      <aside><a href="/c/side">Side</a></aside>
      <main><article><header><a href="/p/card">Card</a></header></article><a href="/p/grid">Grid</a></main>
      <footer><a href="/c/foot">Foot</a></footer>
    </body></html>`;
    const { anchors } = await browser.setContentEvaluate<ListingLinks>(html, LISTING_LINKS_SCRIPT);
    const chrome = Object.fromEntries(anchors.map((a) => [a.href, a.chrome === true]));
    expect(chrome).toEqual({ '/c/top': true, '/c/nav': true, '/c/role': true, '/c/menubar': true, '/c/side': true, '/p/card': false, '/p/grid': false, '/c/foot': true });
  });

  it('a priced card with an image is a card level; a tile without a price is not', async () => {
    const html = `<html><body><ul>
      <li><a href="/p/1"><img src="/i/1.jpg"><span>Oak chair</span></a><span>$129.99</span></li>
      <li><a href="/c/sofas"><img src="/i/2.jpg"><span>Sofas</span></a></li>
    </ul></body></html>`;
    const { anchors } = await browser.setContentEvaluate<ListingLinks>(html, LISTING_LINKS_SCRIPT);
    const level1 = (href: string) => anchors.find((a) => a.href === href)!.levels![1];
    expect(level1('/p/1')).toMatchObject({ d: 1, img: true, price: true });
    expect(level1('/c/sofas')).toMatchObject({ d: 1, img: true, price: false });
  });
});
