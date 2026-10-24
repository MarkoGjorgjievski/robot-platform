// packages/api/src/export/render-run-export.ts
// A run's file, as bytes, in each format: the api-server's live download and the run-delivery snapshot
// (spec 2026-10-24 §3.3) are the same bytes for the same rows.
import { toCsv, toJson } from './serialize.js';
import { toXlsx } from './xlsx.js';
import { exportFilename, type RunExport } from './build-run-export.js';

export type ExportFormat = 'csv' | 'json' | 'xlsx';
export const EXPORT_FORMATS: readonly ExportFormat[] = ['csv', 'json', 'xlsx'];
const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** CSV and JSON declare UTF-8; XLSX is a fixed binary media type with no charset parameter. */
export function exportContentType(format: ExportFormat): string {
  if (format === 'csv') return 'text/csv; charset=utf-8';
  if (format === 'json') return 'application/json; charset=utf-8';
  return XLSX_CONTENT_TYPE;
}

/**
 * `rows`/`fields` always carry the CSV/XLSX shape, which for the `nested` variant shape is the "; "-joined,
 * one-row-per-product view — lossy by design. `json` carries the per-product `variants` structure for that shape
 * and is swapped in, in place of `rows`, for the JSON file only; a flat run's JSON stays the four keys it always
 * was. D3: `fields` describes `rows`, so for a nested envelope it is swapped for `jsonFields`, and `variantFields`
 * is added.
 */
export function runJsonEnvelope(x: RunExport): string {
  if (x.json !== undefined) {
    return toJson({ run: x.run, source: x.source, fields: x.jsonFields, variantFields: x.variantFields, rows: x.json });
  }
  return toJson({ run: x.run, source: x.source, fields: x.fields, rows: x.rows });
}

export async function renderRunExport(x: RunExport, format: ExportFormat): Promise<{ bytes: Buffer; contentType: string; filename: string }> {
  const bytes =
    format === 'csv' ? Buffer.from(toCsv(x.fields, x.rows), 'utf8')
    : format === 'json' ? Buffer.from(runJsonEnvelope(x), 'utf8')
    : Buffer.from(await toXlsx(x.fields, x.rows, x.types));
  return { bytes, contentType: exportContentType(format), filename: exportFilename(x, format) };
}
