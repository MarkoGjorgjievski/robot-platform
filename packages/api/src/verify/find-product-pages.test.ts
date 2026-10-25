import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PlaywrightBrowser, okVerdict } from '@robot/browser';
import { LISTING_LINKS_SCRIPT, type CardLevel, type ListingAnchor, type ListingLinks } from '@robot/scraper';
import { describeListingPage, listingProducts, proofProductOrder, productBaseName, sameProduct } from './find-product-pages.js';

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

// Ruling D1 (first run 2026-10-25): the three proof pages differ. On a listing whose first cards are
// colourways of one product (same name, same price), Price could not be verified. A Gymshark-like grid.
const G = 'https://shop.example/collections/leggings';
const card = (slug: string, text: string, price?: string): ListingAnchor => carded(`/products/${slug}`, text, price ? { price } : {});
const gym = [
  card('everyday-seamless-leggings-blue-aw26', 'Everyday Seamless Leggings', '£38'),
  card('everyday-seamless-leggings-brown-aw26', 'Everyday Seamless Leggings', '£38'),
  card('everyday-seamless-flared-legging-black-aw25', 'Everyday Seamless Flared Leggings', '£38'),
  card('everyday-seamless-leggings-purple-aw25', 'Everyday Seamless Leggings', '£38'),
  card('minimal-sports-bra-2-0-black-aw26', 'Minimal Sports Bra 2.0', '£30'),
  card('everyday-seamless-shorts-black-aw23', 'Everyday Seamless Shorts', '£30'),
];
const slugOf = (u: string) => new URL(u).pathname.split('/').pop();

describe('productBaseName', () => {
  it('drops a trailing colour or variant part, a price and the case', () => {
    expect(productBaseName('GLOSTAD 3-seat sofa - Knisa dark grey')).toBe(productBaseName('Glostad 3-seat sofa – Blekinge white'));
    expect(productBaseName('Everyday Seamless Leggings Black')).toBe(productBaseName('Everyday Seamless Leggings'));
    expect(productBaseName('Oak chair (Light Beige)')).toBe('oak chair');
    expect(productBaseName('Option: GLOSTAD, 3-seat sofa, Knisa dark grey')).toBe(productBaseName('Option: GLOSTAD, 3-seat sofa, Blekinge white'));
    expect(productBaseName('NewVALNÄS 3-seat sofaRM2,995')).toBe(productBaseName('NewVALNÄS 3-seat sofa RM 2,495'));
    expect(productBaseName('Everyday Seamless Leggings')).not.toBe(productBaseName('Everyday Seamless Flared Leggings'));
  });
});

describe('sameProduct (first run, re-run 1)', () => {
  it('IKEA colourways are one product, however the name is punctuated', () => {
    expect(sameProduct('GLOSTAD 3-seat sofa, Knisa dark grey', 'GLOSTAD 3-seat sofa, Knisa medium blue')).toBe(true);
    expect(sameProduct('GLOSTAD 3-seat sofa, Knisa dark grey', 'GLOSTAD, 3-seat sofa, Knisa medium blue')).toBe(true);
    expect(sameProduct('GLOSTAD 3-seat sofa - Knisa dark grey', 'GLOSTAD 3-seat sofa | Knisa medium blue')).toBe(true);
    expect(sameProduct('GLOSTAD 3-seat sofa, Knisa dark grey', 'Option: GLOSTAD, 3-seat sofa, Knisa medium blue')).toBe(true);
    expect(sameProduct('KIVIK 3-seat sofa, Tibbleby beige/grey', 'KIVIK 3-seat sofa – Tresund anthracite')).toBe(true);
  });
  it('different products stay different', () => {
    expect(sameProduct('Crusher 720', 'Crusher 540')).toBe(false);
    expect(sameProduct('Crusher® 720 - Primer', 'Crusher® 540 - Primer')).toBe(false);
    expect(sameProduct('GLOSTAD 3-seat sofa, Knisa dark grey', 'KIVIK 3-seat sofa, Tibbleby beige/grey')).toBe(false);
    expect(sameProduct('GLOSTAD 3-seat sofa, Knisa dark grey', 'GLOSTAD 2-seat sofa, Knisa dark grey')).toBe(false);
    expect(sameProduct('Everyday Seamless Leggings', 'Everyday Seamless Flared Leggings')).toBe(false);
  });
  it('the board never takes two IKEA colourways as proof pages', () => {
    const items = [
      ['g-1', 'GLOSTAD 3-seat sofa, Knisa dark grey', 'RM449'], ['g-2', 'GLOSTAD, 3-seat sofa, Knisa medium blue', 'RM449'],
      ['k-3', 'KIVIK 3-seat sofa, Tibbleby beige/grey', 'RM1,495'], ['e-4', 'EKTORP 3-seat sofa, Hallarp grey', 'RM1,295'],
    ].map(([url, title, price]) => ({ url: url!, title: title!, price }));
    expect(proofProductOrder(items).slice(0, 3)).toEqual(['g-1', 'k-3', 'e-4']);
  });
});

describe('proofProductOrder: three proof pages that differ (ruling D1)', () => {
  it('on a colourway grid, the first three cards whose names differ and whose prices are not all equal come first; the rest keep listing order', () => {
    const r = describeListingPage(links(gym), G, '<html></html>', okVerdict(200));
    expect(r.products.slice(0, 3).map((p) => slugOf(p.url))).toEqual([
      'everyday-seamless-leggings-blue-aw26', 'everyday-seamless-flared-legging-black-aw25', 'minimal-sports-bra-2-0-black-aw26',
    ]);
    expect(r.products.slice(3).map((p) => slugOf(p.url))).toEqual([
      'everyday-seamless-leggings-brown-aw26', 'everyday-seamless-leggings-purple-aw25', 'everyday-seamless-shorts-black-aw23',
    ]);
    expect(r.sample).toEqual(r.products.map((p) => p.url));
    expect(r.productLinks).toBe(6);
  });

  it('a price read from the link text counts too (a card that shows its price inside the link)', () => {
    const anchors = [
      carded('/p/glostad-knisa-1', 'GLOSTAD 3-seat sofa, Knisa dark grey RM449'),
      carded('/p/glostad-blekinge-2', 'GLOSTAD 3-seat sofa, Blekinge white RM449'),
      carded('/p/ektorp-3', 'EKTORP 3-seat sofa RM449'),
      carded('/p/friheten-4', 'FRIHETEN Corner sofa-bed RM1,495'),
    ];
    const r = describeListingPage(links(anchors), L, '<html></html>', okVerdict(200));
    expect(r.products.slice(0, 3).map((p) => slugOf(p.url))).toEqual(['glostad-knisa-1', 'ektorp-3', 'friheten-4']);
  });

  it('names that differ but prices that are all equal: the first three names that differ', () => {
    const items = [['a-1', 'Tee'], ['a-2', 'Tee'], ['b-3', 'Hoodie'], ['c-4', 'Cap'], ['d-5', 'Sock']].map(([u, t]) => ({ url: u!, title: t!, price: '£20' }));
    expect(proofProductOrder(items).slice(0, 3)).toEqual(['a-1', 'b-3', 'c-4']);
  });

  it('falls back to the first three when the listing has no spread (one product in every colour)', () => {
    const anchors = Array.from({ length: 8 }, (_, i) => card(`tee-${i}`, 'Tee', '£20'));
    const r = describeListingPage(links(anchors), G, '<html></html>', okVerdict(200));
    expect(r.products.map((p) => slugOf(p.url))).toEqual(anchors.map((a) => a.href.split('/').pop()));
  });

  it('stays within the first 30 products: a different one further down is never a proof page', () => {
    const anchors = [...Array.from({ length: 30 }, (_, i) => card(`tee-${i}`, 'Tee', '£20')), card('hoodie-30', 'Hoodie', '£40')];
    const r = describeListingPage(links(anchors), G, '<html></html>', okVerdict(200));
    expect(r.products.slice(0, 3).map((p) => slugOf(p.url))).toEqual(['tee-0', 'tee-1', 'tee-2']);
    expect(r.products).toHaveLength(10);
  });

  it('a product further down (within 30) comes into the sample when it is picked', () => {
    const anchors = [...Array.from({ length: 12 }, (_, i) => card(`tee-${i}`, 'Tee', '£20')), card('hoodie-12', 'Hoodie', '£40'), card('cap-13', 'Cap', '£15')];
    const r = describeListingPage(links(anchors), G, '<html></html>', okVerdict(200));
    expect(r.products.slice(0, 3).map((p) => slugOf(p.url))).toEqual(['tee-0', 'hoodie-12', 'cap-13']);
    expect(r.products).toHaveLength(10);
    expect(r.products.slice(3).map((p) => slugOf(p.url))).toEqual(['tee-1', 'tee-2', 'tee-3', 'tee-4', 'tee-5', 'tee-6', 'tee-7']);
  });

  it('cards with no prices: names alone decide', () => {
    const anchors = [carded('/p/a-1', 'Tee Black'), carded('/p/a-2', 'Tee White'), carded('/p/b-3', 'Hoodie'), carded('/p/c-4', 'Cap')];
    const r = describeListingPage(links(anchors), L, '<html></html>', okVerdict(200));
    expect(r.products.slice(0, 3).map((p) => slugOf(p.url))).toEqual(['a-1', 'b-3', 'c-4']);
  });
});



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
  it("ruling D4: a link's card title wins over every link text; a card's link text over an off-card link's", () => {
    const anchors: ListingAnchor[] = [
      { href: '/p/1', text: 'Save $70 on Oak chair | Free shipping on orders over $175' },
      carded('/p/1', 'SHOP Oak chair >'),
      carded('/p/1', '', { name: 'Oak chair' }),
      { href: '/p/2', text: 'Save $10 on Pine stool today only' },
      carded('/p/2', 'Pine stool'),
    ];
    expect(listingProducts(links(anchors), L, ['https://shop.example/p/1', 'https://shop.example/p/2']).map((p) => p.title)).toEqual(['Oak chair', 'Pine stool']);
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
  beforeAll(async () => { browser = new PlaywrightBrowser(); await browser.launch({ headless: true }); }, 60_000);
  afterAll(async () => { await browser.close(); }, 60_000);

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
  }, 60_000);

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
  }, 60_000);

  it('a priced card with an image is a card level; a tile without a price is not', async () => {
    const html = `<html><body><ul>
      <li><a href="/p/1"><img src="/i/1.jpg"><span>Oak chair</span></a><span>$129.99</span></li>
      <li><a href="/c/sofas"><img src="/i/2.jpg"><span>Sofas</span></a></li>
    </ul></body></html>`;
    const { anchors } = await browser.setContentEvaluate<ListingLinks>(html, LISTING_LINKS_SCRIPT);
    const level1 = (href: string) => anchors.find((a) => a.href === href)!.levels![1];
    expect(level1('/p/1')).toMatchObject({ d: 1, img: true, price: true });
    expect(level1('/c/sofas')).toMatchObject({ d: 1, img: true, price: false });
  }, 60_000);

  it("reads the card's price as shown: inside the link, else the lowest card level that shows one", async () => {
    const html = `<html><body><ul>
      <li><div><a href="/p/1"><img src="/i/1.jpg"><span>Oak chair</span></a></div><span>£38.00</span><s>£50.00</s></li>
      <li><a href="/p/2"><img src="/i/2.jpg"><span>Pine stool</span><span>RM1,299</span></a></li>
      <li><a href="/c/sofas"><img src="/i/3.jpg"><span>Sofas</span></a></li>
      <li><a href="/p/4"><img src="/i/4.jpg"><span>Ash table</span></a><span>$90</span></li>
    </ul></body></html>`;
    const { anchors } = await browser.setContentEvaluate<ListingLinks>(html, LISTING_LINKS_SCRIPT);
    const price = (href: string) => anchors.find((a) => a.href === href)!.price;
    expect(price('/p/1')).toBe('£38.00');
    expect(price('/p/2')).toBe('RM1,299');
    expect(price('/c/sofas')).toBeUndefined();
  }, 60_000);

  // Ruling D4 (first run 2026-10-25): a card is named by its own title, not the whole link text.
  const L2 = 'https://shop.example/c/headphones';
  const namesOf = async (html: string, urls: string[]) => {
    const links = await browser.setContentEvaluate<ListingLinks>(html, LISTING_LINKS_SCRIPT);
    return listingProducts(links, L2, urls.map((u) => `https://shop.example${u}`)).map((p) => p.title);
  };

  it('Skullcandy: an announcement link and a "SHOP … >" overlay never name the card; its title element does', async () => {
    const html = `<html><body>
      <div role="region" aria-label="Announcement"><a href="/products/crusher-720"><p>Save $70 on Crusher 720 | Free shipping on orders over $175</p></a></div>
      <main><ul>
        <li class="grid-product"><a href="/products/crusher-720"><img src="/i/720.jpg" alt="Crusher 720 headphones"></a>
          <div class="grid-product__meta"><a href="/products/crusher-720"><div class="grid-product__title">Crusher® 720</div><div class="grid-product__price">$249.99</div></a></div></li>
        <li class="life-style"><div class="life-style-content">
          <span class="h2 life__style-title">Crusher® 540 Active</span><p class="card-overline">Sensory Bass Headphones</p>
          <a href="/products/crusher-540-active"><div class="info-overlay"><span class="card-information__text h2">SHOP Crusher® 540 Active ></span></div><img src="/i/540.jpg"></a>
          <span>$179.99</span></div></li>
      </ul></main>
    </body></html>`;
    expect(await namesOf(html, ['/products/crusher-720', '/products/crusher-540-active'])).toEqual(['Crusher® 720', 'Crusher® 540 Active']);
  }, 60_000);

  it("IKEA: the card's heading names it, not a variant option's \"Option: …\" text; a heading never names another product", async () => {
    const card = (id: string, name: string, desc: string, options: Array<[string, string]>) => `
      <div class="plp-mastercard">
        <a href="/p/${id}/" class="plp-product__image-link"><img alt="The ${name} sofa is a modern comfort design with low armrests." src="/i/${id}.jpg"></a>
        <h3><span class="plp-price-module__name-decorator"><a href="/p/${id}/" aria-label="${name}, ${desc}"><span class="plp-price-module__product-name">${name}</span></a></span>
          <span class="plp-price-module__description"><span aria-hidden="true">${desc}</span></span></h3>
        <em><span class="plp-price__currency">RM</span><span>449</span></em>
        <fieldset><legend>More options<span class="sr-only">${name}</span></legend>
          ${options.map(([oid, label]) => `<label><input type="radio"><a href="/p/${oid}/"><span class="sr-only">Option: ${label}</span><img alt="A ${name} sofa with three cushions." src="/i/${oid}.jpg"></a></label>`).join('')}
        </fieldset>
      </div>`;
    const html = `<html><body><main>
      ${card('glostad-dark-grey-1', 'GLOSTAD', '3-seat sofa, Knisa dark grey', [['glostad-dark-grey-1', 'GLOSTAD, 3-seat sofa, Knisa dark grey'], ['glostad-medium-blue-2', 'GLOSTAD, 3-seat sofa, Knisa medium blue']])}
      ${card('kivik-beige-3', 'KIVIK', '3-seat sofa, Tibbleby beige/grey', [])}
    </main></body></html>`;
    expect(await namesOf(html, ['/p/glostad-dark-grey-1/', '/p/kivik-beige-3/', '/p/glostad-medium-blue-2/'])).toEqual([
      'GLOSTAD 3-seat sofa, Knisa dark grey',
      'KIVIK 3-seat sofa, Tibbleby beige/grey',
      // Reached only by its option link, a swatch (re-run 1): never "Option: …", never the dark grey card's heading.
      '/p/glostad-medium-blue-2/',
    ]);
    // The option links are swatches, so the finder never offers the option-only colourway as a product.
    const read = await browser.setContentEvaluate<ListingLinks>(html, LISTING_LINKS_SCRIPT);
    expect(read.anchors.filter((a) => a.text.startsWith('Option:')).map((a) => a.swatch)).toEqual([true, true]);
    expect(read.anchors.some((a) => a.name?.startsWith('Option:'))).toBe(false);
    const r = describeListingPage(read, L2, '<html></html>', okVerdict(200));
    expect(r.products.map((p) => p.title)).not.toContain('/p/glostad-medium-blue-2/');
    expect(r.products.some((p) => p.title.startsWith('Option:'))).toBe(false);
  }, 60_000);

  it("a card's image alt names it when the card has no title element; a card with neither keeps its link text", async () => {
    const html = `<html><body><ul>
      <li><a href="/p/oak-1"><img src="/i/1.jpg" alt="Oak chair"><span>NEW</span> <span>Oak chair, natural</span> <span>Save 20%</span></a><span>$129.99</span></li>
      <li><a href="/p/pine-2"><img src="/i/2.jpg"><span>Pine stool</span></a><span>$59.00</span></li>
    </ul></body></html>`;
    expect(await namesOf(html, ['/p/oak-1', '/p/pine-2'])).toEqual(['Oak chair', 'Pine stool']);
  }, 60_000);
});
