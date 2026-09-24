import { describe, it, expect } from 'vitest';
import { monthKey, shiftMonth, monthLabel, usdLabel, pagesLabel, usageView } from './usage-view';

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
      { id: 'a', name: 'Busy', slug: 'busy', spendUsd: 0.05, pagesCaptured: 2 },
      { id: 'b', name: 'Quiet', slug: 'quiet', spendUsd: 0, pagesCaptured: 0 },
    ]);
    expect(rows.map((r) => [r.name, r.spendLabel, r.pagesLabel])).toEqual([['Busy', '$0.05', '2 pages'], ['Quiet', '$0.00', '0 pages']]);
  });
});
