import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PlaywrightBrowser } from '@robot/browser';
import { buildDomSearchScript, buildXPathProbeScript, xpathContainsValue, type DomHit, type XPathProbeResult } from './dom-scripts.js';

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
    expect(hits.filter((h) => h.key === 'price')).toHaveLength(1); // the $149 and $99 spans do not match
    expect(hits).toContainEqual({ key: 'in_stock', xpath: '//*[@id="main"]/p[@class="stock"]', raw: 'In stock' });
    expect(hits).toContainEqual({ key: 'image', xpath: '//*[@id="main"]/img[@class="hero"]/@src', raw: '/img/a.jpg' });
    expect(hits).toContainEqual({ key: 'buy', xpath: '//*[@id="main"]/a[@class="buy"]/@href', raw: '/checkout?p=1' });
  });
  it('uses a data attribute anchor when there is no id', async () => {
    const hits = await browser.setContentEvaluate<DomHit[]>(HTML, buildDomSearchScript([{ key: 'rel', type: 'money', expected: '99' }], 'https://shop.example/'));
    expect(hits).toContainEqual({ key: 'rel', xpath: '//div[@data-section="related"]/span[@class="now"]', raw: '$99.00' });
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

describe('xpathContainsValue', () => {
  it('rejects a literal-value predicate', () => {
    expect(xpathContainsValue(`//span[contains(text(), '129.99')]`, '129.99')).toBe(true);
    expect(xpathContainsValue(`//span[@class="now"]`, '129.99')).toBe(false);
  });
});
