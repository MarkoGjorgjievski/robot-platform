import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PlaywrightBrowser } from '@robot/browser';
import { buildDomSearchScript, buildXPathProbeScript, xpathContainsValue, looksVolatile, isVolatileXPath, PAGE_SCRIPT_PRELUDE, type DomHit, type XPathProbeResult } from './dom-scripts.js';

const HTML = `<html><body>
<div id="main">
  <h1 class="title">Widget A</h1>
  <div class="price-box"><span class="was">$149.00</span><span class="now">$129.99</span></div>
  <p class="stock">In stock</p>
  <img class="hero" src="/img/a.jpg">
  <a class="buy" href="/checkout?p=1">Buy</a>
</div>
<div data-section="related"><span class="now">$99.00</span></div>
</body></html>`;

let browser: PlaywrightBrowser;
beforeAll(async () => { browser = new PlaywrightBrowser(); await browser.launch({ headless: true }); });
afterAll(async () => { await browser.close(); });

describe('buildDomSearchScript', () => {
  it('finds text, money, boolean, image and url values with structural xpaths', async () => {
    const hits = await browser.setContentEvaluate<DomHit[]>(HTML, buildDomSearchScript([
      { key: 'title', type: 'text', expected: 'Widget A' },
      { key: 'price', type: 'money', expected: '129.99' },
      { key: 'in_stock', type: 'boolean', expected: 'yes' },
      { key: 'image', type: 'image', expected: 'https://shop.example/img/a.jpg' },
      { key: 'buy', type: 'url', expected: 'https://shop.example/checkout?p=1' },
    ], 'https://shop.example/p/1'));
    expect(hits).toContainEqual({ key: 'title', xpath: '//*[@id="main"]/h1[@class="title"]', raw: 'Widget A' });
    expect(hits).toContainEqual({ key: 'price', xpath: '//*[@id="main"]/div[@class="price-box"]/span[@class="now"]', raw: '$129.99' });
    // The $149 and $99 spans do not match. (One element now yields several XPath variants, so count elements by their raw text.)
    expect(new Set(hits.filter((h) => h.key === 'price').map((h) => h.raw))).toEqual(new Set(['$129.99']));
    expect(hits).toContainEqual({ key: 'in_stock', xpath: '//*[@id="main"]/p[@class="stock"]', raw: 'In stock' });
    expect(hits).toContainEqual({ key: 'image', xpath: '//*[@id="main"]/img[@class="hero"]/@src', raw: '/img/a.jpg' });
    expect(hits).toContainEqual({ key: 'buy', xpath: '//*[@id="main"]/a[@class="buy"]/@href', raw: '/checkout?p=1' });
  });
  it('uses a data attribute anchor when there is no id', async () => {
    const hits = await browser.setContentEvaluate<DomHit[]>(HTML, buildDomSearchScript([{ key: 'rel', type: 'money', expected: '99' }], 'https://shop.example/'));
    expect(hits).toContainEqual({ key: 'rel', xpath: '//div[@data-section="related"]/span[@class="now"]', raw: '$99.00' });
  });
  it('treats a single dot with a 3-digit group as thousands for money but as decimal for number', async () => {
    // Note: currency symbols are stripped before the digit-group check (mirroring Node's
    // parseNumber exactly), so a "money" needle and a "number" needle both reduce "€1.299" and
    // "1.299" to the same digit string and would cross-match if probed together on one page
    // (verified against real Chromium: both needles hit both spans in that arrangement). Each
    // needle is therefore probed against its own page here, isolating the rule under test —
    // money's thousands-separator branch vs number's keep-as-decimal branch — from that artifact.
    const moneyHtml = `<html><body><div id="main"><span id="p" class="eur">€1.299</span></div></body></html>`;
    const moneyHits = await browser.setContentEvaluate<DomHit[]>(moneyHtml, buildDomSearchScript([
      { key: 'price', type: 'money', expected: '1299' },
    ], 'https://shop.example/'));
    expect(moneyHits[0]).toEqual({ key: 'price', xpath: '//*[@id="p"]', raw: '€1.299' });
    expect(new Set(moneyHits.map((h) => h.raw))).toEqual(new Set(['€1.299'])); // one element, several anchors

    const numberHtml = `<html><body><div id="main"><span class="rate">1.299</span></div></body></html>`;
    const numberHits = await browser.setContentEvaluate<DomHit[]>(numberHtml, buildDomSearchScript([
      { key: 'rate', type: 'number', expected: '1.299' },
    ], 'https://shop.example/'));
    expect(numberHits[0]).toEqual({ key: 'rate', xpath: '//*[@id="main"]/span[@class="rate"]', raw: '1.299' });
    expect(new Set(numberHits.map((h) => h.raw))).toEqual(new Set(['1.299'])); // one element, several anchors
  });
  it('uses the matched element\'s own id as the anchor', async () => {
    const html = `<html><body><div id="main"><span id="sku">A1</span></div></body></html>`;
    const hits = await browser.setContentEvaluate<DomHit[]>(html, buildDomSearchScript([{ key: 'sku', type: 'text', expected: 'A1' }], 'https://shop.example/'));
    expect(hits).toContainEqual({ key: 'sku', xpath: '//*[@id="sku"]', raw: 'A1' });
  });
});

describe('buildXPathProbeScript', () => {
  it('returns text or attribute per xpath and null for no match', async () => {
    const r = await browser.setContentEvaluate<XPathProbeResult>(HTML, buildXPathProbeScript([
      '//*[@id="main"]/h1[@class="title"]',
      '//*[@id="main"]/img[@class="hero"]/@src',
      '//*[@id="nope"]',
    ]));
    expect(r['//*[@id="main"]/h1[@class="title"]']).toBe('Widget A');
    expect(r['//*[@id="main"]/img[@class="hero"]/@src']).toBe('/img/a.jpg');
    expect(r['//*[@id="nope"]']).toBeNull();
  });
});

describe('PAGE_SCRIPT_PRELUDE', () => {
  it('is present in both built scripts', () => {
    expect(buildDomSearchScript([], 'https://shop.example/')).toContain(PAGE_SCRIPT_PRELUDE);
    expect(buildXPathProbeScript([])).toContain(PAGE_SCRIPT_PRELUDE);
  });

  it('shims esbuild\'s __name helper so a keepNames-transformed function runs in the page', async () => {
    const result = await browser.setContentEvaluate<number>(
      '<html><body></body></html>',
      `(() => { ${PAGE_SCRIPT_PRELUDE} const f = __name((x) => x * 2, 'f'); return f(21); })()`,
    );
    expect(result).toBe(42);
  });
});

describe('xpathContainsValue', () => {
  it('rejects a literal-value predicate', () => {
    expect(xpathContainsValue(`//span[contains(text(), '129.99')]`, '129.99')).toBe(true);
    expect(xpathContainsValue(`//span[@class="now"]`, '129.99')).toBe(false);
  });
  it('blanks out attribute-equality literals before the substring check', () => {
    expect(xpathContainsValue('//span[@class="now"]', 'now')).toBe(false);
    expect(xpathContainsValue(`//li[@class="red"]`, 'Red')).toBe(false);
    expect(xpathContainsValue(`//span[.='129.99']`, '129.99')).toBe(true);
    expect(xpathContainsValue(`//*[normalize-space()='Widget A']`, 'Widget A')).toBe(true);
  });
});

// A certified XPath must survive the site's next deploy. Found on Ikea,
// 2026-09-17: a backup XPath for `title` was anchored on `data-cv="634a7e0"`,
// a build hash that had already become "a14a902"; and `subtitle`'s ONLY
// certified path was anchored on `data-skapa="price-module@11.1.8"`, a version
// stamp, so the day 11.1.9 ships that column goes empty on every product.
describe('looksVolatile', () => {
  it('flags build hashes, version stamps, long numbers and generated names', () => {
    for (const v of [
      '634a7e0', 'a14a902',                                    // build hashes (Ikea data-cv)
      'price-module@11.1.8', 'product-identifier@9.0.11',      // version stamps (Ikea data-skapa)
      '10489009', 'product-10489009',                          // a product or session number
      'Button_root__3kX9a', 'price_x7Hs2',                     // CSS-module hashes
      'css-1q2w3e', 'sc-bdVaJa', 'jsx-2871349',                // CSS-in-JS
      ':r1:', ':R2d6:',                                        // React useId
      '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',                  // a uuid
    ]) expect(looksVolatile(v), v).toBe(true);
  });
  it('flags state values: they describe this product, not where a field lives', () => {
    // Ikea, 2026-09-17: with the version stamp skipped, the generator anchored subtitle on
    // data-online-sellable="true". A product not sold online carries "false" and the column goes empty for it.
    for (const v of ['true', 'false', 'TRUE', 'yes', 'no', 'on', 'off', '0', '1', '42', 'null', 'undefined']) expect(looksVolatile(v), v).toBe(true);
  });
  it('leaves ordinary, human-written names alone', () => {
    for (const v of [
      'main', 'product-details', 'price-box', 'related', 'overview', 'section-2', 'col-12', 'text-2xl', 'h1', 'mt-4',
      'pipcom-price-module__information', 'hnf-breadcrumb__list-item', 'pipf-product-details-tab__container',
      'notranslate', 'grid-cols-12', 'step3', 'tab2', '',
    ]) expect(looksVolatile(v), v).toBe(false);
  });
});

describe('isVolatileXPath', () => {
  it('is true when any attribute literal in the path is volatile', () => {
    expect(isVolatileXPath('//div[@data-cv="634a7e0"]/nav[@class="hnf-breadcrumb__nav"]/ol/li/span[1]')).toBe(true);
    expect(isVolatileXPath('//div[@data-skapa="price-module@11.1.8"]/div[@class="pipcom-price-module__information"]/h1')).toBe(true);
    expect(isVolatileXPath('//div[@class="card css-1q2w3e"]/span')).toBe(true);
  });
  it('is false for a path built from stable anchors, including positions', () => {
    expect(isVolatileXPath('//*[@id="product-details"]/div[@class="pipf-product-details-tab"]/div[1]/p[2]')).toBe(false);
    expect(isVolatileXPath('//*[@id="main"]/img[@class="hero"]/@src')).toBe(false);
  });
});

describe('buildDomSearchScript — anchors that survive a deploy', () => {
  const IKEA_LIKE = `<html><body>
  <div data-cv="634a7e0" data-region="product">
    <div data-skapa="price-module@11.1.8">
      <div class="pipcom-price-module__information"><h1 class="pipcom-text"><span class="sub">2-seat sofa</span></h1></div>
    </div>
    <div id=":r1:"><p class="Note_root__3kX9a"><em>Ships in 3 days</em></p></div>
    <section id="item-10489009"><b class="code">104.890.09</b></section>
  </div>
  </body></html>`;
  const find = (key: string, expected: string) => browser.setContentEvaluate<DomHit[]>(IKEA_LIKE, buildDomSearchScript([{ key, type: 'text', expected }], 'https://shop.example/p/1'));

  it('skips a version-stamped data attribute and anchors on the next stable one', async () => {
    const [hit] = await find('subtitle', '2-seat sofa');
    expect(hit!.xpath).toBe('//div[@data-region="product"]/div[1]/div[@class="pipcom-price-module__information"]/h1[@class="pipcom-text"]/span[@class="sub"]');
    expect(isVolatileXPath(hit!.xpath)).toBe(false);
  });
  it('skips a generated id and a hashed class, falling back to position', async () => {
    const [hit] = await find('note', 'Ships in 3 days');
    expect(hit!.xpath).toBe('//div[@data-region="product"]/div[2]/p[1]/em[1]');
  });
  it('skips an id that carries a product number', async () => {
    const [hit] = await find('code', '104.890.09');
    expect(hit!.xpath).toBe('//div[@data-region="product"]/section[1]/b[@class="code"]');
  });
});

// One page cannot tell a stable anchor from a product-specific one. Ikea, 2026-09-17: with the
// version stamp skipped, the nearest stable-LOOKING anchor for the subtitle was
// data-product-name="KIVIK": right on that page, wrong on every other product. So the generator
// offers an XPath per anchor on the way up plus the body-rooted one, and the proof pages decide.
describe('buildDomSearchScript — several anchors per element, nearest first', () => {
  const NAMED = `<html><body><div id="content"><div data-product-name="KIVIK"><h2 class="sub">2-seat sofa</h2></div></div></body></html>`;
  it('offers the nearest anchor, the next one up, and the body-rooted path', async () => {
    const hits = await browser.setContentEvaluate<DomHit[]>(NAMED, buildDomSearchScript([{ key: 'subtitle', type: 'text', expected: '2-seat sofa' }], 'https://shop.example/p/1'));
    expect(hits.map((h) => h.xpath)).toEqual([
      '//div[@data-product-name="KIVIK"]/h2[@class="sub"]',
      '//*[@id="content"]/div[1]/h2[@class="sub"]',
      '//body/div[1]/div[1]/h2[@class="sub"]',
    ]);
  });
  it('never offers more than three', async () => {
    const deep = `<html><body><div id="a"><div id="b"><div id="c"><div id="d"><em>x marks</em></div></div></div></div></body></html>`;
    const hits = await browser.setContentEvaluate<DomHit[]>(deep, buildDomSearchScript([{ key: 'k', type: 'text', expected: 'x marks' }], 'https://shop.example/'));
    expect(hits.map((h) => h.xpath)).toEqual(['//*[@id="d"]/em[1]', '//*[@id="c"]/div[1]/em[1]', '//body/div[1]/div[1]/div[1]/div[1]/em[1]']);
  });
});

// A class list often carries STATE next to structure. Ikea, 2026-09-17: the price module is
// "pipcom-price-module pipcom-price-module--medium pipcom-price-module--bti …" on one sofa and
// "… pipcom-price-module--none …" on the next (a BEM modifier for the kind of price tag). Matching the
// whole string gives the same element a different XPath per product, so nothing is shared across the
// proof pages. Such a list is matched on its stable base token instead.
describe('buildDomSearchScript — a class list with state in it is matched on its stable base', () => {
  const page = (modifier: string, extra = '') => `<html><body><div id="content"><div class="price-module price-module--medium price-module--${modifier} type-d${extra}"><h1 class="heading"><span class="sub">2-seat sofa</span></h1></div></div></body></html>`;
  const TOKEN_FORM = '//*[@id="content"]/div[contains(concat(" ",normalize-space(@class)," ")," price-module ")]/h1[@class="heading"]/span[@class="sub"]';
  const search = (html: string) => browser.setContentEvaluate<DomHit[]>(html, buildDomSearchScript([{ key: 'subtitle', type: 'text', expected: '2-seat sofa' }], 'https://shop.example/p/1'));

  it('two products whose module carries a different modifier get the SAME XPath', async () => {
    const [a] = await search(page('bti'));
    const [b] = await search(page('none'));
    expect(a!.xpath).toBe(TOKEN_FORM);
    expect(b!.xpath).toBe(TOKEN_FORM);
  });
  it('that XPath resolves on both pages', async () => {
    for (const html of [page('bti'), page('none')]) {
      const probe = await browser.setContentEvaluate<XPathProbeResult>(html, buildXPathProbeScript([TOKEN_FORM]));
      expect(probe[TOKEN_FORM]).toBe('2-seat sofa');
    }
  });
  it('state tokens such as is-active are handled the same way', async () => {
    const [hit] = await search(page('none', ' is-active'));
    expect(hit!.xpath).toBe(TOKEN_FORM);
  });
  it('a class list with no state in it keeps the exact form', async () => {
    const plain = `<html><body><div id="content"><div class="price-box large"><span class="sub">2-seat sofa</span></div></div></body></html>`;
    const [hit] = await search(plain);
    expect(hit!.xpath).toBe('//*[@id="content"]/div[@class="price-box large"]/span[@class="sub"]');
  });
});

describe('the class-token predicate is a locator', () => {
  const TOKEN = '//*[@id="content"]/div[contains(concat(" ",normalize-space(@class)," ")," sofa-card ")]/span[1]';
  it('xpathContainsValue does not mistake its token for a literal-value predicate', () => {
    expect(xpathContainsValue(TOKEN, 'sofa')).toBe(false);
    // …while a real literal-value predicate is still rejected.
    expect(xpathContainsValue('//span[contains(text(),"2-seat sofa")]', '2-seat sofa')).toBe(true);
  });
  it('isVolatileXPath looks inside it too', () => {
    expect(isVolatileXPath(TOKEN)).toBe(false);
    expect(isVolatileXPath('//div[contains(concat(" ",normalize-space(@class)," ")," css-1q2w3e ")]/span[1]')).toBe(true);
  });
});
