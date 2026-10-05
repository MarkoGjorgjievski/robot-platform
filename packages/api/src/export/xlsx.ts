// XLSX serialization for run/project exports (plan 2026-10-02-variants-plan3,
// Global Constraints "Export shapes"): one sheet named `Data`, a bold frozen
// header row, and plain values — numbers stored as Excel numbers wherever the
// column's field type is `number` or `money`, never as text.

import ExcelJS from 'exceljs';

/** Mirrors serialize.ts's `toCell` for the object/array case (lossless JSON
 *  in one cell); numbers and booleans keep their native Excel type instead of
 *  being stringified, and a numeric-looking string in a `number`/`money`
 *  column is parsed so the cell is a true Excel number, not text. */
function toCellValue(value: unknown, type: string | undefined): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if ((type === 'number' || type === 'money') && value.trim() !== '') {
      const n = Number(value);
      if (Number.isFinite(n)) return n;
    }
    return value;
  }
  return JSON.stringify(value);
}

export async function toXlsx(
  columns: string[],
  rows: Record<string, unknown>[],
  types: Record<string, string> = {},
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Data', { views: [{ state: 'frozen', ySplit: 1 }] });

  sheet.addRow(columns);
  sheet.getRow(1).font = { bold: true };

  for (const row of rows) {
    sheet.addRow(columns.map((column) => toCellValue(row[column], types[column])));
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
