import { describe, it, expect } from 'vitest';
import {
  defaultBadge,
  fillBadge, notShownBadge, rowsMissingField, selectionToItemIds, reExtractLabel, cellState,
  emptyFilterNote,
  type FieldCoverage, type ItemGap, type Row,
} from './coverage-view';

describe('fillBadge', () => {
  it('shows filled/total when a column has gaps', () => {
    const cov: FieldCoverage = { name: 'title', filled: 36, missing: 4, confirmedAbsent: 0, total: 40 };
    expect(fillBadge(cov)).toBe('36/40');
  });

  it('counts confirmed-absent as a gap too, not just missing', () => {
    const cov: FieldCoverage = { name: 'discount', filled: 30, missing: 0, confirmedAbsent: 10, total: 40 };
    expect(fillBadge(cov)).toBe('30/40');
  });

  it('shows no badge on a clean column — nothing to draw attention to', () => {
    const cov: FieldCoverage = { name: 'sku', filled: 40, missing: 0, confirmedAbsent: 0, total: 40 };
    expect(fillBadge(cov)).toBeNull();
  });

  it('shows no badge when this field has no coverage data at all', () => {
    expect(fillBadge(undefined)).toBeNull();
  });
});

// Spec 2026-10-12 §5/§7, Review Focus 4.
describe('notShownBadge', () => {
  it('names the count once the shown-on-page check has caught anything', () => {
    const cov: FieldCoverage = { name: 'description', filled: 36, missing: 4, confirmedAbsent: 0, total: 40, notShown: 8, checked: 36 };
    expect(notShownBadge(cov)).toBe('8 not shown');
  });

  it('reads "not checked" for a filled field whose type the check never runs on', () => {
    const cov: FieldCoverage = { name: 'thumbnail', filled: 40, missing: 0, confirmedAbsent: 0, total: 40, notShown: 0, checked: 0 };
    expect(notShownBadge(cov)).toBe('not checked');
  });

  it('reads "not checked" for a run that predates the check — checked/notShown both absent', () => {
    const cov: FieldCoverage = { name: 'title', filled: 40, missing: 0, confirmedAbsent: 0, total: 40 };
    expect(notShownBadge(cov)).toBe('not checked');
  });

  it('shows nothing when every checked value was shown', () => {
    const cov: FieldCoverage = { name: 'price', filled: 40, missing: 0, confirmedAbsent: 0, total: 40, notShown: 0, checked: 40 };
    expect(notShownBadge(cov)).toBeNull();
  });

  it('shows nothing for a field with nothing filled to check', () => {
    const cov: FieldCoverage = { name: 'sku', filled: 0, missing: 40, confirmedAbsent: 0, total: 40, notShown: 0, checked: 0 };
    expect(notShownBadge(cov)).toBeNull();
  });

  it('shows nothing when this field has no coverage data at all', () => {
    expect(notShownBadge(undefined)).toBeNull();
  });
});

describe('rowsMissingField', () => {
  const gapByUrl = new Map<string, ItemGap>([
    ['https://example.com/p/1', { itemId: 'item-1', url: 'https://example.com/p/1', missingFields: ['description'] }],
    ['https://example.com/p/2', { itemId: 'item-2', url: 'https://example.com/p/2', missingFields: ['image_url'] }],
  ]);
  const rows: Row[] = [
    { _url: 'https://example.com/p/1', title: 'A' },
    { _url: 'https://example.com/p/2', title: 'B' },
    { _url: 'https://example.com/p/3', title: 'C' }, // fully filled — never made the gap list
  ];

  it('keeps only rows whose item gap names this field', () => {
    expect(rowsMissingField(rows, 'description', gapByUrl)).toEqual([rows[0]]);
  });

  it('drops rows with a gap in a DIFFERENT field', () => {
    const urls = rowsMissingField(rows, 'description', gapByUrl).map((r) => r._url);
    expect(urls).not.toContain('https://example.com/p/2');
  });

  it('drops rows that never made the gap list at all', () => {
    const urls = rowsMissingField(rows, 'image_url', gapByUrl).map((r) => r._url);
    expect(urls).not.toContain('https://example.com/p/3');
  });
});

describe('selectionToItemIds', () => {
  const gapByUrl = new Map<string, ItemGap>([
    ['https://example.com/p/1', { itemId: 'item-1', url: 'https://example.com/p/1', missingFields: ['description'] }],
    ['https://example.com/p/2', { itemId: 'item-2', url: 'https://example.com/p/2', missingFields: ['image_url'] }],
  ]);

  it('resolves selected urls to their item ids', () => {
    expect(selectionToItemIds(['https://example.com/p/1', 'https://example.com/p/2'], gapByUrl))
      .toEqual(['item-1', 'item-2']);
  });

  it('drops a selected url with no gap entry, rather than sending a bad id', () => {
    expect(selectionToItemIds(['https://example.com/p/1', 'https://example.com/p/9'], gapByUrl))
      .toEqual(['item-1']);
  });
});

describe('reExtractLabel', () => {
  it('names the action and its cost shape to staff', () => {
    expect(reExtractLabel(4, true))
      .toBe("Re-extract selected (4 pages — cached paths first, AI only where the cache can't answer)");
  });

  it('uses the singular where it should', () => {
    expect(reExtractLabel(1, true))
      .toBe("Re-extract selected (1 page — cached paths first, AI only where the cache can't answer)");
  });

  it('a customer reads the page count alone: no mechanism, no cost (spec 2026-10-17 §8a)', () => {
    expect(reExtractLabel(4, false)).toBe('Re-extract selected (4 pages)');
    expect(reExtractLabel(1, false)).toBe('Re-extract selected (1 page)');
  });
});

describe('cellState', () => {
  it('is filled when the value actually resolved', () => {
    expect(cellState('Blue Widget', 'title', new Set())).toBe('filled');
  });

  it('is missing when the value is empty and nothing confirms it absent', () => {
    expect(cellState(null, 'discount', new Set())).toBe('missing');
    expect(cellState('', 'discount', new Set())).toBe('missing');
    expect(cellState(undefined, 'discount', new Set())).toBe('missing');
  });

  it('is absent when the field is confirmed absent on this item', () => {
    expect(cellState(null, 'discount', new Set(['discount']))).toBe('absent');
  });

  it('filled wins over absent — mirrors computeCoverage precedence', () => {
    expect(cellState('10%', 'discount', new Set(['discount']))).toBe('filled');
  });
});

describe('emptyFilterNote', () => {
  it('is null when there is no coverage data for this field at all', () => {
    expect(emptyFilterNote(undefined)).toBeNull();
  });

  it('is null when the field still has genuine missing gaps — the filter is not empty', () => {
    const cov: FieldCoverage = { name: 'isbn', filled: 30, missing: 5, confirmedAbsent: 5, total: 40 };
    expect(emptyFilterNote(cov)).toBeNull();
  });

  it('is null when there is nothing confirmed absent either — a genuinely clean column', () => {
    const cov: FieldCoverage = { name: 'sku', filled: 40, missing: 0, confirmedAbsent: 0, total: 40 };
    expect(emptyFilterNote(cov)).toBeNull();
  });

  it('explains a zero-row filter caused entirely by confirmed-absent gaps', () => {
    const cov: FieldCoverage = { name: 'discount', filled: 30, missing: 0, confirmedAbsent: 10, total: 40 };
    expect(emptyFilterNote(cov)).toBe(
      "All 10 remaining gaps are confirmed absent — these pages don't have this field.",
    );
  });

  it('uses the singular where it should', () => {
    const cov: FieldCoverage = { name: 'discount', filled: 39, missing: 0, confirmedAbsent: 1, total: 40 };
    expect(emptyFilterNote(cov)).toBe(
      "All 1 remaining gap is confirmed absent — these pages don't have this field.",
    );
  });
});

describe('defaultBadge (spec 2026-10-13 §7)', () => {
  it('counts the values the default filled, and draws nothing on a run from before defaults', () => {
    expect(defaultBadge({ name: 'brand', filled: 60, missing: 0, confirmedAbsent: 0, total: 60, defaulted: 60 })).toBe('default on 60');
    expect(defaultBadge({ name: 'brand', filled: 60, missing: 0, confirmedAbsent: 0, total: 60, defaulted: 0 })).toBeNull();
    expect(defaultBadge({ name: 'brand', filled: 60, missing: 0, confirmedAbsent: 0, total: 60 })).toBeNull();
    expect(defaultBadge(undefined)).toBeNull();
  });
});
