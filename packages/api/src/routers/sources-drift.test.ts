// packages/api/src/routers/sources-drift.test.ts
// sources.checkDrift / sources.driftCheck (drift repair Task 2): the on-demand
// start and the latest check, both org-scoped.
import { describe, it, expect, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, driftChecks, projects, runs, sources, users } from '@robot/db';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from './index.js';
import { createProjectWithSource } from '../test-helpers/customer-source.js';
import { loadSession } from '../auth/session.js';
import { deleteOwnOrg } from '../test-helpers/identity.js';

// The job itself is covered in run-drift-check.test.ts; here it is never fired (no browser, no network).
vi.mock('../verify/run-drift-check.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../verify/run-drift-check.js')>();
  return { ...real, startDriftCheck: (s: string, r: string | null, o: Parameters<typeof real.startDriftCheck>[2] = {}) => real.startDriftCheck(s, r, { ...o, fire: false }) };
});

const caller = createCallerFactory(appRouter)({ db, session: null });

async function signIn(email: string) {
  const cookies: Record<string, string | null> = {};
  const c = createCallerFactory(appRouter)({ db, session: null, setCookie: (n, v) => { cookies[n] = v; }, clearCookie: () => {} });
  const r = await c.auth.signIn({ email, password: 'x' });
  const session = (await loadSession(db, cookies['robot_session']!))!;
  return { ...r, session, caller: createCallerFactory(appRouter)({ db, session }) };
}

async function dropIdentity(r: { org: { id: string }; user: { id: string } }) {
  await db.delete(projects).where(eq(projects.orgId, r.org.id));
  await deleteOwnOrg(r.org.id);
  await db.delete(users).where(eq(users.id, r.user.id));
}

describe('sources.checkDrift / sources.driftCheck', () => {
  it('null before any check; a start names the run that flagged the drift; the latest check comes back with that run\'s date', async () => {
    const f = await createProjectWithSource(caller, { tag: 'drift-router', fields: [{ name: 'Price', type: 'money' }] });
    try {
      expect(await caller.sources.driftCheck({ sourceId: f.sourceId })).toBeNull();

      const completedAt = new Date('2026-09-26T10:00:00Z');
      const [flagged] = await db.insert(runs).values({ sourceId: f.sourceId, status: 'completed', completedAt, driftedFields: ['price'], createdAt: new Date(Date.now() - 60_000) }).returning();
      await db.insert(runs).values({ sourceId: f.sourceId, status: 'completed', completedAt: new Date(), driftedFields: [] });
      await db.update(sources).set({ driftedFields: ['price'] }).where(eq(sources.id, f.sourceId));

      const started = await caller.sources.checkDrift({ sourceId: f.sourceId });
      expect(started.status).toBe('started');
      expect(await caller.sources.checkDrift({ sourceId: f.sourceId })).toEqual({ checkId: started.checkId, status: 'in-progress' });

      const latest = await caller.sources.driftCheck({ sourceId: f.sourceId });
      expect(latest).toMatchObject({ id: started.checkId, status: 'running', completedAt: null, runAt: completedAt });
      expect((await db.query.driftChecks.findFirst({ where: eq(driftChecks.id, started.checkId) }))!.runId).toBe(flagged!.id);
    } finally { await f.cleanup(); }
  });

  it('runAt is null for a check with no run', async () => {
    const f = await createProjectWithSource(caller, { tag: 'drift-router-norun', fields: [{ name: 'Price', type: 'money' }] });
    try {
      await db.insert(driftChecks).values({ sourceId: f.sourceId, status: 'done', results: { runId: null, fields: {} }, completedAt: new Date() });
      expect(await caller.sources.driftCheck({ sourceId: f.sourceId })).toMatchObject({ status: 'done', results: { runId: null, fields: {} }, runAt: null });
    } finally { await f.cleanup(); }
  });

  it('another org gets NOT_FOUND from both', async () => {
    let a: Awaited<ReturnType<typeof signIn>> | undefined;
    let b: Awaited<ReturnType<typeof signIn>> | undefined;
    try {
      a = await signIn(`drift-a-${Date.now()}@example.com`);
      b = await signIn(`drift-b-${Date.now()}@example.com`);
      const p = await a.caller.projects.create({ name: 'Mine' });
      await a.caller.datasets.addField({ datasetId: p.datasetId, name: 'Price', type: 'money' });
      const s = await a.caller.sources.createInProject({ projectSlug: p.slug, name: 'Site', url: 'https://drift-org.example/p/1' });

      const nf = { code: 'NOT_FOUND' };
      await expect(b.caller.sources.checkDrift({ sourceId: s.sourceId })).rejects.toMatchObject(nf);
      await expect(b.caller.sources.driftCheck({ sourceId: s.sourceId })).rejects.toMatchObject(nf);
      expect(await db.query.driftChecks.findFirst({ where: eq(driftChecks.sourceId, s.sourceId) })).toBeUndefined();
      // Their own org may.
      expect(await a.caller.sources.driftCheck({ sourceId: s.sourceId })).toBeNull();
    } finally {
      if (a) await dropIdentity(a);
      if (b) await dropIdentity(b);
    }
  });
});
