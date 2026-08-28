import { describe, it, expect } from 'vitest';
import {
  fillBadge, rowsMissingField, selectionToItemIds, reExtractLabel, cellState,
  nextSelectionOnFilterChange,
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
  it('names the action and its cost honestly', () => {
    expect(reExtractLabel(4))
      .toBe("Re-extract selected (4 pages — cached paths first, AI only where the cache can't answer)");
  });

  it('uses the singular where it should', () => {
    expect(reExtractLabel(1))
      .toBe("Re-extract selected (1 page — cached paths first, AI only where the cache can't answer)");
  });
});

describe('nextSelectionOnFilterChange', () => {
  it('always clears the selection — a filter change invalidates whatever was picked under the old filter', () => {
    expect(nextSelectionOnFilterChange()).toEqual(new Set());
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
