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
  it('fails every product with variants when no answer carries a list to certify against', () => {
    const a = answers();
    delete a[U[0]!]!.list;
    delete a[U[1]!]!.list;
    const r = run(a);
    expect(r.pages[U[0]!]).toEqual({ status: 'fail', message: 'found no colours on product 1' });
    expect(r.pages[U[1]!]).toEqual({ status: 'fail', message: 'found no colours on product 2' });
    expect(r.passed).toBe(false);
  });
  it('catches a duplicate even when case or whitespace differs', () => {
    const c = captures();
    c[U[0]!] = cap(U[0]!, [group([v('Black', 'A1', '10.00'), v('black ', 'A2', '11.00')])]);
    expect(run(answers(), c).pages[U[0]!]).toEqual({ status: 'fail', message: 'two colours on product 1 read the same: Black' });
  });
  it('reports the partial from-product message on the first product not marking it, naming the first that does', () => {
    const a = answers();
    const s0 = a[U[0]!]!.spot!;
    delete s0.expected.in_stock;
    s0.fromProduct = ['in_stock'];
    const r = run(a);
    expect(r.pages[U[1]!]).toEqual({
      status: 'fail',
      message: 'In stock is taken from the product page on product 1 but from the list on product 2',
    });
  });
  it('reports the missing-field message from the candidate proven on the most pages, not merely the first by priority', () => {
    const urls = ['https://s.example/q/1', 'https://s.example/q/2', 'https://s.example/q/3'];
    const list = { source: 'json-ld' as const, path: 'hasVariant' };
    const page = (url: string, entries: Array<Record<string, string>>) => cap(url, [{ hasVariant: entries }]);
    const c: Record<string, CaptureLike | null> = {
      [urls[0]!]: page(urls[0]!, [{ a: 'X1', zzzvariant: 'X1' }, { a: 'o1', zzzvariant: 'o1' }]),
      [urls[1]!]: page(urls[1]!, [{ a: 'WRONG', zzzvariant: 'Y1' }, { a: 'o2', zzzvariant: 'o2' }]),
      [urls[2]!]: page(urls[2]!, [{ a: 'ALSO_WRONG', zzzvariant: 'Z1' }, { a: 'o3', zzzvariant: '' }]),
    };
    const a: Record<string, VariantAnswer> = {
      [urls[0]!]: { count: 2, labels: ['x', 'o'], list, spot: spot({ code: 'X1' }) },
      [urls[1]!]: { count: 2, labels: ['y', 'o'], list, spot: spot({ code: 'Y1' }) },
      [urls[2]!]: { count: 2, labels: ['z', 'o'], list, spot: spot({ code: 'Z1' }) },
    };
    const fields: EntryField[] = [{ key: 'code', name: 'Code', type: 'text', concept: 'no_such_concept' }];
    const r = certifyVariantList({ urls, captures: c, answers: a, fields, noun: 'codes' });
    // 'a' is correct on page 1 only (score 1); 'zzzvariant' is correct on pages 1 and 2 (score 2) and
    // only trips on page 3's other entry being blank. 'a' sorts first (shorter path) but must lose.
    expect(r.pages[urls[2]!]).toEqual({ status: 'fail', message: 'Code missing on 1 of 2 codes on product 3' });
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

describe('relative url and image values (read against the product page)', () => {
  const IMG: EntryField[] = [
    { key: 'image', name: 'Image', type: 'image', concept: 'image_url' },
    { key: 'colour', name: 'Colour', type: 'text', concept: 'axis', axisFrom: 'color' },
  ];
  const withImages = (): Record<string, CaptureLike | null> => ({
    [U[0]!]: cap(U[0]!, [group([v('Black', 'A1', '10.00', { image: '//cdn.s.example/a1.jpg' }), v('Red', 'A2', '11.00', { image: '/img/a2.jpg' })])]),
    [U[1]!]: cap(U[1]!, [group([v('Black', 'B1', '20.00', { image: 'img/b1.jpg' }), v('Red', 'B2', '21.00', { image: '/img/b2.jpg' }), v('White', 'B3', '22.00', { image: '//cdn.s.example/b3.jpg' })])]),
    [U[2]!]: cap(U[2]!, [{ '@type': 'Product', name: 'Plain', sku: 'C1' }]),
  });
  it('suggests a protocol-relative or relative image given the page url, and not without it', () => {
    const entry = resolveVariantList(withImages()[U[0]!]!, LIST)![0]!;
    expect(suggestEntryValues(entry, IMG, { pageUrl: U[0]! }).image).toEqual({ value: '//cdn.s.example/a1.jpg', path: 'image' });
    expect(suggestEntryValues(entry, IMG).image).toBeNull();
  });
  it('certifies an entry field whose values are relative', () => {
    const a: Record<string, VariantAnswer> = {
      [U[0]!]: { count: 2, labels: ['Black', 'Red'], list: LIST, spot: spot({ image: '//cdn.s.example/a1.jpg', colour: 'Black' }) },
      [U[1]!]: { count: 3, labels: ['Black', 'Red', 'White'], list: LIST, spot: spot({ image: 'https://s.example/p/img/b1.jpg', colour: 'Black' }) },
      [U[2]!]: { count: 0, labels: [] },
    };
    const r = certifyVariantList({ urls: U, captures: withImages(), answers: a, fields: IMG, noun: 'colours' });
    expect(r.pages[U[0]!]).toEqual({ status: 'pass', count: 2 });
    expect(r.pages[U[1]!]).toEqual({ status: 'pass', count: 3 });
    expect(r.entryPaths!.image).toEqual({ kind: 'path', path: 'image' });
    expect(r.passed).toBe(true);
  });
});

describe('an axis column several detected names map to', () => {
  const BOTH: EntryField[] = [{ key: 'colour', name: 'Colour', type: 'text', concept: 'axis', axisFrom: ['color', 'colour'] }];
  it('reads the first name that yields a value, in suggestions and certification', () => {
    const entry = { colour: 'Red', sku: 'X' };
    expect(suggestEntryValues(entry, BOTH)).toEqual({ colour: { value: 'Red', path: 'axis:colour' } });
    const c: Record<string, CaptureLike | null> = {
      [U[0]!]: cap(U[0]!, [group([{ color: 'Black', sku: 'A1' }, { color: 'Red', sku: 'A2' }])]),
      [U[1]!]: cap(U[1]!, [group([{ colour: 'Black', sku: 'B1' }, { colour: 'Red', sku: 'B2' }])]),
      [U[2]!]: cap(U[2]!, []),
    };
    const a: Record<string, VariantAnswer> = {
      [U[0]!]: { count: 2, labels: ['Black', 'Red'], list: LIST, spot: spot({ colour: 'Black' }) },
      [U[1]!]: { count: 2, labels: ['Black', 'Red'], list: LIST, spot: spot({ colour: 'Black' }) },
      [U[2]!]: { count: 0, labels: [] },
    };
    const r = certifyVariantList({ urls: U, captures: c, answers: a, fields: BOTH, noun: 'colours' });
    expect(r.passed).toBe(true);
    expect(r.entryPaths!.colour).toEqual({ kind: 'axis', from: ['color', 'colour'] });
  });
});

describe('a yes/no field read from an axis', () => {
  it('never certifies on the bare axis reading — only on a path the customer accepted', () => {
    const fields: EntryField[] = [{ key: 'gift', name: 'Gift wrap', type: 'boolean', concept: 'gift_wrap', axisFrom: 'giftwrap' }];
    const entries = (sku: string) => [{ giftwrap: 'yes', sku: `${sku}1` }, { giftwrap: 'no', sku: `${sku}2` }];
    const c: Record<string, CaptureLike | null> = {
      [U[0]!]: cap(U[0]!, [group(entries('A'))]), [U[1]!]: cap(U[1]!, [group(entries('B'))]), [U[2]!]: cap(U[2]!, []),
    };
    const a = (paths?: Record<string, string>): Record<string, VariantAnswer> => ({
      [U[0]!]: { count: 2, labels: ['a', 'b'], list: LIST, spot: spot({ gift: 'yes' }, paths ? { paths } : {}) },
      [U[1]!]: { count: 2, labels: ['a', 'b'], list: LIST, spot: spot({ gift: 'yes' }, paths ? { paths } : {}) },
      [U[2]!]: { count: 0, labels: [] },
    });
    const bare = certifyVariantList({ urls: U, captures: c, answers: a(), fields, noun: 'variants' });
    expect(bare.entryPaths!.gift).toBeUndefined();
    expect(bare.passed).toBe(false);
    const vouched = certifyVariantList({ urls: U, captures: c, answers: a({ gift: 'axis:giftwrap' }), fields, noun: 'variants' });
    expect(vouched.entryPaths!.gift).toEqual({ kind: 'axis', from: 'giftwrap' });
    expect(vouched.passed).toBe(true);
  });
});

describe('variantHash — what moves it', () => {
  const base = { method: 'list' as const, axes: [{ from: 'color', axisKey: 'colour' }], urls: U, answers: answers(), fields: FIELDS };
  const h = (o: Partial<typeof base> | Record<string, unknown>) => variantHash({ ...base, ...o } as typeof base);
  it('moves with the method', () => {
    expect(h({ method: 'links' })).not.toBe(h({}));
  });
  it('moves with the axis mapping', () => {
    expect(h({ axes: [{ from: 'colour', axisKey: 'colour' }] })).not.toBe(h({}));
    expect(h({ axes: [{ from: 'color', axisKey: 'shade' }] })).not.toBe(h({}));
  });
  it('moves when an entry field is added or dropped (a field changed level)', () => {
    expect(h({ fields: FIELDS.filter((f) => f.key !== 'sku') })).not.toBe(h({}));
    expect(h({ fields: [...FIELDS, { key: 'image', name: 'Image', type: 'image', concept: 'image_url' }] })).not.toBe(h({}));
  });
  it('moves when an entry field is retyped', () => {
    expect(h({ fields: FIELDS.map((f) => (f.key === 'sku' ? { ...f, type: 'number' as const } : f)) })).not.toBe(h({}));
  });
  it('does not move when an entry field is renamed', () => {
    expect(h({ fields: FIELDS.map((f) => ({ ...f, name: `${f.name} renamed` })) })).toBe(h({}));
  });
  it('moves when a proof page is added with no answer, and is independent of url order', () => {
    expect(h({ urls: [...U, 'https://s.example/p/4'] })).not.toBe(h({}));
    expect(h({ urls: [...U].reverse() })).toBe(h({}));
  });
});
