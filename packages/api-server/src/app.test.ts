import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, users, runs } from '@robot/db';
import { deleteOwnOrg, signedInCaller } from '@robot/api/test-helpers/identity';
import { createProjectWithSource } from '@robot/api/test-helpers/customer-source';
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

// Final review I1, end to end against the real DB: the export routes load the
// session the same way the tRPC context does, so a real `robot_session`
// cookie from a real sign-in gates them exactly like everything else.
describe.skipIf(!process.env.DATABASE_URL)('export route session gating (real DB)', () => {
  it('is 401 signed out, 404 for another org, 200 in every format for the owning org', async () => {
    const app = createApp();
    const owner = await signedInCaller('export-gating-owner');
    const other = await signedInCaller('export-gating-other');
    const site = await createProjectWithSource(owner.caller, { tag: 'export-gating', fields: [{ name: 'Title', type: 'text' }] });
    const [run] = await db.insert(runs).values({ sourceId: site.sourceId, status: 'completed', completedAt: new Date() }).returning();
    const ownerCookie = { cookie: `robot_session=${owner.session.token}` };
    const otherCookie = { cookie: `robot_session=${other.session.token}` };

    try {
      for (const format of ['csv', 'json', 'xlsx'] as const) {
        const runPath = `/export/runs/${run!.id}.${format}`;
        const projectPath = `/export/projects/${site.projectId}.${format}`;

        const runNoSession = await app.fetch(new Request(`http://localhost${runPath}`));
        expect(runNoSession.status).toBe(401);
        const projectNoSession = await app.fetch(new Request(`http://localhost${projectPath}`));
        expect(projectNoSession.status).toBe(401);

        const runOtherOrg = await app.fetch(new Request(`http://localhost${runPath}`, { headers: otherCookie }));
        expect(runOtherOrg.status).toBe(404);
        const projectOtherOrg = await app.fetch(new Request(`http://localhost${projectPath}`, { headers: otherCookie }));
        expect(projectOtherOrg.status).toBe(404);

        const runOwnOrg = await app.fetch(new Request(`http://localhost${runPath}`, { headers: ownerCookie }));
        expect(runOwnOrg.status).toBe(200);
        const projectOwnOrg = await app.fetch(new Request(`http://localhost${projectPath}`, { headers: ownerCookie }));
        expect(projectOwnOrg.status).toBe(200);
      }
    } finally {
      await site.cleanup();
      await owner.cleanup();
      await other.cleanup();
    }
  });
});
