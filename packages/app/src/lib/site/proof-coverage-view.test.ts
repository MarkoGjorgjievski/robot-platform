import { describe, it, expect } from 'vitest';
import { coverageLine, coverageStage } from './proof-coverage-view';

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
