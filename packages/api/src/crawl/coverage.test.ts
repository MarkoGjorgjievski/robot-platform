// packages/api/src/crawl/coverage.test.ts
import { describe, it, expect } from 'vitest';
import { computeCoverage } from './coverage.js';

describe('computeCoverage', () => {
  it('counts filled, missing, and confirmed-absent per field', () => {
    const out = computeCoverage(
      [{ name: 'title' }, { name: 'isbn' }],
      [
        { id: 'a', url: 'u1', row: { title: 'T', isbn: null }, absentFields: [] },
        { id: 'b', url: 'u2', row: { title: '' }, absentFields: ['isbn'] },
        { id: 'c', url: 'u3', row: null, absentFields: [] },
      ],
    );
    expect(out.fields).toEqual([
      { name: 'title', filled: 1, missing: 2, confirmedAbsent: 0, total: 3 },
      { name: 'isbn', filled: 0, missing: 2, confirmedAbsent: 1, total: 3 },
    ]);
    expect(out.gapItems).toEqual([
      { itemId: 'a', url: 'u1', missingFields: ['isbn'] },
      { itemId: 'b', url: 'u2', missingFields: ['title'] },
      { itemId: 'c', url: 'u3', missingFields: ['title', 'isbn'] },
    ]);
  });

  it('an item with every field filled produces no gap entry', () => {
    const out = computeCoverage(
      [{ name: 'title' }, { name: 'isbn' }],
      [
        { id: 'a', url: 'u1', row: { title: 'T', isbn: '123' }, absentFields: [] },
      ],
    );
    expect(out.gapItems).toEqual([]);
  });
});
