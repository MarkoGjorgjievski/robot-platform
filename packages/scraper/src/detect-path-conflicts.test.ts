import { describe, it, expect } from 'vitest';
import { detectPathConflicts, type FieldPathSet, type PathSource } from './domain-cache.js';
import type { CandidateCatalogue } from './candidate-catalogue.js';

const NOW = '2026-08-25T00:00:00.000Z';
const path = (p: string, source: PathSource, lastValue: unknown, lastUrl?: string) => ({
  path: p, source, confidence: 0.9, hits: 2, misses: 0, lastValue, lastUsedAt: NOW, lastUrl,
});
const set = (...paths: ReturnType<typeof path>[]): Record<string, FieldPathSet> =>
  ({ price: { paths, conflictCount: 0 } });

const U = 'https://shop.example.com/p/1';

describe('detectPathConflicts — narrowed (v2.5)', () => {
  it('still fires for same-page unlabelled disagreement (the poison signal)', () => {
    const conflicts = detectPathConflicts(set(path('a', 'json-ld', '499', U), path('b', 'api', '9.99', U)));
    expect(conflicts).toHaveLength(1);
  });

  it('does NOT fire when the disagreeing paths map to DIFFERENT labelled candidates', () => {
    const catalogue: CandidateCatalogue = {
      price: [
        { label: 'displayed', source: 'json-ld', path: 'a', sampleValue: '499' },
        { label: 'list', source: 'api', path: 'b', sampleValue: '9.99' },
      ],
    };
    const conflicts = detectPathConflicts(set(path('a', 'json-ld', '499', U), path('b', 'api', '9.99', U)), catalogue);
    expect(conflicts).toEqual([]);
  });

  it('STILL fires when two paths map to the SAME labelled candidate and disagree', () => {
    const catalogue: CandidateCatalogue = {
      price: [{ label: 'displayed', source: 'json-ld', path: 'a', sampleValue: '499' }],
    };
    // Same candidate path recorded under two sources — same label, so still a conflict.
    const conflicts = detectPathConflicts(set(path('a', 'json-ld', '499', U), path('a', 'xpath', '9.99', U)), catalogue);
    expect(conflicts).toHaveLength(1);
  });

  it('does NOT fire when the values were observed on different pages', () => {
    const conflicts = detectPathConflicts(set(
      path('a', 'api', 'carte postale ancienne', 'https://shop.example.com/p/1'),
      path('b', 'xpath', 'The Road to Nab End', 'https://shop.example.com/p/2'),
    ));
    expect(conflicts).toEqual([]);
  });

  it('keeps firing when lastUrl is absent on both (pre-v2.5 rows must not go silent)', () => {
    const conflicts = detectPathConflicts(set(path('a', 'json-ld', '499'), path('b', 'api', '9.99')));
    expect(conflicts).toHaveLength(1);
  });

  it('format-only numeric variants never conflicted and still do not (valuesMatch tolerance)', () => {
    const conflicts = detectPathConflicts(set(path('a', 'api', '$299.00', U), path('b', 'api-ai', 299, U)));
    expect(conflicts).toEqual([]);
  });
});
