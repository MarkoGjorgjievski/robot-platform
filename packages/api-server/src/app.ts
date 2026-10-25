import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AnyTRPCRouter } from '@trpc/server';
import { cors } from 'hono/cors';
import { serveStatic } from '@hono/node-server/serve-static';
import { trpcServer } from '@hono/trpc-server';
import { appRouter } from '@robot/api/routers';
import { loadRunExport, loadProjectExport, orgIdForRun, orgIdForProject, orgIdForCaptureFile } from '@robot/api/export';
import { loadSession } from '@robot/api/auth';
import { reportError as defaultReportError } from '@robot/api/errors';
import { createLog, type Log } from '@robot/api/log';
import { readiness as checkReadiness, type Readiness } from '@robot/api/monitoring';
import { jobQueueName } from '@robot/api/jobs';
import { loadRunFile, webhookSecretForRun } from '@robot/api/delivery';
import { db } from '@robot/db';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createExportRoutes } from './routes/export.js';
import { createCaptureGate } from './routes/captures-gate.js';
import { sessionTokenFrom } from './session-cookie.js';
import { clientIpOf } from './client-ip.js';
import { requestLog } from './request-log.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

/** Collaborators a caller may override. Defaults are the production ones. */
export type AppDeps = {
  /** Injectable so export route tests run without Postgres. */
  loadRunExport: (runId: string) => ReturnType<typeof loadRunExport>;
  loadProjectExport: (projectId: string) => ReturnType<typeof loadProjectExport>;
  loadSession: (token: string) => ReturnType<typeof loadSession>;
  orgIdForRun: (runId: string) => ReturnType<typeof orgIdForRun>;
  orgIdForProject: (projectId: string) => ReturnType<typeof orgIdForProject>;
  orgIdForCaptureFile: (filename: string) => ReturnType<typeof orgIdForCaptureFile>;
  loadRunFile: (runId: string, format: 'csv' | 'json' | 'xlsx') => Promise<{ bytes: Uint8Array; filename: string } | null>;
  webhookSecretForRun: (runId: string) => Promise<string | null>;
  /** Spec 2026-10-25 monitoring §2.4: where a 500 and a tRPC INTERNAL_SERVER_ERROR are reported (method/path or path/type only — never input). */
  reportError: (err: unknown, context: Record<string, unknown>) => unknown;
  /** Spec 2026-10-25 monitoring §2.2: the request log's logger (default `createLog('api-server')`). */
  log: Log;
  /** Spec 2026-10-25 monitoring §2.1: /readyz's checks (default: this process's JOB_QUEUE). */
  readiness: () => Promise<Readiness>;
  /** Tests only: the tRPC router mounted at /trpc (default appRouter). */
  router: AnyTRPCRouter;
};

export function createApp(deps: Partial<AppDeps> = {}) {
  const loadExport = deps.loadRunExport ?? ((runId: string) => loadRunExport(db, runId));
  const loadProject = deps.loadProjectExport ?? ((projectId: string) => loadProjectExport(db, projectId));
  const loadSessionForToken = deps.loadSession ?? ((token: string) => loadSession(db, token));
  const loadRunOrgId = deps.orgIdForRun ?? ((runId: string) => orgIdForRun(db, runId));
  const loadProjectOrgId = deps.orgIdForProject ?? ((projectId: string) => orgIdForProject(db, projectId));
  const loadCaptureOrgId = deps.orgIdForCaptureFile ?? ((filename: string) => orgIdForCaptureFile(db, filename));
  const loadSnapshot = deps.loadRunFile ?? ((runId: string, format: 'csv' | 'json' | 'xlsx') => loadRunFile(db, runId, format));
  const loadWebhookSecret = deps.webhookSecretForRun ?? ((runId: string) => webhookSecretForRun(db, runId));
  const report = deps.reportError ?? defaultReportError;
  const log = deps.log ?? createLog('api-server');
  const ready = deps.readiness ?? (() => checkReadiness({ queue: jobQueueName() }));
  const app = new Hono();

  // Spec 2026-10-25 monitoring §2.4: an exception a route did not handle is a 500 with no detail, reported once.
  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    void Promise.resolve(report(err, { method: c.req.method, path: c.req.path })).catch(() => {});
    return c.json({ error: 'Internal error' }, 500);
  });

  // Spec 2026-10-25 monitoring §2.2: every request — method, path without its query, status, duration, client IP.
  app.use('*', requestLog(log));

  // CORS — the app shell. `APP_ORIGINS` (comma-separated) lets an isolated pair
  // (e.g. :3100 → :4100) run beside the dev servers; unset or blank means :3000.
  const origins = (process.env.APP_ORIGINS?.trim() || 'http://localhost:3000').split(',').map((o) => o.trim()).filter(Boolean);
  app.use('*', cors({ origin: origins, credentials: true }));

  // Health check
  app.get('/healthz', (c) => c.json({ status: 'ok' }));

  // Readiness (spec 2026-10-25 monitoring §2.1, §2.6): no auth; check names and booleans only — no ids, hosts or errors.
  app.get('/readyz', async (c) => {
    let r: Readiness;
    try { r = await ready(); } catch { r = { ok: false, checks: { db: false, migrations: false, worker: false, queue: false } }; }
    c.header('cache-control', 'no-store');
    return c.json({ status: r.ok ? 'ok' : 'unavailable', checks: r.checks }, r.ok ? 200 : 503);
  });

  // tRPC adapter — mounts every procedure under /trpc/<procedure-name>. Reads the
  // session cookie in; hands procedures a way to set/clear it via Set-Cookie out.
  app.use(
    '/trpc/*',
    trpcServer({
      router: (deps.router ?? appRouter) as typeof appRouter,
      // Spec 2026-10-25 monitoring §2.4: only a fault — never a refusal, never the input.
      onError: ({ error, path, type }) => {
        if (error.code !== 'INTERNAL_SERVER_ERROR') return;
        void Promise.resolve(report(error.cause ?? error, { path: path ?? null, type })).catch(() => {});
      },
      createContext: async (_opts, c) => {
        const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
        return {
          db,
          session: await loadSession(db, sessionTokenFrom(c.req.header('cookie'))),
          clientIp: clientIpOf(c),
          setCookie: (name: string, value: string, { maxAge }: { maxAge: number }) =>
            c.header('Set-Cookie', `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`, { append: true }),
          clearCookie: (name: string) =>
            c.header('Set-Cookie', `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`, { append: true }),
        };
      },
    })
  );

  // Data export — CSV/JSON downloads of a run's rows, or of a whole project's.
  // Gated the same way as the tRPC context above: no session is 401, another
  // org's run or project is 404 (never revealing which of the two it was) —
  // and a run's snapshot, by session (`?snapshot=1`) or by a webhook's signed
  // link (no session).
  app.route(
    '/export',
    createExportRoutes({
      loadRunExport: loadExport,
      loadProjectExport: loadProject,
      loadSession: loadSessionForToken,
      orgIdForRun: loadRunOrgId,
      orgIdForProject: loadProjectOrgId,
      loadRunFile: loadSnapshot,
      webhookSecretForRun: loadWebhookSecret,
    })
  );

  // Static screenshots — served from packages/api-server/public/captures/.
  // Gated the same way `/export/*` is (see captures-gate.ts): no session is
  // 401, a file belonging to another org (or no capture at all) is 404, and
  // a filename that isn't a bare, safe segment is 400 before either check.
  // Path is computed relative to the compiled output's location.
  app.use(
    '/captures/*',
    createCaptureGate({ loadSession: loadSessionForToken, orgIdForCaptureFile: loadCaptureOrgId })
  );
  app.use(
    '/captures/*',
    serveStatic({
      root: join(__dirname, '..', 'public'),
    })
  );

  return app;
}
