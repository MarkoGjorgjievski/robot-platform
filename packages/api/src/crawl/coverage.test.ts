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
      { name: 'title', filled: 1, missing: 2, confirmedAbsent: 0, total: 3, notShown: 0, checked: 0, defaulted: 0 },
      { name: 'isbn', filled: 0, missing: 2, confirmedAbsent: 1, total: 3, notShown: 0, checked: 0, defaulted: 0 },
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
      { name: 'price', filled: 2, missing: 0, confirmedAbsent: 0, total: 2, notShown: 0, checked: 1, defaulted: 0 },
      { name: 'description', filled: 2, missing: 0, confirmedAbsent: 0, total: 2, notShown: 1, checked: 1, defaulted: 0 },
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
      { name: 'price', filled: 1, missing: 0, confirmedAbsent: 0, total: 1, notShown: 0, checked: 0, defaulted: 0 },
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
      { name: 'price', filled: 1, missing: 0, confirmedAbsent: 0, total: 1, notShown: 0, checked: 1, defaulted: 0 },
      { name: 'thumbnail', filled: 1, missing: 0, confirmedAbsent: 0, total: 1, notShown: 0, checked: 0, defaulted: 0 },
    ]);
  });

  it('unshownItems is capped at 500 (the sheet\'s row limit), in item order', () => {
    const items = Array.from({ length: 510 }, (_, i) => ({
      id: `item-${i}`,
      url: `u${i}`,
      row: { price: '12' },
      absentFields: [],
      shown: { price: false },
    }));
    const out = computeCoverage([{ name: 'price' }], items);
    expect(out.unshownItems).toHaveLength(500);
    expect(out.unshownItems[0]).toEqual({ url: 'u0', fields: ['price'] });
    expect(out.unshownItems[499]).toEqual({ url: 'u499', fields: ['price'] });
    expect(out.fields[0]).toMatchObject({ notShown: 510, checked: 510 });
  });

  // Spec 2026-10-12 §5: the run page's unshown panel names the certified
  // path a not-shown value came from — carried on the item as
  // `validation_result.paths`, passed through verbatim. An item with no
  // `paths` at all (an older run, or a non-certified extraction) gets no
  // `paths` key on its unshownItems entry, not an empty object.
  it('carries an item`s paths onto its unshownItems entry, when it has any', () => {
    const out = computeCoverage(
      [{ name: 'description' }],
      [
        {
          id: 'a', url: 'u1', row: { description: 'x' }, absentFields: [],
          shown: { description: false },
          paths: { description: { source: 'json-ld', path: 'description' } },
        },
        {
          id: 'b', url: 'u2', row: { description: 'y' }, absentFields: [],
          shown: { description: false },
        },
      ],
    );
    expect(out.unshownItems).toEqual([
      { url: 'u1', fields: ['description'], paths: { description: { source: 'json-ld', path: 'description' } } },
      { url: 'u2', fields: ['description'] },
    ]);
  });

  // Spec 2026-10-13 §7: a defaulted value is filled, counted apart, and listed per item.
  it('counts defaulted per field and lists the items, never counting them not shown', () => {
    const out = computeCoverage(
      [{ name: 'brand' }, { name: 'price' }],
      [
        { id: 'a', url: 'u1', row: { brand: 'Widgetco', price: 1 }, absentFields: [], shown: { brand: null, price: true }, defaulted: ['brand'] },
        { id: 'b', url: 'u2', row: { brand: 'Acme', price: 2 }, absentFields: [], shown: { brand: true, price: true }, defaulted: [] },
        { id: 'c', url: 'u3', row: { brand: 'Widgetco', price: 3 }, absentFields: [] },
      ],
    );
    expect(out.fields).toEqual([
      { name: 'brand', filled: 3, missing: 0, confirmedAbsent: 0, total: 3, notShown: 0, checked: 1, defaulted: 1 },
      { name: 'price', filled: 3, missing: 0, confirmedAbsent: 0, total: 3, notShown: 0, checked: 2, defaulted: 0 },
    ]);
    expect(out.defaultedItems).toEqual([{ url: 'u1', fields: ['brand'] }]);
    expect(out.unshownItems).toEqual([]);
  });
});
