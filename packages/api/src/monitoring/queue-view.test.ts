// Spec 2026-10-25 monitoring §2.5, §4 "API and server": ops.queue's shape and operator-only access.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { db, jobs, workers } from '@robot/db';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from '../routers/index.js';
import { jobQueueName } from '../jobs/queue.js';
import { signedInCaller, type SignedIn } from '../test-helpers/identity.js';

const q = () => jobQueueName();
const codeOf = async (p: Promise<unknown>) => { try { await p; return 'OK'; } catch (e) { return e instanceof TRPCError ? e.code : String(e); } };
let op: SignedIn;
let customer: SignedIn;
const saved = process.env.OPS_EMAILS;
beforeAll(async () => {
  op = await signedInCaller('ops-queue-op');
  customer = await signedInCaller('ops-queue-cust');
  process.env.OPS_EMAILS = op.user.email;
});
afterAll(async () => {
  if (saved === undefined) delete process.env.OPS_EMAILS; else process.env.OPS_EMAILS = saved;
  await op.cleanup();
  await customer.cleanup();
});
afterEach(async () => {
  await db.delete(jobs).where(eq(jobs.queue, q()));
  await db.delete(workers).where(eq(workers.queue, q()));
});

describe('ops.queue (spec 2026-10-25 monitoring §2.5)', () => {
  it('gives an operator the workers, the jobs by type, what needs attention and the last failures — redacted', async () => {
    const id = `oq:1:${randomUUID().slice(0, 8)}`;
    await db.insert(workers).values({ id, queue: q(), startedAt: new Date(), version: 'v-oq', browsers: { inUse: 1, max: 3 }, lanes: { interactive: 0, background: 1, runs: 0 }, websiteChecks: true, recurringRuns: false });
    await db.insert(workers).values({ id: `${id}-dead`, queue: q(), startedAt: new Date(), beatAt: sql`now() - interval '5 minutes'` });
    const [late] = await db.insert(jobs).values({ queue: q(), type: 'reachability', runAfter: sql`now() - interval '11 minutes'` }).returning();
    await db.insert(jobs).values({ queue: q(), type: 'verify', status: 'done', startedAt: sql`now() - interval '2 minutes'`, finishedAt: sql`now() - interval '1 minute'` });
    const [failed] = await db.insert(jobs).values({ queue: q(), type: 'verify', status: 'failed', attempts: 2, maxAttempts: 2, error: 'could not reach http://u:oq-secret@h.test:1', finishedAt: sql`now()` }).returning();
    const out = await op.caller.ops.queue();
    expect(out.queue).toBe(q());
    expect(out.workers.find((w) => w.id === id)).toMatchObject({ queue: q(), version: 'v-oq', dead: false, browsers: { inUse: 1, max: 3 }, lanes: { background: 1 }, websiteChecks: true, recurringRuns: false });
    expect(out.workers.find((w) => w.id === id)!.beatAgeMs).toBeLessThan(60_000);
    expect(out.workers.find((w) => w.id === `${id}-dead`)).toMatchObject({ dead: true });
    expect(out.types.find((t) => t.type === 'reachability')).toMatchObject({ queued: 1, running: 0, done: 0, failed: 0, longestRunningMs: null });
    expect(out.types.find((t) => t.type === 'reachability')!.oldestQueuedMs).toBeGreaterThan(10 * 60_000);
    expect(out.types.find((t) => t.type === 'verify')).toMatchObject({ queued: 0, running: 0, done: 1, failed: 1, oldestQueuedMs: null });
    expect(out.attention).toEqual([expect.objectContaining({ kind: 'backlog', jobId: late!.id, type: 'reachability' })]);
    expect(out.failures[0]).toMatchObject({ jobId: failed!.id, type: 'verify', attempts: 2, maxAttempts: 2, error: 'could not reach http://***@h.test:1' });
    expect(out.failures[0]!.finishedAt).toBeInstanceOf(Date);
    expect(JSON.stringify(out)).not.toContain('oq-secret');
  });

  it('a queue with nothing on it answers empty lists, not an error', async () => {
    const out = await op.caller.ops.queue();
    expect(out.types).toEqual([]);
    expect(out.attention).toEqual([]);
    expect(out.failures).toEqual([]);
  });

  it('is FORBIDDEN to a customer and UNAUTHORIZED signed out', async () => {
    expect(await codeOf(customer.caller.ops.queue())).toBe('FORBIDDEN');
    expect(await codeOf(createCallerFactory(appRouter)({ db, session: null }).ops.queue())).toBe('UNAUTHORIZED');
  });
});
