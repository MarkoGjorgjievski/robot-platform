import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, jobs, sourceVerifications } from '@robot/db';
import { createTestSource, deleteTestSource } from '../test-helpers/source.js';
import { enqueueJob, claimJob, jobQueueName } from './queue.js';
import { startJobRunner, type Registry, type JobRunner } from './runner.js';
import type { JobPolicy } from './types.js';
import { testJobDefinitions } from './test-jobs.js';
import { runQueuedJobs, jobsOf } from '../test-helpers/jobs.js';

const q = () => jobQueueName();
const get = async (id: string) => (await db.query.jobs.findFirst({ where: eq(jobs.id, id) }))!;
const policy = (p: Partial<JobPolicy> = {}): JobPolicy => ({ lane: 'background', priority: 10, maxAttempts: 1, stuckMs: 60_000, startWithinMs: null, ...p });
const until = async (pred: () => Promise<boolean>, ms = 10_000) => {
  const t = Date.now() + ms;
  while (!(await pred())) { if (Date.now() > t) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 25)); }
};
const lanes = { interactive: 1, background: 1, runs: 1 };
let runners: JobRunner[] = [];
const start = (registry: Registry, extra: Partial<Parameters<typeof startJobRunner>[0]> = {}) => {
  const r = startJobRunner({ queue: q(), registry, lanes, pollMs: 20, reapEveryMs: 50, stuckCheckMs: 20, retryBaseMs: 10, log: () => {}, ...extra });
  runners.push(r);
  return r;
};
afterEach(async () => { await Promise.all(runners.map((r) => r.stop(1000))); runners = []; await db.delete(jobs).where(eq(jobs.queue, q())); });

describe('startJobRunner', () => {
  it('runs a job and records its answer', async () => {
    const { id } = await enqueueJob(db, { type: 'echo', payload: { n: 2 } });
    start({ echo: { policy: policy(), run: async (p: { n: number }) => ({ twice: p.n * 2 }) } });
    await until(async () => (await get(id)).status === 'done');
    expect((await get(id)).result).toEqual({ value: { twice: 4 } });
  });

  it('a handler that throws is retried, then failed with its error', async () => {
    const { id } = await enqueueJob(db, { type: 'boom', payload: {}, maxAttempts: 2 });
    let calls = 0;
    start({ boom: { policy: policy({ maxAttempts: 2 }), run: async () => { calls++; throw new Error('db went away'); } } });
    await until(async () => (await get(id)).status === 'failed');
    expect(calls).toBe(2);
    expect(await get(id)).toMatchObject({ attempts: 2, error: 'db went away' });
  });

  it('a lane never runs more than its slots; a type never more than its cap', async () => {
    for (let i = 0; i < 3; i++) await enqueueJob(db, { type: 'slow', payload: {} });
    let now = 0; let peak = 0;
    start({ slow: { policy: policy(), run: async () => { now++; peak = Math.max(peak, now); await new Promise((r) => setTimeout(r, 80)); now--; } } },
      { lanes: { interactive: 1, background: 3, runs: 1 } });
    await until(async () => (await db.query.jobs.findMany({ where: eq(jobs.queue, q()) })).every((j) => j.status === 'done'));
    expect(peak).toBe(3);
    await db.delete(jobs).where(eq(jobs.queue, q()));
    for (let i = 0; i < 3; i++) await enqueueJob(db, { type: 'capped', payload: {} });
    now = 0; peak = 0;
    start({ capped: { policy: policy({ maxConcurrent: 1 }), run: async () => { now++; peak = Math.max(peak, now); await new Promise((r) => setTimeout(r, 50)); now--; } } },
      { lanes: { interactive: 1, background: 3, runs: 1 } });
    await until(async () => (await db.query.jobs.findMany({ where: eq(jobs.queue, q()) })).every((j) => j.status === 'done'));
    expect(peak).toBe(1);
  });

  it('a stuck job is stopped: its signal fires, its browsers close, it fails stalled — or, for work that resumes, is retried', async () => {
    const closed: string[] = [];
    const browsers = { closeJob: async (id: string) => { closed.push(id); }, closeAll: async () => {} };
    let aborted = false;
    const { id } = await enqueueJob(db, { type: 'hang', payload: {}, maxAttempts: 2 });
    start({ hang: { policy: policy({ stuckMs: 100, maxAttempts: 2 }), run: (_p, ctx) => new Promise((_, reject) => ctx.signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); })) } }, { browsers });
    await until(async () => (await get(id)).status === 'failed');
    expect(aborted).toBe(true);
    expect(closed).toContain(id);
    expect(await get(id)).toMatchObject({ error: 'stalled', attempts: 1 });   // never retried in the same process

    const r = await enqueueJob(db, { type: 'resumes', payload: {}, maxAttempts: 2 });
    let attempt = 0;
    start({ resumes: { policy: policy({ stuckMs: 100, maxAttempts: 2, retryOnStuck: true }), run: (_p, ctx) => { attempt = ctx.attempt; return ctx.attempt === 1 ? new Promise(() => {}) : Promise.resolve('resumed'); } } });
    await until(async () => (await get(r.id)).status === 'done');
    expect(attempt).toBe(2);
  });

  it('a job with progress is not stuck', async () => {
    const { id } = await enqueueJob(db, { type: 'busy', payload: {} });
    start({ busy: { policy: policy({ stuckMs: 100 }), run: async (_p, ctx) => { for (let i = 0; i < 6; i++) { await new Promise((r) => setTimeout(r, 50)); ctx.progress(); } return 'ok'; } } });
    await until(async () => (await get(id)).status === 'done');
  });

  it('shutdown waits, then gives running jobs back with their attempt unspent', async () => {
    const { id } = await enqueueJob(db, { type: 'long', payload: {}, maxAttempts: 2 });
    const r = start({ long: { policy: policy({ maxAttempts: 2 }), run: (_p, ctx) => new Promise((_, reject) => ctx.signal.addEventListener('abort', () => reject(new Error('stopped')))) } });
    await until(async () => (await get(id)).status === 'running');
    await r.stop(100);
    expect(await get(id)).toMatchObject({ status: 'queued', attempts: 0, lockedBy: null });
  });

  it('shutdown closes a given-back job\'s browsers before the job can be claimed again', async () => {
    const { id } = await enqueueJob(db, { type: 'long', payload: {}, maxAttempts: 2 });
    const alive = new Set<string>();
    let statusWhenClosed: string | undefined;
    const browsers = {
      closeJob: async (jobId: string) => {
        await new Promise((r) => setTimeout(r, 100));     // Chromium takes a moment to go
        statusWhenClosed = (await get(jobId)).status;
        alive.delete(jobId);
      },
      closeAll: async () => { alive.clear(); },
    };
    const r = start({ long: { policy: policy({ maxAttempts: 2 }), run: (_p, ctx) => { alive.add(ctx.jobId); return new Promise((_, reject) => ctx.signal.addEventListener('abort', () => reject(new Error('stopped')))); } } }, { browsers });
    await until(async () => (await get(id)).status === 'running');
    await r.stop(50);
    expect(statusWhenClosed).toBe('running');              // closed while the job was still this worker's
    expect(alive.size).toBe(0);
    expect(await get(id)).toMatchObject({ status: 'queued', attempts: 0 });
  });

  it('a crashed worker\'s job is reaped and finished by another (in-process)', async () => {
    const { id } = await enqueueJob(db, { type: 'echo', payload: { n: 1 }, maxAttempts: 2 });
    await claimJob({ queue: q(), workerId: 'dead:1', types: ['echo'], leaseMs: 50 });   // claimed, then nobody renews
    start({ echo: { policy: policy({ maxAttempts: 2 }), run: async () => 'recovered' } });
    await until(async () => (await get(id)).status === 'done');
    expect(await get(id)).toMatchObject({ attempts: 2, result: { value: 'recovered' } });
  });

  it('a retry closes the half-done rows of the earlier attempt, but not the one its payload names', async () => {
    const sourceId = await createTestSource({ schema: [] });
    try {
      const { id } = await enqueueJob(db, { type: 'redo', payload: {}, maxAttempts: 2 });
      const [mine] = await db.insert(sourceVerifications).values({ sourceId, definitionHash: 'h', jobId: id }).returning();
      const [leftover] = await db.insert(sourceVerifications).values({ sourceId, definitionHash: 'h', jobId: id }).returning();
      await claimJob({ queue: q(), workerId: 'dead:2', types: ['redo'], leaseMs: 50 });
      start({ redo: { policy: policy({ maxAttempts: 2 }), subject: () => ({ table: 'source_verifications', id: mine!.id }), run: async () => 'ok' } });
      await until(async () => (await get(id)).status === 'done');
      expect((await db.query.sourceVerifications.findFirst({ where: eq(sourceVerifications.id, leftover!.id) }))!.errorMessage).toBe('stalled');
      expect((await db.query.sourceVerifications.findFirst({ where: eq(sourceVerifications.id, mine!.id) }))!.completedAt).toBeNull();
    } finally { await deleteTestSource(sourceId); }
  });

  it('claims nothing while free memory is low', async () => {
    const { id } = await enqueueJob(db, { type: 'echo', payload: { n: 1 } });
    let free = 10;
    start({ echo: { policy: policy(), run: async () => 'ok' } }, { minFreeMb: 100, freeMb: () => free });
    await new Promise((r) => setTimeout(r, 200));
    expect((await get(id)).status).toBe('queued');
    free = 1000;
    await until(async () => (await get(id)).status === 'done');
  });

  it('runQueuedJobs drains the queue; the test jobs answer with their attempt', async () => {
    await enqueueJob(db, { type: 'test-sleep', payload: { ms: 30 }, maxAttempts: 2 });
    await enqueueJob(db, { type: 'test-sleep-once', payload: { ms: 10_000, finishOnAttempt: 1 } });
    await runQueuedJobs({ registry: testJobDefinitions(), timeoutMs: 5000 });
    expect((await jobsOf('test-sleep')).map((j) => [j.status, j.result])).toEqual([['done', { value: { attempt: 1 } }]]);
    expect((await jobsOf('test-sleep-once')).map((j) => [j.status, j.result])).toEqual([['done', { value: { attempt: 1 } }]]);
  });
});
