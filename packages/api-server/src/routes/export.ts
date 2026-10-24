// Data export as plain HTTP, deliberately outside tRPC: a URL a customer can
// open, curl or hand to a script, rather than a payload that only exists inside
// the SPA. Gated the same way as the tRPC context (final review I1): the
// `robot_session` cookie is loaded the same way, and the run's / project's
// org must equal the session's. No session is 401; another org's id (or one
// that doesn't exist) is 404 — the two are indistinguishable on purpose, so a
// guessed id never learns whether it was wrong or just not the caller's.
//
// The app's download links are plain `<a href download>` navigations
// (packages/app/src/lib/trpc.ts's `exportUrl`), so the browser attaches the
// `robot_session` cookie the same way it does for any other same-site request
// to :4000 — no `credentials: 'include'` needed, because this isn't a fetch.
//
// A run's file is also served as its snapshot (spec 2026-10-24 §3.3) — the
// bytes its run-delivery job stored — either with the session (`?snapshot=1`,
// org-gated as above) or by a signed link from a webhook (`?expires=&sig=`, no
// session, never the live rows). A signed link that is wrong, expired, for
// another run or format, or signed with a secret since replaced answers the
// same 404 as a run that does not exist.

import { Hono, type Context } from 'hono';
import { toCsv, toJson, toXlsx, projectExportFilename, renderRunExport, exportContentType, type RunExport, type ProjectExport, type ExportFormat } from '@robot/api/export';
import { checkFileSignature } from '@robot/api/delivery';
import type { SessionInfo } from '@robot/api/auth';
import { sessionTokenFrom } from '../session-cookie.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ExportDeps = {
  loadRunExport: (runId: string) => Promise<RunExport | null>;
  loadProjectExport: (projectId: string) => Promise<ProjectExport | null>;
  loadSession: (token: string) => Promise<SessionInfo | null>;
  orgIdForRun: (runId: string) => Promise<string | null>;
  orgIdForProject: (projectId: string) => Promise<string | null>;
  /** The run's snapshot (spec 2026-10-24 §3.3), as its run-delivery job wrote it; null before. */
  loadRunFile: (runId: string, format: ExportFormat) => Promise<{ bytes: Uint8Array; filename: string } | null>;
  /** The signing secret of the run's website; null without one. */
  webhookSecretForRun: (runId: string) => Promise<string | null>;
};

type Format = ExportFormat;

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

/** A stored filename inside a quoted `filename="…"`: no quote, backslash or control character can end it early. */
function headerFilename(name: string): string {
  return name.replace(/["\\\u0000-\u001f\u007f]/g, '_');
}

export function createExportRoutes(deps: ExportDeps) {
  const app = new Hono();

  const runNotFound = (c: Context) => c.json({ error: 'Run not found' }, 404);

  /** The stored file, never the live rows; not there yet is the same 404 as a missing run. */
  const snapshot = async (c: Context, parsed: { id: string; format: Format }) => {
    const file = await deps.loadRunFile(parsed.id, parsed.format);
    if (!file) return runNotFound(c);
    return c.body(new Uint8Array(file.bytes), 200, {
      'content-type': exportContentType(parsed.format),
      'content-disposition': `attachment; filename="${headerFilename(file.filename)}"`,
      'cache-control': 'private, no-store',
    });
  };

  app.get('/runs/:file', async (c) => {
    const parsed = parseFile(c.req.param('file'));
    if (!parsed) return c.notFound();

    // A signed link (spec 2026-10-24 §3.3): no session; the website's current webhook secret, this run, this format,
    // not expired. Anything wrong is the same 404 as a run that does not exist, and it only ever opens the snapshot.
    const sig = c.req.query('sig');
    const expires = c.req.query('expires');
    if (sig !== undefined || expires !== undefined) {
      const secret = await deps.webhookSecretForRun(parsed.id);
      if (!checkFileSignature({ secret, runId: parsed.id, format: parsed.format, expires, sig })) return runNotFound(c);
      return snapshot(c, parsed);
    }

    const session = await deps.loadSession(sessionTokenFrom(c.req.header('cookie')));
    if (!session) return c.json({ error: 'Sign in first' }, 401);

    const orgId = await deps.orgIdForRun(parsed.id);
    if (orgId !== session.org.id) return runNotFound(c);

    // The file the run's delivery wrote. The run page's buttons carry no `snapshot` and stay live.
    if (c.req.query('snapshot') === '1') return snapshot(c, parsed);

    const runExport = await deps.loadRunExport(parsed.id);
    if (!runExport) return runNotFound(c);
    const file = await renderRunExport(runExport, parsed.format);
    return c.body(new Uint8Array(file.bytes), 200, {
      'content-type': file.contentType,
      'content-disposition': `attachment; filename="${file.filename}"`,
    });
  });

  app.get('/projects/:file', async (c) => {
    const parsed = parseFile(c.req.param('file'));
    if (!parsed) return c.notFound();

    const session = await deps.loadSession(sessionTokenFrom(c.req.header('cookie')));
    if (!session) return c.json({ error: 'Sign in first' }, 401);

    const orgId = await deps.orgIdForProject(parsed.id);
    if (orgId !== session.org.id) return c.json({ error: 'Project not found' }, 404);

    const x = await deps.loadProjectExport(parsed.id);
    if (!x) return c.json({ error: 'Project not found' }, 404);
    // Final review M5: `types` exists only for the xlsx writer — stripped from
    // the JSON the way `runJsonEnvelope` strips it for a run, so no project's
    // JSON gains a key it did not have before variants. `nested` (D2) is a
    // filename-naming signal only, stripped the same way.
    const { types: _types, nested: _nested, ...jsonEnvelope } = x;
    const body =
      parsed.format === 'csv' ? toCsv(x.fields, x.rows)
      : parsed.format === 'json' ? toJson(jsonEnvelope)
      : new Uint8Array(await toXlsx(x.fields, x.rows, x.types));
    // `Uint8Array`'s TS lib typing has drifted a generic parameter ahead of
    // Hono's own in this workspace (also hit in xlsx.test.ts) — the bytes a
    // `Buffer` copy into a fresh `Uint8Array` are exactly what `c.body` wants
    // at runtime.
    return c.body(body as string | Uint8Array<ArrayBuffer>, 200, {
      'content-type': exportContentType(parsed.format),
      'content-disposition': `attachment; filename="${projectExportFilename(x, parsed.format)}"`,
    });
  });

  return app;
}
