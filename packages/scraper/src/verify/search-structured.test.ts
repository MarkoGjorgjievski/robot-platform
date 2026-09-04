import { describe, it, expect } from 'vitest';
import { searchStructured, resolveStructured } from './search-structured.js';

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
});

describe('resolveStructured', () => {
  it('replays api, json-ld and meta paths', () => {
    expect(resolveStructured(capture, 'api', 'item.priceCents')).toBe(12999);
    expect(resolveStructured(capture, 'json-ld', 'offers.price')).toBe('129.99');
    expect(resolveStructured(capture, 'meta', 'og:title')).toBe('Widget A');
    expect(resolveStructured(capture, 'api', 'nope.x')).toBeUndefined();
  });
});
