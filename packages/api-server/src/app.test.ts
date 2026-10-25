import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, users, runs, captures, workers, jobs } from '@robot/db';
import { jobQueueName } from '@robot/api/jobs';
import { createLog } from '@robot/api/log';
import { deleteOwnOrg, signedInCaller } from '@robot/api/test-helpers/identity';
import { createProjectWithSource } from '@robot/api/test-helpers/customer-source';
import { RateLimiter, DEFAULT_LIMITS, useRateLimiter, RATE_LIMITED_MESSAGE } from '@robot/api/isolation/rate-limit';
import { initTRPC, TRPCError } from '@trpc/server';
import { createApp } from './app.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
/** `serveStatic`'s root in app.ts, hardcoded relative to the compiled output
 *  — not `CAPTURES_DIR` — so a real byte-serving test must write here too. */
const CAPTURES_PUBLIC_DIR = join(__dirname, '..', 'public', 'captures');

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

  // R4 (staff access, 2026-10-07): an isolated pair (:3100 -> :4100) runs beside
  // the dev servers, so the allowed origins come from APP_ORIGINS.
  it('allows the origins in APP_ORIGINS', async () => {
    const saved = process.env.APP_ORIGINS;
    process.env.APP_ORIGINS = 'http://localhost:3100, http://localhost:3000';
    try {
      const isolated = createApp();
      const res = await isolated.request('/healthz', { headers: { origin: 'http://localhost:3100' } });
      expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:3100');
      const other = await isolated.request('/healthz', { headers: { origin: 'http://localhost:3200' } });
      expect(other.headers.get('access-control-allow-origin')).toBeNull();
    } finally {
      if (saved === undefined) delete process.env.APP_ORIGINS;
      else process.env.APP_ORIGINS = saved;
    }
  });

  it('an empty APP_ORIGINS falls back to the default :3000', async () => {
    const saved = process.env.APP_ORIGINS;
    process.env.APP_ORIGINS = '  ';
    try {
      const res = await createApp().request('/healthz', { headers: { origin: 'http://localhost:3000' } });
      expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
    } finally {
      if (saved === undefined) delete process.env.APP_ORIGINS;
      else process.env.APP_ORIGINS = saved;
    }
  });

  it('does not allow the old dashboard origin (:3456, deleted at cut-over)', async () => {
    const res = await app.fetch(
      new Request('http://localhost/healthz', {
        headers: { Origin: 'http://localhost:3456' },
      })
    );
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  // Final security fix (2026-10-07): a capture file requires a session the
  // same way /export/* does, so an unauthenticated request never reaches the
  // filesystem at all — it 401s before `serveStatic` is ever asked to look.
  it('requires a session even for a nonexistent capture (never reaches the filesystem unauthenticated)', async () => {
    const res = await app.fetch(new Request('http://localhost/captures/nonexistent.png'));
    expect(res.status).toBe(401);
  });

  it('rejects a path-traversal filename with 400 before checking the session', async () => {
    const res = await app.fetch(new Request('http://localhost/captures/..%2f..%2fetc%2fpasswd'));
    expect(res.status).toBe(400);
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

// Security fix (2026-10-07): /captures/* is gated exactly like /export/* —
// no session is 401, another org's capture (or an unknown filename) is 404,
// a path-traversal filename is 400 before any lookup, and the owning org's
// session still gets the real bytes for both a full screenshot and a tile.
describe.skipIf(!process.env.DATABASE_URL)('captures route session gating (real DB)', () => {
  it('is 401 signed out, 404 for another org or an unknown file, 400 for traversal, 200 for the owning org (full shot + tile)', async () => {
    const app = createApp();
    const owner = await signedInCaller('captures-gating-owner');
    const other = await signedInCaller('captures-gating-other');
    const site = await createProjectWithSource(owner.caller, { tag: 'captures-gating', fields: [{ name: 'Title', type: 'text' }] });

    const fullName = `app-test-full-${Date.now()}.png`;
    const tileName = `app-test-tile-${Date.now()}.png`;
    const now = new Date().toISOString();
    await db.insert(captures).values([
      { sourceId: site.sourceId, url: site.urls[0]!, screenshotPath: `/captures/${fullName}`, metadata: { kind: 'verification' } },
      {
        sourceId: site.sourceId, url: site.urls[1]!, screenshotPath: `/captures/${tileName}`,
        metadata: { kind: 'proof-page', status: 'captured', url: site.urls[1]!, startedAt: now, capturedAt: now, tiles: [`/captures/${tileName}`], boxes: [], pageHeight: 10, capturedHeight: 10, contentHeight: 10 },
      },
    ]);

    await mkdir(CAPTURES_PUBLIC_DIR, { recursive: true });
    await writeFile(join(CAPTURES_PUBLIC_DIR, fullName), Buffer.from('full-png-bytes'));
    await writeFile(join(CAPTURES_PUBLIC_DIR, tileName), Buffer.from('tile-png-bytes'));

    const ownerCookie = { cookie: `robot_session=${owner.session.token}` };
    const otherCookie = { cookie: `robot_session=${other.session.token}` };

    try {
      for (const name of [fullName, tileName]) {
        const path = `/captures/${name}`;
        const noSession = await app.fetch(new Request(`http://localhost${path}`));
        expect(noSession.status).toBe(401);

        const otherOrg = await app.fetch(new Request(`http://localhost${path}`, { headers: otherCookie }));
        expect(otherOrg.status).toBe(404);

        const ownOrg = await app.fetch(new Request(`http://localhost${path}`, { headers: ownerCookie }));
        expect(ownOrg.status).toBe(200);
      }

      const unknown = await app.fetch(new Request('http://localhost/captures/does-not-exist.png', { headers: ownerCookie }));
      expect(unknown.status).toBe(404);

      const traversal = await app.fetch(new Request('http://localhost/captures/..%2f..%2fetc%2fpasswd', { headers: ownerCookie }));
      expect(traversal.status).toBe(400);
    } finally {
      await rm(join(CAPTURES_PUBLIC_DIR, fullName), { force: true });
      await rm(join(CAPTURES_PUBLIC_DIR, tileName), { force: true });
      await site.cleanup();
      await owner.cleanup();
      await other.cleanup();
    }
  });
});

// Rate limits over HTTP (spec 2026-10-24 tenant isolation §2.4): the client address reaches the limiter, a refusal is
// a 429 with the customer sentence, and X-Forwarded-For counts only behind a trusted proxy. An invalid email is
// refused by the input check after the limiter counted it, so nothing is written.
describe('rate limits over HTTP', () => {
  const saved = { RATE_LIMITS: process.env.RATE_LIMITS, TRUST_PROXY: process.env.TRUST_PROXY };
  let previous: RateLimiter;
  beforeEach(() => { process.env.RATE_LIMITS = 'on'; previous = useRateLimiter(new RateLimiter({ limits: { ...DEFAULT_LIMITS, signInIp: 2 } })); });
  afterEach(() => {
    useRateLimiter(previous);
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });
  const signInFrom = (remoteAddress: string, email: string, headers: Record<string, string> = {}) =>
    createApp().request('/trpc/auth.signIn', {
      method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ json: { email, password: 'x' } }),
    }, { incoming: { socket: { remoteAddress } } } as never);

  it('the third sign-in from one address is a 429 with the sentence', async () => {
    expect((await signInFrom('10.9.0.1', 'a')).status).toBe(400);
    expect((await signInFrom('10.9.0.1', 'b')).status).toBe(400);
    const third = await signInFrom('10.9.0.1', 'c');
    expect(third.status).toBe(429);
    expect((await third.json()).error.json.message).toBe(RATE_LIMITED_MESSAGE);
    expect((await signInFrom('10.9.0.2', 'd')).status).toBe(400);
  });

  it('RF2: a rotated X-Forwarded-For does not reset the sign-in limit; behind a proxy the last entry counts', async () => {
    delete process.env.TRUST_PROXY;
    expect((await signInFrom('10.9.1.1', 'a', { 'x-forwarded-for': '1.1.1.1' })).status).toBe(400);
    expect((await signInFrom('10.9.1.1', 'b', { 'x-forwarded-for': '2.2.2.2' })).status).toBe(400);
    expect((await signInFrom('10.9.1.1', 'c', { 'x-forwarded-for': '3.3.3.3' })).status).toBe(429);

    process.env.TRUST_PROXY = 'on';
    // Behind the proxy (one socket), each client is its own address…
    for (const [n, client] of ['198.51.100.1', '198.51.100.2', '198.51.100.3'].entries()) {
      expect((await signInFrom('10.9.2.1', `e${n}`, { 'x-forwarded-for': client })).status).toBe(400);
    }
    // …and what a client writes first is ignored: the proxy's last entry is the one counted.
    expect((await signInFrom('10.9.2.1', 'f', { 'x-forwarded-for': '7.7.7.1, 198.51.100.9' })).status).toBe(400);
    expect((await signInFrom('10.9.2.1', 'g', { 'x-forwarded-for': '7.7.7.2, 198.51.100.9' })).status).toBe(400);
    expect((await signInFrom('10.9.2.1', 'h', { 'x-forwarded-for': '7.7.7.3, 198.51.100.9' })).status).toBe(429);
  });
});

describe('errors (spec 2026-10-25 monitoring §2.4)', () => {
  it('a route that throws answers 500 with no detail, and is reported once with its method and path only', async () => {
    const seen: Array<[unknown, Record<string, unknown>]> = [];
    const app = createApp({ reportError: (err, ctx) => { seen.push([err, ctx]); } });
    app.get('/boom', () => { throw new Error('boom at http://u:route-secret@db.test:5432'); });
    const res = await app.request('/boom?token=abc');
    expect(res.status).toBe(500);
    expect(await res.text()).toBe('{"error":"Internal error"}');
    expect(seen).toHaveLength(1);
    expect((seen[0]![0] as Error).message).toContain('boom');
    expect(seen[0]![1]).toEqual({ method: 'GET', path: '/boom' });
  });

  it('tRPC reports INTERNAL_SERVER_ERROR with its path and type, never its input; a refusal is not reported', async () => {
    const t = initTRPC.create();
    const router = t.router({
      broken: t.procedure.query(() => { throw new Error('db exploded'); }),
      refused: t.procedure.query(() => { throw new TRPCError({ code: 'FORBIDDEN', message: 'no' }); }),
    });
    const seen: Array<[unknown, Record<string, unknown>]> = [];
    const app = createApp({ router, reportError: (err, ctx) => { seen.push([err, ctx]); } });
    expect((await app.request('/trpc/broken?input=%7B%22password%22%3A%22x%22%7D')).status).toBe(500);
    expect((await app.request('/trpc/refused')).status).toBe(403);
    expect(seen).toHaveLength(1);
    expect((seen[0]![0] as Error).message).toBe('db exploded');
    expect(seen[0]![1]).toEqual({ path: 'broken', type: 'query' });
  });
});

describe('/readyz (spec 2026-10-25 monitoring §2.1, §2.6)', () => {
  afterEach(async () => {
    await db.delete(workers).where(eq(workers.queue, jobQueueName()));
    await db.delete(jobs).where(eq(jobs.queue, jobQueueName()));
  });
  const allOk = { db: true, migrations: true, worker: true, queue: true };

  it('503 naming each check when no worker beats on this queue; no-store', async () => {
    const res = await createApp().request('/readyz');
    expect(res.status).toBe(503);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ status: 'unavailable', checks: { db: true, migrations: true, worker: false, queue: true } });
  });

  it('200 once a worker beats; 503 (queue) with a job nobody takes', async () => {
    await db.insert(workers).values({ id: `readyz:${jobQueueName()}`, queue: jobQueueName(), startedAt: new Date() });
    const ok = await createApp().request('/readyz');
    expect([ok.status, await ok.json()]).toEqual([200, { status: 'ok', checks: allOk }]);
    await db.insert(jobs).values({ queue: jobQueueName(), type: 'verify', runAfter: sql`now() - interval '11 minutes'` });
    const late = await createApp().request('/readyz');
    expect([late.status, await late.json()]).toEqual([503, { status: 'unavailable', checks: { ...allOk, queue: false } }]);
  });

  it('a readiness that throws: 503 with every check false, and the answer names no host, id or error', async () => {
    const res = await createApp({ readiness: async () => { throw new Error('connect ECONNREFUSED 10.0.0.5:5432'); } }).request('/readyz');
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ status: 'unavailable', checks: { db: false, migrations: false, worker: false, queue: false } });
    expect(text).not.toMatch(/10\.0\.0\.5|ECONNREFUSED/);
  });

  it('/healthz stays liveness: 200 whatever readiness says', async () => {
    const res = await createApp({ readiness: async () => { throw new Error('down'); } }).request('/healthz');
    expect([res.status, await res.json()]).toEqual([200, { status: 'ok' }]);
  });
});

describe('the request log (spec 2026-10-25 monitoring §2.2)', () => {
  const capture = () => {
    const lines: Array<Record<string, unknown>> = [];
    return { lines, log: createLog('api-server', { env: { LOG_FORMAT: 'json', LOG_LEVEL: 'debug' }, sink: (line) => lines.push(JSON.parse(line)) }) };
  };
  const ready = async () => ({ ok: true, checks: { db: true, migrations: true, worker: true, queue: true } });

  it('method, path without the query, status, duration and client IP at info; /healthz and /readyz at debug', async () => {
    const { lines, log } = capture();
    const app = createApp({ log, readiness: ready });
    await app.request('/nope?token=q-secret&x=1');
    await app.request('/healthz?probe=1');
    await app.request('/readyz');
    expect(lines.map((l) => [l.level, l.method, l.path, l.status])).toEqual([['info', 'GET', '/nope', 404], ['debug', 'GET', '/healthz', 200], ['debug', 'GET', '/readyz', 200]]);
    expect(lines[0]).toMatchObject({ scope: 'api-server', ip: 'unknown', msg: expect.stringMatching(/^GET \/nope 404 \d+ ms$/) });
    expect(typeof lines[0]!.ms).toBe('number');
    expect(JSON.stringify(lines)).not.toContain('q-secret');
  });

  it('a tRPC call is logged by its path only — never its input or the session cookie', async () => {
    const { lines, log } = capture();
    await createApp({ log, readiness: ready }).request('/trpc/auth.me?input=%7B%22password%22%3A%22in-secret%22%7D', { headers: { cookie: 'robot_session=cookie-secret' } });
    expect(lines[0]).toMatchObject({ method: 'GET', path: '/trpc/auth.me' });
    expect(JSON.stringify(lines)).not.toMatch(/in-secret|cookie-secret/);
  });

  it('the IP is the last X-Forwarded-For entry only with TRUST_PROXY=on', async () => {
    const saved = process.env.TRUST_PROXY;
    try {
      const { lines, log } = capture();
      process.env.TRUST_PROXY = 'on';
      await createApp({ log, readiness: ready }).request('/nope', { headers: { 'x-forwarded-for': '198.51.100.1, 203.0.113.9' } });
      process.env.TRUST_PROXY = '';
      await createApp({ log, readiness: ready }).request('/nope', { headers: { 'x-forwarded-for': '203.0.113.9' } });
      expect(lines.map((l) => l.ip)).toEqual(['203.0.113.9', 'unknown']);
    } finally {
      if (saved === undefined) delete process.env.TRUST_PROXY; else process.env.TRUST_PROXY = saved;
    }
  });
});
