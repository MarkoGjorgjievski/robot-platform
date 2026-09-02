import { describe, it, expect } from 'vitest';
import { detectPathConflicts, type FieldPath, type FieldPathSet, type PathSource } from './domain-cache.js';
import type { CandidateCatalogue } from './candidate-catalogue.js';

const NOW = '2026-08-25T00:00:00.000Z';
const path = (p: string, source: PathSource, lastValue: unknown, lastUrl?: string): FieldPath => ({
  path: p, source, confidence: 0.9, hits: 2, misses: 0, lastValue, lastUsedAt: NOW, lastUrl,
});
const set = (...paths: FieldPath[]): Record<string, FieldPathSet> =>
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

  it('does NOT fire when the operator has already ruled by pinning one of the paths', () => {
    // A pin is the operator's answer to exactly this disagreement — the pinned
    // path serves, the rest are kept for the record. Keeping the red conflict
    // panel lit after the ruling tells the operator their pin did nothing.
    const conflicts = detectPathConflicts(set(
      { ...path('a', 'meta', 'real.jpg', U), pinned: true },
      path('b', 'json-ld', 'youtube-thumb.jpg', U),
    ));
    expect(conflicts).toEqual([]);
  });

  it('a human-sourced path counts as an operator ruling the same way a pin does', () => {
    const conflicts = detectPathConflicts(set(path('a', 'human', 'real.jpg', U), path('b', 'api', 'wrong.jpg', U)));
    expect(conflicts).toEqual([]);
  });

  it('format-only numeric variants never conflicted and still do not (valuesMatch tolerance)', () => {
    const conflicts = detectPathConflicts(set(path('a', 'api', '$299.00', U), path('b', 'api-ai', 299, U)));
    expect(conflicts).toEqual([]);
  });
});

describe('detectPathConflicts — structured values (valuesMatch)', () => {
  it('fires when two paths carry DIFFERENT structured lastValues', () => {
    // Regression: String({a:1}) is "[object Object]", so every pair of
    // structured values used to compare equal — variant-array disagreement
    // was invisible to conflict detection.
    const conflicts = detectPathConflicts(set(
      path('a', 'api', [{ size: 'S', price: 10 }], U),
      path('b', 'json-ld', [{ size: 'M', price: 12 }], U),
    ));
    expect(conflicts).toHaveLength(1);
  });

  it('does NOT fire for deep-equal objects that differ only in key order', () => {
    const conflicts = detectPathConflicts(set(
      path('a', 'api', { price: 10, size: 'S' }, U),
      path('b', 'json-ld', { size: 'S', price: 10 }, U),
    ));
    expect(conflicts).toEqual([]);
  });

  it('fires when a structured value disagrees with a scalar', () => {
    const conflicts = detectPathConflicts(set(
      path('a', 'api', { price: 10 }, U),
      path('b', 'json-ld', 'ten dollars', U),
    ));
    expect(conflicts).toHaveLength(1);
  });
});
