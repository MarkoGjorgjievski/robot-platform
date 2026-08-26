import { describe, it, expect } from 'vitest';
import { mergeFieldPaths, type FieldPathSet, type PathSource } from './domain-cache.js';

const NOW = '2026-08-25T00:00:00.000Z';
const existingSet = (over: Record<string, unknown> = {}): Record<string, FieldPathSet> => ({
  variants: {
    paths: [{
      path: 'Style buttons below title (old wording)', source: 'ai-discovered-variants',
      confidence: 0.6, hits: 1, misses: 0, lastValue: '[]', lastUsedAt: NOW, ...over,
    }],
    conflictCount: 0,
  },
});
// Matches the actual `fieldResults` entry shape (ExtractionOutcome['fieldResults'][string] in
// domain-cache.ts): { value, source, path, confidence } — no `found` property.
const result = (path: string, source: PathSource = 'ai-discovered-variants') => ({
  variants: { path, source, value: '[]', confidence: 0.6 },
});

describe('mergeFieldPaths — ai path identity', () => {
  it('REPLACES an existing ai-discovered-variants path instead of appending a near-duplicate', () => {
    const merged = mergeFieldPaths(existingSet(), result('Style buttons below title (new wording)'), [], true, NOW);
    expect(merged.variants!.paths).toHaveLength(1);
    expect(merged.variants!.paths[0]!.path).toBe('Style buttons below title (new wording)');
  });

  it('still appends for path-identified sources when the path differs', () => {
    const merged = mergeFieldPaths(
      { price: { paths: [{ path: '//a', source: 'xpath', confidence: 0.9, hits: 1, misses: 0, lastValue: '1', lastUsedAt: NOW }], conflictCount: 0 } },
      { price: { path: '//b', source: 'xpath', value: '2', confidence: 0.9 } },
      [], true, NOW,
    );
    expect(merged.price!.paths).toHaveLength(2);
  });
});

describe('mergeFieldPaths — lastUrl bookkeeping', () => {
  it('stamps lastUrl on a new path when the outcome carries a url', () => {
    const merged = mergeFieldPaths(
      {}, { price: { path: '//b', source: 'xpath', value: '2', confidence: 0.9 } },
      [], true, NOW, 'https://shop.example.com/p/1',
    );
    expect(merged.price!.paths[0]!.lastUrl).toBe('https://shop.example.com/p/1');
  });

  it('updates lastUrl on an existing path that resolved again', () => {
    const merged = mergeFieldPaths(
      { price: { paths: [{ path: '//a', source: 'xpath', confidence: 0.9, hits: 1, misses: 0, lastValue: '1', lastUsedAt: NOW, lastUrl: 'https://shop.example.com/p/old' }], conflictCount: 0 } },
      { price: { path: '//a', source: 'xpath', value: '2', confidence: 0.9 } },
      [], true, NOW, 'https://shop.example.com/p/new',
    );
    expect(merged.price!.paths[0]!.lastUrl).toBe('https://shop.example.com/p/new');
  });
});
