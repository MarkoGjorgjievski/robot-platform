import { describe, it, expect } from 'vitest';
import { shapeOf, addressPattern } from './shape.js';
import type { InterceptedRequest } from '@robot/browser';

const cap = (url: string, ldJson: Record<string, unknown>[], api?: unknown) => ({
  url,
  structuredData: { ldJson, nextData: null, initialState: null, meta: {} },
  interceptedRequests: api
    ? [
        {
          url: `${url}/api`,
          method: 'GET',
          resourceType: 'xhr',
          responseStatus: 200,
          responseHeaders: {},
          responseBody: JSON.stringify(api),
          contentType: 'application/json',
          bodySize: 0,
          isJson: true,
          parsedJson: api,
          timestamp: 0,
        } satisfies InterceptedRequest,
      ]
    : [],
});

describe('shapeOf', () => {
  it('a single product with top-level offers and a rating', () => {
    expect(shapeOf(cap('https://s.example/p/12', [{ '@type': 'Product', offers: { price: '1' }, aggregateRating: { ratingValue: 4 } }])))
      .toEqual({ jsonLdTypes: ['Product'], offers: 'top-level', rating: true, address: '/p/n' });
  });
  it('a ProductGroup whose offers sit in its variants (Lookfantastic)', () => {
    const s = shapeOf(cap('https://s.example/p/12?variation=3', [{ '@type': 'ProductGroup', hasVariant: [{ '@type': 'Product', offers: { price: '1' } }] }]));
    expect(s).toEqual({ jsonLdTypes: ['ProductGroup'], offers: 'in-variants', rating: false, address: '/p/n?variation' });
  });
  it('unwraps @graph and reads a rating from an intercepted API when the JSON-LD has none', () => {
    const s = shapeOf(cap('https://s.example/x', [{ '@graph': [{ '@type': 'BreadcrumbList' }, { '@type': 'Product' }] }], { stats: { averageRating: 4.2 } }));
    expect(s.jsonLdTypes).toEqual(['BreadcrumbList', 'Product']);
    expect(s.offers).toBe('none');
    expect(s.rating).toBe(true);
  });
  it('no page data at all', () => {
    expect(shapeOf(cap('https://s.example/', []))).toEqual({ jsonLdTypes: [], offers: 'none', rating: false, address: '/' });
  });
});

describe('addressPattern', () => {
  it('replaces digit runs and keeps query keys, sorted', () => {
    expect(addressPattern('https://s.example/p/ekiden-one/9713/c248c227m8351755?b=1&a=2')).toBe('/p/ekiden-one/n/cncnmn?a&b');
  });
});
