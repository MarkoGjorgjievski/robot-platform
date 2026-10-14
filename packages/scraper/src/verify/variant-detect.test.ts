import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
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
  it('an empty options array or an empty value is not a variant (final review M2)', () => {
    const base = { '@type': 'Product', url: 'https://s.example/x' };
    expect(isVariantEntry({ ...base, options: [] })).toBe(false);
    expect(isVariantEntry({ ...base, selectedOptions: [] })).toBe(false);
    expect(isVariantEntry({ ...base, sku: null })).toBe(false);
    expect(isVariantEntry({ ...base, color: '' })).toBe(false);
    expect(isVariantEntry({ ...base, color: '  ' })).toBe(false);
    expect(isVariantEntry({ ...base, gtin13: '' })).toBe(false);
    expect(isVariantEntry({ ...base, price: {} })).toBe(false);
    expect(isVariantEntry({ ...base, offers: null })).toBe(false);
    expect(isVariantEntry({ ...base, options: [{ name: 'Size', value: 'M' }] })).toBe(true);
    expect(isVariantEntry({ ...base, price: 0 })).toBe(true);
    expect(isVariantEntry({ ...base, gtin13: '0123' })).toBe(true);
    expect(isVariantEntry({ ...base, offers: { price: '1' } })).toBe(true);
    expect(isVariantEntry({ ...base, offers: [{ price: '1' }] })).toBe(true);
  });
  it('entries with only an axis value are variants', () => {
    expect(isVariantEntry({ '@type': 'Product', size: 'M' })).toBe(true);
    expect(isVariantEntry({ '@type': 'Product', url: 'https://s.example/x', name: 'x', image: 'i.jpg' })).toBe(false);
  });
});

describe('variant entries keep their ids (spec 2026-10-14 §9)', () => {
  it('entries keep url, @id, id and variant_id as text', () => {
    const kith = JSON.parse(readFileSync(new URL('./__fixtures__/page-variant/kith.json', import.meta.url), 'utf8'));
    const lists = detectVariantLists({ url: kith.url, html: '', structuredData: { ldJson: kith.ldJson, nextData: null, initialState: null, meta: {} }, interceptedRequests: [] });
    expect(lists[0]?.entries[1]).toMatchObject({ sku: '2000372078', url: 'https://kith.com/products/khwa030086-001?variant=45144745050240' });
    const api: CaptureLike = { url: 'https://s.example/p', html: '', structuredData: { ldJson: [], nextData: null, initialState: null, meta: {} }, interceptedRequests: [{ url: 'https://s.example/products/x.json', method: 'GET', resourceType: 'fetch', responseStatus: 200, responseHeaders: {}, responseBody: '', contentType: 'application/json', bodySize: 1, isJson: true, parsedJson: { product: { variants: [{ id: 45061353865273, sku: 'A', option1: 'Black', price: '209.99' }, { id: 45242474037305, sku: 'B', option1: 'Grey', price: '209.99' }] } }, timestamp: 0 }] };
    expect(detectVariantLists(api)[0]?.entries[0]).toMatchObject({ id: '45061353865273', sku: 'A' });
  });
  it('an offer url stands in for an entry without its own url (ProductGroup.hasVariant[i].offers.url)', () => {
    const rug = JSON.parse(readFileSync(new URL('./__fixtures__/page-variant/ruggable.json', import.meta.url), 'utf8'));
    const lists = detectVariantLists({ url: rug.url, html: '', structuredData: { ldJson: rug.ldJson, nextData: null, initialState: null, meta: {} }, interceptedRequests: [] });
    expect(lists[0]?.entries[1]).toMatchObject({ size: "6'x9'", url: '/products/ryder-soft-white-plush-rug?variant=42385836179511' });
  });
});
