// An operator script's inline jobs (M5): its own queue, run in-process, drained before it exits.
import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, jobs } from '@robot/db';
import { enqueue } from './enqueue.js';
import { JOB_POLICIES } from './types.js';
import { startInlineJobs } from './inline.js';
import { JOB_TEST_MS } from '../test-helpers/jobs.js';

let saved: string | undefined;
afterEach(() => { process.env.JOB_QUEUE = saved; });

describe('startInlineJobs', () => {
  it('a script\'s follow-up jobs go to its own queue, run in its process, and are gone after the drain', async () => {
    saved = process.env.JOB_QUEUE;
    const ran: string[] = [];
    const inline = await startInlineJobs('script-test', {
      registry: { 'drift-check': { policy: JOB_POLICIES['drift-check'], run: async (p: { checkId: string }) => { ran.push(p.checkId); } } },
      log: () => {},
    });
    expect(inline.queue).toMatch(/^script-test-/);
    expect(process.env.JOB_QUEUE).toBe(inline.queue);
    const id = await enqueue(db, 'drift-check', { checkId: 'c1' });
    expect((await db.query.jobs.findFirst({ where: eq(jobs.id, id) }))!.queue).toBe(inline.queue);
    await inline.drain(10_000);
    expect(ran).toEqual(['c1']);
    expect(await db.query.jobs.findMany({ where: eq(jobs.queue, inline.queue) })).toEqual([]);
  }, JOB_TEST_MS);
});
