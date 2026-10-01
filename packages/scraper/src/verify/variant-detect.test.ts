import { describe, it, expect } from 'vitest';
import nike from '../__fixtures__/corpus/nike-air-jordan-detail.json';
import { detectVariantLists } from './variant-detect.js';
import type { CaptureLike } from './certify.js';

const cap = (ldJson: Record<string, unknown>[], apis: unknown[] = []): CaptureLike => ({ url: 'https://s.example/p/1', html: '', structuredData: { ldJson, nextData: null, initialState: null, meta: {} },
  interceptedRequests: apis.map((parsedJson, i) => ({ url: `https://s.example/api/${i}`, method: 'GET', status: 200, isJson: true, parsedJson })) as unknown as CaptureLike['interceptedRequests'] });

describe('detectVariantLists', () => {
  it('finds Nike\'s colour variants in its ProductGroup', () => {
    const lists = detectVariantLists(cap((nike as { structuredData: { ldJson: Record<string, unknown>[] } }).structuredData.ldJson));
    expect(lists[0]).toMatchObject({ source: 'json-ld', count: 2, axes: ['color'] });
    expect(lists[0]!.entries[0]).toMatchObject({ color: 'Black/Varsity Red', sku: '850000-003' });
  });
  it('finds an offers list with a SKU per entry', () => {
    const l = detectVariantLists(cap([{ '@type': 'Product', offers: [{ sku: 'A-S', size: 'S', price: '10' }, { sku: 'A-M', size: 'M', price: '10' }] }]));
    expect(l[0]).toMatchObject({ path: 'offers', count: 2, axes: ['size'] });
  });
  it('finds a Shopify-like API variants list', () => {
    const l = detectVariantLists(cap([], [{ product: { variants: [{ id: 1, sku: 'X1', option1: 'Red', price: '5' }, { id: 2, sku: 'X2', option1: 'Blue', price: '5' }] } }]));
    expect(l[0]).toMatchObject({ source: 'api', path: 'product.variants', count: 2, axes: ['option1'] });
  });
  it('one entry is a product, not variants', () => {
    expect(detectVariantLists(cap([{ '@type': 'ProductGroup', hasVariant: [{ sku: 'only' }] }, { '@type': 'Product', offers: [{ sku: 'x', price: 1 }] }]))).toEqual([]);
  });
  it('ignores arrays that look like lists but carry no variant data', () => {
    expect(detectVariantLists(cap([], [{ reviews: [{ id: 1, text: 'a' }, { id: 2, text: 'b' }] }]))).toEqual([]);
  });
});
