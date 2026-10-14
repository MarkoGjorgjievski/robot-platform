import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pageVariantFrom, type PageVariant } from '@robot/browser';
import { matchesPageVariant, pickPageEntry } from './page-variant-match.js';
import { getByDotPath } from '../domain-cache.js';
import { resolveStructured } from './search-structured.js';

type Fx = { url: string; picker?: { pairs?: Array<{ name: string; value: string }>; labels?: string[] }; ldJson: Record<string, unknown>[]; api: unknown[] };
const load = (name: string): Fx => JSON.parse(readFileSync(new URL(`./__fixtures__/page-variant/${name}.json`, import.meta.url), 'utf8'));
const pvOf = (fx: Fx): PageVariant => pageVariantFrom(fx.url, fx.picker ?? null, {});
const captureOf = (fx: Fx) => ({
  structuredData: { ldJson: fx.ldJson, nextData: null, initialState: null, meta: {} },
  interceptedRequests: fx.api.map((parsedJson) => ({ url: 'https://x/api', method: 'GET', resourceType: 'fetch', responseStatus: 200, responseHeaders: {}, responseBody: '', contentType: 'application/json', bodySize: 1, isJson: true, parsedJson, timestamp: 0 })),
});

describe('matchesPageVariant', () => {
  it('rule 1: a Shopify ?variant= id matches an entry url, an @id, an id or a variant_id', () => {
    const pv = pvOf(load('skullcandy'));
    expect(matchesPageVariant({ offers: { url: 'https://www.skullcandy.com/products/crusher-evo?variant=45242474037305' } }, pv)).toBe(true);
    expect(matchesPageVariant({ offers: { url: 'https://www.skullcandy.com/products/crusher-evo?variant=45061353865273' } }, pv)).toBe(false);
    expect(matchesPageVariant({ id: 45242474037305 }, pv)).toBe(true);
    expect(matchesPageVariant({ variant_id: '45242474037305' }, pv)).toBe(true);
    expect(matchesPageVariant({ '@id': 'https://x/p?variant=45242474037305#offer' }, pv)).toBe(true);
  });
  it('a relative entry url still yields its variant id', () => {
    const pv = pageVariantFrom('https://ruggable.com/products/ryder?variant=42385836179511', null, {});
    expect(matchesPageVariant({ offers: { url: '/products/ryder-soft-white-plush-rug?variant=42385836179511' } }, pv)).toBe(true);
  });
  it('rule 2: option pairs match selectedOptions / options / option1-3 / an entry key named like the pair', () => {
    const pv = pageVariantFrom('https://k.example/p?size=XS', null, {});
    expect(matchesPageVariant({ selectedOptions: [{ name: 'Size', value: 'xs' }] }, pv)).toBe(true);
    expect(matchesPageVariant({ options: [{ name: 'size', value: 'XS' }] }, pv)).toBe(true);
    expect(matchesPageVariant({ option1: 'XS' }, pv)).toBe(true);
    expect(matchesPageVariant({ size: 'XS' }, pv)).toBe(true);
    expect(matchesPageVariant({ size: 'S' }, pv)).toBe(false);
    expect(matchesPageVariant({ additionalProperty: { name: 'size', value: 'XS' } }, pv)).toBe(true);
  });
  it('rule 2: a pair the entry does not carry is ignored, but one pair must match', () => {
    const pv = pvOf(load('ruggable'));   // size=6x9 & system=rug-cvr
    expect(matchesPageVariant({ size: "6'x9'" }, pv)).toBe(true);
    expect(matchesPageVariant({ material: 'wool' }, pv)).toBe(false);
  });
  it('rule 3: a label matches a size, colour, axis value, a sku suffix, or is contained in a name', () => {
    const rug = pvOf(load('ruggable'));
    expect(matchesPageVariant({ sku: 'RUG-CVR-IND-RCT-PLS-PH015-06x09' }, rug)).toBe(true);
    expect(matchesPageVariant({ sku: 'RUG-CVR-IND-RCT-PLS-PH015-05x07' }, rug)).toBe(false);
    const bur = pvOf(load('burrow'));
    expect(matchesPageVariant((load('burrow').ldJson[0]!.hasVariant as unknown[])[0], bur)).toBe(true);
    expect(matchesPageVariant((load('burrow').ldJson[0]!.hasVariant as unknown[])[2], bur)).toBe(false);
  });
  it('a label of fewer than three characters never matches by containment', () => {
    const pv = pageVariantFrom('https://p.example/pd/x?swatch=16', null, {});
    expect(matchesPageVariant({ name: 'Model 2016 Classic' }, pv)).toBe(false);
    expect(matchesPageVariant({ swatch: '16' }, pv)).toBe(true);
  });
  it('matching never reads a price or an availability; an empty page variant matches nothing', () => {
    const pv = pageVariantFrom('https://k.example/p?size=810', null, {});
    expect(matchesPageVariant({ price: 810, availability: 'InStock' }, pv)).toBe(false);
    const empty = pageVariantFrom('https://k.example/p', null, {});
    expect(matchesPageVariant({ size: '' }, empty)).toBe(false);
    expect(matchesPageVariant({ id: 1 }, empty)).toBe(false);
  });
});

describe('pickPageEntry', () => {
  it('exactly one match → that entry; two matching entries resolve to nothing; none → nothing', () => {
    const pv = pageVariantFrom('https://k.example/p?size=M', null, {});
    const one = [{ size: 'S' }, { size: 'M', sku: 'a' }];
    expect(pickPageEntry(one, pv)).toEqual({ size: 'M', sku: 'a' });
    const two = [{ size: 'M', color: 'red' }, { size: 'M', color: 'blue' }];
    expect(pickPageEntry(two, pv)).toBeUndefined();
    expect(pickPageEntry([{ size: 'S' }], pv)).toBeUndefined();
    expect(pickPageEntry(one, undefined)).toBeUndefined();
  });
});

describe('getByDotPath with [page]', () => {
  const rug = load('ruggable');
  it('resolves offers by the page variant, never entry 0', () => {
    const pv = pvOf(rug);
    expect(getByDotPath(rug.ldJson[0], 'hasVariant[page].offers.price', { pageVariant: pv })).toBe('569.00');
    expect(getByDotPath(rug.ldJson[0], 'hasVariant[page].sku', { pageVariant: pv })).toBe('RUG-CVR-IND-RCT-PLS-PH015-06x09');
  });
  it('no page variant: [page] yields nothing and the index path is unchanged', () => {
    expect(getByDotPath(rug.ldJson[0], 'hasVariant[page].offers.price')).toBeUndefined();
    expect(getByDotPath(rug.ldJson[0], 'hasVariant[page].offers.price', { pageVariant: pageVariantFrom('https://r.example/p', null, {}) })).toBeUndefined();
    expect(getByDotPath(rug.ldJson[0], 'hasVariant[0].offers.price', { pageVariant: pvOf(rug) })).toBe('439.00');
    expect(getByDotPath(rug.ldJson[0], 'hasVariant[0].offers.price')).toBe('439.00');
  });
  it('a dot key named page is a key, not the step (spec §11 property 2)', () => {
    const body = { data: { page: { total: 7 }, pages: [{ n: 1 }] } };
    expect(getByDotPath(body, 'data.page.total')).toBe(7);
    expect(getByDotPath(body, 'data.page.total', { pageVariant: pvOf(rug) })).toBe(7);
  });
  it('[page] on a non-array yields nothing', () => {
    expect(getByDotPath({ offers: { price: 1 } }, 'offers[page].price', { pageVariant: pvOf(rug) })).toBeUndefined();
  });
});

describe('resolveStructured with a page variant', () => {
  it('skullcandy: one block per colour — offers[page].availability reads the block whose offer matches', () => {
    const fx = load('skullcandy');
    const ctx = { pageVariant: pvOf(fx) };
    // `offers` is an object per block; `[page]` on it must not break a block-level read. The variant list is the ProductGroup's.
    expect(resolveStructured(captureOf(fx), 'json-ld', 'hasVariant[page].offers.availability', ctx)).toBe('http://schema.org/OutOfStock');
    expect(resolveStructured(captureOf(fx), 'api', 'product.variants[page].available', ctx)).toBe(false);
    expect(resolveStructured(captureOf(fx), 'json-ld', 'hasVariant[0].offers.availability', ctx)).toBe('http://schema.org/InStock');
  });
  it('kith: the address names nothing, the picker selects XS → offers[page] is the XS offer', () => {
    const fx = load('kith');
    expect(resolveStructured(captureOf(fx), 'json-ld', 'offers[page].availability', { pageVariant: pvOf(fx) })).toBe('https://schema.org/InStock');
    expect(resolveStructured(captureOf(fx), 'json-ld', 'offers[page].sku', { pageVariant: pvOf(fx) })).toBe('2000372078');
  });
  it('burrow: option pairs in the address, names in the data', () => {
    const fx = load('burrow');
    expect(resolveStructured(captureOf(fx), 'json-ld', 'hasVariant[page].offers.price', { pageVariant: pvOf(fx) })).toBe('1306.0');
    const camel = { ...fx, url: 'https://burrow.com/products/range-plus-4-piece?Fabric=Camel+-+Top+Grain+Leather&Leg+Finish=Black+-+Metal' };
    expect(resolveStructured(captureOf(camel), 'json-ld', 'hasVariant[page].offers.price', { pageVariant: pvOf(camel) })).toBe('2801.0');
  });
});
