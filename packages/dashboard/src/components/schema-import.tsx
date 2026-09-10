import { useState, type ChangeEvent } from 'react';
import { Upload } from 'lucide-react';
import readXlsxFile from 'read-excel-file';
import { parseCsv } from '../lib/csv';
import { rowsFromTable, importProblems, type GridRow } from '../lib/schema-grid';

type Props = { urlCount: number; onRows: (rows: GridRow[]) => void };

/**
 * A file input for bulk-loading the schema grid from a spreadsheet: CSV
 * parsed by our own `parseCsv`, XLSX by `read-excel-file`. Either way the
 * raw cells land in `rowsFromTable`, which does the header mapping and
 * problem reporting shared with pasted-block imports.
 */
export function SchemaImport({ urlCount, onRows }: Props) {
  const [problems, setProblems] = useState<string[]>([]);

  async function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
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

    const { rows, problems: nextProblems } = rowsFromTable(table, urlCount);
    setProblems(nextProblems);
    if (nextProblems.length === 0) onRows(rows);
  }

  return (
    <div>
      <label className="btn-quiet cursor-pointer">
        <Upload className="h-3.5 w-3.5" />
        Import CSV or XLSX
        <input type="file" accept=".csv,.xlsx" onChange={handleChange} className="hidden" />
      </label>

      {problems.length > 0 && (
        <div className="mt-2 rounded-md border border-fail/30 bg-fail-tint p-3 text-xs">
          <p className="font-medium text-fail">Couldn't import this file:</p>
          <ul className="mt-1 list-inside list-disc text-fail">
            {problems.map((p, i) => <li key={i}>{p}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
