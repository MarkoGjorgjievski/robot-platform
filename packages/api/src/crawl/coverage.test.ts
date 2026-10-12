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
      { name: 'title', filled: 1, missing: 2, confirmedAbsent: 0, total: 3, notShown: 0, checked: 0 },
      { name: 'isbn', filled: 0, missing: 2, confirmedAbsent: 1, total: 3, notShown: 0, checked: 0 },
    ]);
    expect(out.gapItems).toEqual([
      { itemId: 'a', url: 'u1', missingFields: ['isbn'] },
      { itemId: 'b', url: 'u2', missingFields: ['title'] },
      { itemId: 'c', url: 'u3', missingFields: ['title', 'isbn'] },
    ]);
    expect(out.unshownItems).toEqual([]);
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

  // Spec 2026-10-12 §4/§5/§8 property 6 (Task 2).
  it('counts notShown and checked per field; items without the flag count as not checked, never as not shown', () => {
    const out = computeCoverage(
      [{ name: 'price' }, { name: 'description' }],
      [
        {
          id: 'a', url: 'u1', row: { price: '12', description: 'x' }, absentFields: [],
          shown: { price: true, description: false },
        },
        {
          id: 'b', url: 'u2', row: { price: '15', description: 'y' }, absentFields: [],
          shown: null,
        },
      ],
    );
    expect(out.fields).toEqual([
      { name: 'price', filled: 2, missing: 0, confirmedAbsent: 0, total: 2, notShown: 0, checked: 1 },
      { name: 'description', filled: 2, missing: 0, confirmedAbsent: 0, total: 2, notShown: 1, checked: 1 },
    ]);
    expect(out.unshownItems).toEqual([{ url: 'u1', fields: ['description'] }]);
  });

  // An item that carries no `shown` map at all (never passes the key) behaves
  // exactly like one whose map is explicitly `null` — same as a row written
  // before this change, which has no `validation_result`.
  it('an item with no shown key at all is not checked for any field', () => {
    const out = computeCoverage(
      [{ name: 'price' }],
      [{ id: 'a', url: 'u1', row: { price: '12' }, absentFields: [] }],
    );
    expect(out.fields).toEqual([
      { name: 'price', filled: 1, missing: 0, confirmedAbsent: 0, total: 1, notShown: 0, checked: 0 },
    ]);
    expect(out.unshownItems).toEqual([]);
  });

  // A field flagged `null` (not checkable for that type, e.g. url/image/
  // boolean/date) is left out of both notShown and checked — it is not
  // "not checked due to a missing map", it is "not a checkable type", but
  // the count treats both the same way: not checked.
  it('a field flagged null is not checked and not counted as not shown', () => {
    const out = computeCoverage(
      [{ name: 'price' }, { name: 'thumbnail' }],
      [
        {
          id: 'a', url: 'u1', row: { price: '12', thumbnail: 'http://x' }, absentFields: [],
          shown: { price: true, thumbnail: null },
        },
      ],
    );
    expect(out.fields).toEqual([
      { name: 'price', filled: 1, missing: 0, confirmedAbsent: 0, total: 1, notShown: 0, checked: 1 },
      { name: 'thumbnail', filled: 1, missing: 0, confirmedAbsent: 0, total: 1, notShown: 0, checked: 0 },
    ]);
  });

  it('unshownItems is capped at 50, in item order', () => {
    const items = Array.from({ length: 60 }, (_, i) => ({
      id: `item-${i}`,
      url: `u${i}`,
      row: { price: '12' },
      absentFields: [],
      shown: { price: false },
    }));
    const out = computeCoverage([{ name: 'price' }], items);
    expect(out.unshownItems).toHaveLength(50);
    expect(out.unshownItems[0]).toEqual({ url: 'u0', fields: ['price'] });
    expect(out.unshownItems[49]).toEqual({ url: 'u49', fields: ['price'] });
    expect(out.fields[0]).toMatchObject({ notShown: 60, checked: 60 });
  });
});
