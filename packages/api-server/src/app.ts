import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serveStatic } from '@hono/node-server/serve-static';
import { trpcServer } from '@hono/trpc-server';
import { appRouter } from '@robot/api/routers';
import { loadRunExport, loadProjectExport, orgIdForRun, orgIdForProject, orgIdForCaptureFile } from '@robot/api/export';
import { loadSession } from '@robot/api/auth';
import { db } from '@robot/db';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createExportRoutes } from './routes/export.js';
import { createCaptureGate } from './routes/captures-gate.js';
import { sessionTokenFrom } from './session-cookie.js';

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
};

export function createApp(deps: Partial<AppDeps> = {}) {
  const loadExport = deps.loadRunExport ?? ((runId: string) => loadRunExport(db, runId));
  const loadProject = deps.loadProjectExport ?? ((projectId: string) => loadProjectExport(db, projectId));
  const loadSessionForToken = deps.loadSession ?? ((token: string) => loadSession(db, token));
  const loadRunOrgId = deps.orgIdForRun ?? ((runId: string) => orgIdForRun(db, runId));
  const loadProjectOrgId = deps.orgIdForProject ?? ((projectId: string) => orgIdForProject(db, projectId));
  const loadCaptureOrgId = deps.orgIdForCaptureFile ?? ((filename: string) => orgIdForCaptureFile(db, filename));
  const app = new Hono();

  // CORS — the app shell (:3000)
  app.use(
    '*',
    cors({
      origin: ['http://localhost:3000'],
      credentials: true,
    })
  );

  // Health check
  app.get('/healthz', (c) => c.json({ status: 'ok' }));

  // tRPC adapter — mounts every procedure under /trpc/<procedure-name>. Reads the
  // session cookie in; hands procedures a way to set/clear it via Set-Cookie out.
  app.use(
    '/trpc/*',
    trpcServer({
      router: appRouter,
      createContext: async (_opts, c) => {
        const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
        return {
          db,
          session: await loadSession(db, sessionTokenFrom(c.req.header('cookie'))),
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
  // org's run or project is 404 (never revealing which of the two it was).
  app.route(
    '/export',
    createExportRoutes({
      loadRunExport: loadExport,
      loadProjectExport: loadProject,
      loadSession: loadSessionForToken,
      orgIdForRun: loadRunOrgId,
      orgIdForProject: loadProjectOrgId,
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
