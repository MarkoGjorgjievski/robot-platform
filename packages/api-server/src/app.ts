import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serveStatic } from '@hono/node-server/serve-static';
import { trpcServer } from '@hono/trpc-server';
import { appRouter } from '@robot/api/routers';
import { loadRunExport } from '@robot/api/export';
import { db } from '@robot/db';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createExportRoutes } from './routes/export.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

/** Collaborators a caller may override. Defaults are the production ones. */
export type AppDeps = {
  /** Injectable so export route tests run without Postgres. */
  loadRunExport: (runId: string) => ReturnType<typeof loadRunExport>;
};

export function createApp(deps: Partial<AppDeps> = {}) {
  const loadExport = deps.loadRunExport ?? ((runId: string) => loadRunExport(db, runId));
  const app = new Hono();

  // CORS — dashboard dev server runs on :3456
  app.use(
    '*',
    cors({
      origin: ['http://localhost:3456'],
      credentials: true,
    })
  );

  // Health check
  app.get('/healthz', (c) => c.json({ status: 'ok' }));

  // tRPC adapter — mounts every procedure under /trpc/<procedure-name>
  app.use(
    '/trpc/*',
    trpcServer({
      router: appRouter,
      createContext: () => ({ db }),
    })
  );

  // Data export — CSV/JSON downloads of a run's rows
  app.route('/export', createExportRoutes({ loadRunExport: loadExport }));

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
