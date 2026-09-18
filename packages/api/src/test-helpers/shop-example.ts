// packages/api/src/test-helpers/shop-example.ts
// The three shop-example proof pages as captures, for router tests that need a
// real page with structured data behind it. A copy of `@robot/scraper`'s
// `src/__fixtures__/verify/shop-example/p{1,2,3}.json`: its loader
// (`__fixtures__/verify/load.ts`) is not part of the package's public surface,
// and reaching into another package's test files from here would be worse than
// the duplication.
import type { PageCapture } from '@robot/browser';

type RawCapture = Omit<PageCapture, 'markdown' | 'title' | 'timestamp' | 'screenshot' | 'screenshotTiles'>;

const page = (raw: RawCapture): PageCapture => ({ ...raw, markdown: '', title: 'Widget', timestamp: 0, screenshot: Buffer.alloc(0), screenshotTiles: [] });

export const SHOP_EXAMPLE: Record<'p1' | 'p2' | 'p3', PageCapture> = {
  p1: page({
    url: 'https://shop.example/p/1',
    html: '<html><body><div id="main"><h1>Widget A</h1><div class="price-box"><span class="was">$159.99</span><span class="now">$129.99</span></div><p class="stock">In stock</p><img class="hero" src="/img/a.jpg" alt="Widget A photo"><a class="buy" href="/buy/1">Buy now</a><time class="ship">Sep 4, 2026</time><ul class="colors"><li>Red</li><li>Blue</li></ul><span class="rating">4.5</span><span class="sku" data-sku="A1"></span></div></body></html>',
    structuredData: {
      ldJson: [
        {
          '@context': 'https://schema.org',
          '@type': 'Product',
          name: 'Widget A',
          offers: { '@type': 'Offer', price: '129.99', priceCurrency: 'USD', availability: 'https://schema.org/InStock' },
        },
      ],
      nextData: null,
      initialState: null,
      meta: { 'product:price:amount': '129.99', 'og:title': 'Widget A' },
    },
    interceptedRequests: [
      {
        url: 'https://shop.example/api/product/1',
        method: 'GET',
        resourceType: 'xhr',
        responseStatus: 200,
        responseHeaders: {},
        responseBody: '{}',
        contentType: 'application/json',
        bodySize: 1,
        isJson: true,
        parsedJson: {
          item: { name: 'Widget A', priceCents: 12999, code: 'SKU-A1', images: ['https://shop.example/img/a.jpg'], colors: ['Red', 'Blue'], rating: 4.5, shipDate: '2026-09-04' },
        },
        timestamp: 0,
      },
    ],
  }),
  p2: page({
    url: 'https://shop.example/p/2',
    html: '<html><body><div id="main"><h1>Widget B</h1><div class="price-box"><span class="was">$259.99</span><span class="now">$219.99</span></div><p class="stock">In stock</p><img class="hero" src="/img/b.jpg" alt="Widget B photo"><a class="buy" href="/buy/2">Buy now</a><time class="ship">Sep 5, 2026</time><ul class="colors"><li>Green</li></ul><span class="rating">3.8</span><span class="sku" data-sku="B2"></span></div></body></html>',
    structuredData: {
      ldJson: [
        {
          '@context': 'https://schema.org',
          '@type': 'Product',
          name: 'Widget B',
          offers: { '@type': 'Offer', price: '219.99', priceCurrency: 'USD', availability: 'https://schema.org/InStock' },
        },
      ],
      nextData: null,
      initialState: null,
      meta: { 'product:price:amount': '219.99', 'og:title': 'Widget B' },
    },
    interceptedRequests: [
      {
        url: 'https://shop.example/api/product/2',
        method: 'GET',
        resourceType: 'xhr',
        responseStatus: 200,
        responseHeaders: {},
        responseBody: '{}',
        contentType: 'application/json',
        bodySize: 1,
        isJson: true,
        parsedJson: {
          item: { name: 'Widget B', priceCents: 21999, code: 'SKU-B2', images: ['https://shop.example/img/b.jpg'], colors: ['Green'], rating: 3.8, shipDate: '2026-09-05' },
        },
        timestamp: 0,
      },
    ],
  }),
  p3: page({
    url: 'https://shop.example/p/3',
    html: '<html><body><div id="main"><h1>Widget C</h1><div class="price-box"><span class="now">$149.00</span></div><p class="stock">Out of stock</p><img class="hero" src="/img/c.jpg" alt="Widget C photo"><a class="buy" href="/buy/3">Buy now</a><time class="ship">Sep 6, 2026</time><ul class="colors"><li>Black</li><li>White</li><li>Grey</li></ul><span class="rating">4.9</span><span class="sku" data-sku="C3"></span></div></body></html>',
    structuredData: {
      ldJson: [
        {
          '@context': 'https://schema.org',
          '@type': 'Product',
          name: 'Widget C',
          offers: { '@type': 'Offer', price: '149.00', priceCurrency: 'USD', availability: 'https://schema.org/OutOfStock' },
        },
      ],
      nextData: null,
      initialState: null,
      meta: { 'product:price:amount': '149.00', 'og:title': 'Widget C' },
    },
    interceptedRequests: [
      {
        url: 'https://shop.example/api/product/3',
        method: 'GET',
        resourceType: 'xhr',
        responseStatus: 200,
        responseHeaders: {},
        responseBody: '{}',
        contentType: 'application/json',
        bodySize: 1,
        isJson: true,
        parsedJson: {
          item: { name: 'Widget C', priceCents: 14900, code: 'SKU-C3', images: ['https://shop.example/img/c.jpg'], colors: ['Black', 'White', 'Grey'], rating: 4.9, shipDate: '2026-09-06' },
        },
        timestamp: 0,
      },
    ],
  }),
};
