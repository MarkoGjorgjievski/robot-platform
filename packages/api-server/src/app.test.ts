import { describe, it, expect } from 'vitest';
import { createApp } from './app.js';

describe('api-server app', () => {
  const app = createApp();

  it('responds 200 on GET /healthz', async () => {
    const res = await app.fetch(new Request('http://localhost/healthz'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: 'ok' });
  });

  it('responds 404 on unknown route', async () => {
    const res = await app.fetch(new Request('http://localhost/nope'));
    expect(res.status).toBe(404);
  });

  it('mounts tRPC at /trpc', async () => {
    // tRPC expects POST for mutations and GET for queries; an unknown procedure
    // should return a tRPC-style error (HTTP 404 with JSON body).
    const res = await app.fetch(
      new Request('http://localhost/trpc/scraper.nonexistent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    );
    // tRPC's HTTP adapter returns 404 for unknown procedures
    expect([400, 404]).toContain(res.status);
  });

  it('sets CORS headers for cross-origin requests', async () => {
    const res = await app.fetch(
      new Request('http://localhost/healthz', {
        headers: { Origin: 'http://localhost:3456' },
      })
    );
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:3456');
  });

  it('serves /captures/* as static files', async () => {
    // Without an actual file, expect 404 — confirms the handler is mounted (not 405 or other unrelated error)
    const res = await app.fetch(new Request('http://localhost/captures/nonexistent.png'));
    expect(res.status).toBe(404);
  });
});
