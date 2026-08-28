import { describe, it, expect } from 'vitest';
import {
  previewSummary, strategyCopy, initialChecked, checkedHasDeadField, backfillMutationInput,
  derivedPreview,
  type FieldClassification,
} from './backfill-preview';
import type { ItemGap } from './coverage-view';

describe('previewSummary', () => {
  it('names rows, pages and an "up to" cost — never an exact figure', () => {
    expect(previewSummary({ items: 17, pages: 17, estCostUsd: 0.85 }))
      .toBe('17 rows, 17 pages — up to ~$0.85 if no cache answers');
  });

  it('uses the singular where it should', () => {
    expect(previewSummary({ items: 1, pages: 1, estCostUsd: 0.05 }))
      .toBe('1 row, 1 page — up to ~$0.05 if no cache answers');
  });

  it('formats the cost to two decimal places even on a round number', () => {
    expect(previewSummary({ items: 4, pages: 4, estCostUsd: 0.2 }))
      .toBe('4 rows, 4 pages — up to ~$0.20 if no cache answers');
  });
});

describe('strategyCopy', () => {
  it('is null for a healthy field — it never gets a strategy choice', () => {
    const healthy: FieldClassification = { name: 'publisher', fill: 0.975, classification: 'healthy' };
    expect(strategyCopy(healthy)).toBeNull();
  });

  it('names the field and its fill rate for a dead field', () => {
    const dead: FieldClassification = { name: 'listing_id', fill: 0, classification: 'dead' };
    const copy = strategyCopy(dead);
    expect(copy).not.toBeNull();
    expect(copy!.title).toContain('listing_id');
    expect(copy!.title).toContain('0%');
  });

  it('describes both strategies honestly — repair-then-sweep and full focus', () => {
    const dead: FieldClassification = { name: 'title', fill: 0.1, classification: 'dead' };
    const copy = strategyCopy(dead)!;
    expect(copy.recommended.toLowerCase()).toContain('sample');
    expect(copy.recommended.toLowerCase()).toContain('sweep');
    expect(copy.alternative.toLowerCase()).toContain('every');
  });
});

describe('initialChecked', () => {
  it('checks every field the preview returned', () => {
    const fields: FieldClassification[] = [
      { name: 'title', fill: 0.1, classification: 'dead' },
      { name: 'isbn', fill: 0.9, classification: 'healthy' },
    ];
    expect(initialChecked(fields)).toEqual(new Set(['title', 'isbn']));
  });

  it('is empty when there are no fields', () => {
    expect(initialChecked([])).toEqual(new Set());
  });
});

describe('checkedHasDeadField', () => {
  const fields: FieldClassification[] = [
    { name: 'title', fill: 0.1, classification: 'dead' },
    { name: 'isbn', fill: 0.9, classification: 'healthy' },
  ];

  it('is true when a CHECKED field is dead', () => {
    expect(checkedHasDeadField(fields, new Set(['title', 'isbn']))).toBe(true);
  });

  it('is false once the only dead field is unchecked', () => {
    expect(checkedHasDeadField(fields, new Set(['isbn']))).toBe(false);
  });

  it('is false with nothing checked at all', () => {
    expect(checkedHasDeadField(fields, new Set())).toBe(false);
  });
});

describe('backfillMutationInput', () => {
  const fields: FieldClassification[] = [
    { name: 'title', fill: 0.1, classification: 'dead' },
    { name: 'isbn', fill: 0.9, classification: 'healthy' },
  ];

  it('sends only the checked field names as targetFields', () => {
    expect(backfillMutationInput(fields, new Set(['isbn']), 'repair_sweep'))
      .toEqual({ targetFields: ['isbn'] });
  });

  it('includes deadFieldStrategy when a checked field is dead', () => {
    expect(backfillMutationInput(fields, new Set(['title', 'isbn']), 'full_focus'))
      .toEqual({ targetFields: ['title', 'isbn'], deadFieldStrategy: 'full_focus' });
  });

  it('omits deadFieldStrategy once the dead field is unchecked — never a stale strategy', () => {
    const result = backfillMutationInput(fields, new Set(['isbn']), 'repair_sweep');
    expect(result).not.toHaveProperty('deadFieldStrategy');
  });
});

// D-UX1: the panel's summary line used to stay pinned at the FULL gappy-field
// query result no matter which checkboxes were unchecked (never understating
// — proven monotone — but a $2.00 quote for a one-field selection that
// derives to a fraction is poor pricing UX). `derivedPreview` recomputes
// items/pages/cost client-side from data already on the page, no re-query.
describe('derivedPreview', () => {
  const gapItems: ItemGap[] = [
    { itemId: 'i1', url: 'https://example.com/p/1', missingFields: ['title', 'isbn'] },
    { itemId: 'i2', url: 'https://example.com/p/2', missingFields: ['isbn'] },
    { itemId: 'i3', url: 'https://example.com/p/3', missingFields: ['title'] },
    { itemId: 'i4', url: 'https://example.com/p/4', missingFields: ['publisher'] },
  ];

  it('matches the full-set count when every gappy field is checked — same semantics as the server preview', () => {
    // i1, i2, i3 each miss title and/or isbn; i4 misses neither.
    expect(derivedPreview(gapItems, new Set(['title', 'isbn']))).toEqual({ items: 3, pages: 3, estCostUsd: 0.15 });
  });

  it('shrinks as fields are unchecked — an item counts only if a CHECKED field is among its gaps', () => {
    // Checking only isbn drops i3 (misses title only).
    expect(derivedPreview(gapItems, new Set(['isbn']))).toEqual({ items: 2, pages: 2, estCostUsd: 0.10 });
  });

  it('is zero with nothing checked', () => {
    expect(derivedPreview(gapItems, new Set())).toEqual({ items: 0, pages: 0, estCostUsd: 0 });
  });

  it('drops an item whose gaps intersect none of the checked fields, even if the item has other gaps', () => {
    expect(derivedPreview(gapItems, new Set(['publisher']))).toEqual({ items: 1, pages: 1, estCostUsd: 0.05 });
  });
});
