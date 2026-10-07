// packages/api/src/routers/sources-drift.test.ts
// sources.checkDrift / sources.driftCheck (drift repair Task 2): the on-demand
// start and the latest check, both org-scoped.
import { describe, it, expect, vi, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, driftChecks, projects, runs, sources } from '@robot/db';
import { createProjectWithSource } from '../test-helpers/customer-source.js';
import { signedInCaller, signIn } from '../test-helpers/identity.js';

// The job itself is covered in run-drift-check.test.ts; here it is never fired (no browser, no network).
vi.mock('../verify/run-drift-check.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../verify/run-drift-check.js')>();
  return { ...real, startDriftCheck: (s: string, r: string | null, o: Parameters<typeof real.startDriftCheck>[2] = {}) => real.startDriftCheck(s, r, { ...o, fire: false }) };
});

const { DRIFT_CHECK_STALL_MS } = await import('../verify/run-drift-check.js');
// A throwaway signed-in identity: every customer procedure needs a session
// and works in its org only, so nothing here touches the seeded `default` org.
const me = await signedInCaller('sources-drift');
const caller = me.caller;
afterAll(async () => { await me.cleanup(); });

const dropIdentity = (r: { cleanup: () => Promise<void> }) => r.cleanup();

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

  it('I2: a running check older than 10 minutes reads back failed / stalled (closed on read); a younger one stays running', async () => {
    const f = await createProjectWithSource(caller, { tag: 'drift-router-stall', fields: [{ name: 'Price', type: 'money' }] });
    try {
      const [young] = await db.insert(driftChecks).values({ sourceId: f.sourceId, status: 'running', createdAt: new Date(Date.now() - 60_000) }).returning();
      expect(await caller.sources.driftCheck({ sourceId: f.sourceId })).toMatchObject({ id: young!.id, status: 'running' });

      await db.update(driftChecks).set({ createdAt: new Date(Date.now() - DRIFT_CHECK_STALL_MS - 1000) }).where(eq(driftChecks.id, young!.id));
      const latest = await caller.sources.driftCheck({ sourceId: f.sourceId });
      expect(latest).toMatchObject({ id: young!.id, status: 'failed', results: null });
      expect(latest!.completedAt).not.toBeNull();
      const row = (await db.query.driftChecks.findFirst({ where: eq(driftChecks.id, young!.id) }))!;
      expect(row).toMatchObject({ status: 'failed', error: 'stalled' });
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
