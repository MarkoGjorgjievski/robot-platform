import { describe, expect, it } from 'vitest';
import { buildVariantRows, groupKeyOf, summariseVariantRows, variantKeyOf, type VariantRunPlan } from './variant-rows.js';

const plan: VariantRunPlan = {
  method: 'list', list: { source: 'json-ld', path: 'hasVariant' },
  entryPaths: { price: { kind: 'path', path: 'offers.price' }, sku: { kind: 'path', path: 'sku' }, colour: { kind: 'axis', from: 'color' } },
  fromProduct: ['in_stock'], axes: [{ key: 'colour', name: 'Colour' }],
  fields: [
    { key: 'title', name: 'Title', type: 'text', level: 'product' },
    { key: 'price', name: 'Price', type: 'money', level: 'variant' },
    { key: 'sku', name: 'SKU', type: 'text', level: 'variant' },
    { key: 'in_stock', name: 'In stock', type: 'boolean', level: 'variant' },
  ],
  skuKey: 'sku',
};
const product = { title: 'Shoe', price: '10.00', sku: 'P1', in_stock: true };
const entries = [
  { '@type': 'Product', color: 'Black', sku: 'A1', offers: { price: '10.00' } },
  { '@type': 'Product', color: 'Red', sku: 'A2', offers: {} },
];

describe('buildVariantRows', () => {
  it('one row per entry: product fields, variant fields from the entry, from-product fields copied, axis column, keys', () => {
    const r = buildVariantRows({ productRow: product, entries, plan, pageUrl: 'https://s.example/p/1#x' });
    expect(r.withVariants).toBe(true);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({ title: 'Shoe', price: 10, sku: 'A1', in_stock: true, colour: 'Black', _product_key: 'https://s.example/p/1', _variant_key: 'A1' });
  });

  it('an entry missing a variant field is partial, the row is kept', () => {
    const r = buildVariantRows({ productRow: product, entries, plan, pageUrl: 'https://s.example/p/1' });
    expect(r.rows[1]).toMatchObject({ price: null, _variant_partial: true });
    expect(r.partial).toBe(true);
  });

  it('no list on the page: one row, without variants', () => {
    const r = buildVariantRows({ productRow: product, entries: null, plan, pageUrl: 'https://s.example/p/1' });
    expect(r).toMatchObject({ withVariants: false, partial: false });
    expect(r.rows).toEqual([{ ...product, _product_key: 'https://s.example/p/1' }]);
  });

  it('a productRow carrying _url and _page_number: every variant row keeps both', () => {
    const productWithMeta = { ...product, _url: 'https://s.example/p/1', _page_number: 2 };
    const r = buildVariantRows({ productRow: productWithMeta, entries, plan, pageUrl: 'https://s.example/p/1' });
    for (const row of r.rows) expect(row).toMatchObject({ _url: 'https://s.example/p/1', _page_number: 2 });
  });
});

describe('variantKeyOf', () => {
  it('falls back to the axis values when there is no sku', () => {
    expect(variantKeyOf({ colour: 'Black', size: '10C' }, { ...plan, skuKey: undefined, axes: [{ key: 'colour', name: 'Colour' }, { key: 'size', name: 'Size' }] })).toBe('Black · 10C');
  });
});

describe('groupKeyOf', () => {
  it('the group key is the smallest normalised url, whichever member asks', () => {
    expect(groupKeyOf(['https://s.example/t/b#x', 'https://s.example/t/a', 'https://s.example/t/c'])).toBe('https://s.example/t/a');
  });
});

describe('summariseVariantRows', () => {
  it('summarises rows', () => {
    const rows = [
      { _product_key: 'p1', _variant_key: 'A1' }, { _product_key: 'p1', _variant_key: 'A2', _variant_partial: true },
      { _product_key: 'p2' },
    ];
    expect(summariseVariantRows(rows, 3)).toEqual({ variants: 2, products: 2, withoutVariants: 1, partial: 1, variantsSkippedForBudget: 3 });
  });
});
