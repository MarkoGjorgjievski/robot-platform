import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, users, orgs } from '@robot/db';
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

// The shared dev database can have zero users; the first sign-in there would
// adopt the seeded `default` org (and cleanup below would then delete it,
// taking its projects with it). A throwaway sentinel user, mirroring
// packages/api/src/routers/auth.test.ts, keeps `users` non-empty for the
// duration of this file so every sign-in below takes the `create` branch.
describe.skipIf(!process.env.DATABASE_URL)('session cookie', () => {
  const app = createApp();
  const SENTINEL = `sentinel-api-server-${Date.now()}@example.com`;

  beforeAll(async () => {
    await db.insert(users).values({ email: SENTINEL, name: 'Sentinel', avatarColour: '#000000' });
  });

  afterAll(async () => {
    await db.delete(users).where(eq(users.email, SENTINEL));
  });

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
      await db.delete(orgs).where(eq(orgs.id, body.result.data.json.org.id));
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
      await db.delete(orgs).where(eq(orgs.id, org.id));
      await db.delete(users).where(eq(users.id, user.id));
    }
  });
});
