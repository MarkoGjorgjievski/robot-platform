// Spec 2026-10-25 monitoring §2.1 "Liveness": WORKER_HEALTH_PORT's server.
import { describe, it, expect } from 'vitest';
import { startHealthServer } from './health.js';

describe('the worker health server', () => {
  it('GET /healthz: 200 while healthy, 503 when not (or when asking throws); 404 elsewhere', async () => {
    let ok = true;
    let throws = false;
    const h = await startHealthServer({ port: 0, healthy: () => { if (throws) throw new Error('x'); return ok; } });
    try {
      const at = (p: string) => fetch(`http://127.0.0.1:${h.port}${p}`);
      let res = await at('/healthz');
      expect([res.status, await res.json()]).toEqual([200, { status: 'ok' }]);
      expect(res.headers.get('cache-control')).toBe('no-store');
      ok = false;
      res = await at('/healthz?x=1');
      expect([res.status, await res.json()]).toEqual([503, { status: 'unavailable' }]);
      throws = true;
      expect((await at('/healthz')).status).toBe(503);
      expect((await at('/other')).status).toBe(404);
    } finally { await h.close(); }
  });

  it('a port in use is an error the caller can catch', async () => {
    const a = await startHealthServer({ port: 0, healthy: () => true });
    try { await expect(startHealthServer({ port: a.port, healthy: () => true })).rejects.toThrow(); } finally { await a.close(); }
  });
});
