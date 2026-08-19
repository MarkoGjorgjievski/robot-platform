// Pure serialization for run exports. No DB, no HTTP — everything here is a
// string transform, which is why it carries the bulk of the export tests.

/** Excel reads a CSV as the system codepage unless it sees a UTF-8 BOM, which
 *  mangles every price symbol and accented product name we extract. */
const BOM = '﻿';
const NEEDS_QUOTING = /[",\r\n]/;

function toCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  // Arrays and objects (variants, star_distribution, ...) stay lossless as JSON
  // in one cell. CSV is a flat format; callers wanting structure take the JSON export.
  return JSON.stringify(value);
}

function escape(cell: string): string {
  return NEEDS_QUOTING.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

/** RFC 4180 CSV: CRLF line endings, quotes only where required, `""` escaping. */
export function toCsv(columns: string[], rows: Record<string, unknown>[]): string {
  const lines = [columns.map(escape).join(',')];
  for (const row of rows) {
    lines.push(columns.map((column) => escape(toCell(row[column]))).join(','));
  }
  return BOM + lines.join('\r\n') + '\r\n';
}

export function toJson(envelope: unknown): string {
  return JSON.stringify(envelope, null, 2);
}
