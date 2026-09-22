import { useState, type ChangeEvent } from 'react';
import { Upload } from 'lucide-react';
import readXlsxFile from 'read-excel-file';
import { Button } from '../ui/button';
import { parseCsv } from '../../lib/site/csv';
import { importProblems, rowsFromTable, type GridRow } from '../../lib/site/schema-grid';

/**
 * Filling the grid from a spreadsheet: CSV through our own `parseCsv`, XLSX
 * through `read-excel-file` (its default entry point is the browser build — the
 * Node one is a separate `read-excel-file/node` export — so nothing server-side
 * reaches the bundle).
 *
 * Either way the raw cells land in `rowsFromTable`, which does the header
 * mapping, and the tab fills existing rows by field name: an import cannot add
 * a field, because fields come from the project.
 */
export function SchemaImport({
  urlCount,
  disabled,
  onRows,
}: {
  urlCount: number;
  disabled?: boolean;
  onRows: (rows: GridRow[]) => void;
}) {
  const [problems, setProblems] = useState<string[]>([]);

  async function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // so the same file can be chosen twice
    if (!file) return;

    let table: string[][];
    try {
      table = file.name.toLowerCase().endsWith('.xlsx')
        ? (await readXlsxFile(file)).map((row) => row.map((c) => (c === null || c === undefined ? '' : String(c))))
        : parseCsv(await file.text());
    } catch (err) {
      setProblems(importProblems(err));
      return;
    }

    const { rows, problems: next } = rowsFromTable(table, urlCount);
    setProblems(next);
    if (next.length === 0) onRows(rows);
  }

  return (
    <div className="min-w-0">
      {/* A label, wearing the button's clothes: a file picker is the one control
          the browser will only open from a label, and `asChild` keeps it looking
          like every other outline button rather than a second kind of control.
          Disabled while a run is in flight, not merely inert — the reason is
          already in the strip above. */}
      <Button variant="outline" size="sm" asChild={!disabled} disabled={disabled}>
        {disabled ? (
          <span>
            <Upload />
            Import CSV or XLSX
          </span>
        ) : (
          <label className="cursor-pointer">
            <Upload />
            Import CSV or XLSX
            <input type="file" accept=".csv,.xlsx" onChange={(e) => void handleChange(e)} className="sr-only" />
          </label>
        )}
      </Button>

      {problems.length > 0 ? (
        <div role="alert" className="mt-2 border-l-2 border-fail pl-2.5">
          <p className="text-sm text-fail">Could not import this file:</p>
          <ul className="mt-0.5 list-inside list-disc text-sm text-fail">
            {problems.map((p, i) => (
              <li key={`${i}-${p}`}>{p}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
