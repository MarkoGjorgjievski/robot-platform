import { describe, it, expect } from 'vitest';
import { buildProposePrompt, proposeWithAi } from './ai-fallback.js';

const field = { key: 'price', name: 'Price', type: 'money' as const, description: 'green number next to Add to cart', concept: 'price' };
const cap = (url: string) => ({
  url, html: '<html><body><div id="p"><span class="now">$129.99</span></div></body></html>',
  structuredData: { ldJson: [{ name: 'W' }], nextData: null, initialState: null, meta: { 'og:title': 'W' } },
  interceptedRequests: [{ url: 'https://s.example/api', method: 'GET', resourceType: 'xhr', responseStatus: 200, responseHeaders: {}, contentType: 'application/json', bodySize: 1, timestamp: 0, isJson: true, responseBody: '{}', parsedJson: { item: { priceCents: 12999 } } }],
});
const evidence = { field, expected: { 'https://s.example/1': '129.99' }, captures: { 'https://s.example/1': cap('https://s.example/1') }, nearMisses: { 'https://s.example/1': ['$149.00'] } };

describe('buildProposePrompt', () => {
  it('carries the description, expected values per URL, near-misses, and the evidence', () => {
    const p = buildProposePrompt(evidence);
    expect(p).toContain('green number next to Add to cart');
    expect(p).toContain('https://s.example/1 → 129.99');
    expect(p).toContain('$149.00');
    expect(p).toContain('"priceCents":12999');
    expect(p).toContain('og:title');
  });
});

describe('proposeWithAi', () => {
  it('returns proposals as candidate paths and reports the call', async () => {
    const agent = { proposePaths: async () => [{ source: 'api' as const, path: 'item.priceCents', transform: 'cents_to_units' as const }] };
    expect(await proposeWithAi(evidence, agent)).toEqual([{ source: 'api', path: 'item.priceCents', transform: 'cents_to_units' }]);
  });
});
