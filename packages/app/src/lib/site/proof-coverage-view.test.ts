import { describe, it, expect } from 'vitest';
import { coverageLine, coverageStage, EVERY_PRODUCT_DEFAULT } from './proof-coverage-view';

const f = { key: 'price', empty: ['https://s.example/p/10', 'https://s.example/p/11'], sampled: 20, explanation: 'all 2 list their sizes as variants in the page data', representative: 'https://s.example/p/10' };

describe('coverageLine (spec 2026-10-10 §5)', () => {
  it('count, explanation, action', () => {
    expect(coverageLine(f, false)).toEqual({ text: 'Empty on 2 of 20 sampled products · all 2 list their sizes as variants in the page data', useAsProofPage: 'https://s.example/p/10' });
  });
  it('count alone without an explanation', () => {
    expect(coverageLine({ ...f, explanation: null }, false).text).toBe('Empty on 2 of 20 sampled products');
  });
  it('at six proof pages the line says so and offers nothing', () => {
    expect(coverageLine(f, true)).toEqual({ text: 'Empty on 2 of 20 sampled products · all 2 list their sizes as variants in the page data · This website has its six proof pages', useAsProofPage: null });
  });
  it('a representative already on the board offers nothing and says so', () => {
    expect(coverageLine(f, false, true)).toEqual({ text: 'Empty on 2 of 20 sampled products · all 2 list their sizes as variants in the page data · already a proof page', useAsProofPage: null });
    expect(coverageLine({ ...f, explanation: null }, true, true)).toEqual({ text: 'Empty on 2 of 20 sampled products · already a proof page', useAsProofPage: null });
  });
  it('one sampled product reads in the singular', () => {
    expect(coverageLine({ ...f, empty: ['https://s.example/p/10'], sampled: 1, explanation: null }, false).text).toBe('Empty on 1 of 1 sampled product');
  });
});

describe('coverageStage', () => {
  it('a running Verify wins over the coverage line', () => expect(coverageStage('checking product 2 of 3', { status: 'done', stage: 'x', fields: [] })).toBe('checking product 2 of 3'));
  it('otherwise the coverage stage, or nothing', () => {
    expect(coverageStage(null, { status: 'running', stage: 'Checking 20 more products from the listing…', fields: [] })).toBe('Checking 20 more products from the listing…');
    expect(coverageStage(null, null)).toBeNull();
  });
});

describe('coverageLine with a default (spec 2026-10-13 §5/§8)', () => {
  it('says the default filled the empties and still offers the page', () => {
    expect(coverageLine({ ...f, explanation: null }, false, false, { hasDefault: true })).toEqual({ text: 'The default filled 2 of 20 sampled products', useAsProofPage: 'https://s.example/p/10' });
    expect(coverageLine({ ...f, empty: [f.empty[0]!], sampled: 1, explanation: null }, false, false, { hasDefault: true }).text).toBe('The default filled 1 of 1 sampled product');
  });
  it('keeps the explanation and the limit after it', () => {
    expect(coverageLine(f, true, false, { hasDefault: true }).text).toBe('The default filled 2 of 20 sampled products · all 2 list their sizes as variants in the page data · This website has its six proof pages');
  });
  it('names the default-only line', () => expect(EVERY_PRODUCT_DEFAULT).toBe('Every product gets the default'));
});
