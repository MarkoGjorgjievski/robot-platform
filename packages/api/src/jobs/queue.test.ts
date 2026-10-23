import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { db, jobs, sourceVerifications, runs } from '@robot/db';
import { createTestSource, deleteTestSource } from '../test-helpers/source.js';
import {
  enqueueJob, claimJob, renewLease, completeJob, retryJob, failJobTerminal, releaseJob, reapJobs,
  purgeJobs, liveJobIds, isJobLive, awaitJob, jobQueueName,
} from './queue.js';
import { JobUnavailableError, serializeError } from './errors.js';
import { RUN_STOPPED } from './types.js';

const W = 'test-worker:1';
const q = () => jobQueueName();
const get = async (id: string) => (await db.query.jobs.findFirst({ where: eq(jobs.id, id) }))!;
const claim = (types = ['t'], leaseMs = 60_000) => claimJob({ queue: q(), workerId: W, types, leaseMs });
const reapOpts = { retryBaseMs: 1000, runSentenceFor: () => RUN_STOPPED };

afterEach(async () => { await db.delete(jobs).where(eq(jobs.queue, q())); });

describe('enqueueJob', () => {
  it('one queued or running job per key: a second enqueue returns the first', async () => {
    const a = await enqueueJob(db, { type: 't', payload: { n: 1 }, key: 'k' });
    expect(a.created).toBe(true);
    expect(await enqueueJob(db, { type: 't', payload: { n: 2 }, key: 'k' })).toEqual({ id: a.id, created: false });
    await db.update(jobs).set({ status: 'done' }).where(eq(jobs.id, a.id));
    expect((await enqueueJob(db, { type: 't', payload: {}, key: 'k' })).created).toBe(true);
  });

  it('inside a transaction that rolls back, leaves no job', async () => {
    await expect(db.transaction(async (tx) => {
      await enqueueJob(tx, { type: 't', payload: {} });
      throw new Error('rollback');
    })).rejects.toThrow('rollback');
    expect(await db.query.jobs.findMany({ where: eq(jobs.queue, q()) })).toEqual([]);
  });
});

describe('claimJob', () => {
  it('lowest priority first, then the oldest; only the listed types; not before run_after; never an expired one', async () => {
    const late = await enqueueJob(db, { type: 't', payload: {}, priority: 10 });
    const urgent = await enqueueJob(db, { type: 't', payload: {}, priority: 0 });
    await enqueueJob(db, { type: 'other', payload: {}, priority: 0 });
    await enqueueJob(db, { type: 't', payload: {}, priority: 0, runAfter: new Date(Date.now() + 60_000) });
    await enqueueJob(db, { type: 't', payload: {}, priority: 0, expiresAt: new Date(Date.now() - 1000) });
    expect((await claim())!.id).toBe(urgent.id);
    expect((await claim())!.id).toBe(late.id);
    expect(await claim()).toBeNull();
  });

  it('never claims another queue', async () => {
    const other = `${q()}-other`;
    await enqueueJob(db, { type: 't', payload: {}, queue: other });
    try { expect(await claim()).toBeNull(); } finally { await db.delete(jobs).where(eq(jobs.queue, other)); }
  });

  it('marks the job running with its owner, a lease and one more attempt', async () => {
    const { id } = await enqueueJob(db, { type: 't', payload: { x: 1 }, maxAttempts: 2 });
    const job = (await claim())!;
    expect(job).toMatchObject({ id, status: 'running', attempts: 1, maxAttempts: 2, lockedBy: W, payload: { x: 1 } });
    expect(job.lockedUntil!.getTime()).toBeGreaterThan(Date.now() + 50_000);
  });
});

describe('the lease', () => {
  it('renews for its owner only; completes for its owner only', async () => {
    const { id } = await enqueueJob(db, { type: 't', payload: {} });
    await claim();
    expect(await renewLease(id, W, 60_000)).toBe(true);
    expect(await renewLease(id, 'someone-else', 60_000)).toBe(false);
    expect(await completeJob(id, 'someone-else', 1)).toBe(false);
    expect(await completeJob(id, W, { ok: true })).toBe(true);
    expect(await get(id)).toMatchObject({ status: 'done', result: { value: { ok: true } }, lockedBy: null });
    expect(await renewLease(id, W, 60_000)).toBe(false);
  });
});

describe('failures', () => {
  it('a retry puts the job back, later, with its error', async () => {
    const { id } = await enqueueJob(db, { type: 't', payload: {}, maxAttempts: 2 });
    await claim();
    expect(await retryJob(id, W, 'boom', 30_000)).toBe(true);
    const row = await get(id);
    expect(row).toMatchObject({ status: 'queued', error: 'boom', lockedBy: null, attempts: 1 });
    expect(row.runAfter.getTime()).toBeGreaterThan(Date.now() + 20_000);
  });

  it('a terminal failure stores the error and closes every row the job owns, in one go', async () => {
    const sourceId = await createTestSource({ schema: [] });
    try {
      const { id } = await enqueueJob(db, { type: 't', payload: {} });
      const [v] = await db.insert(sourceVerifications).values({ sourceId, definitionHash: 'h', jobId: id }).returning();
      const [r] = await db.insert(runs).values({ sourceId, status: 'extracting', jobId: id }).returning();
      await claim();
      expect(await failJobTerminal(id, { owner: W }, serializeError(new Error('nope')), RUN_STOPPED)).toBe(true);
      expect(await get(id)).toMatchObject({ status: 'failed', error: 'nope', result: { error: { kind: 'error', message: 'nope' } } });
      expect(await db.query.sourceVerifications.findFirst({ where: eq(sourceVerifications.id, v!.id) })).toMatchObject({ errorMessage: 'stalled' });
      expect((await db.query.sourceVerifications.findFirst({ where: eq(sourceVerifications.id, v!.id) }))!.completedAt).not.toBeNull();
      expect(await db.query.runs.findFirst({ where: eq(runs.id, r!.id) })).toMatchObject({ status: 'failed', errorMessage: RUN_STOPPED });
    } finally { await deleteTestSource(sourceId); }
  });

  it('release gives the job back without spending its attempt', async () => {
    const { id } = await enqueueJob(db, { type: 't', payload: {}, maxAttempts: 2 });
    await claim();
    await releaseJob(id, W);
    expect(await get(id)).toMatchObject({ status: 'queued', attempts: 0, lockedBy: null });
  });
});

describe('the start window', () => {
  // Spec §4.2: "must start within" is a window for the start, not for the work. A job given back
  // (shutdown) or whose worker died has started; it gets its window again from when it is due.
  const startedThenLate = async (leaseMs: number) => {
    const { id } = await enqueueJob(db, { type: 't', payload: {}, maxAttempts: 2, expiresAt: new Date(Date.now() + 400) });
    expect((await claim(['t'], leaseMs))!.id).toBe(id);
    await new Promise((r) => setTimeout(r, 450));          // the window the job was enqueued with has passed
    return id;
  };

  it('a job given back at shutdown is still claimable after its first window, never expired', async () => {
    const id = await startedThenLate(60_000);
    await releaseJob(id, W);
    expect(await reapJobs(q(), reapOpts)).toEqual({ retried: [], failed: [], expired: [] });
    expect(await isJobLive(db, id)).toBe(true);
    expect((await claim())!.id).toBe(id);
  });

  it('a job whose worker died is retried after its first window, never expired', async () => {
    const id = await startedThenLate(1);
    expect(await reapJobs(q(), { ...reapOpts, retryBaseMs: 1 })).toEqual({ retried: [id], failed: [], expired: [] });
    await new Promise((r) => setTimeout(r, 20));
    expect(await reapJobs(q(), reapOpts)).toEqual({ retried: [], failed: [], expired: [] });
    expect((await claim())!.id).toBe(id);
  });

  it('a job given back still has a window: with no worker it expires a window after it was due', async () => {
    const id = await startedThenLate(60_000);
    await releaseJob(id, W);
    await new Promise((r) => setTimeout(r, 500));
    expect(await reapJobs(q(), reapOpts)).toEqual({ retried: [], failed: [], expired: [id] });
  });
});

describe('reapJobs', () => {
  it('a lapsed lease with attempts left is retried; without, failed stalled; a queued job past its window, expired', async () => {
    const again = await enqueueJob(db, { type: 't', payload: {}, maxAttempts: 2 });
    const once = await enqueueJob(db, { type: 't', payload: {}, maxAttempts: 1 });
    await claim(['t'], 1); await claim(['t'], 1);           // 1 ms leases: both lapse at once
    const late = await enqueueJob(db, { type: 'late', payload: {}, expiresAt: new Date(Date.now() - 1000) });
    await new Promise((r) => setTimeout(r, 20));
    const out = await reapJobs(q(), reapOpts);
    expect(out).toEqual({ retried: [again.id], failed: [once.id], expired: [late.id] });
    expect(await get(again.id)).toMatchObject({ status: 'queued', error: 'lease expired' });
    expect(await get(once.id)).toMatchObject({ status: 'failed', error: 'stalled' });
    expect(await get(late.id)).toMatchObject({ status: 'failed', error: 'expired' });
  });

  it('purge deletes finished jobs older than the window only', async () => {
    const old = await enqueueJob(db, { type: 't', payload: {} });
    const fresh = await enqueueJob(db, { type: 't', payload: {} });
    await db.update(jobs).set({ status: 'done', finishedAt: new Date(Date.now() - 8 * 86_400_000) }).where(eq(jobs.id, old.id));
    await db.update(jobs).set({ status: 'done', finishedAt: new Date() }).where(eq(jobs.id, fresh.id));
    await purgeJobs(q());
    expect(await db.query.jobs.findFirst({ where: eq(jobs.id, old.id) })).toBeUndefined();
    expect(await get(fresh.id)).toBeDefined();
  });
});

describe('liveness', () => {
  it('queued in its window, or running with a lease, is live; anything else is not', async () => {
    const queued = await enqueueJob(db, { type: 't', payload: {} });
    const expired = await enqueueJob(db, { type: 'x', payload: {}, expiresAt: new Date(Date.now() - 1000) });
    const running = await enqueueJob(db, { type: 'r', payload: {} });
    await claim(['r']);
    const lapsed = await enqueueJob(db, { type: 'l', payload: {} });
    await claim(['l'], 1);
    await new Promise((r) => setTimeout(r, 20));
    const live = await liveJobIds(db, [queued.id, expired.id, running.id, lapsed.id, null, undefined]);
    expect([...live].sort()).toEqual([queued.id, running.id].sort());
    expect(await isJobLive(db, null)).toBe(false);
    expect(await isJobLive(db, '00000000-0000-4000-8000-000000000009')).toBe(false);
  });
});

describe('awaitJob', () => {
  it('a done job answers its value; a failed one rethrows its error as the class it was', async () => {
    const ok = await enqueueJob(db, { type: 't', payload: {} });
    await claim(); await completeJob(ok.id, W, { links: 3 });
    expect(await awaitJob(ok.id, 1000)).toEqual({ links: 3 });

    const bad = await enqueueJob(db, { type: 't', payload: {} });
    await claim();
    await failJobTerminal(bad.id, { owner: W }, serializeError(new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Mark page 1 first' })), RUN_STOPPED);
    await expect(awaitJob(bad.id, 1000)).rejects.toMatchObject({ code: 'PRECONDITION_FAILED', message: 'Mark page 1 first' });
  });

  it('a queued job past its window, or the ceiling, is unavailable', async () => {
    const expired = await enqueueJob(db, { type: 't', payload: {}, expiresAt: new Date(Date.now() - 1000) });
    await expect(awaitJob(expired.id, 1000)).rejects.toBeInstanceOf(JobUnavailableError);
    expect(await get(expired.id)).toMatchObject({ status: 'failed', error: 'expired' });
    const waiting = await enqueueJob(db, { type: 't', payload: {} });
    await expect(awaitJob(waiting.id, 300)).rejects.toBeInstanceOf(JobUnavailableError);
  });
});
