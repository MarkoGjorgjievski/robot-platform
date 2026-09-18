import { describe, it, expect } from 'vitest';
import { certify, checkedPages, gatherCandidates, rankCertified, type CaptureLike } from './certify.js';
import { loadShopExample, SHOP_EXAMPLE_URLS as U } from '../__fixtures__/verify/load.js';
import type { DomHit } from './dom-scripts.js';
import type { Mark, SchemaDefinitionField } from './types.js';

const field = { key: 'price', name: 'Price', type: 'money' as const, description: 'green number', concept: 'price' };

function cap(url: string, price: string, other: string): CaptureLike {
  return {
    url, html: '<html></html>',
    structuredData: { ldJson: [{ offers: { price } }], nextData: null, initialState: null, meta: { 'product:price:amount': other } },
    interceptedRequests: [],
  };
}
const captures = {
  'https://s.example/1': cap('https://s.example/1', '129.99', '129.99'),
  'https://s.example/2': cap('https://s.example/2', '219.99', '219.99'),
  'https://s.example/3': cap('https://s.example/3', '149.00', '999.00'),
};
const expected = { 'https://s.example/1': '129.99', 'https://s.example/2': '219.99', 'https://s.example/3': '149' };
const xpathDeps = { evalXPaths: async (_html: string, xps: string[]) => Object.fromEntries(xps.map((x) => [x, x.includes('now') ? 'ignored' : null])) };

describe('certify', () => {
  it('certifies only the path correct on all three, ranks it, and passes every cell', async () => {
    const r = await certify({ field, expected, captures, candidates: [
      { source: 'json-ld', path: 'offers.price', transform: 'identity' },
      { source: 'meta', path: 'product:price:amount', transform: 'identity' },
    ] }, xpathDeps);
    expect(r.certified).toEqual([{ source: 'json-ld', path: 'offers.price', transform: 'identity' }]);
    expect(Object.values(r.cells).every((c) => c.status === 'pass')).toBe(true);
    expect(r.cells['https://s.example/3']).toEqual({ status: 'pass', found: '149.00', path: r.certified[0] });
    expect(r.weakEvidence).toBe(false);
    expect(r.incomplete).toBe(false);
  });
  it('reports different_value on the page where a 2-of-3 path disagrees, pass nowhere', async () => {
    const r = await certify({ field, expected, captures, candidates: [{ source: 'meta', path: 'product:price:amount', transform: 'identity' }] }, xpathDeps);
    expect(r.certified).toEqual([]);
    expect(r.cells['https://s.example/3']).toMatchObject({ status: 'fail', reason: 'different_value', found: '999.00' });
    expect(r.cells['https://s.example/1']).toMatchObject({ status: 'fail', reason: 'ambiguous' });
  });
  it('reports not_found when nothing hit, not_captured for a null capture', async () => {
    const r = await certify({ field, expected, captures: { ...captures, 'https://s.example/3': null }, candidates: [] }, xpathDeps);
    expect(r.cells['https://s.example/1']).toEqual({ status: 'fail', reason: 'not_found' });
    expect(r.cells['https://s.example/3']).toEqual({ status: 'not_captured' });
  });
  it('flags weak evidence when all expected values are identical', async () => {
    const same = { 'https://s.example/1': '129.99', 'https://s.example/2': '129.99', 'https://s.example/3': '129.99' };
    const caps = { ...captures, 'https://s.example/2': cap('https://s.example/2', '129.99', 'x'), 'https://s.example/3': cap('https://s.example/3', '129.99', 'x') };
    const r = await certify({ field, expected: same, captures: caps, candidates: [{ source: 'json-ld', path: 'offers.price', transform: 'identity' }] }, xpathDeps);
    expect(r.weakEvidence).toBe(true);
    expect(r.certified).toHaveLength(1);
  });
  it('rejects an xpath that embeds the expected value', async () => {
    const r = await certify({ field, expected, captures, candidates: [{ source: 'xpath', path: `//span[contains(text(),'129.99')]`, transform: 'identity' }] }, xpathDeps);
    expect(r.certified).toEqual([]);
  });
  it('never certifies from a single captured URL, but passes that cell and flags incomplete', async () => {
    const r = await certify({
      field,
      expected,
      captures: { ...captures, 'https://s.example/2': null, 'https://s.example/3': null },
      candidates: [{ source: 'json-ld', path: 'offers.price', transform: 'identity' }],
    }, xpathDeps);
    expect(r.certified).toEqual([]);
    expect(r.incomplete).toBe(true);
    expect(r.cells['https://s.example/1']).toEqual({
      status: 'pass', found: '129.99', path: { source: 'json-ld', path: 'offers.price', transform: 'identity' },
    });
    expect(r.cells['https://s.example/2']).toEqual({ status: 'not_captured' });
    expect(r.cells['https://s.example/3']).toEqual({ status: 'not_captured' });
  });
});

// Second layout (spec 2026-09-17 §3). Page 4 carries the price under a
// different JSON-LD key; `offers.price` is absent there.
function cap2(url: string, price: string): CaptureLike {
  return {
    url, html: '<html></html>',
    structuredData: { ldJson: [{ priceSpecification: { price } }], nextData: null, initialState: null, meta: {} },
    interceptedRequests: [],
  };
}
const A = { source: 'json-ld' as const, path: 'offers.price', transform: 'identity' as const };
const B = { source: 'json-ld' as const, path: 'priceSpecification.price', transform: 'identity' as const };
const P4 = 'https://s.example/4';
const P5 = 'https://s.example/5';

describe('certify — second layout', () => {
  it('certifies two safe paths that together cover every checked page, and passes every cell', async () => {
    const r = await certify({
      field, expected: { ...expected, [P4]: '89.50' },
      captures: { ...captures, [P4]: cap2(P4, '89.50') },
      candidates: [B, A],
    }, xpathDeps);
    // A covers three pages, B one: A first.
    expect(r.certified).toEqual([
      { ...A, provenOn: ['https://s.example/1', 'https://s.example/2', 'https://s.example/3'] },
      { ...B, provenOn: [P4] },
    ]);
    expect(Object.values(r.cells).every((c) => c.status === 'pass')).toBe(true);
    expect(r.cells[P4]).toEqual({ status: 'pass', found: '89.50', path: r.certified[1] });
    expect(r.thinEvidence).toBe(true); // B is proven on one page only
  });

  it('is not thin once the second layout is proven on two pages', async () => {
    const r = await certify({
      field, expected: { ...expected, [P4]: '89.50', [P5]: '45.00' },
      captures: { ...captures, [P4]: cap2(P4, '89.50'), [P5]: cap2(P5, '45.00') },
      candidates: [A, B],
    }, xpathDeps);
    expect(r.certified.map((p) => p.path)).toEqual(['offers.price', 'priceSpecification.price']);
    expect(r.thinEvidence).toBeUndefined();
  });

  it('never certifies a path that is WRONG on any checked page, even if another path covers it', async () => {
    // On page 4 `offers.price` resolves to a different product's price. At scale
    // A is tried first and would win with the wrong value, so A must not be chosen.
    const wrongOn4: CaptureLike = { ...cap2(P4, '89.50'), structuredData: { ldJson: [{ offers: { price: '12.00' }, priceSpecification: { price: '89.50' } }], nextData: null, initialState: null, meta: {} } };
    const r = await certify({
      field, expected: { ...expected, [P4]: '89.50' },
      captures: { ...captures, [P4]: wrongOn4 },
      candidates: [A, B],
    }, xpathDeps);
    expect(r.certified).toEqual([]);
    expect(r.cells[P4]).toMatchObject({ status: 'fail', reason: 'different_value', found: '12.00' });
  });

  it('does not certify when nothing covers the new page, but still shows what works on the others', async () => {
    const r = await certify({
      field, expected: { ...expected, [P4]: '89.50' },
      captures: { ...captures, [P4]: cap2(P4, '89.50') },
      candidates: [A],
    }, xpathDeps);
    expect(r.certified).toEqual([]);
    expect(r.cells['https://s.example/1']).toEqual({ status: 'pass', found: '129.99', path: A });
    expect(r.cells[P4]).toMatchObject({ status: 'fail', reason: 'not_found' });
  });

  it('a blank expected value means the page is not checked: no cell, no effect on certification', async () => {
    const r = await certify({
      field, expected: { ...expected, [P4]: '' },
      captures: { ...captures, [P4]: cap2(P4, '89.50') },
      candidates: [A],
    }, xpathDeps);
    // Byte-for-byte today's one-layout result: no provenOn, no thinEvidence.
    expect(r.certified).toEqual([A]);
    expect(Object.keys(r.cells)).toEqual(['https://s.example/1', 'https://s.example/2', 'https://s.example/3']);
    expect(r.thinEvidence).toBeUndefined();
    expect(r.incomplete).toBe(false);
  });

  it('an uncaptured page the field is not checked on does not make the field incomplete', async () => {
    const r = await certify({
      field, expected: { ...expected, [P4]: '' },
      captures: { ...captures, [P4]: null },
      candidates: [A],
    }, xpathDeps);
    expect(r.certified).toEqual([A]);
    expect(r.incomplete).toBe(false);
  });
});

describe('checkedPages', () => {
  it('keeps the urls with a non-blank expected value, in url order', () => {
    expect(checkedPages(['u1', 'u2', 'u3', 'u4'], { u4: ' 9 ', u1: '1', u2: '2', u3: '   ' })).toEqual(['u1', 'u2', 'u4']);
  });
});

describe('rankCertified', () => {
  it('orders api, json-ld, meta, xpath then by path length', () => {
    const ranked = rankCertified([
      { source: 'xpath', path: '//a', transform: 'identity' },
      { source: 'meta', path: 'og:price', transform: 'identity' },
      { source: 'api', path: 'item.price.long.path', transform: 'identity' },
      { source: 'api', path: 'p', transform: 'identity' },
    ]);
    expect(ranked.map((p) => p.path)).toEqual(['p', 'item.price.long.path', 'og:price', '//a']);
  });
});

// An XPath anchored on a build hash or a version stamp certifies today and
// goes empty after the site's next deploy (Ikea, 2026-09-17). A stable path
// that certifies always wins; a volatile one is kept only as a last resort.
describe('certify — stable XPaths before volatile ones', () => {
  const textField = { key: 'subtitle', name: 'Subtitle', type: 'text' as const, description: 'under the title', concept: 'subtitle' };
  const pages = ['https://s.example/1', 'https://s.example/2', 'https://s.example/3'];
  const blank = (url: string): CaptureLike => ({ url, html: '<html></html>', structuredData: { ldJson: [], nextData: null, initialState: null, meta: {} }, interceptedRequests: [] });
  const caps = Object.fromEntries(pages.map((u) => [u, blank(u)]));
  const exp = Object.fromEntries(pages.map((u) => [u, '2-seat sofa']));
  const VOLATILE = { source: 'xpath' as const, path: '//div[@data-skapa="price-module@11.1.8"]/div[@class="info"]/h1/span', transform: 'identity' as const };
  const STABLE = { source: 'xpath' as const, path: '//div[@data-region="product"]/div[1]/div[@class="info"]/h1/span', transform: 'identity' as const };
  const bothResolve = { evalXPaths: async (_html: string, xps: string[]) => Object.fromEntries(xps.map((x) => [x, '2-seat sofa'])) };

  it('drops a volatile XPath when a stable one certifies', async () => {
    const r = await certify({ field: textField, expected: exp, captures: caps, candidates: [VOLATILE, STABLE] }, bothResolve);
    expect(r.certified).toEqual([STABLE]);
    expect(Object.values(r.cells).every((c) => c.status === 'pass' && c.path === r.certified[0])).toBe(true);
  });
  it('keeps a volatile XPath as a last resort when nothing stable certifies', async () => {
    const r = await certify({ field: textField, expected: exp, captures: caps, candidates: [VOLATILE] }, bothResolve);
    expect(r.certified).toEqual([VOLATILE]);
  });
  it('a stable non-xpath path beats it too', async () => {
    const withLd = Object.fromEntries(pages.map((u) => [u, { ...blank(u), structuredData: { ldJson: [{ description: '2-seat sofa' }], nextData: null, initialState: null, meta: {} } }]));
    const r = await certify({ field: textField, expected: exp, captures: withLd, candidates: [VOLATILE, { source: 'json-ld', path: 'description', transform: 'identity' }] }, bothResolve);
    expect(r.certified).toEqual([{ source: 'json-ld', path: 'description', transform: 'identity' }]);
  });
});

// The cover rule (second layout) must not mistake product-specific XPaths for layouts.
// Ikea, 2026-09-17: subtitle "certified" with three XPaths anchored on data-product-name="KIVIK" /
// "GLOSTAD" / "HEMLINGBY": each correct on its own proof page and empty on the other two, so each was
// safe and together they covered every page. At scale none matches any other product.
describe('certify — a cover is not made of one-page paths', () => {
  const textField = { key: 'subtitle', name: 'Subtitle', type: 'text' as const, description: 'under the title', concept: 'subtitle' };
  const pages = ['https://s.example/1', 'https://s.example/2', 'https://s.example/3'];
  const names = ['KIVIK', 'GLOSTAD', 'HEMLINGBY'];
  const blank = (url: string): CaptureLike => ({ url, html: `<html data-page="${url}"></html>`, structuredData: { ldJson: [], nextData: null, initialState: null, meta: {} }, interceptedRequests: [] });
  const caps = Object.fromEntries(pages.map((u) => [u, blank(u)]));
  const exp = Object.fromEntries(pages.map((u) => [u, '2-seat sofa']));
  const specific = names.map((n) => ({ source: 'xpath' as const, path: `//div[@data-product-name="${n}"]/h2[@class="sub"]`, transform: 'identity' as const }));
  const SHARED = { source: 'xpath' as const, path: '//*[@id="content"]/div[1]/h2[@class="sub"]', transform: 'identity' as const };
  // Each product-specific XPath resolves only on its own page; the shared one resolves on all of them.
  const evalXPaths = async (html: string, xps: string[]) => Object.fromEntries(xps.map((x) => {
    const i = names.findIndex((n) => x.includes(`"${n}"`));
    return [x, i === -1 || html.includes(pages[i]!) ? '2-seat sofa' : null];
  }));

  it('three paths that each work on one page only do not certify the field', async () => {
    const r = await certify({ field: textField, expected: exp, captures: caps, candidates: specific }, { evalXPaths });
    expect(r.certified).toEqual([]);
  });
  it('with the shared anchor offered as well, that one certifies, alone', async () => {
    const r = await certify({ field: textField, expected: exp, captures: caps, candidates: [...specific, SHARED] }, { evalXPaths });
    expect(r.certified).toEqual([SHARED]);
  });
  it('a real second layout still certifies: one path proven on three pages, one on the fourth', async () => {
    const p4 = 'https://s.example/4';
    const caps4 = { ...caps, [p4]: blank(p4) };
    const exp4 = { ...exp, [p4]: '2-seat sofa' };
    const LAYOUT_2 = { source: 'xpath' as const, path: '//*[@id="clearance"]/h2[@class="sub"]', transform: 'identity' as const };
    const evalTwoLayouts = async (html: string, xps: string[]) => Object.fromEntries(xps.map((x) => [x, (x === LAYOUT_2.path) === html.includes(p4) ? '2-seat sofa' : null]));
    const r = await certify({ field: textField, expected: exp4, captures: caps4, candidates: [SHARED, LAYOUT_2] }, { evalXPaths: evalTwoLayouts });
    expect(r.certified.map((p) => p.path)).toEqual([SHARED.path, LAYOUT_2.path]);
  });
});

// A mark (customer-clicked element) enters certify as an ordinary xpath candidate — gatherCandidates'
// job, not certify's. This pins that once it arrives, it goes through the same door as any other path.
describe('marks', () => {
  it('a mark whose xpath is correct on every page certifies; its other-page evaluation is the ordinary one', async () => {
    const caps = loadShopExample();
    const shopField: SchemaDefinitionField = { key: 'price', name: 'Price', type: 'money', description: 'd', concept: 'price' };
    const exp = { [U[0]!]: '129.99', [U[1]!]: '219.99', [U[2]!]: '149.00' };
    const xp = '//*[@id="main"]/div[@class="price-box"]/span[@class="now"]';
    const evalXPaths = async (html: string, xps: string[]) => Object.fromEntries(xps.map((x) => [x, x === xp ? (html.match(/class="now">([^<]+)</)?.[1] ?? null) : null]));
    const r = await certify({ field: shopField, expected: exp, captures: caps, candidates: [{ source: 'xpath', path: xp, transform: 'identity' }] }, { evalXPaths });
    expect(r.certified).toContainEqual({ source: 'xpath', path: xp, transform: 'identity' });
    expect(Object.values(r.cells).every((c) => c.status === 'pass')).toBe(true);
  });
});

// The whole point of a mark (spec 2026-09-18 §3.5), end to end: gatherCandidates then certify over
// the shop-example fixtures with their structured sources stripped, so XPaths are the only evidence.
//
// The price box holds `.was` and `.now` on pages 1 and 2 but only `.now` on page 3, so the DOM
// search's positional hit is a different span per page: `span[2]` is the price on pages 1 and 2 and
// nothing on page 3, `span[1]` is the price on page 3 and the crossed-out price on the other two.
// Neither survives all three pages, page 1 carries the price twice (a "today only" line as well), and
// so nothing certifies and every cell reads `ambiguous`. The click names the element, its
// class-anchored XPath — one the DOM search never reported — is the only candidate left from page 1,
// and the field certifies.
describe('marks — a mark settles ambiguous (end to end)', () => {
  const shopField: SchemaDefinitionField = { key: 'price', name: 'Price', type: 'money', description: 'd', concept: 'price' };
  const exp = { [U[0]!]: '129.99', [U[1]!]: '219.99', [U[2]!]: '149.00' };
  const CLICKED = '//*[@id="main"]/div[@class="price-box"]/span[@class="now"]';
  const SPAN2 = '//*[@id="main"]/div[@class="price-box"]/span[2]';
  const SPAN1 = '//*[@id="main"]/div[@class="price-box"]/span[1]';
  const PROMO = '//*[@id="main"]/p[@class="promo"]/span';
  const PROMO_HTML = '<p class="promo">Today only: <span>$129.99</span></p>';
  const mark: Mark = { xpaths: [CLICKED], text: '$129.99', rect: { x: 10, y: 20, w: 80, h: 24 } };

  /** The fixtures with page 1's second price line added and every structured source stripped. */
  const bare = (): Record<string, CaptureLike> => Object.fromEntries(Object.entries(loadShopExample()).map(([u, c]) => [u, {
    url: c.url,
    html: u === U[0] ? c.html.replace('<p class="stock">', `${PROMO_HTML}<p class="stock">`) : c.html,
    structuredData: { ldJson: [], nextData: null, initialState: null, meta: {} },
    interceptedRequests: [],
  }]));

  // What each XPath selects in the fixture markup.
  const boxSpans = (html: string) => [...html.matchAll(/<span class="(?:was|now)">([^<]+)</g)].map((m) => m[1]!);
  const resolve = (html: string, xpath: string): string | null => {
    if (xpath === CLICKED) return html.match(/class="now">([^<]+)</)?.[1] ?? null;
    if (xpath === SPAN2) return boxSpans(html)[1] ?? null;
    if (xpath === SPAN1) return boxSpans(html)[0] ?? null;
    if (xpath === PROMO) return html.match(/class="promo">[^<]*<span>([^<]+)</)?.[1] ?? null;
    return null;
  };
  const evalXPaths = async (html: string, xps: string[]) => Object.fromEntries(xps.map((x) => [x, resolve(html, x)]));
  // A text search for the expected value finds exactly these — one xpath per hit, the positional one.
  const hits = (pageUrl: string): DomHit[] => pageUrl === U[0]
    ? [{ key: 'price', xpath: SPAN2, raw: '$129.99' }, { key: 'price', xpath: PROMO, raw: '$129.99' }]
    : pageUrl === U[1] ? [{ key: 'price', xpath: SPAN2, raw: '$219.99' }] : [{ key: 'price', xpath: SPAN1, raw: '$149.00' }];

  it('without a mark: nothing certifies and page 1 is ambiguous', async () => {
    const captures = bare();
    const { candidates } = await gatherCandidates(shopField, exp, captures, { runDomSearch: async (_h, _n, pageUrl) => hits(pageUrl) });
    const r = await certify({ field: shopField, expected: exp, captures, candidates }, { evalXPaths });
    expect(r.certified).toEqual([]);
    expect(r.cells[U[0]!]).toMatchObject({ status: 'fail', reason: 'ambiguous' });
  });

  it('with the mark: page 1 is not searched, the field certifies on the clicked path and every cell passes', async () => {
    const captures = bare();
    const searched: string[] = [];
    const runDomSearch = async (_h: string, _n: unknown, pageUrl: string) => { searched.push(pageUrl); return hits(pageUrl); };
    const { candidates } = await gatherCandidates(shopField, exp, captures, { runDomSearch, marks: { [U[0]!]: mark } });
    expect(searched).toEqual([U[1], U[2]]);
    expect(candidates.map((c) => c.path)).not.toContain(PROMO);
    const r = await certify({ field: shopField, expected: exp, captures, candidates }, { evalXPaths });
    expect(r.certified).toEqual([{ source: 'xpath', path: CLICKED, transform: 'identity' }]);
    expect(Object.values(r.cells).every((c) => c.status === 'pass')).toBe(true);
  });
});
