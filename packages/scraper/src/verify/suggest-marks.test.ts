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
