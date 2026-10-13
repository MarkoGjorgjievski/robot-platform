import { describe, it, expect } from 'vitest';
import { certify, checkedPages, expectedWithDefault, gatherCandidates, qualifiesForWeak, rankCertified, type CaptureLike } from './certify.js';
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

// spec 2026-09-29 C4 / task 2: a structured value that is an object is read
// (its url/contentUrl/@id), never stringified into a near miss.
describe('near misses never contain [object Object]', () => {
  const imageField = { key: 'image', name: 'Image', type: 'image' as const, description: '', concept: 'image_url' };
  const imgUrls = ['https://s.example/1', 'https://s.example/2', 'https://s.example/3'];
  function capImg(url: string, imgUrl: string): CaptureLike {
    return {
      url, html: '<html></html>',
      structuredData: { ldJson: [{ image: { '@type': 'ImageObject', url: imgUrl } }], nextData: null, initialState: null, meta: {} },
      interceptedRequests: [],
    };
  }
  it('a failing image field whose JSON-LD image is an ImageObject yields near misses that are URLs', async () => {
    const imgCaptures = Object.fromEntries(imgUrls.map((u, i) => [u, capImg(u, `https://cdn.example/img${i}.jpg`)]));
    const imgExpected = Object.fromEntries(imgUrls.map((u) => [u, 'https://cdn.example/does-not-match.jpg']));
    const r = await certify({ field: imageField, expected: imgExpected, captures: imgCaptures, candidates: [{ source: 'json-ld', path: 'image', transform: 'identity' }] }, { evalXPaths: async () => ({}) });
    const cell = r.cells[imgUrls[0]!];
    expect(cell).toMatchObject({ status: 'fail', reason: 'not_found', nearMisses: ['https://cdn.example/img0.jpg'] });
    expect(JSON.stringify(cell)).not.toContain('[object Object]');
  });
});

// controller ruling, follow-up 1: a confirmed path's identity reading is
// always a candidate, even when the cache offers the same source+path with
// another transform.
describe('confirmed extras dedupe on the full path id', () => {
  it('the identity reading of a confirmed path certifies although the cache offers a different transform for it', async () => {
    const f = { key: 'price', name: 'Price', type: 'money' as const, description: '', concept: 'price' };
    const urls3 = ['https://s.example/1', 'https://s.example/2', 'https://s.example/3'];
    const vals = [129.99, 219.99, 149.0];
    const cap3 = (url: string, price: number): CaptureLike => ({
      url, html: '<html></html>',
      structuredData: { ldJson: [], nextData: null, initialState: null, meta: {} },
      interceptedRequests: [{ url: `${url}/api`, method: 'GET', status: 200, isJson: true, parsedJson: { price } }] as unknown as CaptureLike['interceptedRequests'],
    });
    const caps3 = Object.fromEntries(urls3.map((u, i) => [u, cap3(u, vals[i]!)]));
    const exp3 = Object.fromEntries(urls3.map((u, i) => [u, String(vals[i])]));
    const r = await certify({
      field: f, expected: exp3, captures: caps3,
      confirmed: [{ source: 'api', path: 'price' }],
      candidates: [{ source: 'api', path: 'price', transform: 'cents_to_units' }],
    }, { evalXPaths: async () => ({}) });
    expect(r.certified).toEqual([{ source: 'api', path: 'price', transform: 'identity' }]);
  });
});

// controller ruling, follow-up 2: weakEvidence must use the same case-insensitive
// normalisation as isWeakField, or the flag and the filter disagree.
describe('weakEvidence follows the same normalisation as isWeakField', () => {
  it('flags weak evidence when text values differ only in case', async () => {
    const f = { key: 'brand', name: 'Brand', type: 'text' as const, description: '', concept: 'brand' };
    const urls3 = ['https://s.example/1', 'https://s.example/2', 'https://s.example/3'];
    const vals = ['IKEA', 'ikea', 'ikea'];
    const capB = (url: string, brand: string): CaptureLike => ({
      url, html: '<html></html>',
      structuredData: { ldJson: [{ brand }], nextData: null, initialState: null, meta: {} },
      interceptedRequests: [],
    });
    const caps3 = Object.fromEntries(urls3.map((u, i) => [u, capB(u, vals[i]!)]));
    const exp3 = Object.fromEntries(urls3.map((u, i) => [u, vals[i]!]));
    const r = await certify({
      field: f, expected: exp3, captures: caps3, candidates: [{ source: 'json-ld', path: 'brand', transform: 'identity' }],
    }, { evalXPaths: async () => ({}) });
    expect(r.weakEvidence).toBe(true);
    expect(r.certified.map((p) => p.path)).toEqual(['brand']);
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
  const blank = (url: string): CaptureLike => ({ url, html: `<html data-page="${url}"></html>`, structuredData: { ldJson: [], nextData: null, initialState: null, meta: {} }, interceptedRequests: [] });
  const caps = Object.fromEntries(pages.map((u) => [u, blank(u)]));
  // A different value on each page: identical values would make the field weak (spec 2026-09-29 C2), which is not what this block is about.
  const exp = Object.fromEntries(pages.map((u, i) => [u, `${i + 2}-seat sofa`]));
  const onPage = (html: string) => exp[pages.find((p) => html.includes(`"${p}"`))!]!;
  const VOLATILE = { source: 'xpath' as const, path: '//div[@data-skapa="price-module@11.1.8"]/div[@class="info"]/h1/span', transform: 'identity' as const };
  const STABLE = { source: 'xpath' as const, path: '//div[@data-region="product"]/div[1]/div[@class="info"]/h1/span', transform: 'identity' as const };
  const bothResolve = { evalXPaths: async (html: string, xps: string[]) => Object.fromEntries(xps.map((x) => [x, onPage(html)])) };

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
    const withLd = Object.fromEntries(pages.map((u) => [u, { ...blank(u), structuredData: { ldJson: [{ description: exp[u] }], nextData: null, initialState: null, meta: {} } }]));
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
  // A different value on each page: identical values would make the field weak (spec 2026-09-29 C2), which is not what this block is about.
  const value = (url: string) => `${url.slice(-1)}-seat sofa`;
  const exp = Object.fromEntries(pages.map((u) => [u, value(u)]));
  const onPage = (html: string) => value(html.match(/data-page="([^"]+)"/)![1]!);
  const specific = names.map((n) => ({ source: 'xpath' as const, path: `//div[@data-product-name="${n}"]/h2[@class="sub"]`, transform: 'identity' as const }));
  const SHARED = { source: 'xpath' as const, path: '//*[@id="content"]/div[1]/h2[@class="sub"]', transform: 'identity' as const };
  // Each product-specific XPath resolves only on its own page; the shared one resolves on all of them.
  const evalXPaths = async (html: string, xps: string[]) => Object.fromEntries(xps.map((x) => {
    const i = names.findIndex((n) => x.includes(`"${n}"`));
    return [x, i === -1 || html.includes(pages[i]!) ? onPage(html) : null];
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
    const exp4 = { ...exp, [p4]: value(p4) };
    const LAYOUT_2 = { source: 'xpath' as const, path: '//*[@id="clearance"]/h2[@class="sub"]', transform: 'identity' as const };
    const evalTwoLayouts = async (html: string, xps: string[]) => Object.fromEntries(xps.map((x) => [x, (x === LAYOUT_2.path) === html.includes(p4) ? onPage(html) : null]));
    const r = await certify({ field: textField, expected: exp4, captures: caps4, candidates: [SHARED, LAYOUT_2] }, { evalXPaths: evalTwoLayouts });
    expect(r.certified.map((p) => p.path)).toEqual([SHARED.path, LAYOUT_2.path]);
  });
  // An absent page (spec 2026-10-10 §B2) is "correct" for every path empty there, so it must not
  // count as a path's second page: three one-page paths plus one absent page still do not certify.
  it('an absent fourth page does not give each one-page path a second page', async () => {
    const p4 = 'https://s.example/4';
    const r = await certify({ field: textField, expected: exp, absent: [p4], captures: { ...caps, [p4]: blank(p4) }, candidates: specific }, { evalXPaths });
    expect(r.certified).toEqual([]);
    expect(r.thinEvidence).toBeUndefined();
  });
  it('a real second layout with an absent page: provenOn lists the pages with a value only', async () => {
    const p4 = 'https://s.example/4';
    const p5 = 'https://s.example/5';
    const caps5 = { ...caps, [p4]: blank(p4), [p5]: blank(p5) };
    const exp5 = { ...exp, [p4]: value(p4) };
    const LAYOUT_2 = { source: 'xpath' as const, path: '//*[@id="clearance"]/h2[@class="sub"]', transform: 'identity' as const };
    // SHARED on pages 1-3, LAYOUT_2 on page 4, neither on page 5 (absent).
    const evalTwoLayouts = async (html: string, xps: string[]) => Object.fromEntries(xps.map((x) => [x,
      html.includes(p5) ? null : (x === LAYOUT_2.path) === html.includes(p4) ? onPage(html) : null]));
    const r = await certify({ field: textField, expected: exp5, absent: [p5], captures: caps5, candidates: [SHARED, LAYOUT_2] }, { evalXPaths: evalTwoLayouts });
    expect(r.certified.map((p) => [p.path, p.provenOn])).toEqual([[SHARED.path, pages], [LAYOUT_2.path, [p4]]]);
    expect(r.thinEvidence).toBe(true);
    expect(r.cells[p5]).toMatchObject({ status: 'pass', found: '' });
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

// Spec 2026-09-29 C1/C2 (Ikea, 2026-09-28): In stock certified `api → priority` (1 on every proof page).
describe('weak fields need a fitting path', () => {
  // Three in-stock products: an unrelated API field equals 1 everywhere, JSON-LD says InStock.
  const cap = (url: string): CaptureLike => ({
    url, html: '<html><body><span class="s">Available</span></body></html>',
    structuredData: { ldJson: [{ '@type': 'Product', offers: { availability: 'https://schema.org/InStock' } }], nextData: null, initialState: null, meta: {} },
    interceptedRequests: [{ url: `${url}/api`, method: 'GET', status: 200, isJson: true, parsedJson: { priority: 1 } }] as unknown as CaptureLike['interceptedRequests'],
  });
  const urls = ['https://s.example/p/1', 'https://s.example/p/2', 'https://s.example/p/3'];
  const field = { key: 'in_stock', name: 'In stock', type: 'boolean' as const, description: '', concept: 'availability' };
  const expected = Object.fromEntries(urls.map((u) => [u, 'Available']));
  const captures = Object.fromEntries(urls.map((u) => [u, cap(u)]));

  it('certifies offers.availability, not an unrelated API field that happens to be 1', async () => {
    const candidates = [{ source: 'api', path: 'priority', transform: 'identity' }, { source: 'json-ld', path: 'offers.availability', transform: 'identity' }] as const;
    const r = await certify({ field, expected, captures, candidates: [...candidates] }, { evalXPaths: async () => ({}) });
    expect(r.certified.map((p) => `${p.source} ${p.path}`)).toEqual(['json-ld offers.availability']);
  });

  it('fails with no_fitting_path when nothing fits and nothing was confirmed', async () => {
    const r = await certify({ field, expected, captures, candidates: [{ source: 'api', path: 'priority', transform: 'identity' }] }, { evalXPaths: async () => ({}) });
    expect(r.certified).toEqual([]);
    expect(Object.values(r.cells).every((c) => c.status === 'fail' && c.reason === 'no_fitting_path')).toBe(true);
  });

  it('a confirmed path qualifies even when its name does not fit, and goes first', async () => {
    const r = await certify({ field, expected, captures, confirmed: [{ source: 'api', path: 'priority' }], candidates: [{ source: 'json-ld', path: 'offers.availability', transform: 'identity' }] }, { evalXPaths: async () => ({}) });
    expect(r.certified[0]).toMatchObject({ source: 'api', path: 'priority' });
  });

  it('confirmed paths from different products cover together', async () => {
    const c3 = { ...cap(urls[2]!), structuredData: { ...cap(urls[2]!).structuredData, ldJson: [{ '@type': 'Product', offers: { offers: [{ availability: 'https://schema.org/InStock' }] } }] } };
    const r = await certify({ field, expected, captures: { ...captures, [urls[2]!]: c3 },
      confirmed: [{ source: 'json-ld', path: 'offers.availability' }, { source: 'json-ld', path: 'offers.offers[0].availability' }], candidates: [] }, { evalXPaths: async () => ({}) });
    expect(r.certified.map((p) => p.path).sort()).toEqual(['offers.availability', 'offers.offers[0].availability']);
  });

  it('a custom field with identical values and no concept only takes confirmed paths or marks', async () => {
    const f = { ...field, key: 'shop', name: 'Shop', type: 'text' as const, concept: 'shop' };
    const r = await certify({ field: f, expected: Object.fromEntries(urls.map((u) => [u, '1'])), captures, candidates: [{ source: 'api', path: 'priority', transform: 'identity' }] }, { evalXPaths: async () => ({}) });
    expect(r.certified).toEqual([]);
  });

  it('a non-weak field is unaffected', async () => {
    const f = { key: 'price', name: 'Price', type: 'money' as const, description: '', concept: 'price' };
    const caps = Object.fromEntries(urls.map((u, i) => [u, { ...cap(u), interceptedRequests: [{ url: `${u}/api`, method: 'GET', status: 200, isJson: true, parsedJson: { amount: [10, 20, 30][i] } }] as unknown as CaptureLike['interceptedRequests'] }]));
    const r = await certify({ field: f, expected: Object.fromEntries(urls.map((u, i) => [u, String([10, 20, 30][i])])), captures: caps, candidates: [{ source: 'api', path: 'amount', transform: 'identity' }] }, { evalXPaths: async () => ({}) });
    expect(r.certified[0]).toMatchObject({ source: 'api', path: 'amount' });
  });

  it('a marked element qualifies; an unmarked DOM hit does not', async () => {
    const probe = { evalXPaths: async (_h: string, xps: string[]) => Object.fromEntries(xps.map((x) => [x, 'Available'])) };
    const marked = '//span[@class="s"]';
    const unmarked = '//body/span';
    const r = await certify({ field, expected, captures, markXPaths: [marked], candidates: [
      { source: 'xpath', path: unmarked, transform: 'identity' },
      { source: 'xpath', path: marked, transform: 'identity' },
    ] }, probe);
    expect(r.certified.map((p) => p.path)).toEqual([marked]);
    const none = await certify({ field, expected, captures, candidates: [{ source: 'xpath', path: unmarked, transform: 'identity' }] }, probe);
    expect(none.certified).toEqual([]);
  });

  it('a confirmed path is still only a candidate: wrong on one page, it is not certified', async () => {
    const caps = { ...captures, [urls[1]!]: { ...cap(urls[1]!), interceptedRequests: [{ url: 'x', method: 'GET', status: 200, isJson: true, parsedJson: { priority: 0 } }] as unknown as CaptureLike['interceptedRequests'] } };
    const r = await certify({ field, expected, captures: caps, confirmed: [{ source: 'api', path: 'priority' }], candidates: [{ source: 'json-ld', path: 'offers.availability', transform: 'identity' }] }, { evalXPaths: async () => ({}) });
    expect(r.certified.map((p) => `${p.source} ${p.path}`)).toEqual(['json-ld offers.availability']);
  });

  it('a confirmed path goes first for a non-weak field too; API order otherwise', async () => {
    const f = { key: 'price', name: 'Price', type: 'money' as const, description: '', concept: 'price' };
    const caps = Object.fromEntries(urls.map((u, i) => [u, { ...cap(u),
      structuredData: { ldJson: [{ offers: { price: String([10, 20, 30][i]) } }], nextData: null, initialState: null, meta: {} },
      interceptedRequests: [{ url: `${u}/api`, method: 'GET', status: 200, isJson: true, parsedJson: { amount: [10, 20, 30][i] } }] as unknown as CaptureLike['interceptedRequests'] }]));
    const exp = Object.fromEntries(urls.map((u, i) => [u, String([10, 20, 30][i])]));
    const candidates = [{ source: 'api' as const, path: 'amount', transform: 'identity' as const }, { source: 'json-ld' as const, path: 'offers.price', transform: 'identity' as const }];
    const plain = await certify({ field: f, expected: exp, captures: caps, candidates }, { evalXPaths: async () => ({}) });
    expect(plain.certified.map((p) => p.source)).toEqual(['api', 'json-ld']);
    const withConfirmed = await certify({ field: f, expected: exp, captures: caps, confirmed: [{ source: 'json-ld', path: 'offers.price' }], candidates }, { evalXPaths: async () => ({}) });
    expect(withConfirmed.certified.map((p) => p.source)).toEqual(['json-ld', 'api']);
  });
});

describe('qualifiesForWeak', () => {
  const field = { key: 'in_stock', name: 'In stock', type: 'boolean' as const, description: '', concept: 'availability' };
  it('takes a fitting structured path, a confirmed path, or a marked XPath', () => {
    expect(qualifiesForWeak(field, { source: 'json-ld', path: 'offers.availability', transform: 'identity' }, {})).toBe(true);
    expect(qualifiesForWeak(field, { source: 'api', path: 'priority', transform: 'identity' }, {})).toBe(false);
    expect(qualifiesForWeak(field, { source: 'api', path: 'priority', transform: 'identity' }, { confirmed: [{ source: 'api', path: 'priority' }] })).toBe(true);
    expect(qualifiesForWeak(field, { source: 'meta', path: 'priority', transform: 'identity' }, { confirmed: [{ source: 'api', path: 'priority' }] })).toBe(false);
    expect(qualifiesForWeak(field, { source: 'xpath', path: '//p', transform: 'identity' }, { markXPaths: ['//p'] })).toBe(true);
    expect(qualifiesForWeak(field, { source: 'xpath', path: '//p', transform: 'identity' }, {})).toBe(false);
    // An XPath never fits by name, however it ends.
    expect(qualifiesForWeak(field, { source: 'xpath', path: '//availability', transform: 'identity' }, {})).toBe(false);
  });
});

describe('certify — "not on this product" (spec 2026-10-10 §B2)', () => {
  const rating = { key: 'rating', name: 'Rating', type: 'number' as const, description: 'stars', concept: 'rating' };
  // Decathlon: the JSON-LD carries the rating only when the product has one; an api
  // field `stats.averageRating` is 0 for products with none. The fake intercepted
  // request uses the real fields `resolveStructured`'s `apiBodies` reads (isJson +
  // parsedJson), the same shape other tests in this file use for an `api` candidate.
  function page(url: string, jsonRating: number | null, apiRating: number): CaptureLike {
    return {
      url, html: '<html></html>',
      structuredData: { ldJson: [jsonRating === null ? { name: 'x' } : { aggregateRating: { ratingValue: jsonRating } }], nextData: null, initialState: null, meta: {} },
      interceptedRequests: [{ url: `${url}/api`, method: 'GET', isJson: true, parsedJson: { stats: { averageRating: apiRating } } }] as unknown as CaptureLike['interceptedRequests'],
    };
  }
  const caps = {
    'https://d.example/1': page('https://d.example/1', 4.39, 4.39),
    'https://d.example/2': page('https://d.example/2', 4.6, 4.6),
    'https://d.example/3': page('https://d.example/3', 4.54, 4.54),
    'https://d.example/4': page('https://d.example/4', null, 0),
  };
  const exp = { 'https://d.example/1': '4.39', 'https://d.example/2': '4.6', 'https://d.example/3': '4.54' };
  const jsonLd = { source: 'json-ld' as const, path: 'aggregateRating.ratingValue', transform: 'identity' as const };
  const api = { source: 'api' as const, path: 'stats.averageRating', transform: 'identity' as const };

  it('checkedPages counts an absent page as checked', () => {
    expect(checkedPages(Object.keys(caps), exp, { 'https://d.example/4': true })).toEqual(Object.keys(caps));
    expect(checkedPages(Object.keys(caps), exp)).toEqual(Object.keys(caps).slice(0, 3));
  });

  it('a path that yields a value on an absent page is never certified; the one that yields nothing certifies and passes that cell', async () => {
    const r = await certify({ field: rating, expected: exp, absent: ['https://d.example/4'], captures: caps, candidates: [api, jsonLd] }, xpathDeps);
    expect(r.certified.map((p) => p.path)).toEqual(['aggregateRating.ratingValue']);
    expect(r.cells['https://d.example/4']).toEqual({ status: 'pass', found: '', path: jsonLd });
    expect(Object.values(r.cells).every((c) => c.status === 'pass')).toBe(true);
  });

  it('without the absent page the api fallback certifies too (what Decathlon saw)', async () => {
    const r = await certify({ field: rating, expected: exp, captures: caps, candidates: [api, jsonLd] }, xpathDeps);
    expect(r.certified.map((p) => p.path).sort()).toEqual(['aggregateRating.ratingValue', 'stats.averageRating']);
  });

  it('reports found_unexpected on the absent page when every candidate produces a value there', async () => {
    const r = await certify({ field: rating, expected: exp, absent: ['https://d.example/4'], captures: caps, candidates: [api] }, xpathDeps);
    expect(r.certified).toEqual([]);
    expect(r.cells['https://d.example/4']).toMatchObject({ status: 'fail', reason: 'found_unexpected', found: '0' });
  });

  it('a path wrong elsewhere does not turn the absent cell red (Decathlon: a drifted rating on page 1)', async () => {
    // Page 1's expected value no longer matches: both paths are wrong there, so neither is
    // right on every other page with a value. The api's 0 on page 4 says nothing against the
    // customer's mark; the real problem is page 1, and it alone fails.
    const drifted = { ...exp, 'https://d.example/1': '4.38' };
    const r = await certify({ field: rating, expected: drifted, absent: ['https://d.example/4'], captures: caps, candidates: [api, jsonLd] }, xpathDeps);
    expect(r.certified).toEqual([]);
    expect(r.cells['https://d.example/4']).toMatchObject({ status: 'pass', found: '' });
    expect(r.cells['https://d.example/1']).toMatchObject({ status: 'fail', reason: 'different_value', found: '4.39' });
  });

  it('an absent page still passes empty when nothing resolved there, even though a WRONG expected value elsewhere keeps the field from certifying', async () => {
    // Page w4 has no api call at all (unlike page 4 above): nothing produces a value
    // there, so §B2's `found_unexpected` must not fire — it reads as any other
    // passing page would. Page w3's typed expected value is wrong for the api
    // reading there, which makes api unsafe everywhere and fails page w3 outright;
    // json-ld has nothing on w3 (a different layout) so it cannot cover that page
    // either, and nothing certifies — but json-ld stays safe throughout, so it is
    // still the path reported on the absent page.
    const noApiPage = (url: string, jsonRating: number | null): CaptureLike => ({
      url, html: '<html></html>',
      structuredData: { ldJson: [jsonRating === null ? { name: 'x' } : { aggregateRating: { ratingValue: jsonRating } }], nextData: null, initialState: null, meta: {} },
      interceptedRequests: [],
    });
    const wPages = {
      'https://d.example/w1': page('https://d.example/w1', 4.39, 4.39),
      'https://d.example/w2': page('https://d.example/w2', 4.6, 4.6),
      'https://d.example/w3': page('https://d.example/w3', null, 4.54),
      'https://d.example/w4': noApiPage('https://d.example/w4', null),
    };
    const wrongExp = { 'https://d.example/w1': '4.39', 'https://d.example/w2': '4.6', 'https://d.example/w3': '1.23' };
    const r = await certify({ field: rating, expected: wrongExp, absent: ['https://d.example/w4'], captures: wPages, candidates: [api, jsonLd] }, xpathDeps);
    expect(r.certified).toEqual([]);
    expect(r.cells['https://d.example/w4']).toEqual({ status: 'pass', found: '', path: jsonLd });
    expect(r.cells['https://d.example/w3']).toMatchObject({ status: 'fail' });
  });
});

describe('certify — a website\'s default (spec 2026-10-13 §4)', () => {
  const brand = { key: 'brand', name: 'Brand', type: 'text' as const, description: 'the maker', concept: 'brand' };
  const G = ['https://g.example/1', 'https://g.example/2', 'https://g.example/3'];
  const page = (url: string, ld: Record<string, unknown>, site = 'Gymshark | We Do Gym'): CaptureLike => ({
    url, html: '<html></html>',
    structuredData: { ldJson: [ld], nextData: null, initialState: null, meta: { 'og:site_name': site } },
    interceptedRequests: [],
  });
  const named = (url: string, name = 'Gymshark') => page(url, { brand: { name } });
  const plain = { [G[0]!]: named(G[0]!), [G[1]!]: named(G[1]!), [G[2]!]: named(G[2]!) };
  const blank = { [G[0]!]: '', [G[1]!]: '', [G[2]!]: '' };
  const brandName = { source: 'json-ld' as const, path: 'brand.name', transform: 'identity' as const };
  const siteName = { source: 'meta' as const, path: 'og:site_name', transform: 'identity' as const };
  const nothing = { source: 'json-ld' as const, path: 'vendor.name', transform: 'identity' as const };
  const collabLabel = { source: 'json-ld' as const, path: 'collab.label', transform: 'identity' as const };
  const deps = { evalXPaths: async () => ({}) };

  it('expectedWithDefault fills every blank, non-absent cell with the default and leaves a typed value alone', () => {
    expect(expectedWithDefault(G, { [G[1]!]: 'Gymshark x Whitney' }, 'Gymshark')).toEqual({ [G[0]!]: 'Gymshark', [G[1]!]: 'Gymshark x Whitney', [G[2]!]: 'Gymshark' });
    expect(expectedWithDefault(G, { [G[1]!]: 'x' }, undefined)).toEqual({ [G[1]!]: 'x' });
    expect(expectedWithDefault(G, {}, '  ')).toEqual({});
    expect(expectedWithDefault(G, {}, 'Gymshark', { [G[2]!]: true })).toEqual({ [G[0]!]: 'Gymshark', [G[1]!]: 'Gymshark' });
  });

  it('with nothing typed, a fitting path that reads the default on every page certifies; one that reads another value never does (property 1)', async () => {
    const r = await certify({ field: brand, expected: blank, defaultValue: 'Gymshark', captures: plain, candidates: [brandName, siteName] }, deps);
    expect(r.certified).toEqual([brandName]);
    expect(r.defaultOnly).toBeUndefined();
    expect(r.cells[G[0]!]).toEqual({ status: 'pass', found: 'Gymshark', path: brandName });
    expect(Object.values(r.cells).every((c) => c.status === 'pass')).toBe(true);
  });

  it('a typed value equal to the default, whatever its spaces and case, is a default cell', async () => {
    const r = await certify({ field: brand, expected: { ...blank, [G[1]!]: '  gymshark ' }, defaultValue: 'Gymshark', captures: plain, candidates: [brandName] }, deps);
    expect(r.certified).toEqual([brandName]);
    expect(r.cells[G[1]!]).toMatchObject({ status: 'pass', found: 'Gymshark' });
  });

  it('a path that reads nothing anywhere never certifies; with no other path the field passes by default only (properties 2, 3)', async () => {
    const r = await certify({ field: brand, expected: blank, defaultValue: 'Gymshark', captures: plain, candidates: [nothing] }, deps);
    expect(r.certified).toEqual([]);
    expect(r.defaultOnly).toBe(true);
    expect(r.cells).toEqual(Object.fromEntries(G.map((u) => [u, { status: 'pass', found: '' }])));
    expect(r.incomplete).toBe(false);
  });

  it('a typed value that differs from the default forbids default only: the cell fails as today (property 3)', async () => {
    const caps = { ...plain, [G[1]!]: page(G[1]!, { name: 'x' }) };
    const r = await certify({ field: brand, expected: { ...blank, [G[1]!]: 'Gymshark x Whitney' }, defaultValue: 'Gymshark', captures: caps, candidates: [brandName] }, deps);
    expect(r.certified).toEqual([]);
    expect(r.defaultOnly).toBeUndefined();
    expect(r.cells[G[1]!]).toMatchObject({ status: 'fail', reason: 'not_found' });
  });

  it('a path that reads the typed collab value on its page and the default elsewhere certifies on every page', async () => {
    const caps = { ...plain, [G[1]!]: named(G[1]!, 'Gymshark x Whitney') };
    const r = await certify({ field: brand, expected: { ...blank, [G[1]!]: 'Gymshark x Whitney' }, defaultValue: 'Gymshark', captures: caps, candidates: [brandName] }, deps);
    expect(r.certified).toEqual([brandName]);
    expect(r.cells[G[1]!]).toMatchObject({ status: 'pass', found: 'Gymshark x Whitney' });
  });

  // Review fix 1 (D): a path proven on one page only, the others default cells, is not a layout (the two-page rule).
  it('a path reading the typed value on one page and nothing on the default cells does not certify alone (D)', async () => {
    const caps = { [G[0]!]: page(G[0]!, { name: 'a' }), [G[1]!]: named(G[1]!, 'Gymshark x Whitney'), [G[2]!]: page(G[2]!, { name: 'c' }) };
    const r = await certify({ field: brand, expected: { ...blank, [G[1]!]: 'Gymshark x Whitney' }, defaultValue: 'Gymshark', captures: caps, candidates: [brandName] }, deps);
    expect(r.certified).toEqual([]);
    expect(r.defaultOnly).toBeUndefined();
    expect(r.thinEvidence).toBeUndefined();
    // On three proof pages no safe path is correct with a value on every page, so each cell reads ambiguous (the code's existing reason).
    expect(r.cells).toEqual({
      [G[0]!]: { status: 'fail', reason: 'ambiguous' },
      [G[1]!]: { status: 'fail', reason: 'ambiguous', nearMisses: ['Gymshark x Whitney'] },
      [G[2]!]: { status: 'fail', reason: 'ambiguous' },
    });
  });

  it('(A) all cells blank, a path reading the default on page 1 only: default only, the path does not certify', async () => {
    const caps = { [G[0]!]: named(G[0]!), [G[1]!]: page(G[1]!, { name: 'b' }), [G[2]!]: page(G[2]!, { name: 'c' }) };
    const r = await certify({ field: brand, expected: blank, defaultValue: 'Gymshark', captures: caps, candidates: [brandName] }, deps);
    expect(r.certified).toEqual([]);
    expect(r.defaultOnly).toBe(true);
    expect(r.cells).toEqual(Object.fromEntries(G.map((u) => [u, { status: 'pass', found: '' }])));
  });

  it('(B) a one-page path does not ride along beside a path proven on every page', async () => {
    const caps = { [G[0]!]: page(G[0]!, { brand: { name: 'Gymshark' }, collab: { label: 'Gymshark' } }), [G[1]!]: named(G[1]!), [G[2]!]: named(G[2]!) };
    const r = await certify({ field: brand, expected: blank, defaultValue: 'Gymshark', captures: caps, candidates: [brandName, collabLabel] }, deps);
    expect(r.certified).toEqual([brandName]);
    expect(r.thinEvidence).toBeUndefined();
    expect(Object.values(r.cells).every((c) => c.status === 'pass')).toBe(true);
  });

  it('(C) a collab value on page 2 read by a one-page path, the brand path proven on pages 1 and 3: a cover of both, thin evidence', async () => {
    const caps = { [G[0]!]: named(G[0]!), [G[1]!]: page(G[1]!, { collab: { label: 'Gymshark x Whitney' } }), [G[2]!]: named(G[2]!) };
    const r = await certify({ field: brand, expected: { ...blank, [G[1]!]: 'Gymshark x Whitney' }, defaultValue: 'Gymshark', captures: caps, candidates: [collabLabel, brandName] }, deps);
    expect(r.certified.map((p) => [p.path, p.provenOn])).toEqual([['brand.name', [G[0]!, G[2]!]], ['collab.label', [G[1]!]]]);
    expect(r.thinEvidence).toBe(true);
    expect(r.defaultOnly).toBeUndefined();
    expect(r.cells[G[0]!]).toMatchObject({ status: 'pass', found: 'Gymshark' });
    expect(r.cells[G[1]!]).toMatchObject({ status: 'pass', found: 'Gymshark x Whitney' });
    expect(r.cells[G[2]!]).toMatchObject({ status: 'pass', found: 'Gymshark' });
  });

  it('a weak field whose only matching path does not fit the concept passes by default only, never on that path', async () => {
    const caps = { [G[0]!]: page(G[0]!, { name: 'a' }, 'Gymshark'), [G[1]!]: page(G[1]!, { name: 'b' }, 'Gymshark'), [G[2]!]: page(G[2]!, { name: 'c' }, 'Gymshark') };
    const r = await certify({ field: brand, expected: blank, defaultValue: 'Gymshark', captures: caps, candidates: [siteName] }, deps);
    expect(r.certified).toEqual([]);
    expect(r.defaultOnly).toBe(true);
    expect(r.cells[G[0]!]).toEqual({ status: 'pass', found: '' });
  });

  it('every proof page is checked: a path wrong on a blank page four never certifies', async () => {
    const G4 = 'https://g.example/4';
    const caps = { ...plain, [G4]: named(G4, 'Other') };
    const r = await certify({ field: brand, expected: { ...blank, [G4]: '' }, defaultValue: 'Gymshark', captures: caps, candidates: [brandName] }, deps);
    expect(r.certified).toEqual([]);
    expect(Object.keys(r.cells)).toEqual([...G, G4]);
    const three = await certify({ field: brand, expected: blank, defaultValue: 'Gymshark', captures: plain, candidates: [brandName] }, deps);
    expect(three.certified).toEqual([brandName]);
  });

  it('a capture that failed keeps the field incomplete: never default only (property 3)', async () => {
    const r = await certify({ field: brand, expected: blank, defaultValue: 'Gymshark', captures: { ...plain, [G[2]!]: null }, candidates: [nothing] }, deps);
    expect(r.defaultOnly).toBeUndefined();
    expect(r.incomplete).toBe(true);
    expect(r.cells[G[2]!]).toEqual({ status: 'not_captured' });
  });

  it('without a default the same pages and candidates certify exactly as before (property 9)', async () => {
    const typed = { [G[0]!]: 'Gymshark', [G[1]!]: 'Gymshark', [G[2]!]: 'Gymshark' };
    const before = await certify({ field: brand, expected: typed, captures: plain, candidates: [brandName, siteName] }, deps);
    const withDefault = await certify({ field: brand, expected: typed, defaultValue: 'Gymshark', captures: plain, candidates: [brandName, siteName] }, deps);
    expect(before.certified).toEqual([brandName]);
    expect(before.defaultOnly).toBeUndefined();
    expect(withDefault).toEqual(before);
  });
});
