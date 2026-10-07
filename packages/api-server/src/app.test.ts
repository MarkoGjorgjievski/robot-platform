import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, users } from '@robot/db';
import { deleteOwnOrg } from '@robot/api/test-helpers/identity';
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
      new Request('http://localhost/trpc/nonexistent.procedure', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    );
    // tRPC's HTTP adapter returns 404 for unknown procedures
    expect([400, 404]).toContain(res.status);
  });

  it('sets CORS headers for cross-origin requests', async () => {
    const res = await app.fetch(
      new Request('http://localhost/healthz', {
        headers: { Origin: 'http://localhost:3000' },
      })
    );
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
  });

  it('does not allow the old dashboard origin (:3456, deleted at cut-over)', async () => {
    const res = await app.fetch(
      new Request('http://localhost/healthz', {
        headers: { Origin: 'http://localhost:3456' },
      })
    );
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('serves /captures/* as static files', async () => {
    // Without an actual file, expect 404 — confirms the handler is mounted (not 405 or other unrelated error)
    const res = await app.fetch(new Request('http://localhost/captures/nonexistent.png'));
    expect(res.status).toBe(404);
  });
});

// Every sign-in below mints its own throwaway user and personal org, and the
// cleanups delete exactly those. `deleteOwnOrg` is the guard that makes a
// mistake here unrepresentable: it refuses to delete the org slugged
// `default`, whose delete would cascade every real project in the shared dev
// database. (An earlier sentinel user stood here to keep `users` non-empty,
// back when the first sign-in ever adopted `default`. Sign-in has not adopted
// anything since d187573 — adoption is `pnpm db:adopt-default` — so the
// sentinel guarded nothing and is gone.)
describe.skipIf(!process.env.DATABASE_URL)('session cookie', () => {
  const app = createApp();

  it('POST /trpc/auth.signIn sets an HttpOnly session cookie', async () => {
    const email = `cookie-signin-${Date.now()}@example.com`;
    const res = await app.fetch(
      new Request('http://localhost/trpc/auth.signIn', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ json: { email, password: 'whatever' } }),
      })
    );
    const setCookie = res.headers.get('set-cookie') ?? '';
    try {
      expect(setCookie).toContain('robot_session=');
      expect(setCookie).toContain('HttpOnly');
    } finally {
      const body = await res.json();
      await deleteOwnOrg(body.result.data.json.org.id);
      await db.delete(users).where(eq(users.id, body.result.data.json.user.id));
    }
  });

  it('GET /trpc/auth.me returns the user with the cookie, 401 without it', async () => {
    const email = `cookie-me-${Date.now()}@example.com`;
    const signInRes = await app.fetch(
      new Request('http://localhost/trpc/auth.signIn', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ json: { email, password: 'whatever' } }),
      })
    );
    const token = /robot_session=([^;]+)/.exec(signInRes.headers.get('set-cookie') ?? '')?.[1];
    const signInBody = await signInRes.json();
    const { user, org } = signInBody.result.data.json;
    try {
      const withCookie = await app.fetch(
        new Request('http://localhost/trpc/auth.me', { headers: { cookie: `robot_session=${token}` } })
      );
      expect(withCookie.status).toBe(200);
      const meBody = await withCookie.json();
      expect(meBody.result.data.json.user.email).toBe(email);

      const withoutCookie = await app.fetch(new Request('http://localhost/trpc/auth.me'));
      expect(withoutCookie.status).toBe(401);
    } finally {
      await deleteOwnOrg(org.id);
      await db.delete(users).where(eq(users.id, user.id));
    }
  });
});
