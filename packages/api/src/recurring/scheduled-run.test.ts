// Spec 2026-10-24 §3.2 "Starting": the scheduled-run job plans like crawl.plan, then starts the run — stubbed planner.
import { describe, it, expect, afterAll, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, emailMessages, runs } from '@robot/db';
import { signedInCaller } from '../test-helpers/identity.js';
import { createProjectWithSource } from '../test-helpers/customer-source.js';
import { jobRegistry } from '../jobs/handlers.js';
import { JOB_POLICIES, RUN_STOPPED } from '../jobs/types.js';
import type { CertifiedPath } from '@robot/scraper';
import { seedPassingVerification } from '../test-helpers/seed-coverage-check.js';
import type { planSource } from '../crawl/plan-source.js';
import type { startRunJob } from '../jobs/handlers/run.js';
import { NOT_CERTIFIED_RUN, NOTHING_PLANNED, runScheduledRun } from './scheduled-run.js';

const me = await signedInCaller('scheduled-run');
afterAll(async () => { await me.cleanup(); });

const planned = (status: 'planned' | 'failed', itemCount: number) => vi.fn(async (_db: unknown, _s: string, o: { runId?: string }) => ({
  runId: o.runId!, status, itemCount, listingPages: 0, warnings: [], errors: [], inputs: [], cacheWarm: true,
})) as unknown as typeof planSource & ReturnType<typeof vi.fn>;

const LD: CertifiedPath = { source: 'json-ld', path: 'offers.price', transform: 'identity' };

/** A website (certified unless told otherwise) with one scheduled run in `status`. */
async function withRun(status: string, errorMessage: string | null = null, opts: { certified?: boolean } = {}) {
  const urls = [1, 2, 3].map((n) => `https://test-scheduled-run.example.com/p/${n}`);
  const f = await createProjectWithSource(me.caller, {
    tag: 'scheduled-run', urls, fields: [{ name: 'Price', type: 'money' }],
    expected: { Price: Object.fromEntries(urls.map((u, i) => [u, `${i + 1}.00`])) },
  });
  if (opts.certified !== false) await seedPassingVerification(f.sourceId, { [f.keys.Price!]: [LD] });
  const [run] = await db.insert(runs).values({ sourceId: f.sourceId, status, inputLabel: 'scheduled', errorMessage }).returning({ id: runs.id });
  return { ...f, runId: run!.id };
}

describe('runScheduledRun', () => {
  it('plans at full limits on the run it was given, and starts the run when products were found', async () => {
    const f = await withRun('planning');
    try {
      const plan = planned('planned', 3);
      const start = vi.fn(async () => 'job-1') as unknown as typeof startRunJob & ReturnType<typeof vi.fn>;
      expect(await runScheduledRun({ sourceId: f.sourceId, runId: f.runId }, { plan, start })).toEqual({ started: true });
      expect(plan).toHaveBeenCalledWith(db, f.sourceId, { probe: false, runId: f.runId });
      expect(start).toHaveBeenCalledWith(db, { runId: f.runId });
    } finally { await f.cleanup(); }
  });
  it('a failed plan stays failed with its own reason; nothing starts', async () => {
    const f = await withRun('failed', 'The listing page could not be read.');
    try {
      const start = vi.fn() as unknown as typeof startRunJob & ReturnType<typeof vi.fn>;
      expect(await runScheduledRun({ sourceId: f.sourceId, runId: f.runId }, { plan: planned('failed', 0), start })).toEqual({ started: false });
      expect(start).not.toHaveBeenCalled();
      expect(await db.query.runs.findFirst({ where: eq(runs.id, f.runId), columns: { status: true, errorMessage: true } }))
        .toEqual({ status: 'failed', errorMessage: 'The listing page could not be read.' });
    } finally { await f.cleanup(); }
  });
  it('a plan that found no products is closed failed with a sentence, not left planned', async () => {
    const f = await withRun('planned');
    try {
      const start = vi.fn() as unknown as typeof startRunJob & ReturnType<typeof vi.fn>;
      expect(await runScheduledRun({ sourceId: f.sourceId, runId: f.runId }, { plan: planned('planned', 0), start })).toEqual({ started: false });
      expect(start).not.toHaveBeenCalled();
      expect(await db.query.runs.findFirst({ where: eq(runs.id, f.runId), columns: { status: true, errorMessage: true } }))
        .toEqual({ status: 'failed', errorMessage: NOTHING_PLANNED });
    } finally { await f.cleanup(); }
  });
  it('a start that throws after a good plan closes the run failed, never left planned (fix round 1)', async () => {
    const f = await withRun('planned');
    try {
      const start = vi.fn(async () => { throw new Error('connection reset'); }) as unknown as typeof startRunJob & ReturnType<typeof vi.fn>;
      await expect(runScheduledRun({ sourceId: f.sourceId, runId: f.runId }, { plan: planned('planned', 3), start })).rejects.toThrow('connection reset');
      expect(await db.query.runs.findFirst({ where: eq(runs.id, f.runId), columns: { status: true, errorMessage: true } }))
        .toEqual({ status: 'failed', errorMessage: RUN_STOPPED });
    } finally { await f.cleanup(); }
  });
  it('certification is checked again before the start: lost since the sweep, the run is closed failed (fix round 1)', async () => {
    const f = await withRun('planned', null, { certified: false });
    try {
      const start = vi.fn() as unknown as typeof startRunJob & ReturnType<typeof vi.fn>;
      expect(await runScheduledRun({ sourceId: f.sourceId, runId: f.runId }, { plan: planned('planned', 3), start })).toEqual({ started: false });
      expect(start).not.toHaveBeenCalled();
      expect(await db.query.runs.findFirst({ where: eq(runs.id, f.runId), columns: { status: true, errorMessage: true } }))
        .toEqual({ status: 'failed', errorMessage: NOT_CERTIFIED_RUN });
    } finally { await f.cleanup(); }
  });
  it('a scheduled run this job left failed emails its owners (spec 2026-10-24 email, Settled 6); a started one does not', async () => {
    const empty = await withRun('planned');
    const going = await withRun('planning');
    try {
      const start = vi.fn(async () => 'job-1') as unknown as typeof startRunJob & ReturnType<typeof vi.fn>;
      await runScheduledRun({ sourceId: empty.sourceId, runId: empty.runId }, { plan: planned('planned', 0), start });
      const [row] = await db.select().from(emailMessages).where(eq(emailMessages.dedupeKey, `run-failed:${empty.runId}:${me.user.id}`));
      expect(row).toMatchObject({ subject: 'A run of Site scheduled-run failed' });
      expect(row!.text).toContain(NOTHING_PLANNED);
      await runScheduledRun({ sourceId: going.sourceId, runId: going.runId }, { plan: planned('planned', 3), start });
      expect(await db.select().from(emailMessages).where(eq(emailMessages.dedupeKey, `run-failed:${going.runId}:${me.user.id}`))).toEqual([]);
    } finally { await empty.cleanup(); await going.cleanup(); }
  });
  it('the worker knows the job, with its policy and its run as the row it owns', () => {
    const def = jobRegistry()['scheduled-run']!;
    expect(def.policy).toBe(JOB_POLICIES['scheduled-run']);
    expect(def.subject?.({ sourceId: 's', runId: 'r' })).toEqual({ table: 'runs', id: 'r' });
  });
});

describe('a scheduled-run job that ends for good after the plan, before the start (final review M1)', () => {
  /** A scheduled-run job for `runId` on this file's queue, stamped on the run, the run already `planned`. */
  async function plannedWithJob(runId: string) {
    const { enqueue } = await import('../jobs/enqueue.js');
    const { jobs } = await import('@robot/db');
    const jobId = await enqueue(db, 'scheduled-run', { sourceId: '', runId }, { key: `scheduled-run:${runId}` });
    await db.update(runs).set({ status: 'planned', jobId }).where(eq(runs.id, runId));
    return { jobId, jobs };
  }

  it('failed for good: its planned run is closed failed with the run-stopped sentence', async () => {
    const { failJobTerminal } = await import('../jobs/queue.js');
    const f = await withRun('planning');
    try {
      const { jobId } = await plannedWithJob(f.runId);
      expect(await failJobTerminal(jobId, 'queued', { kind: 'unavailable', message: 'stalled' }, JOB_POLICIES['scheduled-run'].runSentence)).toBe(true);
      expect(await db.query.runs.findFirst({ where: eq(runs.id, f.runId), columns: { status: true, errorMessage: true } })).toEqual({ status: 'failed', errorMessage: RUN_STOPPED });
    } finally { await f.cleanup(); }
  });

  it('reaped (its worker died): the same', async () => {
    const { reapJobs, jobQueueName } = await import('../jobs/queue.js');
    const f = await withRun('planning');
    try {
      const { jobId, jobs } = await plannedWithJob(f.runId);
      await db.update(jobs).set({ status: 'running', attempts: 1, lockedBy: 'gone#00000000', lockedUntil: new Date(Date.now() - 60_000) }).where(eq(jobs.id, jobId));
      expect((await reapJobs(jobQueueName(), { retryBaseMs: 30_000 })).failed).toContain(jobId);
      expect(await db.query.runs.findFirst({ where: eq(runs.id, f.runId), columns: { status: true, errorMessage: true } })).toEqual({ status: 'failed', errorMessage: RUN_STOPPED });
    } finally { await f.cleanup(); }
  });

  it('a planned run another kind of job owns (a plan by hand, waiting to be started) is left planned', async () => {
    const { failJobTerminal } = await import('../jobs/queue.js');
    const { enqueue } = await import('../jobs/enqueue.js');
    const f = await withRun('planned');
    try {
      const jobId = await enqueue(db, 'plan', { sourceId: f.sourceId, runId: f.runId } as never, { key: `plan-test:${f.runId}` });
      await db.update(runs).set({ jobId }).where(eq(runs.id, f.runId));
      await failJobTerminal(jobId, 'queued', { kind: 'unavailable', message: 'expired' }, JOB_POLICIES.plan.runSentence);
      expect((await db.query.runs.findFirst({ where: eq(runs.id, f.runId), columns: { status: true } }))!.status).toBe('planned');
    } finally { await f.cleanup(); }
  });
});
