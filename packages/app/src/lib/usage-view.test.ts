import { describe, it, expect } from 'vitest';
import { monthKey, shiftMonth, monthLabel, usdLabel, pagesLabel, runsLabel, usageView, usageHeadline, usageScreenState } from './usage-view';

describe('months', () => {
  it('keys a date by its UTC month', () => {
    expect(monthKey(new Date('2026-09-24T23:30:00Z'))).toBe('2026-09');
    expect(monthKey(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01');
  });
  it('steps across a year boundary in both directions', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2025-12', 1)).toBe('2026-01');
    expect(shiftMonth('2026-09', -3)).toBe('2026-06');
  });
  it('names a month', () => {
    expect(monthLabel('2026-09')).toBe('September 2026');
    expect(monthLabel('2025-12')).toBe('December 2025');
  });
});

describe('usdLabel', () => {
  it('shows cents, and says when there is less than a cent', () => {
    expect(usdLabel(0)).toBe('$0.00');
    expect(usdLabel(0.05)).toBe('$0.05');
    expect(usdLabel(12.3)).toBe('$12.30');
    expect(usdLabel(0.004)).toBe('< $0.01');
    expect(usdLabel(0.005)).toBe('$0.01');
    expect(usdLabel(1234.5)).toBe('$1234.50');
  });
});

describe('pagesLabel', () => {
  it('counts pages', () => {
    expect(pagesLabel(0)).toBe('0 pages');
    expect(pagesLabel(1)).toBe('1 page');
    expect(pagesLabel(240)).toBe('240 pages');
  });
});

describe('usageView', () => {
  it('labels each row and keeps the order it was given', () => {
    const rows = usageView([
      { id: 'a', name: 'Busy', slug: 'busy', spendUsd: 0.05, pagesCaptured: 2, runs: 0 },
      { id: 'b', name: 'Quiet', slug: 'quiet', spendUsd: 0, pagesCaptured: 0, runs: 0 },
    ], true);
    expect(rows.map((r) => [r.name, r.spendLabel, r.pagesLabel])).toEqual([['Busy', '$0.05', '2 pages'], ['Quiet', '$0.00', '0 pages']]);
  });
});

describe('usageScreenState', () => {
  it('is loading while the query is pending, whatever the row count', () => {
    expect(usageScreenState({ isPending: true, isError: false, rowCount: 0 })).toBe('loading');
    expect(usageScreenState({ isPending: true, isError: false, rowCount: 3 })).toBe('loading');
  });
  it('is error on a failed query, even one that still carries a pending flag', () => {
    expect(usageScreenState({ isPending: false, isError: true, rowCount: 0 })).toBe('error');
    expect(usageScreenState({ isPending: true, isError: true, rowCount: 0 })).toBe('error');
  });
  it('is empty once settled with no rows', () => {
    expect(usageScreenState({ isPending: false, isError: false, rowCount: 0 })).toBe('empty');
  });
  it('is table once settled with rows', () => {
    expect(usageScreenState({ isPending: false, isError: false, rowCount: 1 })).toBe('table');
  });
});

describe('usage without money for a customer (spec 2026-10-17 §8a)', () => {
  const rows = [{ id: 'p', name: 'Prices', slug: 'prices', spendUsd: 1.24, pagesCaptured: 60, runs: 0 }];
  it('rows carry no spend label for a customer, and one for staff', () => {
    expect(usageView(rows, false)[0]!.spendLabel).toBeNull();
    expect(usageView(rows, true)[0]!.spendLabel).toBe('$1.24');
  });
  it('the headline is pages for a customer, spend for staff', () => {
    expect(usageHeadline({ spendUsd: 1.24, pagesCaptured: 60, runs: 0 }, '2026-10', false)).toEqual({ label: 'Pages captured in October 2026', figure: '60 pages', sub: '0 runs' });
    expect(usageHeadline({ spendUsd: 1.24, pagesCaptured: 60, runs: 0 }, '2026-10', true)).toEqual({ label: 'Spend in October 2026', figure: '$1.24', sub: '60 pages captured · 0 runs' });
  });
  it('a customer row and total arrive with no spend at all (spec 2026-10-24 tenant isolation §2.3)', () => {
    expect(usageView([{ id: 'p', name: 'P', slug: 'p', pagesCaptured: 3, runs: 0 }], false)).toEqual([{ id: 'p', name: 'P', slug: 'p', pagesCaptured: 3, runs: 0, spendLabel: null, pagesLabel: '3 pages', runsLabel: '0 runs' }]);
    expect(usageHeadline({ pagesCaptured: 3, runs: 0 }, '2026-10', false)).toEqual({ label: 'Pages captured in October 2026', figure: '3 pages', sub: '0 runs' });
  });
});

describe('runs on Usage (spec 2026-10-24 metering §2.5)', () => {
  it('counts runs', () => {
    expect(runsLabel(0)).toBe('0 runs');
    expect(runsLabel(1)).toBe('1 run');
    expect(runsLabel(12)).toBe('12 runs');
  });
  it('each row and the headline carry the runs, for a customer and for staff', () => {
    expect(usageView([{ id: 'p', name: 'P', slug: 'p', pagesCaptured: 3, runs: 2 }], false)[0]).toMatchObject({ pagesLabel: '3 pages', runsLabel: '2 runs', spendLabel: null });
    expect(usageHeadline({ pagesCaptured: 60, runs: 4 }, '2026-10', false)).toEqual({ label: 'Pages captured in October 2026', figure: '60 pages', sub: '4 runs' });
    expect(usageHeadline({ spendUsd: 1.24, pagesCaptured: 60, runs: 4 }, '2026-10', true)).toEqual({ label: 'Spend in October 2026', figure: '$1.24', sub: '60 pages captured · 4 runs' });
  });
});
