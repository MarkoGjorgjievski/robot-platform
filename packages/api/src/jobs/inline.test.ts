// An operator script's inline jobs (M5): its own queue, run in-process, drained before it exits.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, jobs } from '@robot/db';
import { enqueue } from './enqueue.js';
import { enqueueJob } from './queue.js';
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

describe('startInlineJobs, fix wave: its lines are redacted', () => {
  const failing = (secret: string) => ({
    'drift-check': { policy: { ...JOB_POLICIES['drift-check'], maxAttempts: 1 }, run: async () => { throw new Error(`boom postgres://robot:${secret}@db.test/x`); } },
  });

  it('the default lines go through the logger: scoped, at their level, with no secret', async () => {
    saved = process.env.JOB_QUEUE;
    const out: string[] = [];
    const spies = [vi.spyOn(console, 'log'), vi.spyOn(console, 'error')].map((s) => s.mockImplementation((...a: unknown[]) => { out.push(a.join(' ')); }));
    try {
      const inline = await startInlineJobs('script-test', { registry: failing('inline-pw-1') });
      await enqueueJob(db, { type: 'drift-check', payload: { checkId: 'c2' }, maxAttempts: 1 });
      await inline.drain(10_000);
    } finally { for (const s of spies) s.mockRestore(); }
    const failed = out.filter((l) => l.includes('failed drift-check'));
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatch(/^\[script-test jobs\] ERROR failed drift-check /);
    expect(out.join('\n')).not.toContain('inline-pw-1');
  }, JOB_TEST_MS);

  it('a caller\'s own log gets the lines redacted too', async () => {
    saved = process.env.JOB_QUEUE;
    const lines: string[] = [];
    const inline = await startInlineJobs('script-test', { registry: failing('inline-pw-2'), log: (l) => lines.push(l) });
    await enqueueJob(db, { type: 'drift-check', payload: { checkId: 'c3' }, maxAttempts: 1 });
    await inline.drain(10_000);
    expect(lines.some((l) => l.startsWith('failed drift-check'))).toBe(true);
    expect(lines.join('\n')).not.toContain('inline-pw-2');
  }, JOB_TEST_MS);
});
