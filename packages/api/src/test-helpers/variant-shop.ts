// packages/api/src/test-helpers/variant-shop.ts
// Three product-page captures for a website that shows variants (spec
// 2026-10-01 §3), for router tests of saveVariantAnswer/variantList/
// variantLinksNear: p1 and p2 are `ProductGroup`s with a `hasVariant` list
// (color/sku/price/availability) and an HTML swatch group; p3 is a plain
// `Product` with no swatches. Built the way `shop-example.ts` builds its
// pages.
import type { PageCapture } from '@robot/browser';

type RawCapture = Omit<PageCapture, 'markdown' | 'title' | 'timestamp' | 'screenshot' | 'screenshotTiles' | 'verdict'>;

const page = (raw: RawCapture): PageCapture => ({ ...raw, markdown: '', title: 'Variant shop', timestamp: 0, screenshot: Buffer.alloc(0), screenshotTiles: [], verdict: { kind: 'ok', status: 200 } });

export const VARIANT_SHOP_URLS = [
  'https://variants.example/p/1',
  'https://variants.example/p/2',
  'https://variants.example/p/3',
];

/** p1's first swatch href that is not p1's own URL (plan 2 Task 4's links spot-check test). The first swatch IS p1's own URL — the currently-selected variant links back to the product page it's shown on, same as most shops — so this is the second. */
export const VARIANT_SHOP_SPOT_URL = 'https://variants.example/p/1-red';

const variant = (color: string, sku: string, price: string) => ({
  '@type': 'Product',
  sku,
  color,
  offers: { '@type': 'Offer', price, priceCurrency: 'USD', availability: 'https://schema.org/InStock' },
});

const group = (name: string, variants: unknown[]) => ({
  '@context': 'https://schema.org',
  '@type': 'ProductGroup',
  name,
  hasVariant: variants,
});

export const VARIANT_SHOP: Record<'p1' | 'p2' | 'p3', PageCapture> = {
  p1: page({
    url: VARIANT_SHOP_URLS[0]!,
    html: `<html><body><div id="main"><h1>Shoe</h1><div class="product-swatches"><a href="${VARIANT_SHOP_URLS[0]}">Black</a><a href="${VARIANT_SHOP_SPOT_URL}">Red</a></div></div></body></html>`,
    structuredData: {
      ldJson: [group('Shoe', [variant('Black', 'V1-BLACK', '10.00'), variant('Red', 'V1-RED', '11.00')])],
      nextData: null,
      initialState: null,
      meta: {},
    },
    interceptedRequests: [],
  }),
  p2: page({
    url: VARIANT_SHOP_URLS[1]!,
    html: `<html><body><div id="main"><h1>Hat</h1><div class="product-swatches"><a href="https://variants.example/p/2-black">Black</a><a href="https://variants.example/p/2-red">Red</a><a href="https://variants.example/p/2-white">White</a></div></div></body></html>`,
    structuredData: {
      ldJson: [group('Hat', [variant('Black', 'V2-BLACK', '20.00'), variant('Red', 'V2-RED', '21.00'), variant('White', 'V2-WHITE', '22.00')])],
      nextData: null,
      initialState: null,
      meta: {},
    },
    interceptedRequests: [],
  }),
  p3: page({
    url: VARIANT_SHOP_URLS[2]!,
    html: '<html><body><div id="main"><h1>Belt</h1></div></body></html>',
    structuredData: {
      ldJson: [{ '@context': 'https://schema.org', '@type': 'Product', name: 'Belt', offers: { '@type': 'Offer', price: '15.00', priceCurrency: 'USD', availability: 'https://schema.org/InStock' } }],
      nextData: null,
      initialState: null,
      meta: {},
    },
    interceptedRequests: [],
  }),
};
