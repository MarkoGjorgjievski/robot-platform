import { describe, it, expect, vi, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db, runs, runItems } from '@robot/db';
import { createTestSource, deleteTestSource } from '../../test-helpers/source.js';
import { enqueueRun, runExecuteJob } from './run.js';
import { jobsOf } from '../../test-helpers/jobs.js';
import type { JobContext } from '../context.js';
import type { startExecution } from '../../crawl/start-execution.js';

const sources: string[] = [];
afterAll(async () => { for (const s of sources) await deleteTestSource(s); });
const ctx = (retry: boolean, signal: AbortSignal = new AbortController().signal, progress: () => void = () => {}): JobContext =>
  ({ jobId: 'j', claim: 'c', type: 'run', lane: 'runs', attempt: retry ? 2 : 1, retry, signal, progress });

async function runWithItems(opts: { parentRunId?: string } = {}) {
  const sourceId = await createTestSource({ schema: [] });
  sources.push(sourceId);
  const [run] = await db.insert(runs).values({ sourceId, status: 'extracting', ...opts }).returning();
  const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);
  await db.insert(runItems).values([
    { runId: run!.id, kind: 'detail', url: 'https://x.test/1', inputIndex: 0, status: 'running', startedAt: minutesAgo(1) },
    { runId: run!.id, kind: 'detail', url: 'https://x.test/2', inputIndex: 1, status: 'running', startedAt: minutesAgo(45) },
  ]);
  return run!.id;
}
const statuses = async (runId: string) => (await db.query.runItems.findMany({ where: eq(runItems.runId, runId) })).map((i) => `${i.url}:${i.status}`).sort();
type Execute = typeof startExecution;
type Hooks = { onItem?: () => void; aborted?: () => boolean };
const hooksOf = (call: unknown[]) => (call[4] as { hooks: Hooks }).hooks;

describe('runs through the queue (spec 2026-10-23 §4.4)', () => {
  it('one run job per run: a second enqueue adds none; the run names its job', async () => {
    const runId = await runWithItems();
    const a = await enqueueRun(db, { runId });
    const b = await enqueueRun(db, { runId, limit: 3 });
    expect(b).toBe(a);
    expect((await jobsOf('run')).filter((j) => (j.payload as { runId: string }).runId === runId)).toHaveLength(1);
    expect((await db.query.runs.findFirst({ where: eq(runs.id, runId) }))!.jobId).toBe(a);
  });

  it('a retry requeues every running item; a first attempt only stale ones', async () => {
    const execute = vi.fn<Execute>(async () => {});
    const first = await runWithItems();
    await runExecuteJob({ runId: first }, ctx(false), { execute });
    expect(await statuses(first)).toEqual(['https://x.test/1:running', 'https://x.test/2:pending']);
    const retry = await runWithItems();
    await runExecuteJob({ runId: retry }, ctx(true), { execute });
    expect(await statuses(retry)).toEqual(['https://x.test/1:pending', 'https://x.test/2:pending']);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('a run no longer extracting is not run', async () => {
    const runId = await runWithItems();
    await db.update(runs).set({ status: 'completed' }).where(eq(runs.id, runId));
    const execute = vi.fn<Execute>(async () => {});
    await runExecuteJob({ runId }, ctx(true), { execute });
    expect(execute).not.toHaveBeenCalled();
    expect(await statuses(runId)).toEqual(['https://x.test/1:running', 'https://x.test/2:running']);
  });

  it('passes the limit, the merge rule, progress and the abort to the execution; a repair sweep goes through the sweep', async () => {
    const runId = await runWithItems();
    const execute = vi.fn<Execute>(async () => {});
    const progress = vi.fn();
    const controller = new AbortController();
    await runExecuteJob({ runId, limit: 3 }, ctx(false, controller.signal, progress), { execute });
    expect(execute).toHaveBeenCalledWith(runId, expect.any(String), expect.any(Array), 3, expect.objectContaining({ hooks: expect.objectContaining({ onItem: expect.any(Function), aborted: expect.any(Function) }) }));
    expect(execute.mock.calls[0]![4]).not.toHaveProperty('mergeToParent');
    const hooks = hooksOf(execute.mock.calls[0]!);
    hooks.onItem!();
    expect(progress).toHaveBeenCalledTimes(1);
    expect(hooks.aborted!()).toBe(false);
    controller.abort('stuck');
    expect(hooks.aborted!()).toBe(true);

    const repairSweep = vi.fn(async () => 'swept' as const);
    await runExecuteJob({ runId, repairSweep: { deadFields: ['price'] } }, ctx(false), { execute, repairSweep });
    expect(repairSweep).toHaveBeenCalledWith(db, runId, ['price'], expect.any(Function));
  });

  it('a backfill run merges into its parent', async () => {
    const parent = await runWithItems();
    const runId = await runWithItems({ parentRunId: parent });
    const execute = vi.fn<Execute>(async () => {});
    await runExecuteJob({ runId }, ctx(false), { execute });
    expect(execute.mock.calls[0]![4]).toMatchObject({ mergeToParent: true });
  });

  it('a stopped attempt ends with an error, so a repair sweep goes no further than the stage it was in', async () => {
    const runId = await runWithItems();
    const controller = new AbortController();
    const execute = vi.fn<Execute>(async () => { controller.abort('stuck'); });
    const stages: string[] = [];
    const repairSweep = vi.fn(async (_db: unknown, _id: string, _f: string[], go: (o?: { limit?: number }) => Promise<void>) => {
      await go({ limit: 3 }); stages.push('sampled');
      await go({}); stages.push('swept');
      return 'swept' as const;
    });
    await expect(runExecuteJob({ runId, repairSweep: { deadFields: ['price'] } }, ctx(false, controller.signal), { execute, repairSweep })).rejects.toThrow();
    expect(stages).toEqual([]);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('work put back to pending while the execution was ending (a retry-failed click) is run before the job ends', async () => {
    const runId = await runWithItems();
    await db.update(runItems).set({ status: 'pending', startedAt: null }).where(eq(runItems.runId, runId));
    const execute = vi.fn<Execute>(async (id, _s, _schema, _limit, opts) => {
      // A pass: works every pending item, then the run settles.
      await db.update(runItems).set({ status: 'done' }).where(and(eq(runItems.runId, id), eq(runItems.status, 'pending')));
      opts!.hooks!.onItem!();
      await db.update(runs).set({ status: 'completed', completedAt: new Date() }).where(eq(runs.id, id));
      if (execute.mock.calls.length === 1) {
        // crawl.execute with retryFailed lands now: the job is still running, so it adds none.
        await db.update(runItems).set({ status: 'pending' }).where(and(eq(runItems.runId, id), eq(runItems.url, 'https://x.test/2')));
        await db.update(runs).set({ status: 'extracting', completedAt: null }).where(eq(runs.id, id));
      }
    });
    await runExecuteJob({ runId }, ctx(false), { execute });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(await statuses(runId)).toEqual(['https://x.test/1:done', 'https://x.test/2:done']);
  });

  it('a pass that recorded nothing is not repeated, even with work pending', async () => {
    const runId = await runWithItems();
    await db.update(runItems).set({ status: 'pending', startedAt: null }).where(eq(runItems.runId, runId));
    const execute = vi.fn<Execute>(async () => {});
    await runExecuteJob({ runId }, ctx(false), { execute });
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
