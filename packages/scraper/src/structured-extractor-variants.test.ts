import { describe, it, expect } from 'vitest';
import { extractFromStructuredData } from './structured-extractor.js';
import type { StructuredData } from '@robot/browser';

const NIKE_LIKE_LDJSON: StructuredData = {
  ldJson: [{
    '@type': 'ProductGroup',
    name: 'Jordan 12 Retro',
    variesBy: ['https://schema.org/color'],
    hasVariant: [
      {
        '@type': 'Product',
        name: 'Jordan 12 Retro Black/Varsity Red',
        color: 'Black/Varsity Red',
        mpn: '850000-003',
        image: 'https://static.nike.com/a.png',
        offers: { '@type': 'Offer', price: 80, priceCurrency: 'USD', availability: 'https://schema.org/InStock' },
      },
      {
        '@type': 'Product',
        name: 'Jordan 12 Retro Taxi',
        color: 'Taxi',
        mpn: '850000-170',
        image: 'https://static.nike.com/b.png',
        offers: { '@type': 'Offer', price: 80, priceCurrency: 'USD', availability: 'https://schema.org/InStock' },
      },
    ],
  }],
  nextData: null,
  initialState: null,
  meta: {},
};

describe('extractFromStructuredData — variant_array', () => {
  it('extracts variants from JSON-LD ProductGroup.hasVariant', () => {
    const result = extractFromStructuredData(
      NIKE_LIKE_LDJSON,
      [{ name: 'variants', type: 'variant_array' }],
    );
    expect(result.sources.variants).toBe('json-ld');
    const variants = result.data.variants as Array<Record<string, unknown>>;
    expect(variants).toHaveLength(2);
    expect(variants[0]).toMatchObject({ sku: '850000-003', price: 80, image_url: 'https://static.nike.com/a.png', color: 'Black/Varsity Red' });
    expect(variants[1]).toMatchObject({ sku: '850000-170', price: 80, image_url: 'https://static.nike.com/b.png', color: 'Taxi' });
  });

  it('returns no variants when JSON-LD lacks ProductGroup', () => {
    const noProductGroup: StructuredData = {
      ldJson: [{ '@type': 'Product', name: 'Single product' }],
      nextData: null,
      initialState: null,
      meta: {},
    };
    const result = extractFromStructuredData(
      noProductGroup,
      [{ name: 'variants', type: 'variant_array' }],
    );
    expect(result.data.variants).toBeUndefined();
  });

  it('accepts mpn OR sku OR productID as the sku source', () => {
    const data: StructuredData = {
      ldJson: [{
        '@type': 'ProductGroup',
        hasVariant: [
          { '@type': 'Product', sku: 'SKU-A', color: 'red', offers: { price: 10 } },
          { '@type': 'Product', productID: 'PID-B', color: 'blue', offers: { price: 10 } },
          { '@type': 'Product', mpn: 'MPN-C', color: 'green', offers: { price: 10 } },
        ],
      }],
      nextData: null,
      initialState: null,
      meta: {},
    };
    const result = extractFromStructuredData(data, [{ name: 'variants', type: 'variant_array' }]);
    const variants = result.data.variants as Array<Record<string, unknown>>;
    expect(variants.map((v) => v.sku)).toEqual(['SKU-A', 'PID-B', 'MPN-C']);
  });

  it('picks the first image when `image` is an array', () => {
    const data: StructuredData = {
      ldJson: [{
        '@type': 'ProductGroup',
        hasVariant: [{ '@type': 'Product', sku: 'A', image: ['first.png', 'second.png'], offers: { price: 1 } }],
      }],
      nextData: null,
      initialState: null,
      meta: {},
    };
    const result = extractFromStructuredData(data, [{ name: 'variants', type: 'variant_array' }]);
    const variants = result.data.variants as Array<Record<string, unknown>>;
    expect(variants[0].image_url).toBe('first.png');
  });
});
