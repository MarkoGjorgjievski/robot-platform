import { describe, it, expect } from 'vitest';
import { buildCataloguePrompt, parseCatalogueResponse, type CatalogueEvidence } from './catalogue-discovery.js';

const evidence: CatalogueEvidence = {
  apiBodies: [{ MainItem: { OriginalUnitPrice: 679.99, FinalPrice: 399.99 } }],
  jsonLdBlocks: [{ '@type': 'Product', offers: { price: 389.99 } }],
  meta: { 'og:title': 'SSD 9100 PRO' },
  fieldResults: [{ name: 'price', value: 389.99, source: 'xpath', path: '//span[@class="price-current"]' }],
};

describe('parseCatalogueResponse', () => {
  it('accepts a candidate whose dot-path resolves against the provided API bodies', () => {
    const out = parseCatalogueResponse({
      price: [{ label: 'list', source: 'api', path: 'MainItem.OriginalUnitPrice', sampleValue: 679.99 }],
    }, evidence);
    expect(out.price).toHaveLength(1);
  });

  it('accepts a candidate whose path is a path the extraction itself used', () => {
    const out = parseCatalogueResponse({
      price: [{ label: 'displayed', source: 'xpath', path: '//span[@class="price-current"]', sampleValue: 389.99 }],
    }, evidence);
    expect(out.price).toHaveLength(1);
  });

  it('REJECTS a candidate whose path resolves nowhere — a fabricated answer never reaches the cache', () => {
    const out = parseCatalogueResponse({
      price: [{ label: 'promo', source: 'api', path: 'MainItem.PromoPriceInvented', sampleValue: 1 }],
    }, evidence);
    expect(out.price).toBeUndefined();
  });

  it('routes through sanitizeCatalogue (caps, duplicate labels, garbage)', () => {
    expect(parseCatalogueResponse('garbage', evidence)).toEqual({});
  });

  it('strips displayed and verifiedAt from a kept candidate — discovery must not mint them', () => {
    const out = parseCatalogueResponse({
      price: [{
        label: 'displayed', source: 'xpath', path: '//span[@class="price-current"]', sampleValue: 389.99,
        displayed: true, verifiedAt: '2026-01-01T00:00:00.000Z',
      }],
    }, evidence);
    expect(out.price).toHaveLength(1);
    expect(out.price![0]).not.toHaveProperty('displayed');
    expect(out.price![0]).not.toHaveProperty('verifiedAt');
    expect(out.price![0]).toEqual({
      label: 'displayed', source: 'xpath', path: '//span[@class="price-current"]', sampleValue: 389.99,
    });
  });
});

describe('parseCatalogueResponse — envelope shape', () => {
  // The 2026-08-26 dogfood proved the permissive record shape is unstable:
  // the model wrapped output in its own key and everything sanitized to {}
  // silently. The tool now asks for an explicit envelope the schema can
  // actually describe: { concepts: [{ concept, candidates: [...] }] }.
  it('accepts the concepts-envelope shape the tool schema prescribes', () => {
    const out = parseCatalogueResponse({
      concepts: [
        {
          concept: 'price',
          candidates: [{ label: 'list', source: 'api', path: 'MainItem.OriginalUnitPrice', sampleValue: 679.99 }],
        },
      ],
    }, evidence);
    expect(out.price).toHaveLength(1);
    expect(out.price![0]!.label).toBe('list');
  });

  it('still accepts a bare record (defensive fallback for the old shape)', () => {
    const out = parseCatalogueResponse({
      price: [{ label: 'list', source: 'api', path: 'MainItem.OriginalUnitPrice', sampleValue: 679.99 }],
    }, evidence);
    expect(out.price).toHaveLength(1);
  });

  it('a malformed envelope (concepts not an array, entries without names) yields {}', () => {
    expect(parseCatalogueResponse({ concepts: 'nope' }, evidence)).toEqual({});
    expect(parseCatalogueResponse({ concepts: [{ candidates: [] }] }, evidence)).toEqual({});
  });
});

describe('buildCataloguePrompt', () => {
  it('carries the evidence and the labelling rules', () => {
    const prompt = buildCataloguePrompt(evidence);
    expect(prompt).toContain('OriginalUnitPrice');
    expect(prompt).toContain('price-current');
    expect(prompt).toContain('snake_case');   // concept naming rule
    expect(prompt).toContain('meaning');      // "label the meaning, never the path"
  });
});
