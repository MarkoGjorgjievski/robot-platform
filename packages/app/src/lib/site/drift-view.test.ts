import { describe, it, expect } from 'vitest';
import { driftBadge, driftBanner, type DriftCheckView } from './drift-view';

describe('driftBadge', () => {
  it('is null with nothing drifted', () => {
    expect(driftBadge(null)).toBeNull();
    expect(driftBadge([])).toBeNull();
  });

  it('is singular for one field', () => {
    expect(driftBadge(['price'])).toBe('1 field stopped extracting');
  });

  it('counts for more than one', () => {
    expect(driftBadge(['price', 'rating', 'sku'])).toBe('3 fields stopped extracting');
  });
});

const FIELD_NAMES = { price: 'Price', rating: 'Rating', sku: 'SKU' };

describe('driftBanner', () => {
  it('is none with nothing drifted', () => {
    expect(driftBanner({ driftedFields: null, fieldNames: FIELD_NAMES, check: null })).toEqual({ kind: 'none' });
    expect(driftBanner({ driftedFields: [], fieldNames: FIELD_NAMES, check: null })).toEqual({ kind: 'none' });
  });

  it('is none for a stale check once the website was re-verified (Review Focus 3), even with old results', () => {
    const check: DriftCheckView = {
      status: 'done',
      results: { fields: { price: { emptyShare: 0.4 } } },
      runAt: new Date('2026-09-20T00:00:00Z'),
    };
    expect(driftBanner({ driftedFields: null, fieldNames: FIELD_NAMES, check })).toEqual({ kind: 'none' });
  });

  it('is "checking" while a check runs, whatever shares are already on hand', () => {
    const check: DriftCheckView = {
      status: 'running',
      results: null,
      runAt: null,
    };
    expect(driftBanner({ driftedFields: ['price'], fieldNames: FIELD_NAMES, check })).toEqual({
      kind: 'checking',
      text: 'Checking what changed…',
    });
  });

  it('gives the full result text with two fields and their shares', () => {
    const check: DriftCheckView = {
      status: 'done',
      results: { fields: { price: { emptyShare: 0.345 }, rating: { emptyShare: 0.2 } } },
      runAt: new Date('2026-09-26T10:00:00Z'),
    };
    expect(driftBanner({ driftedFields: ['price', 'rating'], fieldNames: FIELD_NAMES, check })).toEqual({
      kind: 'result',
      text: 'Price and Rating stopped extracting in the run of 26 Sep (35 % and 20 % of products empty)',
    });
  });

  it('joins three field names without an Oxford comma', () => {
    const check: DriftCheckView = {
      status: 'done',
      results: { fields: { price: { emptyShare: 0.1 }, rating: { emptyShare: 0.2 }, sku: { emptyShare: 0.3 } } },
      runAt: new Date('2026-09-26T10:00:00Z'),
    };
    expect(driftBanner({ driftedFields: ['price', 'rating', 'sku'], fieldNames: FIELD_NAMES, check })).toEqual({
      kind: 'result',
      text: 'Price, Rating and SKU stopped extracting in the run of 26 Sep (10 %, 20 % and 30 % of products empty)',
    });
  });

  it('drops percentages when a share is missing, but keeps the run date', () => {
    const check: DriftCheckView = {
      status: 'failed',
      results: null,
      runAt: new Date('2026-09-26T10:00:00Z'),
    };
    expect(driftBanner({ driftedFields: ['price', 'rating'], fieldNames: FIELD_NAMES, check })).toEqual({
      kind: 'result',
      text: 'Price and Rating stopped extracting in the run of 26 Sep',
    });
  });

  it('drops the run date too when there is no check at all', () => {
    expect(driftBanner({ driftedFields: ['price', 'rating'], fieldNames: FIELD_NAMES, check: null })).toEqual({
      kind: 'result',
      text: 'Price and Rating stopped extracting',
    });
  });

  it('names an undrifted-by-name field by its key when fieldNames has nothing for it', () => {
    expect(driftBanner({ driftedFields: ['unknown-key'], fieldNames: FIELD_NAMES, check: null })).toEqual({
      kind: 'result',
      text: 'unknown-key stopped extracting',
    });
  });

  it('accepts runAt as an ISO string, not only a Date', () => {
    const check: DriftCheckView = { status: 'done', results: null, runAt: '2026-09-26T10:00:00Z' };
    expect(driftBanner({ driftedFields: ['price'], fieldNames: FIELD_NAMES, check })).toEqual({
      kind: 'result',
      text: 'Price stopped extracting in the run of 26 Sep',
    });
  });
});
