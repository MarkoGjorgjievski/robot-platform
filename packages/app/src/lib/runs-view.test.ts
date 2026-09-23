import { describe, expect, it } from 'vitest';
import { durationLabel, runsView, type RunRow } from './runs-view';

const NOW = new Date('2026-09-22T12:00:00Z');

function row(over: Partial<RunRow> & { id: string }): RunRow {
  return {
    status: 'completed',
    inputLabel: null,
    startedAt: new Date('2026-09-22T09:00:00Z'),
    completedAt: new Date('2026-09-22T09:00:12Z'),
    resultCount: 10,
    errorMessage: null,
    createdAt: new Date('2026-09-22T09:00:00Z'),
    ...over,
  };
}

describe('durationLabel', () => {
  it('is null when either end is missing', () => {
    expect(durationLabel(null, new Date())).toBeNull();
    expect(durationLabel(new Date(), null)).toBeNull();
    expect(durationLabel(null, null)).toBeNull();
  });

  it('reads in seconds under a minute', () => {
    expect(durationLabel(new Date('2026-09-22T09:00:00Z'), new Date('2026-09-22T09:00:12Z'))).toBe('12 s');
  });

  it('reads in minutes under an hour', () => {
    expect(durationLabel(new Date('2026-09-22T09:00:00Z'), new Date('2026-09-22T09:03:00Z'))).toBe('3 min');
  });

  it('reads hours and minutes, padded, at an hour or more', () => {
    expect(durationLabel(new Date('2026-09-22T09:00:00Z'), new Date('2026-09-22T10:04:00Z'))).toBe('1 h 04 min');
  });
});

describe('runsView', () => {
  it('orders newest first', () => {
    const views = runsView(
      [
        row({ id: 'old', createdAt: new Date('2026-09-20T09:00:00Z') }),
        row({ id: 'new', createdAt: new Date('2026-09-22T09:00:00Z') }),
      ],
      NOW,
    );
    expect(views.map((v) => v.id)).toEqual(['new', 'old']);
  });

  it('labels a probe run "Done · sample"', () => {
    const [v] = runsView([row({ id: 'r', inputLabel: 'probe', status: 'completed' })], NOW);
    expect(v!.statusLabel).toBe('Done · sample');
    expect(v!.state).toBe('done');
  });

  it('labels a backfill run "Done · backfill"', () => {
    const [v] = runsView([row({ id: 'r', inputLabel: 'backfill', status: 'completed' })], NOW);
    expect(v!.statusLabel).toBe('Done · backfill');
  });

  it('leaves an ordinary run\'s label alone', () => {
    const [v] = runsView([row({ id: 'r', inputLabel: null, status: 'completed' })], NOW);
    expect(v!.statusLabel).toBe('Done');
  });

  it('reads an extracting run with no completedAt as running', () => {
    const [v] = runsView(
      [row({ id: 'r', status: 'extracting', startedAt: new Date('2026-09-22T09:00:00Z'), completedAt: null })],
      NOW,
    );
    expect(v!.state).toBe('running');
    expect(v!.statusLabel).toBe('Running');
    expect(v!.durationLabel).toBeNull();
  });

  it('reads startedLabel off startedAt, or createdAt when there is no startedAt yet', () => {
    const [v] = runsView(
      [row({ id: 'r', startedAt: null, createdAt: new Date('2026-09-22T11:57:00Z') })],
      NOW,
    );
    expect(v!.startedLabel).toBe('3 min ago');
  });

  it('carries rows and the error message through', () => {
    const [ok] = runsView([row({ id: 'ok', resultCount: 42 })], NOW);
    expect(ok!.rowsLabel).toBe('42 rows');
    expect(ok!.error).toBeNull();

    const [failed] = runsView(
      [row({ id: 'bad', status: 'failed', resultCount: null, errorMessage: 'timed out' })],
      NOW,
    );
    expect(failed!.rowsLabel).toBeNull();
    expect(failed!.error).toBe('timed out');
    expect(failed!.state).toBe('failed');
  });

  it('one row is "1 row"', () => {
    const [v] = runsView([row({ id: 'r', resultCount: 1 })], NOW);
    expect(v!.rowsLabel).toBe('1 row');
  });

  // Unseparated, the same way `websitesView` writes it: past a thousand the two
  // tables showed the same run's rows as `1,240` here and `1240` there.
  it('past a thousand, no separator — the project home writes it the same way', () => {
    const [v] = runsView([row({ id: 'r', resultCount: 1240 })], NOW);
    expect(v!.rowsLabel).toBe('1240 rows');
  });
});
