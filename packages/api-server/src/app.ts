import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serveStatic } from '@hono/node-server/serve-static';
import { trpcServer } from '@hono/trpc-server';
import { appRouter } from '@robot/api/routers';
import { loadRunExport, loadProjectExport } from '@robot/api/export';
import { loadSession, SESSION_COOKIE } from '@robot/api/auth';
import { db } from '@robot/db';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createExportRoutes } from './routes/export.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

/** `getCookie` from `hono/cookie` needs a Hono `Context`, which we have — but a tiny
 * regex is simpler than pulling in the helper for one cookie. */
function sessionTokenFrom(cookieHeader: string | undefined): string {
  return new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`).exec(cookieHeader ?? '')?.[1] ?? '';
}

/** Collaborators a caller may override. Defaults are the production ones. */
export type AppDeps = {
  /** Injectable so export route tests run without Postgres. */
  loadRunExport: (runId: string) => ReturnType<typeof loadRunExport>;
  loadProjectExport: (projectId: string) => ReturnType<typeof loadProjectExport>;
};

export function createApp(deps: Partial<AppDeps> = {}) {
  const loadExport = deps.loadRunExport ?? ((runId: string) => loadRunExport(db, runId));
  const loadProject = deps.loadProjectExport ?? ((projectId: string) => loadProjectExport(db, projectId));
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

  // Data export — CSV/JSON downloads of a run's rows, or of a whole project's
  app.route('/export', createExportRoutes({ loadRunExport: loadExport, loadProjectExport: loadProject }));

  // Static screenshots — served from packages/api-server/public/captures/
  // Path is computed relative to the compiled output's location.
  app.use(
    '/captures/*',
    serveStatic({
      root: join(__dirname, '..', 'public'),
    })
  );

  return app;
}
