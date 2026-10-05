// Data export as plain HTTP, deliberately outside tRPC: a URL a customer can
// open, curl or hand to a script, rather than a payload that only exists inside
// the SPA. Unauthenticated like every other surface here — the run UUID is the
// only thing standing between a caller and the data.
//
// The project route is the same bargain: `/export/projects/<project uuid>.csv`
// is unauthenticated by the project UUID exactly like the run route. Cut-over
// (spec 2026-09-21 §7, plan 6) puts both behind the session.

import { Hono } from 'hono';
import { toCsv, toJson, toXlsx, exportFilename, projectExportFilename, type RunExport, type ProjectExport } from '@robot/api/export';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export type ExportDeps = {
  loadRunExport: (runId: string) => Promise<RunExport | null>;
  loadProjectExport: (projectId: string) => Promise<ProjectExport | null>;
};

type Format = 'csv' | 'json' | 'xlsx';

/** `<uuid>.<csv|json|xlsx>`, or null for anything else (e.g. `.pdf`).
 *  Postgres raises on a malformed uuid, so reject it here before it reaches
 *  the DB. */
function parseFile(file: string): { id: string; format: Format } | null {
  const dot = file.lastIndexOf('.');
  if (dot === -1) return null;
  const id = file.slice(0, dot);
  const format = file.slice(dot + 1).toLowerCase();
  if (format !== 'csv' && format !== 'json' && format !== 'xlsx') return null;
  if (!UUID_RE.test(id)) return null;
  return { id, format };
}

/** `content-type` per format; CSV and JSON declare UTF-8, XLSX is a fixed
 *  binary media type with no charset parameter. */
function contentTypeFor(format: Format): string {
  if (format === 'csv') return 'text/csv; charset=utf-8';
  if (format === 'json') return 'application/json; charset=utf-8';
  return XLSX_CONTENT_TYPE;
}

/**
 * `rows`/`fields` always carry the CSV/XLSX shape, which for the `nested`
 * variant shape (build-run-export.ts's `shapeRows`) is the "; "-joined,
 * one-row-per-product view — lossy by design. `json` carries the distinct
 * per-product `variants` array structure for that shape, and is swapped in
 * here, in place of `rows`, for the JSON response only. This also keeps a
 * flat run's JSON export byte-identical to before: `json`/`types` are never
 * present on its envelope, so picking exactly these four keys reproduces
 * exactly what `toJson` serialized previously.
 *
 * D3: `fields` (the CSV/XLSX columns) describes `rows`, not `json` — a
 * nested product object's own keys are different (and carry a without-
 * variants product's variant-level values directly, ruling I4) and its
 * inner `variants[]` object's keys are different again. For a nested
 * envelope (`json` present), `fields` is swapped for `jsonFields` and a new
 * `variantFields` key is added; every other shape's response is untouched.
 */
function toJsonEnvelope(x: {
  run: unknown; source: unknown; fields: string[]; rows: Record<string, unknown>[];
  json?: unknown; jsonFields?: string[]; variantFields?: string[];
}): string {
  if (x.json !== undefined) {
    return toJson({ run: x.run, source: x.source, fields: x.jsonFields, variantFields: x.variantFields, rows: x.json });
  }
  return toJson({ run: x.run, source: x.source, fields: x.fields, rows: x.rows });
}

export function createExportRoutes(deps: ExportDeps) {
  const app = new Hono();

  app.get('/runs/:file', async (c) => {
    const parsed = parseFile(c.req.param('file'));
    if (!parsed) return c.notFound();

    const runExport = await deps.loadRunExport(parsed.id);
    if (!runExport) return c.json({ error: 'Run not found' }, 404);

    const body =
      parsed.format === 'csv' ? toCsv(runExport.fields, runExport.rows)
      : parsed.format === 'json' ? toJsonEnvelope(runExport)
      : new Uint8Array(await toXlsx(runExport.fields, runExport.rows, runExport.types));
    // `Uint8Array`'s TS lib typing has drifted a generic parameter ahead of
    // Hono's own in this workspace (also hit in xlsx.test.ts) — the bytes a
    // `Buffer` copy into a fresh `Uint8Array` are exactly what `c.body` wants
    // at runtime.
    return c.body(body as string | Uint8Array<ArrayBuffer>, 200, {
      'content-type': contentTypeFor(parsed.format),
      'content-disposition': `attachment; filename="${exportFilename(runExport, parsed.format)}"`,
    });
  });

  app.get('/projects/:file', async (c) => {
    const parsed = parseFile(c.req.param('file'));
    if (!parsed) return c.notFound();
    const x = await deps.loadProjectExport(parsed.id);
    if (!x) return c.json({ error: 'Project not found' }, 404);
    // Final review M5: `types` exists only for the xlsx writer — stripped from
    // the JSON the way `toJsonEnvelope` strips it for a run, so no project's
    // JSON gains a key it did not have before variants. `nested` (D2) is a
    // filename-naming signal only, stripped the same way.
    const { types: _types, nested: _nested, ...jsonEnvelope } = x;
    const body =
      parsed.format === 'csv' ? toCsv(x.fields, x.rows)
      : parsed.format === 'json' ? toJson(jsonEnvelope)
      : new Uint8Array(await toXlsx(x.fields, x.rows, x.types));
    return c.body(body as string | Uint8Array<ArrayBuffer>, 200, {
      'content-type': contentTypeFor(parsed.format),
      'content-disposition': `attachment; filename="${projectExportFilename(x, parsed.format)}"`,
    });
  });

  return app;
}
