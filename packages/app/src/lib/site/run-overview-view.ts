/**
 * The run page's overview (Marko 2026-11-18): how full each field's column is, as numbers a bar can draw.
 * Read off the rows on screen, so it is there while a run is still extracting and on a stopped one — the
 * server's coverage report is only asked for on a settled run.
 */
export type FieldFill = { key: string; name: string; filled: number; total: number; percent: number };

const blank = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);

export function fieldFill(rows: readonly Record<string, unknown>[], columns: readonly { key: string; name: string }[]): FieldFill[] {
  const total = rows.length;
  return columns.map((c) => {
    const filled = rows.reduce((n, r) => n + (blank(r[c.key]) ? 0 : 1), 0);
    return { key: c.key, name: c.name, filled, total, percent: total === 0 ? 0 : (filled / total) * 100 };
  });
}

/** Every value there could be against the ones that are there: "94%". Null with no rows or no fields. */
export function overallFill(fill: readonly FieldFill[]): number | null {
  const total = fill.reduce((n, f) => n + f.total, 0);
  if (total === 0) return null;
  return Math.floor((fill.reduce((n, f) => n + f.filled, 0) / total) * 100);
}

/** The emptiest fields first, at most `max`; fields that are full everywhere are left out. */
export function thinnestFields(fill: readonly FieldFill[], max = 4): FieldFill[] {
  return fill.filter((f) => f.total > 0 && f.filled < f.total).sort((a, b) => a.percent - b.percent || a.name.localeCompare(b.name)).slice(0, max);
}
