import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PlaywrightBrowser } from '@robot/browser';
import { transferMarks } from './transfer-marks.js';
import { buildBoxMapScript, boxesFromAnnotation, type Box } from './box-map.js';
import { buildDomSearchScript, buildXPathProbeScript, type DomHit, type DomNeedle, type XPathProbeResult } from './dom-scripts.js';
import { loadShopExample, loadVerifyFixture, SHOP_EXAMPLE_URLS as U, SHOP_EXAMPLE_P4 } from '../__fixtures__/verify/load.js';
import type { CaptureLike } from './certify.js';
import type { SchemaDefinitionField } from './types.js';

let browser: PlaywrightBrowser;
beforeAll(async () => { browser = new PlaywrightBrowser(); await browser.launch({ headless: true }); });
afterAll(async () => { await browser.close(); });

const deps = {
  evalXPaths: (html: string, xps: string[]) => browser.setContentEvaluate<XPathProbeResult>(html, buildXPathProbeScript(xps)),
  runDomSearch: (html: string, needles: DomNeedle[], pageUrl: string) => browser.setContentEvaluate<DomHit[]>(html, buildDomSearchScript(needles, pageUrl)),
};
const boxesOf = async (html: string): Promise<Box[]> => boxesFromAnnotation(await browser.setContentEvaluate<unknown>(html, buildBoxMapScript()));
// No structured source at all: only the DOM (and the mark's XPath) can carry the value.
const bare = (c: CaptureLike): CaptureLike => ({
  ...c,
  structuredData: { ldJson: [], nextData: null, initialState: null, meta: {} },
  interceptedRequests: [],
});
const price: SchemaDefinitionField = { key: 'price', name: 'Price', type: 'money', description: '', concept: 'price' };
const title: SchemaDefinitionField = { key: 'title', name: 'Title', type: 'text', description: '', concept: 'product_name' };

describe('transferMarks', () => {
  it('carries page 1 price to pages 2 and 3 with the element that shows it', async () => {
    const caps = loadShopExample();
    const to = { [U[1]!]: { capture: caps[U[1]!]!, boxes: await boxesOf(caps[U[1]!]!.html) }, [U[2]!]: { capture: caps[U[2]!]!, boxes: await boxesOf(caps[U[2]!]!.html) } };
    const r = await transferMarks({ field: price, from: { url: U[0]!, capture: caps[U[0]!]!, expected: '129.99' }, to }, deps);
    expect(r[U[1]!]).toMatchObject({ value: expect.stringMatching(/219\.99/), boxes: [expect.any(Number)] });
    expect(to[U[1]!]!.boxes[r[U[1]!]!.boxes[0]!]!.text).toBe('$219.99');
    expect(r[U[2]!]!.value).toMatch(/149(\.00)?/);
  });
  it('a mark\'s xpath carries the value when the page has no structured source', async () => {
    const caps = loadShopExample();
    const mark = { xpaths: ['//*[@id="main"]/div[@class="price-box"]/span[@class="now"]'], text: '$129.99', rect: { x: 0, y: 0, w: 1, h: 1 } };
    const fromCapture = bare(caps[U[0]!]!);
    const toCapture = bare(caps[U[1]!]!);
    const to = { [U[1]!]: { capture: toCapture, boxes: await boxesOf(toCapture.html) } };
    const r = await transferMarks({ field: price, from: { url: U[0]!, capture: fromCapture, expected: '129.99', mark }, to }, deps);
    expect(r[U[1]!]).toMatchObject({ value: expect.stringMatching(/219\.99/), via: { source: 'xpath', path: mark.xpaths[0] }, boxes: [expect.any(Number)] });
    expect(to[U[1]!]!.boxes[r[U[1]!]!.boxes[0]!]!.text).toBe('$219.99');
  });
  it('a page where nothing resolves is null', async () => {
    const caps = loadShopExample();
    const p4 = loadVerifyFixture('shop-example', 'p4');
    const to = { [SHOP_EXAMPLE_P4]: { capture: p4, boxes: await boxesOf(p4.html) } };
    // p4 is the clearance template: the price is not where p1 keeps it, and p4 carries no offers.price (see the fixture).
    const r = await transferMarks({ field: price, from: { url: U[0]!, capture: caps[U[0]!]!, expected: '129.99' }, to }, deps);
    expect(r[SHOP_EXAMPLE_P4]).toBeNull();
  });
  it('a structured-only value comes back with no boxes', async () => {
    const caps = loadShopExample();
    const to = { [U[1]!]: { capture: caps[U[1]!]!, boxes: [] as Box[] } };
    const r = await transferMarks({ field: title, from: { url: U[0]!, capture: caps[U[0]!]!, expected: 'Widget A' }, to }, deps);
    expect(r[U[1]!]).toMatchObject({ value: 'Widget B', boxes: [] });
  });

  // spec 2026-09-29 A2: the carry follows the same fit rule as certification
  // (C2) for a weak (boolean) field — an unrelated API field that happens to
  // agree is not a candidate; only a path that fits the concept is.
  it('carries a boolean field by the fitting concept path, not an unrelated field that happens to agree', async () => {
    const inStock: SchemaDefinitionField = { key: 'in_stock', name: 'In stock', type: 'boolean', description: '', concept: 'availability' };
    const capOf = (url: string): CaptureLike => ({
      url, html: '<html><body></body></html>',
      structuredData: { ldJson: [{ offers: { availability: 'https://schema.org/InStock' } }], nextData: null, initialState: null, meta: {} },
      interceptedRequests: [{ url: `${url}/api`, method: 'GET', status: 200, isJson: true, parsedJson: { priority: 1 } }] as unknown as CaptureLike['interceptedRequests'],
    });
    const fromCapture = capOf('https://s.example/p/1');
    const toCapture = capOf('https://s.example/p/2');
    const to = { 'https://s.example/p/2': { capture: toCapture, boxes: [] as Box[] } };
    const r = await transferMarks({ field: inStock, from: { url: 'https://s.example/p/1', capture: fromCapture, expected: 'true' }, to }, deps);
    expect(r['https://s.example/p/2']).toMatchObject({ via: { source: 'json-ld', path: 'offers.availability' } });
  });

  // spec 2026-09-29 A2 + C1: the path the customer confirmed on page 1 carries first, ahead
  // of a fitting API path that certification's order would otherwise pick.
  it('a confirmed JSON-LD path carries ahead of a fitting API path', async () => {
    const inStock: SchemaDefinitionField = { key: 'in_stock', name: 'In stock', type: 'boolean', description: '', concept: 'availability' };
    const capOf = (url: string, ld: string, api: boolean): CaptureLike => ({
      url, html: '<html><body></body></html>',
      structuredData: { ldJson: [{ offers: { availability: ld } }], nextData: null, initialState: null, meta: {} },
      interceptedRequests: [{ url: `${url}/api`, method: 'GET', status: 200, isJson: true, parsedJson: { product: { inStock: api } } }] as unknown as CaptureLike['interceptedRequests'],
    });
    const fromCapture = capOf('https://s.example/p/1', 'https://schema.org/InStock', true);
    const toCapture = capOf('https://s.example/p/2', 'https://schema.org/OutOfStock', true);
    const to = { 'https://s.example/p/2': { capture: toCapture, boxes: [] as Box[] } };
    const unconfirmed = await transferMarks({ field: inStock, from: { url: 'https://s.example/p/1', capture: fromCapture, expected: 'true' }, to }, deps);
    expect(unconfirmed['https://s.example/p/2']).toMatchObject({ via: { source: 'api', path: 'product.inStock' } });
    const confirmed = await transferMarks({ field: inStock, from: { url: 'https://s.example/p/1', capture: fromCapture, expected: 'true', via: { source: 'json-ld', path: 'offers.availability' } }, to }, deps);
    expect(confirmed['https://s.example/p/2']).toMatchObject({ via: { source: 'json-ld', path: 'offers.availability' } });
  });

  // Fix round 1, regression (Important): normalize() now reads an ImageObject's own
  // `url`, so it no longer rejects the array-level candidate (`image`, transform
  // first_of_list) that outranks the leaf one (`image[0].url`, longer path) once both
  // qualify. Before the fix, `String(raw)` on that winning ImageObject produced
  // "[object Object]" instead of the URL.
  const image: SchemaDefinitionField = { key: 'image', name: 'Image', type: 'image', description: '', concept: 'image_url' };
  it('a JSON-LD image array carries the URL of its ImageObject, never [object Object], and matches the image box', async () => {
    const capOf = (url: string, imgUrl: string): CaptureLike => ({
      url, html: `<html><body><img src="${imgUrl}"></body></html>`,
      structuredData: { ldJson: [{ image: [{ '@type': 'ImageObject', url: imgUrl }] }], nextData: null, initialState: null, meta: {} },
      interceptedRequests: [],
    });
    const fromCapture = capOf('https://s.example/p/1', 'https://x.example/from.jpg');
    const toCapture = capOf('https://s.example/p/2', 'https://x.example/to.jpg');
    const to = { 'https://s.example/p/2': { capture: toCapture, boxes: await boxesOf(toCapture.html) } };
    const r = await transferMarks({ field: image, from: { url: 'https://s.example/p/1', capture: fromCapture, expected: 'https://x.example/from.jpg' }, to }, deps);
    expect(r['https://s.example/p/2']).toMatchObject({ value: 'https://x.example/to.jpg', via: { source: 'json-ld', path: 'image' } });
    expect(r['https://s.example/p/2']!.value).not.toContain('[object Object]');
    const box = to['https://s.example/p/2']!.boxes[r['https://s.example/p/2']!.boxes[0]!];
    expect(box).toMatchObject({ kind: 'image', src: 'https://x.example/to.jpg' });
  });
});
