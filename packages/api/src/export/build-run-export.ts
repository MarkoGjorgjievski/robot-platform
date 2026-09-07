// Turns the rows a run persisted into a self-describing export envelope.
//
// Pure on purpose: everything that decides *what* an export contains lives here
// and is testable without Postgres; `load-run-export.ts` only fetches the inputs.

import { DETAIL_URL_FIELD } from '@robot/scraper';

export type ExportSchemaField = { name: string; enabled?: boolean };

export type RunExportInput = {
  run: {
    id: string;
    status: string;
    startedAt: Date | null;
    completedAt: Date | null;
    createdAt: Date;
    resultCount: number | null;
  };
  source: {
    slug: string;
    name: string;
    urlTemplate: string | null;
    selectorsJson: unknown;
    schemaDefinition?: unknown;
  } | null;
  /** The URL actually fetched, which may carry parameters the template does not. */
  captureUrl: string | null;
  extractionData: unknown;
};

export type RunExport = {
  run: {
    id: string;
    status: string;
    startedAt: string | null;
    completedAt: string | null;
    createdAt: string;
    rowCount: number;
  };
  source: { slug: string; name: string; url: string | null } | null;
  fields: string[];
  rows: Record<string, unknown>[];
};

/**
 * Column order comes from the schema so two runs of the same Source export the
 * same header — a consumer can diff them. Fields nothing resolved still get a
 * column (empty cells), and data keys the schema never declared are appended
 * rather than silently dropped.
 */
export function deriveColumns(
  fields: ExportSchemaField[],
  rows: Record<string, unknown>[],
): string[] {
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const field of fields) {
    if (field.enabled === false || seen.has(field.name)) continue;
    seen.add(field.name);
    columns.push(field.name);
  }
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (seen.has(key)) continue;
      seen.add(key);
      columns.push(key);
    }
  }
  return columns;
}

/**
 * `DETAIL_URL_FIELD` is filtered here for the same reason
 * `effective-schema.ts` filters it out of the schema handed to extraction:
 * it is planning machinery (the row-scoped "which detail page does this row
 * link to" field `runListingAnalysis` always adds, and that the deleted
 * `sources.analyze` procedure (removed 2026-09; no live writer) used to
 * persist into `selectorsJson.fields` verbatim for the discovery report),
 * never a field extraction actually resolves per item. Left in, no row ever
 * carries the key, and the schema-driven half of `deriveColumns` below adds
 * it as a column anyway — a permanently empty phantom column in every
 * export. `effectiveSchema` itself isn't reused here: it additionally
 * prefers the dataset's own schema over `selectorsJson.fields`, which this
 * function's caller has no dataset schema to offer.
 */
function schemaFields(selectorsJson: unknown): ExportSchemaField[] {
  const fields = (selectorsJson as { fields?: unknown } | null)?.fields;
  if (!Array.isArray(fields)) return [];
  return fields.filter(
    (f): f is ExportSchemaField =>
      typeof f === 'object' && f !== null && typeof (f as ExportSchemaField).name === 'string'
      && (f as ExportSchemaField).name !== DETAIL_URL_FIELD,
  );
}

/**
 * A customer schema definition (Task 1's `sources.schemaDefinition`) names
 * its own columns — the header a customer sees is the `name` they typed,
 * not the internal field `key`. `null` (not a customer schema, or an empty
 * definition) tells the caller to fall back to `selectorsJson`-derived
 * columns unchanged.
 */
function customerColumns(schemaDefinition: unknown): Array<{ key: string; name: string }> | null {
  if (!Array.isArray(schemaDefinition) || schemaDefinition.length === 0) return null;
  return schemaDefinition
    .filter((f): f is { key: string; name: string } => f && typeof f.key === 'string' && typeof f.name === 'string')
    .map((f) => ({ key: f.key, name: f.name }));
}

export function buildRunExport(input: RunExportInput): RunExport {
  const rows = (Array.isArray(input.extractionData) ? input.extractionData : []) as Record<string, unknown>[];
  const customer = customerColumns(input.source?.schemaDefinition);
  // Customer schema: rows are re-keyed from the internal field `key` to the
  // customer's declared `name` so the export header reads the way they
  // authored it. `_`-prefixed keys (e.g. `_url`) are provenance metadata
  // added outside the schema and survive untouched; any other undeclared
  // key is dropped rather than leaking an internal field name into a
  // customer-facing export.
  const outRows = customer
    ? rows.map((r) => {
        const o: Record<string, unknown> = {};
        for (const c of customer) o[c.name] = r[c.key] ?? null;
        for (const k of Object.keys(r)) if (k.startsWith('_')) o[k] = r[k];
        return o;
      })
    : rows;
  const fieldList = customer ? customer.map((c) => ({ name: c.name })) : schemaFields(input.source?.selectorsJson ?? null);
  return {
    run: {
      id: input.run.id,
      status: input.run.status,
      startedAt: input.run.startedAt?.toISOString() ?? null,
      completedAt: input.run.completedAt?.toISOString() ?? null,
      createdAt: input.run.createdAt.toISOString(),
      // The exported row count, not runs.result_count — the file describes itself.
      rowCount: rows.length,
    },
    source: input.source
      ? {
          slug: input.source.slug,
          name: input.source.name,
          url: input.captureUrl ?? input.source.urlTemplate ?? null,
        }
      : null,
    fields: deriveColumns(fieldList, outRows),
    rows: outRows,
  };
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function exportFilename(runExport: RunExport, extension: 'csv' | 'json'): string {
  // A run that never completed still has a creation date to name the file by.
  const date = (runExport.run.completedAt ?? runExport.run.createdAt).slice(0, 10);
  const name = runExport.source ? slugify(runExport.source.slug) : 'run';
  return `${name}-${runExport.run.id.slice(0, 8)}-${date}.${extension}`;
}
