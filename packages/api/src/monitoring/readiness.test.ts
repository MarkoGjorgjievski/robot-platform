// Spec 2026-10-25 monitoring §2.1 "Readiness": each check failing on its own.
import { afterEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db, jobs, workers } from '@robot/db';
import { jobQueueName } from '../jobs/queue.js';
import { readiness } from './readiness.js';

const q = () => jobQueueName();
afterEach(async () => {
  await db.delete(jobs).where(eq(jobs.queue, q()));
  await db.delete(workers).where(eq(workers.queue, q()));
});
const beating = () => db.insert(workers).values({ id: `ready:${q()}`, queue: q(), startedAt: new Date() });

describe('readiness (spec 2026-10-25 monitoring §2.1)', () => {
  it('ok when the database answers, migrations are applied, a worker beats on this queue and nothing waits', async () => {
    await beating();
    expect(await readiness({ queue: q() })).toEqual({ ok: true, checks: { db: true, migrations: true, worker: true, queue: true } });
  });

  it('worker: failing with no row, only a beat older than 2 minutes, or only another queue’s worker', async () => {
    expect((await readiness({ queue: q() })).checks.worker).toBe(false);
    await db.insert(workers).values({ id: `old:${q()}`, queue: q(), startedAt: new Date(), beatAt: sql`now() - interval '3 minutes'` });
    await db.insert(workers).values({ id: `elsewhere:${q()}`, queue: `${q()}-other`.slice(0, 64), startedAt: new Date() });
    try {
      expect(await readiness({ queue: q() })).toEqual({ ok: false, checks: { db: true, migrations: true, worker: false, queue: true } });
    } finally { await db.delete(workers).where(eq(workers.id, `elsewhere:${q()}`)); }
  });

  it('queue: failing with a job due over 10 minutes that nobody takes', async () => {
    await beating();
    await db.insert(jobs).values({ queue: q(), type: 'verify', runAfter: sql`now() - interval '11 minutes'` });
    expect(await readiness({ queue: q() })).toEqual({ ok: false, checks: { db: true, migrations: true, worker: true, queue: false } });
  });

  it('migrations: failing when the database has fewer than are bundled', async () => {
    await beating();
    expect(await readiness({ queue: q(), expectedMigrations: () => 10_000 })).toEqual({ ok: false, checks: { db: true, migrations: false, worker: true, queue: true } });
  });

  it('db: failing — and nothing else read — when the ping fails, or takes longer than the timeout', async () => {
    const t0 = Date.now();
    expect(await readiness({ queue: q(), ping: () => new Promise(() => {}), timeoutMs: 200 })).toEqual({ ok: false, checks: { db: false, migrations: false, worker: false, queue: false } });
    expect(Date.now() - t0).toBeLessThan(1500);
    expect((await readiness({ queue: q(), ping: async () => { throw new Error('ECONNREFUSED'); } })).checks).toEqual({ db: false, migrations: false, worker: false, queue: false });
  });
});
