import { describe, expect, it } from 'vitest';
import { certifyVariantList, suggestEntryValues, variantHash, resolveVariantList, type EntryField } from './variant-certify.js';
import type { CaptureLike } from './certify.js';
import type { VariantAnswer } from './types.js';

const v = (color: string, sku: string, price: string | null, extra: Record<string, unknown> = {}) => ({
  '@type': 'Product', color, sku, featured: true,
  ...(price === null ? {} : { offers: { '@type': 'Offer', price, availability: 'https://schema.org/InStock' } }), ...extra,
});
const group = (variants: unknown[]) => ({ '@type': 'ProductGroup', name: 'Shoe', variesBy: ['https://schema.org/color'], hasVariant: variants });
const cap = (url: string, ld: unknown[]): CaptureLike => ({
  url, html: '<html><body></body></html>', interceptedRequests: [],
  structuredData: { ldJson: ld as Record<string, unknown>[], nextData: null, initialState: null, meta: {} },
});
const U = ['https://s.example/p/1', 'https://s.example/p/2', 'https://s.example/p/3'];
const FIELDS: EntryField[] = [
  { key: 'price', name: 'Price', type: 'money', concept: 'price' },
  { key: 'sku', name: 'SKU', type: 'text', concept: 'sku' },
  { key: 'in_stock', name: 'In stock', type: 'boolean', concept: 'availability' },
  { key: 'colour', name: 'Colour', type: 'text', concept: 'axis', axisFrom: 'color' },
];
const LIST = { source: 'json-ld' as const, path: 'hasVariant' };
const spot = (expected: Record<string, string>, extra: Partial<NonNullable<VariantAnswer['spot']>> = {}) => ({ index: 0, expected, ...extra });
const captures = (): Record<string, CaptureLike | null> => ({
  [U[0]!]: cap(U[0]!, [group([v('Black', 'A1', '10.00'), v('Red', 'A2', '11.00')])]),
  [U[1]!]: cap(U[1]!, [group([v('Black', 'B1', '20.00'), v('Red', 'B2', '21.00'), v('White', 'B3', '22.00')])]),
  [U[2]!]: cap(U[2]!, [{ '@type': 'Product', name: 'Plain', sku: 'C1', offers: { price: '5.00' } }]),
});
const answers = (): Record<string, VariantAnswer> => ({
  [U[0]!]: { count: 2, labels: ['Black', 'Red'], list: LIST, spot: spot({ price: '10.00', sku: 'A1', in_stock: 'yes', colour: 'Black' }) },
  [U[1]!]: { count: 3, labels: ['Black', 'Red', 'White'], list: LIST, spot: spot({ price: '20.00', sku: 'B1', in_stock: 'yes', colour: 'Black' }) },
  [U[2]!]: { count: 0, labels: [] },
});
const run = (a = answers(), c: Record<string, CaptureLike | null> = captures()) =>
  certifyVariantList({ urls: U, captures: c, answers: a, fields: FIELDS, noun: 'colours' });

describe('certifyVariantList', () => {
  it('certifies the list and an entry path per field; a product without variants reads none', () => {
    const r = run();
    expect(r.passed).toBe(true);
    expect(r.list).toEqual(LIST);
    expect(r.entryPaths).toEqual({
      price: { kind: 'path', path: 'offers.price' }, sku: { kind: 'path', path: 'sku' },
      in_stock: { kind: 'path', path: 'offers.availability' }, colour: { kind: 'axis', from: 'color' },
    });
    expect(r.pages[U[0]!]).toEqual({ status: 'pass', count: 2 });
    expect(r.pages[U[2]!]).toEqual({ status: 'none' });
  });
  it('a yes/no field never certifies on a path that does not mean it (featured: true)', () => {
    expect(run().entryPaths!.in_stock).toEqual({ kind: 'path', path: 'offers.availability' });
  });
  it('reports a count that does not match', () => {
    const a = answers(); a[U[1]!] = { ...a[U[1]!]!, count: 4, labels: ['Black', 'Red', 'White', 'Blue'] };
    const r = run(a);
    expect(r.passed).toBe(false);
    expect(r.pages[U[1]!]).toEqual({ status: 'fail', message: 'found 3 of 4 colours on product 2' });
  });
  it('reports an entry missing a field', () => {
    const c = captures();
    c[U[1]!] = cap(U[1]!, [group([v('Black', 'B1', '20.00'), v('Red', 'B2', null), v('White', 'B3', '22.00')])]);
    expect(run(answers(), c).pages[U[1]!]).toEqual({ status: 'fail', message: 'Price missing on 1 of 3 colours on product 2' });
  });
  it('reports two variants that read the same', () => {
    const c = captures();
    c[U[0]!] = cap(U[0]!, [group([v('Black', 'A1', '10.00'), v('Black', 'A2', '11.00')])]);
    expect(run(answers(), c).pages[U[0]!]).toEqual({ status: 'fail', message: 'two colours on product 1 read the same: Black' });
  });
  it('asks to confirm a list on a product answered as having none', () => {
    const a = answers(); a[U[1]!] = { count: 0, labels: [] };
    expect(run(a).pages[U[1]!]).toEqual({ status: 'fail', message: 'product 2 lists 3 colours — confirm them' });
  });
  it('a field marked from the product page on every product needs no entry path', () => {
    const a = answers();
    for (const u of [U[0]!, U[1]!]) { const s = a[u]!.spot!; delete s.expected.in_stock; s.fromProduct = ['in_stock']; }
    const r = run(a);
    expect(r.passed).toBe(true);
    expect(r.fromProduct).toEqual(['in_stock']);
    expect(r.entryPaths!.in_stock).toBeUndefined();
  });
  it('a website where no product has variants fails as a whole', () => {
    const a: Record<string, VariantAnswer> = { [U[0]!]: { count: 0, labels: [] }, [U[1]!]: { count: 0, labels: [] }, [U[2]!]: { count: 0, labels: [] } };
    const c = { [U[0]!]: cap(U[0]!, []), [U[1]!]: cap(U[1]!, []), [U[2]!]: cap(U[2]!, []) };
    const r = run(a, c);
    expect(r.passed).toBe(false);
    expect(r.problem).toBe('None of the products has variants — add one that does, or choose No variants on this website');
  });
  it('a page without a capture is not_captured and fails the whole', () => {
    const c = captures(); c[U[1]!] = null;
    const r = run(answers(), c);
    expect(r.pages[U[1]!]).toEqual({ status: 'not_captured' });
    expect(r.passed).toBe(false);
  });
});

describe('suggestEntryValues', () => {
  it('suggests by meaning, axis by its key', () => {
    const list = resolveVariantList(captures()[U[0]!]!, LIST)!;
    expect(suggestEntryValues(list[1]!, FIELDS)).toEqual({
      price: { value: '11.00', path: 'offers.price' }, sku: { value: 'A2', path: 'sku' },
      in_stock: { value: 'https://schema.org/InStock', path: 'offers.availability' }, colour: { value: 'Red', path: 'axis:color' },
    });
  });
});

describe('variantHash', () => {
  const base = { method: 'list' as const, axes: [{ from: 'color', axisKey: 'colour' }], urls: U, answers: answers(), fields: FIELDS };
  it('is stable under key order and moves with an answer', () => {
    const reordered = Object.fromEntries(Object.entries(answers()).reverse());
    expect(variantHash({ ...base, answers: reordered })).toBe(variantHash(base));
    const a = answers(); a[U[0]!] = { ...a[U[0]!]!, count: 3 };
    expect(variantHash({ ...base, answers: a })).not.toBe(variantHash(base));
  });
  it('ignores answers for urls no longer in the set', () => {
    const a = { ...answers(), 'https://s.example/p/old': { count: 2, labels: ['x', 'y'] } };
    expect(variantHash({ ...base, answers: a })).toBe(variantHash(base));
  });
});
