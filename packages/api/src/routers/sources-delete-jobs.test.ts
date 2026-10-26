// First run 2026-10-25 (ruling): deleting a website stops its jobs. Skullcandy's reachability check waited behind a
// coverage check of a website deleted minutes before, which held the only browser. Its queued jobs are failed at
// once; a running one is failed in the table, so the worker's lease renewal finds it gone, aborts it and closes its
// browsers — the existing lease mechanism — and its slot is free for the next job.
import { describe, it, expect, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, jobs, coverageChecks, driftChecks, captures, runs } from '@robot/db';
import { createProjectWithSource } from '../test-helpers/customer-source.js';
import { signedInCaller } from '../test-helpers/identity.js';
import { enqueue } from '../jobs/enqueue.js';
import { jobQueueName } from '../jobs/queue.js';
import { startJobRunner, type Registry } from '../jobs/runner.js';
import { JOB_POLICIES } from '../jobs/types.js';
import { cancelWebsiteJobs } from '../jobs/cancel.js';
import { JOB_TEST_MS } from '../test-helpers/jobs.js';

const me = await signedInCaller('src-delete-jobs');
afterAll(async () => { await me.cleanup(); });

const statusOf = async (id: string) => (await db.query.jobs.findFirst({ where: eq(jobs.id, id) }))!;
async function until(cond: () => Promise<boolean> | boolean, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await cond())) {
    if (Date.now() > end) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe('sources.delete stops the website\'s jobs', () => {
  it('a running coverage check for a deleted website stops and frees its slot; a queued one never starts', async () => {
    const f = await createProjectWithSource(me.caller, { tag: 'delete-jobs', fields: [] });
    const other = await createProjectWithSource(me.caller, { tag: 'delete-jobs-other', fields: [] });
    const started: string[] = [];
    let aborted = false;
    const registry: Registry = {
      'coverage-check': {
        policy: JOB_POLICIES['coverage-check'],
        run: async (p: { checkId: string }, ctx) => {
          started.push(p.checkId);
          if (p.checkId === otherCheck!.id) return { ok: true };
          // Works until it is stopped, as a check holding a browser would.
          await new Promise<void>((resolve) => ctx.signal.addEventListener('abort', () => { aborted = true; resolve(); }));
          return { ok: false };
        },
      },
      'website-check': { policy: JOB_POLICIES['website-check'], run: async (p: { sourceId: string }) => { started.push(`website:${p.sourceId}`); } },
    };
    const [running] = await db.insert(coverageChecks).values({ sourceId: f.sourceId }).returning();
    const [queued] = await db.insert(coverageChecks).values({ sourceId: f.sourceId }).returning();
    const [otherCheck] = await db.insert(coverageChecks).values({ sourceId: other.sourceId }).returning();
    const runningJob = await enqueue(db, 'coverage-check', { checkId: running!.id });
    const queuedJob = await enqueue(db, 'coverage-check', { checkId: queued!.id });
    const websiteJob = await enqueue(db, 'website-check', { sourceId: f.sourceId });
    const otherJob = await enqueue(db, 'coverage-check', { checkId: otherCheck!.id });
    // One background slot, the lease renewed every 250 ms.
    const runner = startJobRunner({
      queue: jobQueueName(), registry, lanes: { interactive: 0, background: 1, runs: 0 },
      leaseMs: 1000, pollMs: 25, reapEveryMs: 60_000, stuckCheckMs: 60_000, retryBaseMs: 10, log: () => {},
    });
    try {
      await until(() => started.length === 1);
      expect(started).toEqual([running!.id]);

      await me.caller.sources.delete({ sourceId: f.sourceId });

      // Queued and running alike are failed at once, in the table.
      for (const id of [runningJob, queuedJob, websiteJob]) {
        expect(await statusOf(id)).toMatchObject({ status: 'failed', lockedBy: null, error: expect.stringMatching(/website was deleted/) });
      }
      // The worker stops the running one and its slot takes the next job — the other website's.
      await until(async () => (await statusOf(otherJob)).status === 'done');
      expect(aborted).toBe(true);
      expect(started).toEqual([running!.id, otherCheck!.id]);
      await until(() => runner.active() === 0);
      // Nothing for the deleted website ever started after the delete, and its rows are gone.
      expect(await db.query.coverageChecks.findMany({ where: eq(coverageChecks.sourceId, f.sourceId) })).toEqual([]);
    } finally {
      await runner.stop(100);
      await f.cleanup();
      await other.cleanup();
    }
  }, JOB_TEST_MS);

  it('stops every kind of job that names the website: by its id, a check, a capture or a run; another website\'s are left', async () => {
    const f = await createProjectWithSource(me.caller, { tag: 'delete-jobs-kinds', fields: [] });
    const other = await createProjectWithSource(me.caller, { tag: 'delete-jobs-kinds-other', fields: [] });
    try {
      const [drift] = await db.insert(driftChecks).values({ sourceId: f.sourceId }).returning();
      const [capture] = await db.insert(captures).values({ sourceId: f.sourceId, url: 'https://test-delete-jobs-kinds.example.com/p/1' }).returning();
      const [run] = await db.insert(runs).values({ sourceId: f.sourceId }).returning();
      const mine = [
        await enqueue(db, 'verify', { sourceId: f.sourceId, verificationId: '00000000-0000-4000-8000-000000000001' }),
        await enqueue(db, 'drift-check', { checkId: drift!.id }),
        await enqueue(db, 'proof-page-capture', { captureId: capture!.id }),
        await enqueue(db, 'plan', { sourceId: f.sourceId, runId: run!.id, probe: false }),
        await enqueue(db, 'run', { runId: run!.id }),
        await enqueue(db, 'reachability', { url: 'https://test-delete-jobs-kinds.example.com/', sourceId: f.sourceId }),
      ];
      const theirs = await enqueue(db, 'website-check', { sourceId: other.sourceId });
      await me.caller.sources.delete({ sourceId: f.sourceId });
      for (const id of mine) expect((await statusOf(id)).status).toBe('failed');
      expect((await statusOf(theirs)).status).toBe('queued');
    } finally {
      await f.cleanup();
      await other.cleanup();
    }
  });

  it('deleting a project, or an organisation, stops the jobs of its websites too', async () => {
    const f = await createProjectWithSource(me.caller, { tag: 'delete-jobs-project', fields: [] });
    const other = await createProjectWithSource(me.caller, { tag: 'delete-jobs-project-other', fields: [] });
    try {
      const mine = await enqueue(db, 'website-check', { sourceId: f.sourceId });
      const theirs = await enqueue(db, 'website-check', { sourceId: other.sourceId });
      await me.caller.projects.delete({ projectId: f.projectId });
      expect((await statusOf(mine)).status).toBe('failed');
      expect((await statusOf(theirs)).status).toBe('queued');
      // The organisation's scope reaches the rest (orgs.delete calls it in its transaction).
      expect((await cancelWebsiteJobs(db, { orgId: me.session.org.id })).map((j) => j.id)).toEqual([theirs]);
      expect((await statusOf(theirs)).status).toBe('failed');
    } finally {
      await f.cleanup();
      await other.cleanup();
    }
  });
});
