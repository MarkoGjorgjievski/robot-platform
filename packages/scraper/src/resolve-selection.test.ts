import { describe, it, expect } from 'vitest';
import { resolveFromCache, type FieldPathSet, type PathSource } from './domain-cache.js';
import type { CandidateCatalogue } from './candidate-catalogue.js';

const NOW = '2026-08-25T00:00:00.000Z';
const path = (p: string, source: PathSource, hits: number, over: Record<string, unknown> = {}) => ({
  path: p, source, confidence: 0.9, hits, misses: 0, lastValue: 'x', lastUsedAt: NOW, ...over,
});
// Two price paths; the api one has the better stats (perfect hit rate vs. a
// recently-missing xpath) and wins today under comparePaths' stats ranking.
// (A tie on hit rate — e.g. both 0 misses — would fall through to source
// authority, where 'xpath' outranks 'api'; the misses here avoid that tie so
// the baseline genuinely locks the *statistical* ranking, not source order.)
const fieldPaths: Record<string, FieldPathSet> = {
  price: {
    paths: [
      path('MainItem.FinalPrice', 'api', 10),
      path('//span[@class="pc"]', 'xpath', 1, { misses: 3 }),
    ],
    conflictCount: 0,
  },
};
// resolveFromCache reads values via allExtractedData keyed by path (see its body).
const data = { 'MainItem.FinalPrice': 399.99, '//span[@class="pc"]': 389.99 };
const catalogue: CandidateCatalogue = {
  price: [
    { label: 'displayed', source: 'xpath', path: '//span[@class="pc"]', sampleValue: 389.99, displayed: true },
    { label: 'final', source: 'api', path: 'MainItem.FinalPrice', sampleValue: 399.99 },
  ],
};

describe('resolveFromCache — selection and displayed-default (v2.5)', () => {
  it('baseline: without opts the statistically better path still wins', () => {
    const { resolved } = resolveFromCache(fieldPaths, data, ['price']);
    expect(resolved.price!.value).toBe(399.99);
  });

  it('an explicit selection outranks everything', () => {
    const { resolved } = resolveFromCache(fieldPaths, data, ['price'], {
      catalogue, selections: { price: { concept: 'price', label: 'final' } },
    });
    expect(resolved.price!.value).toBe(399.99);
    const other = resolveFromCache(fieldPaths, data, ['price'], {
      catalogue, selections: { price: { concept: 'price', label: 'displayed' } },
    });
    expect(other.resolved.price!.value).toBe(389.99);
  });

  it('without a selection, the displayed candidate outranks the statistical winner', () => {
    const { resolved } = resolveFromCache(fieldPaths, data, ['price'], { catalogue });
    expect(resolved.price!.value).toBe(389.99);
  });

  it('a dangling selection degrades to the default ranking, never fails the field', () => {
    const { resolved } = resolveFromCache(fieldPaths, data, ['price'], {
      catalogue, selections: { price: { concept: 'price', label: 'gone' } },
    });
    expect(resolved.price!.value).toBe(389.99); // displayed-default still applies
  });
});
