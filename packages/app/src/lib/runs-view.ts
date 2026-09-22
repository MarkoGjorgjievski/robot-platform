import { runDotLabel, runDotState, type RunDotStatus } from './run-dot-view';
import { relativeTime } from './projects-view';

/** One row of `runs.listBySource`, narrowed to what the table reads. */
export type RunRow = {
  id: string;
  status: string;
  inputLabel: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  resultCount: number | null;
  errorMessage: string | null;
  createdAt: Date;
};

export type RunView = {
  id: string;
  state: RunDotStatus;
  /** The dot's word, plus " · sample" (a `probe` run) or " · backfill" (a `backfill` run). */
  statusLabel: string;
  /** relativeTime(startedAt ?? createdAt) — a run that has not started yet still has an age. */
  startedLabel: string;
  /** "12 s", "3 min", "1 h 04 min" — null while the run has no end yet. */
  durationLabel: string | null;
  /** "N row(s)", or null when the run produced no count. */
  rowsLabel: string | null;
  error: string | null;
};

/**
 * How long a run took, from its own two timestamps.
 *
 * Seconds under a minute, minutes under an hour, then hours and minutes —
 * the last with the minutes padded to two digits so a column of these lines
 * up ("1 h 04 min", not "1 h 4 min" beside "1 h 45 min"). `null` when either
 * end is missing: a run that has not started, or has not finished, has no
 * duration yet, not a duration of zero.
 */
export function durationLabel(start: Date | null, end: Date | null): string | null {
  if (!start || !end) return null;
  const totalSeconds = Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000));
  if (totalSeconds < 60) return `${totalSeconds} s`;
  const totalMinutes = Math.round(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours} h ${String(minutes).padStart(2, '0')} min`;
}

function statusLabel(state: RunDotStatus, inputLabel: string | null): string {
  const label = runDotLabel(state);
  if (inputLabel === 'probe') return `${label} · sample`;
  if (inputLabel === 'backfill') return `${label} · backfill`;
  return label;
}

/** Sorted newest first and formatted for the table. Pure: the rows handed in are never touched. */
export function runsView(rows: readonly RunRow[], now: Date = new Date()): RunView[] {
  return [...rows]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((row) => {
      const state = runDotState(row);
      const count = row.resultCount;
      return {
        id: row.id,
        state,
        statusLabel: statusLabel(state, row.inputLabel),
        startedLabel: relativeTime(row.startedAt ?? row.createdAt, now),
        durationLabel: durationLabel(row.startedAt, row.completedAt),
        rowsLabel: count == null ? null : `${count.toLocaleString('en-US')} ${count === 1 ? 'row' : 'rows'}`,
        error: row.errorMessage,
      };
    });
}
