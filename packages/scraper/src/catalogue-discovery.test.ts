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

describe('parseCatalogueResponse — label hygiene', () => {
  it('renames a label that merely repeats the source name', () => {
    const out = parseCatalogueResponse({
      'product_name': [
        { label: 'json-ld', source: 'json-ld', path: 'name', sampleValue: 'SSD' },
      ],
    }, { ...evidence, fieldResults: [{ name: 'product_name', value: 'SSD', source: 'json-ld', path: 'name' }] });
    expect(out.product_name).toHaveLength(1);
    expect(out.product_name![0]!.label).not.toBe('json-ld');
    expect(out.product_name![0]!.label).toBe('main');
  });

  it('leaves meaningful labels alone', () => {
    const out = parseCatalogueResponse({
      price: [{ label: 'list', source: 'api', path: 'MainItem.OriginalUnitPrice', sampleValue: 679.99 }],
    }, evidence);
    expect(out.price![0]!.label).toBe('list');
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
    expect(prompt).toContain('sampleValue short'); // output-budget rule (Newegg truncation, 2026-08-26)
    // Conflict suppression only engages when every disagreeing path is
    // labelled — so the extraction's own paths must all be catalogued.
    expect(prompt).toContain('every path listed under Extraction results');
    // Labels say WHICH value, never WHERE it came from — the 2026-08-26
    // catalogues carried labels like "json-ld", which duplicate the source
    // column and tell the customer nothing.
    expect(prompt).toContain('never a source or format name');
  });

  // The 2026-08-26 Newegg diagnosis: one 30KB slice over ALL bodies cut the
  // FIRST body mid-JSON (it alone was 37KB), so the model saw broken evidence.
  // Bodies are now serialized individually under per-body and total budgets,
  // with bodies that the extraction's own api paths resolve against first.
  it('serializes bodies separately, product-bearing bodies first', () => {
    const junk = { widget: 'w'.repeat(50) };
    const product = { MainItem: { OriginalUnitPrice: 679.99, BodyOnlyMarker: 'zqx1' } };
    const prompt = buildCataloguePrompt({
      ...evidence,
      apiBodies: [junk, product],
      fieldResults: [{ name: 'price', value: 679.99, source: 'api', path: 'MainItem.OriginalUnitPrice' }],
    });
    const productAt = prompt.indexOf('zqx1');
    const junkAt = prompt.indexOf('wwww');
    expect(productAt).toBeGreaterThan(-1);
    expect(junkAt).toBeGreaterThan(-1);
    expect(productAt).toBeLessThan(junkAt);
  });

  it('a single oversized body cannot break the others out of the prompt', () => {
    const huge = { blob: 'h'.repeat(60_000) };
    const product = { MainItem: { OriginalUnitPrice: 679.99 } };
    const prompt = buildCataloguePrompt({ ...evidence, apiBodies: [huge, product] });
    // The small product body survives intact even though the huge one exceeds
    // any single-slice budget on its own.
    expect(prompt).toContain('OriginalUnitPrice');
    expect(prompt.length).toBeLessThan(60_000);
  });
});
