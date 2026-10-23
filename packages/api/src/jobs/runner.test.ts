import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, jobs, sourceVerifications, driftChecks, runs } from '@robot/db';
import { createTestSource, deleteTestSource } from '../test-helpers/source.js';
import { enqueueJob, claimJob, releaseJob, jobQueueName } from './queue.js';
import { startJobRunner, type Registry, type JobRunner } from './runner.js';
import { PLAN_STOPPED, type JobPolicy } from './types.js';
import { testJobDefinitions } from './test-jobs.js';
import { createBrowserGate } from './browser-gate.js';
import { runQueuedJobs, jobsOf, JOB_TEST_MS } from '../test-helpers/jobs.js';

const q = () => jobQueueName();
const get = async (id: string) => (await db.query.jobs.findFirst({ where: eq(jobs.id, id) }))!;
const policy = (p: Partial<JobPolicy> = {}): JobPolicy => ({ lane: 'background', priority: 10, maxAttempts: 1, stuckMs: 60_000, startWithinMs: null, ...p });
const until = async (pred: () => Promise<boolean>, ms = 30_000) => {
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
  }, JOB_TEST_MS);

  it('a handler that throws is retried, then failed with its error', async () => {
    const { id } = await enqueueJob(db, { type: 'boom', payload: {}, maxAttempts: 2 });
    let calls = 0;
    start({ boom: { policy: policy({ maxAttempts: 2 }), run: async () => { calls++; throw new Error('db went away'); } } });
    await until(async () => (await get(id)).status === 'failed');
    expect(calls).toBe(2);
    expect(await get(id)).toMatchObject({ attempts: 2, error: 'db went away' });
  }, JOB_TEST_MS);

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
  }, JOB_TEST_MS);

  it('a stuck job is stopped: its signal fires, its browsers close, it fails stalled — or, for work that resumes, is retried', async () => {
    const closed: string[] = [];
    const browsers = { closeJob: async (id: string) => { closed.push(id); }, closeAll: async () => {} };
    let aborted = false; let claim = '';
    const { id } = await enqueueJob(db, { type: 'hang', payload: {}, maxAttempts: 2 });
    start({ hang: { policy: policy({ stuckMs: 100, maxAttempts: 2 }), run: (_p, ctx) => { claim = ctx.claim; return new Promise((_, reject) => ctx.signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); })); } } }, { browsers });
    await until(async () => (await get(id)).status === 'failed');
    expect(aborted).toBe(true);
    expect(claim).toMatch(/#/);
    expect(closed).toContain(claim);                        // this hold's browsers
    expect(await get(id)).toMatchObject({ error: 'stalled', attempts: 1 });   // never retried in the same process

    const r = await enqueueJob(db, { type: 'resumes', payload: {}, maxAttempts: 2 });
    let attempt = 0;
    start({ resumes: { policy: policy({ stuckMs: 100, maxAttempts: 2, retryOnStuck: true }), run: (_p, ctx) => { attempt = ctx.attempt; return ctx.attempt === 1 ? new Promise(() => {}) : Promise.resolve('resumed'); } } });
    await until(async () => (await get(r.id)).status === 'done');
    expect(attempt).toBe(2);
  }, JOB_TEST_MS);

  it('a job waiting for a browser past its stuck limit is not stuck: the wait is not its work (final review I2)', async () => {
    const gate = createBrowserGate({ max: 1, pollMs: 20 });
    const held = await gate.acquire();                      // another job's browser, for longer than the stuck limit
    const { id } = await enqueueJob(db, { type: 'waits', payload: {} });
    start({ waits: { policy: policy({ stuckMs: 150 }), run: async () => { (await gate.acquire())(); return 'got one'; } } }, { browsers: gate });
    await until(async () => (await get(id)).status === 'running');
    await new Promise((r) => setTimeout(r, 400));
    expect((await get(id)).status).toBe('running');
    held();
    await until(async () => (await get(id)).status === 'done');
    expect((await get(id)).result).toEqual({ value: 'got one' });
  }, JOB_TEST_MS);
  it('a stuck job failed for good has its rows closed before its browsers (M1); one that resumes is given back only after', async () => {
    const sourceId = await createTestSource({ schema: [] });
    try {
      const seen: Array<{ status: string; row?: string | null }> = [];
      const { id } = await enqueueJob(db, { type: 'hang', payload: {} });
      const [v] = await db.insert(sourceVerifications).values({ sourceId, definitionHash: 'h', jobId: id }).returning();
      const browsers = { closeJob: async () => {
        seen.push({ status: (await get(id)).status, row: (await db.query.sourceVerifications.findFirst({ where: eq(sourceVerifications.id, v!.id) }))!.errorMessage });
      }, closeAll: async () => {} };
      start({ hang: { policy: policy({ stuckMs: 100 }), run: (_p, ctx) => new Promise((_, reject) => ctx.signal.addEventListener('abort', () => reject(new Error('aborted')))) } }, { browsers });
      await until(async () => seen.length > 0);
      expect(seen[0]).toEqual({ status: 'failed', row: 'stalled' });

      const r = await enqueueJob(db, { type: 'resumes', payload: {}, maxAttempts: 2 });
      const resumed: string[] = [];
      start({ resumes: { policy: policy({ stuckMs: 100, maxAttempts: 2, retryOnStuck: true }), run: (_p, ctx) => ctx.attempt === 1 ? new Promise(() => {}) : Promise.resolve('resumed') } },
        { browsers: { closeJob: async () => { resumed.push((await get(r.id)).status); }, closeAll: async () => {} } });
      await until(async () => resumed.length > 0);
      expect(resumed[0]).toBe('running');
    } finally { await deleteTestSource(sourceId); }
  }, JOB_TEST_MS);
  it('afterDone runs once the job is recorded done, with its answer; a throw there is logged, the job stays done (M4)', async () => {
    const lines: string[] = [];
    const seen: Array<[string, unknown]> = [];
    const ok = await enqueueJob(db, { type: 'then', payload: { n: 1 } });
    const bad = await enqueueJob(db, { type: 'then-bad', payload: {} });
    start({
      then: { policy: policy(), run: async () => ({ settled: true }), afterDone: async (_p, value) => { seen.push([(await get(ok.id)).status, value]); } },
      'then-bad': { policy: policy(), run: async () => 'x', afterDone: async () => { throw new Error('enqueue failed'); } },
    }, { log: (l) => lines.push(l), lanes: { interactive: 1, background: 2, runs: 1 } });
    await until(async () => seen.length === 1 && lines.some((l) => l.includes('after then-bad')));
    expect(seen).toEqual([['done', { settled: true }]]);
    expect(lines).toContain(`after then-bad ${bad.id} failed: enqueue failed`);
    expect((await get(bad.id)).status).toBe('done');
  }, JOB_TEST_MS);
  it('a job with progress is not stuck', async () => {
    const { id } = await enqueueJob(db, { type: 'busy', payload: {} });
    start({ busy: { policy: policy({ stuckMs: 100 }), run: async (_p, ctx) => { for (let i = 0; i < 6; i++) { await new Promise((r) => setTimeout(r, 50)); ctx.progress(); } return 'ok'; } } });
    await until(async () => (await get(id)).status === 'done');
  }, JOB_TEST_MS);

  it('shutdown waits, then gives running jobs back with their attempt unspent', async () => {
    const { id } = await enqueueJob(db, { type: 'long', payload: {}, maxAttempts: 2 });
    const r = start({ long: { policy: policy({ maxAttempts: 2 }), run: (_p, ctx) => new Promise((_, reject) => ctx.signal.addEventListener('abort', () => reject(new Error('stopped')))) } });
    await until(async () => (await get(id)).status === 'running');
    await r.stop(100);
    expect(await get(id)).toMatchObject({ status: 'queued', attempts: 0, lockedBy: null });
  }, JOB_TEST_MS);

  it('shutdown closes a given-back job\'s browsers before the job can be claimed again', async () => {
    const { id } = await enqueueJob(db, { type: 'long', payload: {}, maxAttempts: 2 });
    const alive = new Set<string>();
    let statusWhenClosed: string | undefined;
    const browsers = {
      closeJob: async (claim: string) => {
        await new Promise((r) => setTimeout(r, 100));     // Chromium takes a moment to go
        statusWhenClosed = (await get(id)).status;
        alive.delete(claim);
      },
      closeAll: async () => { alive.clear(); },
    };
    const r = start({ long: { policy: policy({ maxAttempts: 2 }), run: (_p, ctx) => { alive.add(ctx.claim); return new Promise((_, reject) => ctx.signal.addEventListener('abort', () => reject(new Error('stopped')))); } } }, { browsers });
    await until(async () => (await get(id)).status === 'running');
    await r.stop(50);
    expect(statusWhenClosed).toBe('running');              // closed while the job was still this worker's
    expect(alive.size).toBe(0);
    expect(await get(id)).toMatchObject({ status: 'queued', attempts: 0 });
  }, JOB_TEST_MS);

  it('a crashed worker\'s job is reaped and finished by another (in-process)', async () => {
    const { id } = await enqueueJob(db, { type: 'echo', payload: { n: 1 }, maxAttempts: 2 });
    await claimJob({ queue: q(), workerId: 'dead:1', types: ['echo'], leaseMs: 50 });   // claimed, then nobody renews
    start({ echo: { policy: policy({ maxAttempts: 2 }), run: async () => 'recovered' } });
    await until(async () => (await get(id)).status === 'done');
    expect(await get(id)).toMatchObject({ attempts: 2, result: { value: 'recovered' } });
  }, JOB_TEST_MS);

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
  }, JOB_TEST_MS);

  it('a job given back at attempt 1 and claimed again closes the half-done rows of its earlier start', async () => {
    const sourceId = await createTestSource({ schema: [] });
    try {
      const { id } = await enqueueJob(db, { type: 'redo', payload: {}, maxAttempts: 2 });
      const [mine] = await db.insert(sourceVerifications).values({ sourceId, definitionHash: 'h', jobId: id }).returning();
      const [halfDone] = await db.insert(driftChecks).values({ sourceId, jobId: id }).returning();
      const old = await claimJob({ queue: q(), workerId: 'old:3', types: ['redo'], leaseMs: 60_000 });
      await releaseJob(id, old!.lockedBy!);                        // a shutdown: the attempt is not spent
      let retry: boolean | undefined;
      start({ redo: { policy: policy({ maxAttempts: 2 }), subject: () => ({ table: 'source_verifications', id: mine!.id }), run: async (_p, ctx) => { retry = ctx.retry; return 'ok'; } } });
      await until(async () => (await get(id)).status === 'done');
      expect(await get(id)).toMatchObject({ attempts: 1 });
      expect(await db.query.driftChecks.findFirst({ where: eq(driftChecks.id, halfDone!.id) })).toMatchObject({ status: 'failed', error: 'stalled' });
      expect(retry).toBe(true);
      expect((await db.query.sourceVerifications.findFirst({ where: eq(sourceVerifications.id, mine!.id) }))!.completedAt).toBeNull();
    } finally { await deleteTestSource(sourceId); }
  }, JOB_TEST_MS);

  it('a first start closes nothing and is not a retry', async () => {
    const sourceId = await createTestSource({ schema: [] });
    try {
      const { id } = await enqueueJob(db, { type: 'fresh', payload: {} });
      const [own] = await db.insert(driftChecks).values({ sourceId, jobId: id }).returning();
      let retry: boolean | undefined;
      start({ fresh: { policy: policy(), run: async (_p, ctx) => { retry = ctx.retry; return 'ok'; } } });
      await until(async () => (await get(id)).status === 'done');
      expect(retry).toBe(false);
      expect(await db.query.driftChecks.findFirst({ where: eq(driftChecks.id, own!.id) })).toMatchObject({ status: 'running' });
    } finally { await deleteTestSource(sourceId); }
  }, JOB_TEST_MS);

  it('a lost lease stops that hold only: the job claimed again here keeps its slot and finishes', async () => {
    const { id } = await enqueueJob(db, { type: 'twice', payload: {}, maxAttempts: 2 });
    let calls = 0; let firstStopped = ''; let releaseSecond: (v: unknown) => void = () => {};
    const r = start({ twice: { policy: policy({ maxAttempts: 2 }), run: (_p, ctx) => {
      calls++;
      if (calls === 1) return new Promise((_, reject) => ctx.signal.addEventListener('abort', () => { firstStopped = String(ctx.signal.reason); reject(new Error('stopped')); }));
      return new Promise((resolve) => { releaseSecond = resolve; });
    } } }, { leaseMs: 1000, lanes: { interactive: 1, background: 2, runs: 1 } });
    await until(async () => (await get(id)).status === 'running');
    // Another worker's reaper took it back (this one looked dead); this worker's free slot claims it again.
    await db.update(jobs).set({ status: 'queued', lockedBy: null, lockedUntil: null }).where(eq(jobs.id, id));
    await until(async () => calls === 2 && firstStopped !== '');
    expect(firstStopped).toBe('lease lost');
    expect(r.active()).toBe(1);
    releaseSecond('second');
    await until(async () => (await get(id)).status === 'done');
    expect((await get(id)).result).toEqual({ value: 'second' });
  }, JOB_TEST_MS);

  it('an answer or a failure the lost lease kept from being recorded is logged, and changes nothing', async () => {
    const lines: string[] = [];
    const steal = (id: string) => db.update(jobs).set({ lockedBy: 'other:9#00000000' }).where(eq(jobs.id, id));
    const ok = await enqueueJob(db, { type: 'stolen-ok', payload: {} });
    const bad = await enqueueJob(db, { type: 'stolen-bad', payload: {} });
    start({
      'stolen-ok': { policy: policy(), run: async (_p, ctx) => { await steal(ctx.jobId); return 'late'; } },
      'stolen-bad': { policy: policy(), run: async (_p, ctx) => { await steal(ctx.jobId); throw new Error('late'); } },
    }, { log: (l) => lines.push(l), lanes: { interactive: 1, background: 2, runs: 1 } });
    await until(async () => lines.filter((l) => l.startsWith('lost the lease')).length === 2);
    expect(lines).toContain(`lost the lease on stolen-ok ${ok.id} before its answer was recorded`);
    expect(lines).toContain(`lost the lease on stolen-bad ${bad.id} before its failure was recorded: late`);
    expect(lines.some((l) => l.startsWith('done ') || l.startsWith('failed '))).toBe(false);
    expect(await get(ok.id)).toMatchObject({ status: 'running', lockedBy: 'other:9#00000000' });
  }, JOB_TEST_MS);

  it('a run row closes with its job type sentence from the one table awaitJob reads too', async () => {
    const sourceId = await createTestSource({ schema: [] });
    try {
      const { id } = await enqueueJob(db, { type: 'plan', payload: {} });
      const [run] = await db.insert(runs).values({ sourceId, status: 'planning', jobId: id }).returning();
      start({ plan: { policy: policy(), run: async () => { throw new Error('the database went away'); } } });
      await until(async () => (await get(id)).status === 'failed');
      expect(await db.query.runs.findFirst({ where: eq(runs.id, run!.id) })).toMatchObject({ status: 'failed', errorMessage: PLAN_STOPPED });
    } finally { await deleteTestSource(sourceId); }
  }, JOB_TEST_MS);

  it('a claim that lands after stop() began is given back unstarted: never run, attempt unspent, not a retry next time', async () => {
    const { id } = await enqueueJob(db, { type: 'late', payload: {}, maxAttempts: 2 });
    let calls = 0;
    const registry: Registry = { late: { policy: policy({ maxAttempts: 2 }), run: async () => { calls++; return 'ran'; } } };
    // The claim lands only after stop() has begun: it is held in flight by this test's own claim wrapper
    // (no lock on the jobs table, which the whole dev database shares).
    let inFlight: () => void = () => {};
    const held = new Promise<void>((res) => { inFlight = res; });
    let claims = 0;
    const r = start(registry, { claim: async (o) => { claims++; await held; return claimJob(o); } });
    await until(async () => claims > 0);
    const stopped = r.stop(2000);
    await new Promise((res) => setTimeout(res, 50));
    inFlight();
    await stopped;
    expect(calls).toBe(0);
    expect(await get(id)).toMatchObject({ status: 'queued', attempts: 0, lockedBy: null, startedAt: null });
    expect((await claimJob({ queue: q(), workerId: 'next:1', types: ['late'], leaseMs: 60_000 }))!.startedBefore).toBe(false);
  }, JOB_TEST_MS);

  it('a runner purges the long-finished jobs of its queue jobs when it starts', async () => {
    const { id } = await enqueueJob(db, { type: 'old', payload: {} });
    await db.update(jobs).set({ status: 'done', finishedAt: new Date(Date.now() - 8 * 86_400_000) }).where(eq(jobs.id, id));
    start({}, { reapEveryMs: 60_000 });
    await until(async () => (await db.query.jobs.findFirst({ where: eq(jobs.id, id) })) === undefined);
  }, JOB_TEST_MS);

  it('claims nothing while free memory is low', async () => {
    const { id } = await enqueueJob(db, { type: 'echo', payload: { n: 1 } });
    let free = 10;
    start({ echo: { policy: policy(), run: async () => 'ok' } }, { minFreeMb: 100, freeMb: () => free });
    await new Promise((r) => setTimeout(r, 200));
    expect((await get(id)).status).toBe('queued');
    free = 1000;
    await until(async () => (await get(id)).status === 'done');
  }, JOB_TEST_MS);

  let earlierQueue = '';
  it('each test has its own queue (final review I4): a job one test leaves is no other test\'s to run', async () => {
    earlierQueue = q();
    const left = await enqueueJob(db, { type: 'test-sleep', payload: { ms: 60_000 } });
    expect((await get(left.id)).queue).toBe(earlierQueue);
  }, JOB_TEST_MS);

  it('runQueuedJobs drains only the calling test\'s queue and stops at once when it is empty', async () => {
    expect(q()).not.toBe(earlierQueue);
    const elsewhere = await enqueueJob(db, { type: 'test-sleep', payload: { ms: 60_000 }, queue: earlierQueue });
    await enqueueJob(db, { type: 'test-sleep', payload: { ms: 20 } });
    const t0 = Date.now();
    await runQueuedJobs({ registry: testJobDefinitions(), timeoutMs: 5000 });
    expect(Date.now() - t0).toBeLessThan(3000);
    expect((await jobsOf('test-sleep')).map((j) => j.status)).toEqual(['done']);
    expect((await get(elsewhere.id)).status).toBe('queued');
    await db.delete(jobs).where(eq(jobs.queue, earlierQueue));
  }, JOB_TEST_MS);
  it('runQueuedJobs drains the queue; the test jobs answer with their attempt', async () => {
    await enqueueJob(db, { type: 'test-sleep', payload: { ms: 30 }, maxAttempts: 2 });
    await enqueueJob(db, { type: 'test-sleep-once', payload: { ms: 10_000, finishOnAttempt: 1 } });
    await runQueuedJobs({ registry: testJobDefinitions(), timeoutMs: 5000 });
    expect((await jobsOf('test-sleep')).map((j) => [j.status, j.result])).toEqual([['done', { value: { attempt: 1 } }]]);
    expect((await jobsOf('test-sleep-once')).map((j) => [j.status, j.result])).toEqual([['done', { value: { attempt: 1 } }]]);
  }, JOB_TEST_MS);
});
