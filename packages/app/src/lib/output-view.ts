import { relativeTime } from './projects-view';

/** `projects.output` (Task 3), narrowed to what the screen reads. */
export type OutputInput = {
  fields: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  websites: Array<{ id: string; name: string; runId: string | null; completedAt: string | null; rowCount: number }>;
};

export type OutputView = {
  columns: string[];
  rows: string[][];
  /** Rows on the screen — the API caps them at 500. */
  shown: number;
  /** Rows in the file. */
  total: number;
  truncated: boolean;
  summary: string;
};

/**
 * One cell, as the customer would read it. Extraction returns whatever the page
 * held, so a cell can be a number, a list of sizes or a nested object — and a
 * table that printed `[object Object]` in that last case would be lying about
 * what the file contains.
 */
export function cellText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(cellText).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** `_`-prefixed columns are provenance (`_url`) — in the file, not on the screen. */
export function outputView(x: OutputInput, now: Date = new Date()): OutputView {
  const columns = x.fields.filter((f) => !f.startsWith('_'));
  const rows = x.rows.map((r) => columns.map((c) => cellText(r[c])));
  // The newest completed run in the project. ISO-8601 in UTC sorts
  // lexicographically, which is why these are compared as strings.
  const latest = x.websites
    .map((w) => w.completedAt)
    .filter((d): d is string => !!d)
    .sort()
    .at(-1);
  const summary =
    x.rowCount === 0
      ? 'No rows yet'
      : `${plural(x.websites.length, 'website')} · ${plural(x.rowCount, 'row')} · latest ${relativeTime(new Date(latest!), now)}`;
  return { columns, rows, shown: rows.length, total: x.rowCount, truncated: rows.length < x.rowCount, summary };
}
