// Turns the rows a run persisted into a self-describing export envelope.
//
// Pure on purpose: everything that decides *what* an export contains lives here
// and is testable without Postgres; `load-run-export.ts` only fetches the inputs.

import { DETAIL_URL_FIELD } from '@robot/scraper';
import { contractFields, contractAxes, effectiveLevel, type VariantMode } from '../contract.js';

export type ExportSchemaField = { name: string; enabled?: boolean };

/** The shape a run exports in (plan 2026-10-02-variants-plan3, Global
 *  Constraints "Export shapes"): `flat` is today's one-row-per-extraction
 *  shape (used whenever the run produced no `_product_key` rows, whatever
 *  the project's variant setting); `row_per_variant` and `nested` apply only
 *  to a run that did produce variant rows, per the project's `variantMode`. */
export type ExportShape = 'flat' | 'row_per_variant' | 'nested';
export type ShapeField = { key: string; name: string; level: 'product' | 'variant' };
export type ShapeAxis = { key: string; name: string };

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
  /** The project's dataset (spec 2026-10-01 §2): its schema carries the
   *  contract's per-field `level` and axis entries, and `variantMode` picks
   *  `row_per_variant` vs `nested` for a run that produced variant rows.
   *  `null`/omitted for a run whose source has no dataset (legacy) or has
   *  been detached — identical to today, since such a run never carries
   *  `_product_key` rows either. */
  dataset?: { schema: unknown; variantMode: string } | null;
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
  /** Present only for the `nested` shape: the per-product JSON representation
   *  (a `variants` array per product), distinct from the `; `-joined rows
   *  `fields`/`rows` carry for CSV and XLSX. Absent (never serialized) for
   *  every other shape, so a flat run's JSON export is untouched. */
  json?: unknown;
  /** Column name → field type, for `toXlsx`'s "numbers as numbers" rule.
   *  Absent when there is no type information to offer (no customer schema,
   *  no dataset), so a flat run's envelope is untouched too. */
  types?: Record<string, string>;
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
function customerColumns(schemaDefinition: unknown): Array<{ key: string; name: string; type: string }> | null {
  if (!Array.isArray(schemaDefinition) || schemaDefinition.length === 0) return null;
  return schemaDefinition
    .filter((f): f is { key: string; name: string; type?: unknown } => f && typeof f.key === 'string' && typeof f.name === 'string')
    .map((f) => ({ key: f.key, name: f.name, type: typeof f.type === 'string' ? f.type : 'text' }));
}

/** `undefined` when `o` has no keys, so a caller can assign it to an optional
 *  field and have it vanish from `toEqual`/`JSON.stringify` rather than show
 *  up as an empty object — the mechanism that keeps a flat run's envelope
 *  byte-identical to before this field existed. */
function presentOrUndefined<T extends object>(o: T): T | undefined {
  return Object.keys(o).length > 0 ? o : undefined;
}

function joinCell(values: unknown[]): string {
  return values
    .map((v) => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)))
    .join('; ');
}

/**
 * Shapes a run's rows for export in the project's variant shape (plan
 * 2026-10-02-variants-plan3, Global Constraints "Export shapes"). `rows` are
 * keyed by field/axis key exactly as `buildVariantRows`
 * (packages/scraper/src/verify/variant-rows.ts) produces them — plus
 * `_product_key`, `_variant_key` and (for a partial row) `_variant_partial`,
 * which never reaches the output. `fields` and `axes` supply the customer
 * display name for every key.
 */
export function shapeRows(args: {
  rows: Record<string, unknown>[];
  shape: ExportShape;
  fields: ShapeField[];
  axes: ShapeAxis[];
}): { columns: string[]; rows: Record<string, unknown>[]; json: unknown } {
  const { rows, shape, fields, axes } = args;

  if (shape === 'flat') {
    const columns = fields.map((f) => f.name);
    const outRows = rows.map((r) => {
      const o: Record<string, unknown> = {};
      for (const f of fields) o[f.name] = r[f.key] ?? null;
      return o;
    });
    return { columns, rows: outRows, json: outRows };
  }

  const productFields = fields.filter((f) => f.level === 'product');
  const variantFields = fields.filter((f) => f.level === 'variant');

  if (shape === 'row_per_variant') {
    const columns = [
      ...productFields.map((f) => f.name),
      ...axes.map((a) => a.name),
      ...variantFields.map((f) => f.name),
      'product_key',
      'variant_key',
    ];
    const outRows = rows.map((r) => {
      const o: Record<string, unknown> = {};
      for (const f of productFields) o[f.name] = r[f.key] ?? null;
      for (const a of axes) o[a.name] = r[a.key] ?? null;
      for (const f of variantFields) o[f.name] = r[f.key] ?? null;
      o.product_key = r._product_key ?? null;
      o.variant_key = r._variant_key ?? null;
      return o;
    });
    return { columns, rows: outRows, json: outRows };
  }

  // nested — lossy in CSV/XLSX (spec: "Documented as lossy"): every member
  // row's axis and variant-level values join into one "; "-separated cell
  // per product row. Only the JSON side keeps the per-variant structure.
  const columns = [
    ...productFields.map((f) => f.name),
    ...axes.map((a) => a.name),
    ...variantFields.map((f) => f.name),
    'product_key',
  ];

  const order: unknown[] = [];
  const groups = new Map<unknown, Record<string, unknown>[]>();
  for (const r of rows) {
    const pk = r._product_key;
    if (!groups.has(pk)) { groups.set(pk, []); order.push(pk); }
    groups.get(pk)!.push(r);
  }

  const outRows: Record<string, unknown>[] = [];
  const jsonRows: Record<string, unknown>[] = [];
  for (const pk of order) {
    const members = groups.get(pk)!;
    const first = members[0]!;
    // A product with no variants never got a `_variant_key` at all (the
    // no-entries branch of buildVariantRows) — vs. a genuine single variant,
    // which always has one. That's the only reliable signal: an empty
    // `variants: []` is required even though both cases have one member row.
    const hasVariants = members.some((m) => m._variant_key !== undefined && m._variant_key !== null && m._variant_key !== '');

    const row: Record<string, unknown> = {};
    for (const f of productFields) row[f.name] = first[f.key] ?? null;
    for (const a of axes) row[a.name] = joinCell(members.map((m) => m[a.key]));
    for (const f of variantFields) row[f.name] = joinCell(members.map((m) => m[f.key]));
    row.product_key = pk ?? null;
    outRows.push(row);

    const jo: Record<string, unknown> = {};
    for (const f of productFields) jo[f.name] = first[f.key] ?? null;
    jo.product_key = pk ?? null;
    jo.variants = hasVariants
      ? members.map((m) => {
          const v: Record<string, unknown> = { variant_key: m._variant_key ?? null };
          for (const a of axes) v[a.name] = m[a.key] ?? null;
          for (const f of variantFields) v[f.name] = m[f.key] ?? null;
          return v;
        })
      : [];
    jsonRows.push(jo);
  }

  return { columns, rows: outRows, json: jsonRows };
}

export function buildRunExport(input: RunExportInput): RunExport {
  const rows = (Array.isArray(input.extractionData) ? input.extractionData : []) as Record<string, unknown>[];
  const customer = customerColumns(input.source?.schemaDefinition);

  // The shape (Global Constraints): `flat` whenever the run itself produced
  // no `_product_key` rows — whatever the project's variantMode — else that
  // mode's shape. A run never mixes the two: either every row the pipeline
  // wrote carries `_product_key`, or none does.
  const hasVariants = rows.some((r) => r._product_key !== undefined && r._product_key !== null);
  const variantMode = (input.dataset?.variantMode as VariantMode | undefined) ?? 'ignore';
  const shape: ExportShape = hasVariants ? (variantMode === 'nested' ? 'nested' : 'row_per_variant') : 'flat';

  let outFields: string[];
  let outRows: Record<string, unknown>[];
  let json: unknown;
  const types: Record<string, string> = {};

  if (shape === 'flat') {
    // Unchanged from before variants existed — a flat run's CSV/JSON export
    // must stay byte-identical. Customer schema: rows are re-keyed from the
    // internal field `key` to the customer's declared `name` so the export
    // header reads the way they authored it. `_`-prefixed keys (e.g. `_url`)
    // are provenance metadata added outside the schema and survive
    // untouched; any other undeclared key is dropped rather than leaking an
    // internal field name into a customer-facing export.
    outRows = customer
      ? rows.map((r) => {
          const o: Record<string, unknown> = {};
          for (const c of customer) o[c.name] = r[c.key] ?? null;
          for (const k of Object.keys(r)) if (k.startsWith('_')) o[k] = r[k];
          return o;
        })
      : rows;
    const fieldList = customer ? customer.map((c) => ({ name: c.name })) : schemaFields(input.source?.selectorsJson ?? null);
    outFields = deriveColumns(fieldList, outRows);
    if (customer) for (const c of customer) types[c.name] = c.type;
  } else {
    const contract = contractFields(input.dataset?.schema ?? null);
    const axes = contractAxes(input.dataset?.schema ?? null);
    const shaped = shapeRows({
      rows,
      shape,
      fields: contract.map((f) => ({ key: f.key, name: f.name, level: effectiveLevel(f) })),
      axes: axes.map((a) => ({ key: a.key, name: a.name })),
    });
    outFields = shaped.columns;
    outRows = shaped.rows;
    if (shape === 'nested') json = shaped.json;
    for (const f of contract) types[f.name] = f.type;
  }

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
    fields: outFields,
    rows: outRows,
    json,
    types: presentOrUndefined(types),
  };
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function exportFilename(runExport: RunExport, extension: 'csv' | 'json' | 'xlsx'): string {
  // A run that never completed still has a creation date to name the file by.
  const date = (runExport.run.completedAt ?? runExport.run.createdAt).slice(0, 10);
  const name = runExport.source ? slugify(runExport.source.slug) : 'run';
  return `${name}-${runExport.run.id.slice(0, 8)}-${date}.${extension}`;
}
