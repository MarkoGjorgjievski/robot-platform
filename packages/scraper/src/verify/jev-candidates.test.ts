import { describe, expect, it } from 'vitest';
import { isAmbiguous, jevFieldCandidates, jevVariantOptions, JEV_MAX_VARIANT_OPTIONS, type JevField } from './jev-candidates.js';
import type { Box } from './box-map.js';

const box = (text: string, tag = 'span', y = 100): Box => ({ xpaths: [`//${tag}`], text, rect: { x: 100, y, w: 200, h: 20 }, tag, kind: 'text' });
const price: JevField = { key: 'price', name: 'Price', type: 'money', concept: 'price', description: 'the price a buyer pays' };
const brand: JevField = { key: 'brand', name: 'Brand', type: 'text', concept: 'brand' };
const title: JevField = { key: 'title', name: 'Title', type: 'text', concept: 'product_name' };

describe('jevFieldCandidates', () => {
  it('offers a sale price and a crossed-out list price as two candidates (Ruggable)', () => {
    const c = jevFieldCandidates(price, { ldJson: [{ '@type': 'Product', offers: { price: '374.25' } }], meta: {} }, [box('Sierra Rug', 'h1', 80), box('$374.25', 'span', 200), box('$499.00', 's', 200)]);
    expect(c.map((x) => x.value)).toEqual(['374.25', '$499.00']);
    expect(isAmbiguous(price, c)).toBe(true);
  });
  it('offers the brand and the site tagline (Gymshark)', () => {
    const c = jevFieldCandidates(brand, { ldJson: [{ '@type': 'Product', brand: { name: 'Gymshark' } }], meta: { 'og:site_name': 'Gymshark | We Do Gym' } }, []);
    expect(c.map((x) => x.value)).toEqual(['Gymshark', 'Gymshark | We Do Gym']);
  });
  it('offers the JSON-LD name and the heading (Colourpop)', () => {
    const c = jevFieldCandidates(title, { ldJson: [{ '@type': 'Product', name: 'Drift' }], meta: {} }, [box('Super Shock Shadow', 'h1', 80)]);
    expect(c.map((x) => x.value).sort()).toEqual(['Drift', 'Super Shock Shadow']);
  });
  it('money candidates that normalise to one value are not ambiguous', () => {
    const c = jevFieldCandidates(price, { ldJson: [{ offers: { price: '22' } }], meta: { 'product:price:amount': '22.00' } }, [box('Widget', 'h1', 80), box('$22.00', 'span', 200)]);
    expect(c).toHaveLength(1);
    expect(isAmbiguous(price, c)).toBe(false);
  });
  it('never asks a boolean, image or url field', () => {
    const stock: JevField = { key: 'stock', name: 'In stock', type: 'boolean', concept: 'availability' };
    expect(isAmbiguous(stock, [{ id: 'c1', value: 'yes', source: 'x' }, { id: 'c2', value: 'no', source: 'y' }])).toBe(false);
  });
  it('caps at 30 candidates with stable ids c1…', () => {
    const ld = { offers: Array.from({ length: 40 }, (_, i) => ({ price: String(100 + i) })) };
    const c = jevFieldCandidates(price, { ldJson: [ld], meta: {} }, []);
    expect(c).toHaveLength(30);
    expect(c[0]!.id).toBe('c1');
  });
});

describe('jevVariantOptions', () => {
  const hasVariant = (n: number) => Array.from({ length: n }, (_, i) => ({ '@type': 'Product', sku: `R-${i}`, size: `${i + 2}'x${i + 3}'`, offers: { price: String(100 + i), url: `/p?variant=${1000 + i}` } }));
  const cap = (pv?: unknown, n = 4) => ({
    structuredData: { ldJson: [{ '@type': 'ProductGroup', variesBy: ['https://schema.org/size'], hasVariant: hasVariant(n) }], nextData: null, initialState: null, meta: {} },
    interceptedRequests: [],
    ...(pv ? { pageVariant: pv as never } : {}),
  });
  it('labels entries by option values and name, never price, and finds the [page] match', () => {
    const r = jevVariantOptions(cap({ ids: [], pairs: [{ name: 'size', value: "4'x5'" }], labels: ["4'x5'"], named: true, selected: false }))!;
    expect(r.options.map((o) => o.label)).toEqual(["2'x3'", "3'x4'", "4'x5'", "5'x6'"]);
    expect(r.options.every((o) => !/\d+\.\d\d|100|101/.test(o.label))).toBe(true);
    expect(r.pageMatch).toBe('e3');
  });
  it('no variant list → null', () => {
    expect(jevVariantOptions({ structuredData: { ldJson: [{ '@type': 'Product', name: 'x' }], nextData: null, initialState: null, meta: {} }, interceptedRequests: [] })).toBeNull();
  });
  it('caps at 40 options and keeps the [page] match', () => {
    const r = jevVariantOptions(cap({ ids: [], pairs: [{ name: 'size', value: "57'x58'" }], labels: ["57'x58'"], named: true, selected: false }, 60))!;
    expect(r.options.length).toBeLessThanOrEqual(JEV_MAX_VARIANT_OPTIONS);
    expect(r.pageMatch).not.toBeNull();
    expect(r.options.some((o) => o.id === r.pageMatch)).toBe(true);
  });
});
