import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { pageVariantFrom } from '@robot/browser';
import { searchStructured, resolveStructured, searchStructuredByConcept, apiResponseOf, responseKey } from './search-structured.js';
import { applyTransform } from './transforms.js';

const capture = {
  url: 'https://shop.example/p/1',
  structuredData: {
    ldJson: [{ '@type': 'Product', name: 'Widget A', offers: { price: '129.99', priceCurrency: 'USD', availability: 'https://schema.org/InStock' } }],
    nextData: null, initialState: null,
    meta: { 'og:title': 'Widget A', 'product:price:amount': '129.99' },
  },
  interceptedRequests: [
    { url: 'https://shop.example/api/p/1', method: 'GET', resourceType: 'xhr', responseStatus: 200, responseHeaders: {}, contentType: 'application/json', bodySize: 1, timestamp: 0, isJson: true,
      responseBody: '{}', parsedJson: { item: { title: 'Widget A', priceCents: 12999, images: ['https://c.example/a.jpg', 'https://c.example/b.jpg'] }, related: [{ title: 'Widget B' }] } },
    { url: 'https://shop.example/telemetry', method: 'POST', resourceType: 'xhr', responseStatus: 200, responseHeaders: {}, contentType: 'text/plain', bodySize: 1, timestamp: 0, isJson: false, responseBody: 'ok', parsedJson: null },
  ],
};

describe('searchStructured', () => {
  it('finds a text value in api, json-ld and meta with identity transform', () => {
    const c = searchStructured(capture, 'text', 'Widget A');
    expect(c).toContainEqual({ source: 'api', path: 'item.title', transform: 'identity', raw: 'Widget A' });
    expect(c).toContainEqual({ source: 'json-ld', path: 'name', transform: 'identity', raw: 'Widget A' });
    expect(c).toContainEqual({ source: 'meta', path: 'og:title', transform: 'identity', raw: 'Widget A' });
    expect(c.find((x) => x.path === 'related[0].title')).toBeUndefined();
  });
  it('finds money via cents_to_units in the api and identity in json-ld', () => {
    const c = searchStructured(capture, 'money', '129.99');
    expect(c).toContainEqual({ source: 'api', path: 'item.priceCents', transform: 'cents_to_units', raw: 12999 });
    expect(c).toContainEqual({ source: 'json-ld', path: 'offers.price', transform: 'identity', raw: '129.99' });
  });
  it('finds an image via first_of_list on an array', () => {
    const c = searchStructured(capture, 'image', 'https://c.example/a.jpg');
    expect(c).toContainEqual({ source: 'api', path: 'item.images', transform: 'first_of_list', raw: ['https://c.example/a.jpg', 'https://c.example/b.jpg'] });
    expect(c).toContainEqual({ source: 'api', path: 'item.images[0]', transform: 'identity', raw: 'https://c.example/a.jpg' });
  });
  it('maps a schema.org availability to boolean', () => {
    expect(searchStructured(capture, 'boolean', 'in stock')).toContainEqual({ source: 'json-ld', path: 'offers.availability', transform: 'identity', raw: 'https://schema.org/InStock' });
  });
  it('handles root-level arrays without emitting empty path', () => {
    const rootArrayCapture = {
      url: 'https://api.example/items',
      structuredData: {
        ldJson: [],
        nextData: null, initialState: null,
        meta: {},
      },
      interceptedRequests: [
        { url: 'https://api.example/items', method: 'GET', resourceType: 'xhr', responseStatus: 200, responseHeaders: {}, contentType: 'application/json', bodySize: 1, timestamp: 0, isJson: true,
          responseBody: '[]', parsedJson: [{ title: 'Widget A' }, { title: 'Widget Z' }] },
      ],
    };
    const c = searchStructured(rootArrayCapture, 'text', 'Widget A');
    expect(c).toContainEqual({ source: 'api', path: '[0].title', transform: 'identity', raw: 'Widget A' });
    expect(c.find((x) => x.path === '')).toBeUndefined();
    expect(resolveStructured(rootArrayCapture, 'api', '[0].title')).toBe('Widget A');
  });
});

describe('resolveStructured', () => {
  it('replays api, json-ld and meta paths', () => {
    expect(resolveStructured(capture, 'api', 'item.priceCents')).toBe(12999);
    expect(resolveStructured(capture, 'json-ld', 'offers.price')).toBe('129.99');
    expect(resolveStructured(capture, 'meta', 'og:title')).toBe('Widget A');
    expect(resolveStructured(capture, 'api', 'nope.x')).toBeUndefined();
  });
});

describe('searchStructuredByConcept', () => {
  it('money: a key named for cents reads through cents_to_units (priceCents: 22999 → 229.99), not identity', () => {
    const c = { ...capture, interceptedRequests: [{ ...capture.interceptedRequests[0]!, parsedJson: { item: { priceCents: 22999 } } }] };
    const found = searchStructuredByConcept(c, 'money', 'price');
    const cents = found.find((x) => x.path === 'item.priceCents');
    expect(cents?.transform).toBe('cents_to_units');
    expect(applyTransform(cents!.raw, cents!.transform)).toBe(229.99);
  });
  it('money: a key not named for cents keeps identity first', () => {
    const found = searchStructuredByConcept(capture, 'money', 'price');
    expect(found.find((x) => x.path === 'offers.price')?.transform).toBe('identity');
  });
});

describe('searchStructured — the [page] twin (spec 2026-10-14 §4)', () => {
  const rug = JSON.parse(readFileSync(new URL('./__fixtures__/page-variant/ruggable.json', import.meta.url), 'utf8'));
  const capture = { url: rug.url, structuredData: { ldJson: rug.ldJson, nextData: null, initialState: null, meta: {} }, interceptedRequests: [], pageVariant: pageVariantFrom(rug.url, null, {}) };
  it('beside the index path whose entry is the page variant, emits the [page] form; other indexes get no twin', () => {
    const out = searchStructured(capture, 'money', '569.00');
    const paths = out.map((c) => c.path);
    expect(paths).toContain('hasVariant[1].offers.price');
    expect(paths).toContain('hasVariant[page].offers.price');
    expect(out.find((c) => c.path === 'hasVariant[page].offers.price')).toMatchObject({ source: 'json-ld', transform: 'identity' });
    const other = searchStructured(capture, 'money', '439.00');
    expect(other.map((c) => c.path)).toContain('hasVariant[0].offers.price');
    expect(other.map((c) => c.path)).not.toContain('hasVariant[page].offers.price');
  });
  it('no page variant on the capture: no twin', () => {
    const { pageVariant: _, ...plain } = capture;
    expect(searchStructured(plain, 'money', '569.00').map((c) => c.path)).not.toContain('hasVariant[page].offers.price');
  });
  it('every [page] twin resolves to the value it was found with (the twin agrees with getByDotPath)', () => {
    const twin = searchStructured(capture, 'money', '569.00').find((c) => c.path === 'hasVariant[page].offers.price')!;
    expect(resolveStructured(capture, 'json-ld', twin.path, { pageVariant: capture.pageVariant })).toBe('569.00');
  });
  it('the concept search emits the twin too', () => {
    expect(searchStructuredByConcept(capture, 'money', 'price').map((c) => c.path)).toContain('hasVariant[page].offers.price');
  });
});


describe('apiResponseOf (spec 2026-10-20 one-source §3.1)', () => {
  const json = (url: string, parsedJson: unknown) => ({ url, method: 'GET', resourceType: 'xhr', responseStatus: 200, responseHeaders: {}, contentType: 'application/json', bodySize: 1, timestamp: 0, isJson: true, responseBody: '{}', parsedJson });
  const text = (url: string) => ({ url, method: 'POST', resourceType: 'xhr', responseStatus: 200, responseHeaders: {}, contentType: 'text/plain', bodySize: 1, timestamp: 0, isJson: false, responseBody: 'ok', parsedJson: null });
  const at = (...requests: unknown[]) => ({ interceptedRequests: requests as unknown as typeof capture.interceptedRequests });

  it('names the response by origin and path, query and fragment ignored', () => {
    expect(apiResponseOf(at(json('https://api.salesitem.ingka.com/availabilities/ru/us?itemNos=80275887&expand=StoresList#x', { price: 79.99 })), 'price'))
      .toBe('https://api.salesitem.ingka.com/availabilities/ru/us');
  });

  it('names the first body where the path reads, as resolveStructured does', () => {
    const c = at(
      json('https://shop.example/api/cart', { total: 0 }),
      json('https://shop.example/api/product/1', { price: 129.99 }),
      json('https://shop.example/api/recommendations', { price: 5 }),
    );
    expect(apiResponseOf(c, 'price')).toBe('https://shop.example/api/product/1');
    expect(resolveStructured({ ...c, structuredData: capture.structuredData }, 'api', 'price')).toBe(129.99);
  });

  it('skips non-JSON and unparsed requests, and a body where the path is empty', () => {
    const c = at(text('https://shop.example/telemetry'), json('https://shop.example/api/a', { price: '' }), json('https://shop.example/api/b', { price: null }), json('https://shop.example/api/c', { price: 9 }));
    expect(apiResponseOf(c, 'price')).toBe('https://shop.example/api/c');
  });

  it('is null when no body has the path', () => {
    expect(apiResponseOf(at(json('https://shop.example/api/a', { name: 'x' })), 'price')).toBeNull();
    expect(apiResponseOf(at(), 'price')).toBeNull();
  });

  it('reads a [page] path through the capture\'s page variant', () => {
    const pageVariant = pageVariantFrom('https://shop.example/p/1?size=M', null, {});
    const c = { ...at(json('https://shop.example/api/p/1', { variants: [{ size: 'S', price: 1 }, { size: 'M', price: 2 }] })), pageVariant };
    expect(apiResponseOf(c, 'variants[page].price')).toBe('https://shop.example/api/p/1');
  });

  it('responseKey keeps an unparsable address up to its query', () => {
    expect(responseKey('/relative/path?x=1#y')).toBe('/relative/path');
    expect(responseKey('https://a.example/x/y?z=1')).toBe('https://a.example/x/y');
  });
});
