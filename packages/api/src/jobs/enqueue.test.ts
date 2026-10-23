import { describe, it, expect, afterEach } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db, jobs } from '@robot/db';
import { enqueue, ceilingOf, runAndWait, urlKey } from './enqueue.js';
import { jobQueueName } from './queue.js';
import { JOB_POLICIES } from './types.js';
import { withJobRunner } from '../test-helpers/jobs.js';

const q = () => jobQueueName();
afterEach(async () => { await db.delete(jobs).where(eq(jobs.queue, q())); });

describe('enqueue', () => {
  it('takes priority, attempts and start window from the type\'s policy; a key and a priority of the caller\'s own', async () => {
    const id = await enqueue(db, 'verify', { sourceId: 's', verificationId: 'v' }, { key: 'verify:v' });
    const [row] = (await db.execute(sql`SELECT priority, max_attempts, key, type, payload,
      extract(epoch FROM expires_at - run_after) * 1000 AS window FROM jobs WHERE id = ${id}`)) as unknown as Array<Record<string, unknown>>;
    expect({ ...row, window: Number(row!.window) }).toEqual({
      priority: JOB_POLICIES.verify.priority, max_attempts: JOB_POLICIES.verify.maxAttempts, key: 'verify:v', type: 'verify',
      payload: { sourceId: 's', verificationId: 'v' }, window: JOB_POLICIES.verify.startWithinMs,
    });
    const run = await enqueue(db, 'run', { runId: 'r' }, { priority: 3 });
    expect(await db.query.jobs.findFirst({ where: eq(jobs.id, run) })).toMatchObject({ priority: 3, maxAttempts: 3, expiresAt: null });
  });
});

describe('urlKey (final review I3)', () => {
  it('keys a job by its address\'s hash: one length whatever the address, the same address the same key', () => {
    const long = `https://shop.example/c/${'a'.repeat(300)}`;
    expect(urlKey('listing', long)).toMatch(/^listing:[0-9a-f]{40}$/);
    expect(urlKey('listing', long)).toBe(urlKey('listing', long));
    expect(urlKey('listing', long)).not.toBe(urlKey('listing', `${long}b`));
    expect(urlKey('reachability', long)).not.toBe(urlKey('listing', long));
  });

  it('a 300-character address enqueues, and dedupes on its key', async () => {
    const key = urlKey('reachability', `https://shop.example/${'p'.repeat(300)}`);
    const a = await enqueue(db, 'reachability', { url: 'x' }, { key });
    expect(await enqueue(db, 'reachability', { url: 'x' }, { key })).toBe(a);
  });
});describe('ceilingOf', () => {
  it('is the start window, the stuck limit and ten seconds; JOB_AWAIT_MAX_MS caps it', () => {
    expect(ceilingOf('listing-check', {})).toBe(60_000 + 90_000 + 10_000);
    expect(ceilingOf('run', {})).toBe(15 * 60_000 + 10_000);           // no window
    expect(ceilingOf('listing-check', { JOB_AWAIT_MAX_MS: '2000' })).toBe(2000);
    expect(ceilingOf('variant-links-near', { JOB_AWAIT_MAX_MS: '999999999' })).toBe(60_000 + 30_000 + 10_000);
    expect(ceilingOf('listing-check', { JOB_AWAIT_MAX_MS: 'nonsense' })).toBe(160_000);
  });
});

describe('runAndWait', () => {
  it('enqueues the job, a worker runs it, and the caller gets its answer', async () => {
    const registry = { reachability: { policy: JOB_POLICIES.reachability, run: async (p: { url: string }) => ({ reachable: p.url }) } };
    expect(await withJobRunner(() => runAndWait('reachability', { url: 'https://shop.example/' }, { key: 'reachability:x' }), { registry }))
      .toEqual({ reachable: 'https://shop.example/' });
    expect(await db.query.jobs.findMany({ where: eq(jobs.queue, q()) })).toMatchObject([{ type: 'reachability', key: 'reachability:x', status: 'done' }]);
  });
});
