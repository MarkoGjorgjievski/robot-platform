import { describe, expect, it } from 'vitest';
import { addressVariant, normalizeLabel, pageVariantFrom, selectedInPageData, wrongVariant } from './page-variant.js';

describe('addressVariant', () => {
  it('reads a Shopify variant id, option pairs, labels and a key=value fragment', () => {
    expect(addressVariant('https://s.example/products/x?variant=45061353865273')).toEqual({ ids: ['45061353865273'], pairs: [{ name: 'variant', value: '45061353865273' }], labels: [], text: 'variant=45061353865273' });
    const r = addressVariant('https://r.example/products/x?size=6x9&system=rug-cvr');
    expect(r.ids).toEqual([]);
    expect(r.pairs).toEqual([{ name: 'size', value: '6x9' }, { name: 'system', value: 'rug-cvr' }]);
    expect(r.labels).toEqual(['6x9', 'rug-cvr']);
    expect(r.text).toBe('size=6x9&system=rug-cvr');
    const b = addressVariant('https://b.example/products/x?Fabric=Moss+Green+-+Performance+Flatweave&Leg+Finish=Black+-+Metal');
    expect(b.pairs).toEqual([{ name: 'Fabric', value: 'Moss Green - Performance Flatweave' }, { name: 'Leg Finish', value: 'Black - Metal' }]);
    expect(addressVariant('https://s.example/p/1#sku=p1-blue').pairs).toEqual([{ name: 'sku', value: 'p1-blue' }]);
  });
  it('tracking parameters are not pairs', () => {
    const a = addressVariant('https://s.example/products/x?variant=123&utm_source=x&gclid=abc&fbclid=1&ref=mail');
    expect(a.pairs).toEqual([{ name: 'variant', value: '123' }]);
    expect(a.ids).toEqual(['123']);
    expect(a.text).toBe('variant=123');
  });
  it('an address with no query and no key=value fragment names nothing', () => {
    expect(addressVariant('https://k.example/products/khwa030086-001#reviews')).toEqual({ ids: [], pairs: [], labels: [], text: '' });
  });
  it('a numeric id-like value names an id; a word names a label', () => {
    expect(addressVariant('https://p.example/pd/x/312123?swatch=16').ids).toEqual([]);
    expect(addressVariant('https://p.example/pd/x/312123?swatch=16').labels).toEqual(['16']);
    expect(addressVariant('https://l.example/PH5522-00.html?color=031').labels).toEqual(['031']);
  });
});

describe('normalizeLabel', () => {
  it('equates the address spelling, the label spelling and a sku suffix', () => {
    expect(normalizeLabel('6x9')).toBe(normalizeLabel("6'x9'"));
    expect(normalizeLabel('06x09')).toBe(normalizeLabel('6x9'));
    expect(normalizeLabel('Moss Green - Performance Flatweave')).toBe('moss green performance flatweave');
    expect(normalizeLabel('XXL ')).toBe('xxl');
  });
});

describe('selectedInPageData', () => {
  it('reads selectedVariant / selected_variant / currentVariant ids and skus from page data and api bodies', () => {
    const s = selectedInPageData(
      { ldJson: [], nextData: { props: { pageProps: { selectedVariant: { id: 7, sku: 'ABC-M' } } } }, initialState: null },
      [{ product: { current_variant: 'gid://shopify/ProductVariant/45061353865273' } }],
    );
    expect(s.ids).toEqual(['7', '45061353865273']);
    expect(s.labels).toEqual(['ABC-M']);
  });
  it('finds nothing in data with no selected key', () => {
    expect(selectedInPageData({ ldJson: [{ '@type': 'Product', name: 'x' }], nextData: null, initialState: null }, [])).toEqual({});
  });
});

describe('pageVariantFrom', () => {
  it('named from the address, selected from the page', () => {
    const pv = pageVariantFrom('https://s.example/products/x?variant=123', { labels: ['Chill Grey'] }, {});
    expect(pv).toEqual({ ids: ['123'], pairs: [{ name: 'variant', value: '123' }], labels: ['Chill Grey'], named: true, selected: true });
  });
  it('an unnamed address uses the page selection alone', () => {
    const pv = pageVariantFrom('https://k.example/products/khwa030086-001', { pairs: [{ name: 'size', value: 'XS' }], labels: ['XS'] }, {});
    expect(pv.named).toBe(false);
    expect(pv.selected).toBe(true);
    expect(pv.pairs).toEqual([{ name: 'size', value: 'XS' }]);
  });
  it('neither: present but empty', () => {
    expect(pageVariantFrom('https://k.example/products/x', null, {})).toEqual({ ids: [], pairs: [], labels: [], named: false, selected: false });
  });
});

describe('wrongVariant', () => {
  const url = 'https://p.example/pd/x/312123?swatch=16';
  it('named A, page shows B → the address text', () => {
    const pv = pageVariantFrom(url, { labels: ['17'], pairs: [{ name: 'swatch', value: '17' }] }, {});
    expect(wrongVariant(pv, url)).toBe('swatch=16');
  });
  it('named A, page shows A → null', () => {
    expect(wrongVariant(pageVariantFrom(url, { labels: ['16'] }, {}), url)).toBeNull();
  });
  it('named A, no selection on the page → null', () => {
    expect(wrongVariant(pageVariantFrom(url, null, {}), url)).toBeNull();
  });
  it('an id against a label is not comparable → null', () => {
    const u = 'https://s.example/products/x?variant=123';
    expect(wrongVariant(pageVariantFrom(u, { labels: ['Chill Grey'] }, {}), u)).toBeNull();
  });
  it('an id against another id → the address text', () => {
    const u = 'https://s.example/products/x?variant=123';
    expect(wrongVariant(pageVariantFrom(u, {}, { ids: ['999'] }), u)).toBe('variant=123');
  });
});
