import { describe, it, expect } from 'vitest';
import { orgRunsView, anyRunning, type OrgRunRow } from './org-runs-view';

const now = new Date('2026-09-24T12:00:00Z');
const base = { inputLabel: null, errorMessage: null, resultCount: null, startedAt: null, completedAt: null, costUsd: 0 };
const row = (over: Partial<OrgRunRow>): OrgRunRow => ({
  id: 'r', status: 'completed', createdAt: now,
  project: { name: 'Prices', slug: 'prices' }, website: { name: 'Shop', slug: 'shop' },
  ...base, ...over,
});

describe('orgRunsView', () => {
  it('keeps runsView’s labels and adds where the run belongs, newest first', () => {
    const views = orgRunsView([
      row({ id: 'old', createdAt: new Date('2026-09-20T12:00:00Z'), startedAt: new Date('2026-09-20T12:00:00Z'), completedAt: new Date('2026-09-20T12:00:12Z'), resultCount: 3 }),
      row({ id: 'new', status: 'extracting', createdAt: now, website: { name: 'Other', slug: 'other' } }),
    ], now);
    expect(views.map((v) => v.id)).toEqual(['new', 'old']);
    expect(views[0]).toMatchObject({ state: 'running', statusLabel: 'Running', websiteName: 'Other', websiteSlug: 'other', projectSlug: 'prices' });
    expect(views[1]).toMatchObject({ state: 'done', rowsLabel: '3 rows', durationLabel: '12 s', startedLabel: '4 d ago' });
  });

  it('does not touch the rows it is given', () => {
    const rows = [row({ id: 'b', createdAt: new Date(1) }), row({ id: 'a', createdAt: new Date(2) })];
    orgRunsView(rows, now);
    expect(rows.map((r) => r.id)).toEqual(['b', 'a']);
  });
});

describe('anyRunning', () => {
  it('is true only while some dot is running', () => {
    expect(anyRunning([{ state: 'done' }, { state: 'running' }])).toBe(true);
    expect(anyRunning([{ state: 'done' }, { state: 'failed' }, { state: 'idle' }])).toBe(false);
    expect(anyRunning([])).toBe(false);
  });
});
