import { describe, it, expect } from 'vitest';
import nike from '../__fixtures__/corpus/nike-air-jordan-detail.json';
import { detectVariantLists, isVariantEntry } from './variant-detect.js';
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
  it('ignores an image/related-item list — id + a generic axis-like key is not enough', () => {
    expect(detectVariantLists(cap([], [{ images: [{ id: 1, url: 'https://s.example/a.jpg', size: 'large' }, { id: 2, url: 'https://s.example/b.jpg', size: 'small' }] }]))).toEqual([]);
  });
  it('ignores a recommendations list — a price per item is not a variant list without an option signal', () => {
    const rec = (id: number) => ({ id, name: `Other product ${id}`, price: '19.99', url: `https://s.example/p/${id}` });
    expect(detectVariantLists(cap([], [{ recommendations: [rec(1), rec(2), rec(3)] }]))).toEqual([]);
  });
  it('finds a price-per-entry API list once an entry carries an option', () => {
    const l = detectVariantLists(cap([], [{ variants: [{ price: '5', size: 'S' }, { price: '6', size: 'M' }] }]));
    expect(l[0]).toMatchObject({ source: 'api', path: 'variants', count: 2, axes: ['size'] });
  });
  it('still finds a Shopify list identified by id + option1, with no sku/price', () => {
    const l = detectVariantLists(cap([], [{ product: { variants: [{ id: 1, option1: 'Red' }, { id: 2, option1: 'Blue' }] } }]));
    expect(l[0]).toMatchObject({ source: 'api', path: 'product.variants', count: 2, axes: ['option1'] });
  });
  it('unwraps a JSON-LD @graph to find hasVariant inside it', () => {
    const l = detectVariantLists(cap([{ '@graph': [{ '@type': 'ProductGroup', hasVariant: [{ sku: 'G-1', color: 'Red' }, { sku: 'G-2', color: 'Blue' }] }] }]));
    expect(l[0]).toMatchObject({ source: 'json-ld', path: 'hasVariant', count: 2, axes: ['color'] });
  });
  it('finds an AggregateOffer\'s combination variants (Ikea shape)', () => {
    const l = detectVariantLists(cap([{ '@type': 'Product', offers: { '@type': 'AggregateOffer', offers: [{ sku: 'IK-1', price: '20', color: 'Red' }, { sku: 'IK-2', price: '20', color: 'Blue' }] } }]));
    expect(l[0]).toMatchObject({ source: 'json-ld', path: 'offers.offers', count: 2, axes: ['color'] });
  });

  const stub = (size: number) => ({ '@type': 'Product', url: `https://s.example/p/other?size=${size}` });
  const real = (size: string, sku: string) => ({ '@type': 'Product', size, sku, offers: { price: '100', availability: 'https://schema.org/InStock' } });

  it('drops URL-only stub entries from a hasVariant list (Allbirds)', () => {
    const lists = detectVariantLists(cap([{ '@type': 'ProductGroup', hasVariant: [stub(8), stub(9), stub(10), real('8', 'A-8'), real('9', 'A-9')] }]));
    expect(lists).toHaveLength(1);
    expect(lists[0]!.count).toBe(2);
    expect(lists[0]!.entries.map((e) => e.sku)).toEqual(['A-8', 'A-9']);
  });
  it('a list of stubs plus one real entry is no list', () => {
    expect(detectVariantLists(cap([{ '@type': 'ProductGroup', hasVariant: [stub(8), stub(9), real('8', 'A-8')] }]))).toEqual([]);
  });
  it('entries with only an axis value are variants', () => {
    expect(isVariantEntry({ '@type': 'Product', size: 'M' })).toBe(true);
    expect(isVariantEntry({ '@type': 'Product', url: 'https://s.example/x', name: 'x', image: 'i.jpg' })).toBe(false);
  });
});
