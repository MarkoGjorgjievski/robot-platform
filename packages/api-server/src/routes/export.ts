// Data export as plain HTTP, deliberately outside tRPC: a URL a customer can
// open, curl or hand to a script, rather than a payload that only exists inside
// the SPA. Unauthenticated like every other surface here — the run UUID is the
// only thing standing between a caller and the data.

import { Hono } from 'hono';
import { toCsv, toJson, exportFilename, type RunExport } from '@robot/api/export';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ExportDeps = {
  loadRunExport: (runId: string) => Promise<RunExport | null>;
};

export function createExportRoutes(deps: ExportDeps) {
  const app = new Hono();

  app.get('/runs/:file', async (c) => {
    const file = c.req.param('file');
    const dot = file.lastIndexOf('.');
    const runId = dot === -1 ? file : file.slice(0, dot);
    const format = dot === -1 ? '' : file.slice(dot + 1).toLowerCase();

    if (format !== 'csv' && format !== 'json') return c.notFound();
    // Postgres raises on a malformed uuid, so reject it before it reaches the DB.
    if (!UUID_RE.test(runId)) return c.notFound();

    const runExport = await deps.loadRunExport(runId);
    if (!runExport) return c.json({ error: 'Run not found' }, 404);

    const body = format === 'csv' ? toCsv(runExport.fields, runExport.rows) : toJson(runExport);
    return c.body(body, 200, {
      'content-type': format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="${exportFilename(runExport, format)}"`,
    });
  });

  return app;
}
