import { describe, it, expect, afterEach } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { CaptureProblemError } from '@robot/scraper';
import { db, jobs, sourceVerifications, runs } from '@robot/db';
import { createTestSource, deleteTestSource } from '../test-helpers/source.js';
import {
  enqueueJob, claimJob, renewLease, completeJob, retryJob, failJobTerminal, releaseJob, reapJobs,
  purgeJobs, liveJobIds, isJobLive, awaitJob, jobQueueName,
} from './queue.js';
import { JobUnavailableError, serializeError } from './errors.js';
import { JOB_TEST_MS } from '../test-helpers/jobs.js';
import { RUN_STOPPED } from './types.js';

const W = 'test-worker:1';
const q = () => jobQueueName();
const get = async (id: string) => (await db.query.jobs.findFirst({ where: eq(jobs.id, id) }))!;
/** The last claim's owner (its lock: the worker id and a token of that claim). */
let O = '';
const claim = async (types = ['t'], leaseMs = 60_000) => {
  const job = await claimJob({ queue: q(), workerId: W, types, leaseMs });
  if (job) O = job.lockedBy!;
  return job;
};
const reapOpts = { retryBaseMs: 1000 };

afterEach(async () => { await db.delete(jobs).where(eq(jobs.queue, q())); });

describe('enqueueJob', () => {
  it('one queued or running job per key: a second enqueue returns the first', async () => {
    const a = await enqueueJob(db, { type: 't', payload: { n: 1 }, key: 'k' });
    expect(a.created).toBe(true);
    expect(await enqueueJob(db, { type: 't', payload: { n: 2 }, key: 'k' })).toEqual({ id: a.id, created: false });
    await db.update(jobs).set({ status: 'done' }).where(eq(jobs.id, a.id));
    expect((await enqueueJob(db, { type: 't', payload: {}, key: 'k' })).created).toBe(true);
  }, JOB_TEST_MS);

  it('its delay and start window are reckoned on the database clock, from the moment it is written', async () => {
    const { id } = await enqueueJob(db, { type: 't', payload: {}, delayMs: 5000, startWithinMs: 60_000 });
    const plain = await enqueueJob(db, { type: 't', payload: {} });
    const [row] = (await db.execute(sql`SELECT extract(epoch FROM run_after - created_at) * 1000 AS delay,
      extract(epoch FROM expires_at - run_after) * 1000 AS window FROM jobs WHERE id = ${id}`)) as unknown as Array<{ delay: string; window: string }>;
    expect([Number(row!.delay), Number(row!.window)]).toEqual([5000, 60_000]);
    expect(await get(plain.id)).toMatchObject({ expiresAt: null });
    expect((await get(plain.id)).runAfter.getTime()).toBe((await get(plain.id)).createdAt.getTime());
  }, JOB_TEST_MS);

  it('two enqueues of one key at once make one job', async () => {
    const [a, b] = await Promise.all([
      db.transaction((tx) => enqueueJob(tx, { type: 't', payload: { n: 1 }, key: 'same' })),
      db.transaction((tx) => enqueueJob(tx, { type: 't', payload: { n: 2 }, key: 'same' })),
    ]);
    expect(a!.id).toBe(b!.id);
    expect([a!.created, b!.created].sort()).toEqual([false, true]);
    expect(await db.query.jobs.findMany({ where: eq(jobs.queue, q()) })).toHaveLength(1);
  }, JOB_TEST_MS);

  it('inside a transaction that rolls back, leaves no job', async () => {
    await expect(db.transaction(async (tx) => {
      await enqueueJob(tx, { type: 't', payload: {} });
      throw new Error('rollback');
    })).rejects.toThrow('rollback');
    expect(await db.query.jobs.findMany({ where: eq(jobs.queue, q()) })).toEqual([]);
  }, JOB_TEST_MS);
});

describe('claimJob', () => {
  it('lowest priority first, then the oldest; only the listed types; not before run_after; never an expired one', async () => {
    const late = await enqueueJob(db, { type: 't', payload: {}, priority: 10 });
    const urgent = await enqueueJob(db, { type: 't', payload: {}, priority: 0 });
    await enqueueJob(db, { type: 'other', payload: {}, priority: 0 });
    await enqueueJob(db, { type: 't', payload: {}, priority: 0, delayMs: 60_000 });
    await enqueueJob(db, { type: 't', payload: {}, priority: 0, startWithinMs: -1000 });
    expect((await claim())!.id).toBe(urgent.id);
    expect((await claim())!.id).toBe(late.id);
    expect(await claim()).toBeNull();
  }, JOB_TEST_MS);

  it('claimers at once each get a different job', async () => {
    for (let i = 0; i < 6; i++) await enqueueJob(db, { type: 't', payload: { i } });
    // A claimer racing others may come back empty-handed while jobs remain (a row it found taken is skipped
    // under LIMIT 1); the worker just polls again. What must hold: no job is ever claimed twice, and rounds
    // of racing claimers take every job.
    const ids: string[] = [];
    for (let round = 0; round < 10 && ids.length < 6; round++) {
      const got = await Promise.all(Array.from({ length: 8 }, (_, i) => claimJob({ queue: q(), workerId: `w${i}`, types: ['t'], leaseMs: 60_000 })));
      ids.push(...got.filter((j) => j !== null).map((j) => j!.id));
    }
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);
  }, JOB_TEST_MS);

  it('a claim takes exactly one job, however many claim at once: none is left running that no claim returned', async () => {
    for (let round = 0; round < 15; round++) {
      for (let i = 0; i < 6; i++) await enqueueJob(db, { type: 't', payload: { i } });
      const got = await Promise.all(Array.from({ length: 6 }, (_, i) => claimJob({ queue: q(), workerId: `w${i}`, types: ['t'], leaseMs: 60_000 })));
      const returned = got.filter((j) => j !== null).length;
      const running = (await db.query.jobs.findMany({ where: eq(jobs.queue, q()) })).filter((j) => j.status === 'running').length;
      expect(running).toBe(returned);
      await db.delete(jobs).where(eq(jobs.queue, q()));
    }
  }, JOB_TEST_MS);

  it('never claims another queue', async () => {
    const other = `${q()}-other`;
    await enqueueJob(db, { type: 't', payload: {}, queue: other });
    try { expect(await claim()).toBeNull(); } finally { await db.delete(jobs).where(eq(jobs.queue, other)); }
  }, JOB_TEST_MS);

  it('marks the job running with its owner, a lease and one more attempt', async () => {
    const { id } = await enqueueJob(db, { type: 't', payload: { x: 1 }, maxAttempts: 2 });
    const job = (await claim())!;
    expect(job).toMatchObject({ id, status: 'running', attempts: 1, maxAttempts: 2, lockedBy: expect.stringMatching(/^test-worker:1#[0-9a-f]{8}$/), payload: { x: 1 } });
    expect(job.lockedUntil!.getTime()).toBeGreaterThan(Date.now() + 50_000);
  }, JOB_TEST_MS);
});

describe('the lease', () => {
  it('belongs to one claim: a write of an earlier claim of the same worker does nothing', async () => {
    const { id } = await enqueueJob(db, { type: 't', payload: {}, maxAttempts: 2 });
    await claim();
    const first = O;
    await releaseJob(id, first);
    await claim();
    expect(O).not.toBe(first);
    expect(await renewLease(id, first, 60_000)).toBe(false);
    expect(await completeJob(id, first, 'stale')).toBe(false);
    expect(await retryJob(id, first, 'stale', 1)).toBe(false);
    expect(await failJobTerminal(id, { owner: first }, { kind: 'error', message: 'stale' }, RUN_STOPPED)).toBe(false);
    await releaseJob(id, first);
    expect(await get(id)).toMatchObject({ status: 'running', lockedBy: O });
    expect(await completeJob(id, O, 'fresh')).toBe(true);
  }, JOB_TEST_MS);

  it('renews for its owner only; completes for its owner only', async () => {
    const { id } = await enqueueJob(db, { type: 't', payload: {} });
    await claim();
    expect(await renewLease(id, O, 60_000)).toBe(true);
    expect(await renewLease(id, 'someone-else', 60_000)).toBe(false);
    expect(await completeJob(id, 'someone-else', 1)).toBe(false);
    expect(await completeJob(id, O, { ok: true })).toBe(true);
    expect(await get(id)).toMatchObject({ status: 'done', result: { value: { ok: true } }, lockedBy: null });
    expect(await renewLease(id, O, 60_000)).toBe(false);
  }, JOB_TEST_MS);
});

describe('failures', () => {
  it('a retry puts the job back, later, with its error', async () => {
    const { id } = await enqueueJob(db, { type: 't', payload: {}, maxAttempts: 2 });
    await claim();
    expect(await retryJob(id, O, 'boom', 30_000)).toBe(true);
    const row = await get(id);
    expect(row).toMatchObject({ status: 'queued', error: 'boom', lockedBy: null, attempts: 1 });
    expect(row.runAfter.getTime()).toBeGreaterThan(Date.now() + 20_000);
  }, JOB_TEST_MS);

  it('a terminal failure stores the error and closes every row the job owns, in one go', async () => {
    const sourceId = await createTestSource({ schema: [] });
    try {
      const { id } = await enqueueJob(db, { type: 't', payload: {} });
      const [v] = await db.insert(sourceVerifications).values({ sourceId, definitionHash: 'h', jobId: id }).returning();
      const [r] = await db.insert(runs).values({ sourceId, status: 'extracting', jobId: id }).returning();
      await claim();
      expect(await failJobTerminal(id, { owner: O }, serializeError(new Error('nope')), RUN_STOPPED)).toBe(true);
      expect(await get(id)).toMatchObject({ status: 'failed', error: 'nope', result: { error: { kind: 'error', message: 'nope' } } });
      expect(await db.query.sourceVerifications.findFirst({ where: eq(sourceVerifications.id, v!.id) })).toMatchObject({ errorMessage: 'stalled' });
      expect((await db.query.sourceVerifications.findFirst({ where: eq(sourceVerifications.id, v!.id) }))!.completedAt).not.toBeNull();
      expect(await db.query.runs.findFirst({ where: eq(runs.id, r!.id) })).toMatchObject({ status: 'failed', errorMessage: RUN_STOPPED });
    } finally { await deleteTestSource(sourceId); }
  }, JOB_TEST_MS);

  it('release gives the job back without spending its attempt', async () => {
    const { id } = await enqueueJob(db, { type: 't', payload: {}, maxAttempts: 2 });
    await claim();
    await releaseJob(id, O);
    expect(await get(id)).toMatchObject({ status: 'queued', attempts: 0, lockedBy: null });
  }, JOB_TEST_MS);
});

describe('the start window', () => {
  // Spec §4.2: "must start within" is a window for the start, not for the work. A job given back
  // (shutdown) or whose worker died has started; it gets its window again from when it is due.
  const startedThenLate = async (leaseMs: number) => {
    const { id } = await enqueueJob(db, { type: 't', payload: {}, maxAttempts: 2, startWithinMs: 400 });
    expect((await claim(['t'], leaseMs))!.id).toBe(id);
    await new Promise((r) => setTimeout(r, 450));          // the window the job was enqueued with has passed
    return id;
  };

  it('a job given back at shutdown is still claimable after its first window, never expired', async () => {
    const id = await startedThenLate(60_000);
    await releaseJob(id, O);
    expect(await reapJobs(q(), reapOpts)).toEqual({ retried: [], failed: [], expired: [] });
    expect(await isJobLive(db, id)).toBe(true);
    expect((await claim())!.id).toBe(id);
  }, JOB_TEST_MS);

  it('a job whose worker died is retried after its first window, never expired', async () => {
    const id = await startedThenLate(1);
    expect(await reapJobs(q(), { ...reapOpts, retryBaseMs: 1 })).toEqual({ retried: [id], failed: [], expired: [] });
    await new Promise((r) => setTimeout(r, 20));
    expect(await reapJobs(q(), reapOpts)).toEqual({ retried: [], failed: [], expired: [] });
    expect((await claim())!.id).toBe(id);
  }, JOB_TEST_MS);

  it('a job given back still has a window: with no worker it expires a window after it was due', async () => {
    const id = await startedThenLate(60_000);
    await releaseJob(id, O);
    await new Promise((r) => setTimeout(r, 500));
    expect(await reapJobs(q(), reapOpts)).toEqual({ retried: [], failed: [], expired: [id] });
  }, JOB_TEST_MS);
});

describe('reapJobs', () => {
  it('a lapsed lease with attempts left is retried; without, failed stalled; a queued job past its window, expired', async () => {
    const again = await enqueueJob(db, { type: 't', payload: {}, maxAttempts: 2 });
    const once = await enqueueJob(db, { type: 't', payload: {}, maxAttempts: 1 });
    await claim(['t'], 1); await claim(['t'], 1);           // 1 ms leases: both lapse at once
    const late = await enqueueJob(db, { type: 'late', payload: {}, startWithinMs: -1000 });
    await new Promise((r) => setTimeout(r, 20));
    const out = await reapJobs(q(), reapOpts);
    expect(out).toEqual({ retried: [again.id], failed: [once.id], expired: [late.id] });
    expect(await get(again.id)).toMatchObject({ status: 'queued', error: 'lease expired' });
    expect(await get(once.id)).toMatchObject({ status: 'failed', error: 'stalled' });
    expect(await get(late.id)).toMatchObject({ status: 'failed', error: 'expired' });
  }, JOB_TEST_MS);

  it('a lapsed job is retried after the base delay doubled per attempt spent', async () => {
    const { id } = await enqueueJob(db, { type: 't', payload: {}, maxAttempts: 3 });
    const dueIn = async () => { const r = await get(id); return r.runAfter.getTime() - Date.now(); };
    await claim(['t'], 1);
    await new Promise((r) => setTimeout(r, 20));
    await reapJobs(q(), { retryBaseMs: 60_000 });                 // attempt 1 spent: 60 s
    expect(await dueIn()).toBeGreaterThan(55_000); expect(await dueIn()).toBeLessThan(61_000);
    await db.update(jobs).set({ runAfter: new Date(Date.now() - 1000) }).where(eq(jobs.id, id));
    await claim(['t'], 1);
    await new Promise((r) => setTimeout(r, 20));
    await reapJobs(q(), { retryBaseMs: 60_000 });                 // attempt 2 spent: 120 s
    expect(await dueIn()).toBeGreaterThan(115_000); expect(await dueIn()).toBeLessThan(121_000);
  }, JOB_TEST_MS);

  it('purge deletes finished jobs older than the window only', async () => {
    const old = await enqueueJob(db, { type: 't', payload: {} });
    const fresh = await enqueueJob(db, { type: 't', payload: {} });
    await db.update(jobs).set({ status: 'done', finishedAt: new Date(Date.now() - 8 * 86_400_000) }).where(eq(jobs.id, old.id));
    await db.update(jobs).set({ status: 'done', finishedAt: new Date() }).where(eq(jobs.id, fresh.id));
    await purgeJobs(q());
    expect(await db.query.jobs.findFirst({ where: eq(jobs.id, old.id) })).toBeUndefined();
    expect(await get(fresh.id)).toBeDefined();
  }, JOB_TEST_MS);
});

describe('liveness', () => {
  it('queued in its window, or running with a lease, is live; anything else is not', async () => {
    const queued = await enqueueJob(db, { type: 't', payload: {} });
    const expired = await enqueueJob(db, { type: 'x', payload: {}, startWithinMs: -1000 });
    const running = await enqueueJob(db, { type: 'r', payload: {} });
    await claim(['r']);
    const lapsed = await enqueueJob(db, { type: 'l', payload: {} });
    await claim(['l'], 1);
    await new Promise((r) => setTimeout(r, 20));
    const live = await liveJobIds(db, [queued.id, expired.id, running.id, lapsed.id, null, undefined]);
    expect([...live].sort()).toEqual([queued.id, running.id].sort());
    expect(await isJobLive(db, null)).toBe(false);
    expect(await isJobLive(db, '00000000-0000-4000-8000-000000000009')).toBe(false);
  }, JOB_TEST_MS);
});

describe('awaitJob', () => {
  it('a done job answers its value; a failed one rethrows its error as the class it was', async () => {
    const ok = await enqueueJob(db, { type: 't', payload: {} });
    await claim(); await completeJob(ok.id, O, { links: 3 });
    expect(await awaitJob(ok.id, 1000)).toEqual({ links: 3 });

    const bad = await enqueueJob(db, { type: 't', payload: {} });
    await claim();
    await failJobTerminal(bad.id, { owner: O }, serializeError(new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Mark page 1 first' })), RUN_STOPPED);
    await expect(awaitJob(bad.id, 1000)).rejects.toMatchObject({ code: 'PRECONDITION_FAILED', message: 'Mark page 1 first' });
  }, JOB_TEST_MS);

  it('a capture problem comes back as a CaptureProblemError with its customer sentence and verdict', async () => {
    const { id } = await enqueueJob(db, { type: 't', payload: {} });
    await claim();
    const problem = new CaptureProblemError('The page asked to prove you are human. Try again later.', { kind: 'challenge', status: 403, vendor: 'cloudflare' });
    await failJobTerminal(id, { owner: O }, serializeError(problem), RUN_STOPPED);
    const err = await awaitJob(id, 1000).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CaptureProblemError);
    expect(err).toMatchObject({ message: problem.message, verdict: problem.verdict });
  }, JOB_TEST_MS);

  it('a queued job past its window, or the ceiling, is unavailable', async () => {
    const expired = await enqueueJob(db, { type: 't', payload: {}, startWithinMs: -1000 });
    await expect(awaitJob(expired.id, 1000)).rejects.toBeInstanceOf(JobUnavailableError);
    expect(await get(expired.id)).toMatchObject({ status: 'failed', error: 'expired' });
    const waiting = await enqueueJob(db, { type: 't', payload: {} });
    await expect(awaitJob(waiting.id, 300)).rejects.toBeInstanceOf(JobUnavailableError);
  }, JOB_TEST_MS);
});
