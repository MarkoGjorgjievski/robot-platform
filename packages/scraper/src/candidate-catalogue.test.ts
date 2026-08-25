import { describe, it, expect } from 'vitest';
import { sanitizeCatalogue, type CandidateCatalogue } from './candidate-catalogue.js';

const cand = (label: string, over: Record<string, unknown> = {}) => ({
  label, source: 'api', path: `MainItem.${label}`, sampleValue: 1, ...over,
});

describe('sanitizeCatalogue', () => {
  it('passes a well-formed catalogue through unchanged', () => {
    const raw: CandidateCatalogue = { price: [cand('list'), cand('displayed', { source: 'xpath', path: '//span' })] };
    expect(sanitizeCatalogue(raw)).toEqual(raw);
  });

  it('returns an empty catalogue for garbage input, never throwing', () => {
    expect(sanitizeCatalogue(null)).toEqual({});
    expect(sanitizeCatalogue('nope')).toEqual({});
    expect(sanitizeCatalogue({ price: 'nope' })).toEqual({});
  });

  it('drops candidates missing a label, source, or path', () => {
    const out = sanitizeCatalogue({ price: [cand('list'), { label: 'broken' }] });
    expect(out.price).toHaveLength(1);
  });

  it('caps a concept at 8 candidates, keeping the first 8', () => {
    const many = Array.from({ length: 12 }, (_, i) => cand(`c${i}`));
    expect(sanitizeCatalogue({ price: many }).price).toHaveLength(8);
  });

  it('drops a duplicate label within a concept, keeping the first', () => {
    const out = sanitizeCatalogue({ price: [cand('list'), cand('list', { path: 'Other' })] });
    expect(out.price).toHaveLength(1);
    expect(out.price![0]!.path).toBe('MainItem.list');
  });

  it('keeps displayed on at most one candidate per concept (first wins)', () => {
    const out = sanitizeCatalogue({
      price: [cand('a', { displayed: true }), cand('b', { displayed: true })],
    });
    expect(out.price!.filter((c) => c.displayed === true)).toHaveLength(1);
    expect(out.price![0]!.displayed).toBe(true);
  });
});
