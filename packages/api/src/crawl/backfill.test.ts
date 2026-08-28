// packages/api/src/crawl/backfill.test.ts
import { describe, it, expect } from 'vitest';
import { classifyFields, deriveBackfillItems, DEAD_FIELD_FILL_THRESHOLD } from './backfill.js';
import type { FieldCoverage, ItemGap } from './coverage.js';

describe('classifyFields', () => {
  it('classifies fill exactly at the threshold as healthy', () => {
    // 1/2 = 0.5, exactly DEAD_FIELD_FILL_THRESHOLD — binding boundary: healthy.
    const fields: FieldCoverage[] = [
      { name: 'title', filled: 1, missing: 1, confirmedAbsent: 0, total: 2 },
    ];
    const result = classifyFields(fields, ['title']);
    expect(result).toEqual([{ name: 'title', fill: 0.5, classification: 'healthy' }]);
  });

  it('classifies fill just below the threshold as dead', () => {
    // 4/10 = 0.4 < 0.5
    const fields: FieldCoverage[] = [
      { name: 'isbn', filled: 4, missing: 6, confirmedAbsent: 0, total: 10 },
    ];
    const result = classifyFields(fields, ['isbn']);
    expect(result).toEqual([{ name: 'isbn', fill: 0.4, classification: 'dead' }]);
  });

  it('classifies a total-0 field as dead (fill 0)', () => {
    const fields: FieldCoverage[] = [
      { name: 'ghost', filled: 0, missing: 0, confirmedAbsent: 0, total: 0 },
    ];
    const result = classifyFields(fields, ['ghost']);
    expect(result).toEqual([{ name: 'ghost', fill: 0, classification: 'dead' }]);
  });

  it('only classifies fields named in targetNames', () => {
    const fields: FieldCoverage[] = [
      { name: 'title', filled: 2, missing: 0, confirmedAbsent: 0, total: 2 },
      { name: 'isbn', filled: 0, missing: 2, confirmedAbsent: 0, total: 2 },
    ];
    const result = classifyFields(fields, ['isbn']);
    expect(result).toEqual([{ name: 'isbn', fill: 0, classification: 'dead' }]);
  });

  it('sanity-checks the threshold constant value', () => {
    expect(DEAD_FIELD_FILL_THRESHOLD).toBe(0.5);
  });
});

describe('deriveBackfillItems', () => {
  const gapItems: ItemGap[] = [
    { itemId: 'item-1', url: 'https://example.com/p/1', missingFields: ['isbn'] },
    { itemId: 'item-2', url: 'https://example.com/p/2', missingFields: ['title', 'isbn'] },
    { itemId: 'item-3', url: 'https://example.com/p/3', missingFields: ['author'] },
  ];

  it('includes only items whose missingFields intersect targetNames, with targetFields as that intersection', () => {
    const result = deriveBackfillItems(gapItems, ['isbn']);
    expect(result).toEqual([
      { parentItemId: 'item-1', url: 'https://example.com/p/1', targetFields: ['isbn'] },
      { parentItemId: 'item-2', url: 'https://example.com/p/2', targetFields: ['isbn'] },
    ]);
  });

  it('excludes items with no intersection at all', () => {
    const result = deriveBackfillItems(gapItems, ['author']);
    expect(result).toEqual([
      { parentItemId: 'item-3', url: 'https://example.com/p/3', targetFields: ['author'] },
    ]);
  });

  it('when itemIds is provided, intersects with the selection first', () => {
    const result = deriveBackfillItems(gapItems, ['isbn'], ['item-2']);
    expect(result).toEqual([
      { parentItemId: 'item-2', url: 'https://example.com/p/2', targetFields: ['isbn'] },
    ]);
  });

  it('itemIds restricting to an item with no field intersection yields nothing', () => {
    const result = deriveBackfillItems(gapItems, ['isbn'], ['item-3']);
    expect(result).toEqual([]);
  });

  it('returns nothing when gapItems is empty', () => {
    expect(deriveBackfillItems([], ['isbn'])).toEqual([]);
  });

  it('confirmed-absent-only items never appear in gapItems, so they are excluded by composition', () => {
    // Task 2's computeCoverage never puts a field into missingFields when it is
    // confirmedAbsent for that item — so a gap item whose ONLY non-filled field
    // is confirmed-absent simply never shows up in gapItems at all. Seeded here
    // as an item with an EMPTY missingFields array (the shape computeCoverage
    // would produce if it ever did emit such an item) to prove
    // deriveBackfillItems still correctly excludes it, defense in depth.
    const gapItemsWithAbsentOnly: ItemGap[] = [
      { itemId: 'item-4', url: 'https://example.com/p/4', missingFields: [] },
    ];
    const result = deriveBackfillItems(gapItemsWithAbsentOnly, ['isbn']);
    expect(result).toEqual([]);
  });
});
