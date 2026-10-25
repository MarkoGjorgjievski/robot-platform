// WORKER_HEALTH_PORT (spec 2026-10-25 monitoring §2.1): GET /healthz on 127.0.0.1 — 200 while the worker's job loop,
// heartbeat and lease renewal run, 503 while it stops (or when it cannot reach its database). Nothing else.
import { createServer } from 'node:http';

export type HealthServer = { port: number; close(): Promise<void> };

export async function startHealthServer(opts: { port: number; healthy: () => boolean; host?: string }): Promise<HealthServer> {
  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    if ((req.method !== 'GET' && req.method !== 'HEAD') || path !== '/healthz') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end('{"status":"not found"}');
      return;
    }
    let ok = false;
    try { ok = opts.healthy(); } catch { ok = false; }
    res.writeHead(ok ? 200 : 503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ status: ok ? 'ok' : 'unavailable' }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, opts.host ?? '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  const { port } = server.address() as { port: number };
  return { port, close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }) };
}
