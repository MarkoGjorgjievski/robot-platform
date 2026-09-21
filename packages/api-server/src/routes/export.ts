// Data export as plain HTTP, deliberately outside tRPC: a URL a customer can
// open, curl or hand to a script, rather than a payload that only exists inside
// the SPA. Unauthenticated like every other surface here — the run UUID is the
// only thing standing between a caller and the data.
//
// The project route is the same bargain: `/export/projects/<project uuid>.csv`
// is unauthenticated by the project UUID exactly like the run route. Cut-over
// (spec 2026-09-21 §7, plan 6) puts both behind the session.

import { Hono } from 'hono';
import { toCsv, toJson, exportFilename, projectExportFilename, type RunExport, type ProjectExport } from '@robot/api/export';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ExportDeps = {
  loadRunExport: (runId: string) => Promise<RunExport | null>;
  loadProjectExport: (projectId: string) => Promise<ProjectExport | null>;
};

/** `<uuid>.<csv|json>`, or null for anything else. Postgres raises on a
 *  malformed uuid, so reject it here before it reaches the DB. */
function parseFile(file: string): { id: string; format: 'csv' | 'json' } | null {
  const dot = file.lastIndexOf('.');
  if (dot === -1) return null;
  const id = file.slice(0, dot);
  const format = file.slice(dot + 1).toLowerCase();
  if (format !== 'csv' && format !== 'json') return null;
  if (!UUID_RE.test(id)) return null;
  return { id, format };
}

export function createExportRoutes(deps: ExportDeps) {
  const app = new Hono();

  app.get('/runs/:file', async (c) => {
    const parsed = parseFile(c.req.param('file'));
    if (!parsed) return c.notFound();

    const runExport = await deps.loadRunExport(parsed.id);
    if (!runExport) return c.json({ error: 'Run not found' }, 404);

    const body = parsed.format === 'csv' ? toCsv(runExport.fields, runExport.rows) : toJson(runExport);
    return c.body(body, 200, {
      'content-type': parsed.format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="${exportFilename(runExport, parsed.format)}"`,
    });
  });

  app.get('/projects/:file', async (c) => {
    const parsed = parseFile(c.req.param('file'));
    if (!parsed) return c.notFound();
    const x = await deps.loadProjectExport(parsed.id);
    if (!x) return c.json({ error: 'Project not found' }, 404);
    const body = parsed.format === 'csv' ? toCsv(x.fields, x.rows) : toJson(x);
    return c.body(body, 200, {
      'content-type': parsed.format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="${projectExportFilename(x, parsed.format)}"`,
    });
  });

  return app;
}
