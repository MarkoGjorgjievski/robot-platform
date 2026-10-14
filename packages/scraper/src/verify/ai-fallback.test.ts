import { describe, it, expect } from 'vitest';
import { buildProposePrompt, proposeWithAi } from './ai-fallback.js';
import { pageVariantFrom } from '@robot/browser';

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

describe('buildProposePrompt — I1 robustness', () => {
  it('skips a page whose expected value is blank instead of searching for the empty string', () => {
    const p4 = 'https://s.example/4';
    const withBlankPage = {
      field,
      expected: { 'https://s.example/1': '129.99', [p4]: '' }, // not checked on p4
      captures: { 'https://s.example/1': cap('https://s.example/1'), [p4]: cap(p4) },
      nearMisses: { 'https://s.example/1': ['$149.00'] },
    };
    const p = buildProposePrompt(withBlankPage);
    expect(p).not.toContain(p4);
    expect(p).not.toMatch(/→\s*(\n|$)/); // no blank-value "- url → " line
    expect(p).toContain('https://s.example/1 → 129.99'); // the checked page is still there
  });
});

describe('proposeWithAi', () => {
  it('returns proposals as candidate paths and reports the call', async () => {
    const agent = { proposePaths: async () => [{ source: 'api' as const, path: 'item.priceCents', transform: 'cents_to_units' as const }] };
    expect(await proposeWithAi(evidence, agent)).toEqual([{ source: 'api', path: 'item.priceCents', transform: 'cents_to_units' }]);
  });
});

describe('buildProposePrompt — the page variant (spec 2026-10-14 §4)', () => {
  const url = 'https://ruggable.com/products/ryder?size=6x9';
  const capture = cap(url);
  it('tells the model the page variant and the [page] form when the address names one', () => {
    const prompt = buildProposePrompt({ field, expected: { [url]: '569.00' }, captures: { [url]: { ...capture, pageVariant: pageVariantFrom(url, null, {}) } }, nearMisses: {} });
    expect(prompt).toContain('This address names a variant');
    expect(prompt).toContain('[{"name":"size","value":"6x9"}]');
    expect(prompt).toContain('arr[page]');
  });
  it('says nothing of it when the address names none', () => {
    const plain = 'https://ruggable.com/products/ryder';
    const prompt = buildProposePrompt({ field, expected: { [plain]: '569.00' }, captures: { [plain]: { ...cap(plain), pageVariant: pageVariantFrom(plain, null, {}) } }, nearMisses: {} });
    expect(prompt).not.toContain('arr[page]');
  });
});
