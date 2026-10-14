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
  it('marketing parameters are noise; ids come only from variant-style keys', () => {
    const a = addressVariant('https://s.example/products/x?variant=123&pr_rec_id=abc&pr_prod_strat=x&cm_mmc=y&icid=z&irclickid=w&ranMID=1&view=quick');
    expect(a.ids).toEqual(['123']);
    expect(a.pairs).toEqual([{ name: 'variant', value: '123' }]);
    expect(addressVariant('https://s.example/p?variantId=55').ids).toEqual(['55']);
    expect(addressVariant('https://s.example/p?sku=4006381333931').ids).toEqual(['4006381333931']);
    expect(addressVariant('https://s.example/p?pid=1234567').ids).toEqual([]);
    expect(addressVariant('https://s.example/p?pid=1234567').labels).toEqual(['1234567']);
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
  it('spaces around x, × or / between digits do not count', () => {
    for (const s of ["6' x 9'", "6'x9'", '06x09', '6 × 9', '6×9']) expect(normalizeLabel(s)).toBe(normalizeLabel('6x9'));
    expect(normalizeLabel('6 / 9')).toBe(normalizeLabel('6/9'));
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
  it('de-duplicates what the address and the page both carry', () => {
    const pv = pageVariantFrom('https://p.example/pd/x?swatch=16', { labels: ['16'], pairs: [{ name: 'swatch', value: '16' }] }, { labels: ['16'] });
    expect(pv.pairs).toEqual([{ name: 'swatch', value: '16' }]);
    expect(pv.labels).toEqual(['16']);
  });
  it('neither: present but empty', () => {
    expect(pageVariantFrom('https://k.example/products/x', null, {})).toEqual({ ids: [], pairs: [], labels: [], named: false, selected: false });
  });
});

describe('wrongVariant', () => {
  const url = 'https://p.example/pd/x/312123?swatch=16';
  it('named A, page shows B → the address text', () => {
    expect(wrongVariant(url, { labels: ['17'], pairs: [{ name: 'swatch', value: '17' }] }, {})).toBe('swatch=16');
  });
  it('named A, page shows A → null', () => {
    expect(wrongVariant(url, { labels: ['16'], pairs: [{ name: 'swatch', value: '16' }] }, {})).toBeNull();
  });
  it('named A, page shows A on that axis and something else on another → null (multi-axis)', () => {
    expect(wrongVariant(url, { labels: ['16', 'M'], pairs: [{ name: 'swatch', value: '16' }, { name: 'size', value: 'M' }] }, {})).toBeNull();
  });
  it('named A, no selection on the page → null', () => {
    expect(wrongVariant(url, null, {})).toBeNull();
  });
  it('an id against a label is not comparable → null', () => {
    const u = 'https://s.example/products/x?variant=123';
    expect(wrongVariant(u, { labels: ['Chill Grey'] }, {})).toBeNull();
  });
  it('an id against another id → the address text', () => {
    const u = 'https://s.example/products/x?variant=123';
    expect(wrongVariant(u, {}, { ids: ['999'] })).toBe('variant=123');
  });
  it('an id the page shows among other ids → null', () => {
    const u = 'https://s.example/products/x?variant=123';
    expect(wrongVariant(u, {}, { ids: ['123', '999'] })).toBeNull();
  });
  it('a pair whose name the page does not show never decides: ?pid=12345 against a picker showing M → null', () => {
    const u = 'https://s.example/products/x?pid=12345';
    expect(addressVariant(u).ids).toEqual([]);
    expect(wrongVariant(u, { labels: ['M'], pairs: [{ name: 'size', value: 'M' }] }, {})).toBeNull();
    expect(wrongVariant(u, { labels: ['M'] }, { ids: ['999999'] })).toBeNull();
  });
  it('a pair name compares case-insensitively; a spaced size equals the address size', () => {
    const u = 'https://r.example/products/x?size=6x9';
    expect(wrongVariant(u, { pairs: [{ name: 'Size', value: "6' x 9'" }] }, {})).toBeNull();
    expect(wrongVariant(u, { pairs: [{ name: 'Size', value: "8' x 10'" }] }, {})).toBe('size=6x9');
  });
});
