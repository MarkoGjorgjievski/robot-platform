import { describe, it, expect } from 'vitest';
import { suggestMarks, pageHeading } from './suggest-marks.js';
import { loadVerifyFixture } from '../__fixtures__/verify/load.js';
import type { Box } from './box-map.js';
import type { SchemaDefinitionField } from './types.js';

const f = (key: string, type: SchemaDefinitionField['type'], concept: string): SchemaDefinitionField => ({ key, name: key, type, description: '', concept });
const box = (text: string, i: number, extra: Partial<Box> = {}): Box => ({ xpaths: [`//b[${i}]`], text, rect: { x: 0, y: i * 10, w: 10, h: 10 }, tag: 'span', kind: 'text', ...extra });
const p1 = loadVerifyFixture('shop-example', 'p1');
const boxes: Box[] = [box('Widget A', 0), box('$129.99', 1), box('$159.99', 2), box('In stock', 3), box('', 4, { kind: 'image', tag: 'img', src: 'https://shop.example/img/a.jpg' }), box('$129.99', 5)];

describe('suggestMarks', () => {
  it('price: JSON-LD offers.price, shown in two places → both boxes', () => {
    const r = suggestMarks(p1, boxes, [f('price', 'money', 'price')]);
    expect(r.price).toEqual({ value: '129.99', via: { source: 'json-ld', path: 'offers.price' }, boxes: [1, 5] });
  });
  it('title: JSON-LD name, one box', () => {
    expect(suggestMarks(p1, boxes, [f('title', 'text', 'product_name')]).title).toEqual({ value: 'Widget A', via: { source: 'json-ld', path: 'name' }, boxes: [0] });
  });
  it('image: matched against src', () => {
    expect(suggestMarks(p1, boxes, [f('image', 'image', 'image_url')]).image).toMatchObject({ value: 'https://shop.example/img/a.jpg', boxes: [4] });
  });
  it('sku: only in the API body → value with no boxes ("page data")', () => {
    expect(suggestMarks(p1, boxes, [f('sku', 'text', 'sku')]).sku).toEqual({ value: 'SKU-A1', via: { source: 'api', path: 'item.code' }, boxes: [] });
  });
  it('a value the field type rejects is skipped; nothing found → null', () => {
    expect(suggestMarks(p1, boxes, [f('weight', 'number', 'weight')]).weight).toBeNull();
  });
  it('an API integer-cents price is not offered as the price when JSON-LD has one', () => {
    expect(suggestMarks(p1, boxes, [f('price', 'money', 'price')]).price!.value).toBe('129.99');
  });
  it('a field with an unknown concept falls back to its key as a path tail', () => {
    expect(suggestMarks(p1, boxes, [f('colors', 'text_list', 'colors')]).colors).toMatchObject({ via: { source: 'api', path: 'item.colors' } });
  });
  it('a BreadcrumbList block before the Product block does not shadow the product name (Ikea 2026-09-18)', () => {
    const capture = {
      ...p1,
      structuredData: {
        ...p1.structuredData,
        ldJson: [
          { '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', name: 'Products' }] },
          { '@type': 'Product', name: 'Widget A' },
        ],
        meta: {},
      },
      interceptedRequests: [],
    };
    const r = suggestMarks(capture, [], [f('title', 'text', 'product_name')]);
    expect(r.title).toMatchObject({ value: 'Widget A', via: { source: 'json-ld', path: 'name' } });
  });
});

describe('suggestMarks — the shop\'s name (spec 2026-10-17 §4)', () => {
  const brand = { key: 'brand', name: 'Brand', type: 'text' as const, description: 'the maker', concept: 'brand' };
  const cap = (ld: Record<string, unknown>, meta: Record<string, string>) => ({
    url: 'https://s.example/p', html: '<html></html>', structuredData: { ldJson: [ld], nextData: null, initialState: null, meta }, interceptedRequests: [],
  });
  it('suggests og:site_name when the page data names no brand', () => {
    expect(suggestMarks(cap({ name: 'Brow Kit' }, { 'og:site_name': 'Sigma Beauty' }), [], [brand]).brand).toMatchObject({ value: 'Sigma Beauty', via: { source: 'meta', path: 'og:site_name' } });
  });
  it('keeps brand.name first wherever it exists', () => {
    expect(suggestMarks(cap({ brand: { name: 'Kith Women' } }, { 'og:site_name': 'Kith' }), [], [brand]).brand).toMatchObject({ value: 'Kith Women' });
  });
});

// First run 2026-10-25: a Title suggestion is the page data's name with the colour attached
// ("Crusher® 720 - Primer", "GLOSTAD 3-seat sofa - Knisa dark grey") while the page's heading
// reads the product. The heading rule (spec 2026-10-12 §B1) refuses such a suggestion, so the
// suggestion prefers the heading when a path reads it: a structured value equal to it, else the
// element that shows it.
describe('suggestMarks — a Title prefers the page\'s heading (first run 2026-10-25)', () => {
  const title = f('title', 'text', 'product_name');
  const page = (html: string, ldJson: Array<Record<string, unknown>>, meta: Record<string, string> = {}, api: unknown[] = []) => ({
    url: 'https://shop.example/products/x',
    html,
    structuredData: { ldJson, nextData: null, initialState: null, meta },
    interceptedRequests: api.map((parsedJson) => ({ url: 'https://shop.example/api', method: 'GET', status: 200, isJson: true, parsedJson, contentType: 'application/json' })),
  }) as unknown as Parameters<typeof suggestMarks>[0];

  it('skullcandy-like: the page data names "Crusher® 720 - Primer", the h1 reads "Crusher® 720" → the h1 is suggested', () => {
    const html = '<html><body><nav><a href="/">Home</a> <span>Crusher® 720</span></nav><h1 class="product__title"><span>Crusher® 720</span></h1><p>$139.99</p></body></html>';
    const bx: Box[] = [
      box('Crusher® 720', 0, { xpaths: ['//nav/span'], rect: { x: 0, y: 0, w: 60, h: 12 } }),
      box('Crusher® 720', 1, { xpaths: ['//h1[@class="product__title"]/span', '//body/main/h1/span'], rect: { x: 0, y: 40, w: 300, h: 40 } }),
      box('$139.99', 2),
    ];
    const r = suggestMarks(page(html, [{ '@type': 'Product', name: 'Crusher® 720 - Primer' }], { 'og:title': 'Crusher® 720 - Primer' }), bx, [title]);
    expect(r.title).toEqual({ value: 'Crusher® 720', via: { source: 'xpath', path: '//h1[@class="product__title"]/span' }, boxes: [1] });
  });

  it('ikea-like: the h1 element shows the heading itself → that element, even though a smaller heading-sized box elsewhere says it too', () => {
    const html = '<html><body><h1 class="pip-header">GLOSTAD 3-seat sofa</h1><div>MYR 449</div><footer><h3>GLOSTAD 3-seat sofa</h3></footer></body></html>';
    const bx: Box[] = [
      box('GLOSTAD 3-seat sofa', 0, { tag: 'h1', xpaths: ['//h1[@class="pip-header"]'], rect: { x: 0, y: 20, w: 400, h: 50 } }),
      box('MYR 449', 1),
      box('GLOSTAD 3-seat sofa', 2, { tag: 'h3', xpaths: ['//footer/h3'], rect: { x: 0, y: 900, w: 500, h: 60 } }),
    ];
    const r = suggestMarks(page(html, [{ '@type': 'Product', name: 'GLOSTAD 3-seat sofa - Knisa dark grey' }]), bx, [title]);
    expect(r.title).toEqual({ value: 'GLOSTAD 3-seat sofa', via: { source: 'xpath', path: '//h1[@class="pip-header"]' }, boxes: [0] });
  });

  it('a structured value equal to the heading is preferred over the element: its path certifies like any page data', () => {
    const html = '<html><body><h1>Crusher® 720</h1></body></html>';
    const bx: Box[] = [box('Crusher® 720', 0, { tag: 'h1', xpaths: ['//h1'], rect: { x: 0, y: 0, w: 300, h: 40 } })];
    const r = suggestMarks(page(html, [{ '@type': 'Product', name: 'Crusher® 720 - Primer' }], {}, [{ product: { title: 'Crusher® 720' } }]), bx, [title]);
    expect(r.title).toEqual({ value: 'Crusher® 720', via: { source: 'api', path: 'product.title' }, boxes: [0] });
  });

  it('the page data name that IS the heading stays as it was (case and spacing aside)', () => {
    const html = '<html><body><h1>  widget   A </h1></body></html>';
    const bx: Box[] = [box('widget A', 0, { tag: 'h1', xpaths: ['//h1'] })];
    expect(suggestMarks(page(html, [{ '@type': 'Product', name: 'Widget A' }]), bx, [title]).title).toEqual({ value: 'Widget A', via: { source: 'json-ld', path: 'name' }, boxes: [0] });
  });

  it('no element and no page data reads the heading → the page data name, as before (the row says what it needs)', () => {
    const html = '<html><body><h1><span>GLOSTAD</span> <span>3-seat sofa</span></h1></body></html>';
    const bx: Box[] = [box('GLOSTAD', 0), box('3-seat sofa', 1)];
    expect(suggestMarks(page(html, [{ '@type': 'Product', name: 'GLOSTAD 3-seat sofa - Knisa dark grey' }]), bx, [title]).title).toMatchObject({ value: 'GLOSTAD 3-seat sofa - Knisa dark grey', via: { source: 'json-ld', path: 'name' } });
  });

  it('a page with no heading at all keeps the page data name', () => {
    const bx: Box[] = [box('Crusher® 720 - Primer', 0)];
    expect(suggestMarks(page('<html><body><p>x</p></body></html>', [{ '@type': 'Product', name: 'Crusher® 720 - Primer' }]), bx, [title]).title).toEqual({ value: 'Crusher® 720 - Primer', via: { source: 'json-ld', path: 'name' }, boxes: [0] });
  });

  it('pageHeading: the first h1 from the HTML, else the largest heading box, else null', () => {
    expect(pageHeading('<h1 class="t"><span>Widget</span> <em>A</em></h1><h1>B</h1>', [])).toBe('Widget A');
    expect(pageHeading('<script>"<h1>x</h1>"</script><h2>Small</h2>', [box('Small', 0, { tag: 'h2' }), box('Big one', 1, { tag: 'h3', rect: { x: 0, y: 0, w: 100, h: 100 } })])).toBe('Big one');
    expect(pageHeading('<p>none</p>', [box('none', 0)])).toBeNull();
  });
});

// Fix round 1 (review I1, I2): the heading is preferred only when it is the product's name — the
// page's structured product name contains it (or the page has no name at all) — and a breadcrumb
// that happens to equal the heading is never the path.
describe('suggestMarks — the heading must be the product\'s name (fix round 1)', () => {
  const title = f('title', 'text', 'product_name');
  const page = (html: string, ldJson: Array<Record<string, unknown>>, meta: Record<string, string> = {}) => ({
    url: 'https://shop.example/products/x', html,
    structuredData: { ldJson, nextData: null, initialState: null, meta }, interceptedRequests: [],
  }) as unknown as Parameters<typeof suggestMarks>[0];
  const h1Box = (text: string, xp = '//header/h1') => box(text, 0, { tag: 'h1', xpaths: [xp], rect: { x: 0, y: 0, w: 300, h: 40 } });

  it('a category h1 first ("Headphones") with a Product named "Crusher 720 - Primer" → not preferred', () => {
    const html = '<html><body><header><h1>Headphones</h1></header><h2>Crusher 720 - Primer</h2></body></html>';
    const r = suggestMarks(page(html, [{ '@type': 'Product', name: 'Crusher 720 - Primer' }]), [h1Box('Headphones')], [title]);
    expect(r.title).toMatchObject({ value: 'Crusher 720 - Primer', via: { source: 'json-ld', path: 'name' } });
  });

  it('a logo h1 with an Organization block (and a title naming the shop) → not preferred', () => {
    const html = '<html><head><title>Crusher 720 | Skullcandy</title></head><body><h1>Skullcandy</h1></body></html>';
    // The Product block first: with the Organization first, the main loop's tie on `name` already offers "Skullcandy" (before this change too).
    const ld = [{ '@type': 'Product', name: 'Crusher 720 - Primer' }, { '@type': 'Organization', name: 'Skullcandy' }];
    const r = suggestMarks(page(html, ld, { 'og:title': 'Crusher 720 | Skullcandy' }), [h1Box('Skullcandy', '//h1')], [title]);
    expect(r.title).toMatchObject({ value: 'Crusher 720 - Primer', via: { source: 'json-ld', path: 'name' } });
  });

  it('a "You may also like" h1 → not preferred', () => {
    const html = '<html><body><h1>You may also like</h1></body></html>';
    const r = suggestMarks(page(html, [{ '@type': 'Product', name: 'GLOSTAD 3-seat sofa - Knisa dark grey' }]), [h1Box('You may also like', '//h1')], [title]);
    expect(r.title).toMatchObject({ value: 'GLOSTAD 3-seat sofa - Knisa dark grey' });
  });

  it('the Skullcandy shape is preferred: the name contains the heading, ® and spacing aside', () => {
    const html = '<html><body><h1 class="product__title"><span>Crusher® 720</span></h1></body></html>';
    const bx = [box('Crusher® 720', 0, { xpaths: ['//h1[@class="product__title"]/span'], rect: { x: 0, y: 0, w: 300, h: 40 } })];
    const r = suggestMarks(page(html, [{ '@type': 'Product', name: 'Crusher 720  - Primer' }]), bx, [title]);
    expect(r.title).toEqual({ value: 'Crusher® 720', via: { source: 'xpath', path: '//h1[@class="product__title"]/span' }, boxes: [0] });
  });

  it('the IKEA shape is preferred, its Product inside an @graph', () => {
    const html = '<html><body><h1 class="pip-header">GLOSTAD 3-seat sofa</h1></body></html>';
    const ld = [{ '@graph': [{ '@type': 'WebPage', name: 'Sofas' }, { '@type': ['Product'], name: 'GLOSTAD 3-seat sofa - Knisa dark grey' }] }];
    const r = suggestMarks(page(html, ld), [h1Box('GLOSTAD 3-seat sofa', '//h1[@class="pip-header"]')], [title]);
    expect(r.title).toMatchObject({ value: 'GLOSTAD 3-seat sofa', via: { source: 'xpath', path: '//h1[@class="pip-header"]' } });
  });

  it('with no Product name, og:title or the document title decides; with no name at all the heading is preferred', () => {
    const html = (t: string) => `<html><head>${t}</head><body><h1>Widget A</h1></body></html>`;
    const api = { url: 'https://shop.example/api', method: 'GET', status: 200, isJson: true, contentType: 'application/json', parsedJson: { product: { title: 'Widget A - Red' } } };
    const cap = (t: string, meta: Record<string, string> = {}) => ({ ...page(html(t), [], meta), interceptedRequests: [api] }) as unknown as Parameters<typeof suggestMarks>[0];
    expect(suggestMarks(cap('<title>Widget A | Shop</title>'), [h1Box('Widget A', '//h1')], [title]).title).toMatchObject({ value: 'Widget A', via: { source: 'xpath' } });
    expect(suggestMarks(cap('<title>Home | Shop</title>'), [h1Box('Widget A', '//h1')], [title]).title).toMatchObject({ value: 'Widget A - Red', via: { source: 'api' } });
    expect(suggestMarks(cap(''), [h1Box('Widget A', '//h1')], [title]).title).toMatchObject({ value: 'Widget A', via: { source: 'xpath' } });
  });

});
