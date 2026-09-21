import { runDotState, type RunDotStatus } from './run-dot-view';

/** One row of `projects.list`, narrowed to what the table reads. */
export type ProjectRow = {
  id: string;
  name: string;
  slug: string;
  /** Websites, in customer wording (spec §4: no "source"). */
  sourceCount: number;
  fieldCount: number;
  /**
   * `completedAt` is part of the row, not decoration: `runDotState` reads it to
   * tell a live run from one the api-server abandoned mid-flight, and
   * `projects.list` returns it. Leaving it off the type made that branch look
   * dead when it is the one that stops a dot pulsing forever.
   */
  lastRun: { createdAt: Date; resultCount: number | null; status?: string | null; completedAt?: Date | null } | null;
  createdAt: Date;
};

export type ProjectView = {
  id: string;
  name: string;
  slug: string;
  websites: number;
  fields: number;
  /** "websites 3 · fields 12" — the one-line summary, for the ⌘K palette and narrow screens. */
  countsLabel: string;
  lastRunState: RunDotStatus;
  /** "3 h ago", or null when the project has never run — the table draws that as an em dash. */
  lastRunLabel: string | null;
  createdLabel: string;
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const YEAR = 365 * DAY;

/**
 * "just now", "5 min ago", "3 h ago", "2 d ago", "1 y ago".
 *
 * Short units on purpose: these sit in a mono column beside a dot, where
 * "3 hours ago" would be the widest thing in the table for no extra meaning.
 * A timestamp slightly in the future (two clocks, one database) reads as
 * "just now" rather than as a negative number.
 */
export function relativeTime(at: Date, now: Date = new Date()): string {
  const ms = now.getTime() - at.getTime();
  if (ms < MINUTE) return 'just now';
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)} min ago`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)} h ago`;
  if (ms < YEAR) return `${Math.floor(ms / DAY)} d ago`;
  return `${Math.floor(ms / YEAR)} y ago`;
}

/**
 * `YYYY-MM-DD`, in UTC. Locale-free by design: a console's dates should sort
 * the way they read, and the same row must not say 09/08 to one colleague and
 * 08/09 to another.
 */
export function isoDate(at: Date): string {
  return at.toISOString().slice(0, 10);
}

export function countsLabel(websites: number, fields: number): string {
  return `websites ${websites} · fields ${fields}`;
}

/** Sorted by name and formatted for the table. Pure: the rows handed in are never touched. */
export function projectsView(rows: readonly ProjectRow[], now: Date = new Date()): ProjectView[] {
  return [...rows]
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }))
    .map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      websites: row.sourceCount,
      fields: row.fieldCount,
      countsLabel: countsLabel(row.sourceCount, row.fieldCount),
      lastRunState: runDotState(row.lastRun),
      lastRunLabel: row.lastRun ? relativeTime(row.lastRun.createdAt, now) : null,
      createdLabel: isoDate(row.createdAt),
    }));
}
