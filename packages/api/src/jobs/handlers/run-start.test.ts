// A run is marked extracting and its job enqueued in one transaction: never a run that reads extracting
// with no job to run it (whole-branch final list).
import { describe, it, expect, vi, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, runs } from '@robot/db';
import { createTestSource, deleteTestSource } from '../../test-helpers/source.js';
import { jobsOf } from '../../test-helpers/jobs.js';

const { failEnqueue } = vi.hoisted(() => ({ failEnqueue: { on: false } }));
vi.mock('../enqueue.js', async (orig) => {
  const real = await orig<typeof import('../enqueue.js')>();
  return { ...real, enqueue: (async (...args: Parameters<typeof real.enqueue>) => {
    if (failEnqueue.on) throw new Error('the database went away');
    return real.enqueue(...args);
  }) as typeof real.enqueue };
});
const { startRunJob } = await import('./run.js');

const sources: string[] = [];
afterAll(async () => { for (const s of sources) await deleteTestSource(s); });
async function plannedRun() {
  const sourceId = await createTestSource({ schema: [] });
  sources.push(sourceId);
  const [run] = await db.insert(runs).values({ sourceId, status: 'planned' }).returning();
  return run!.id;
}
const runRow = async (id: string) => (await db.query.runs.findFirst({ where: eq(runs.id, id) }))!;

describe('startRunJob', () => {
  it('marks the run extracting, enqueues its job and stamps the run with it', async () => {
    const runId = await plannedRun();
    const jobId = await startRunJob(db, { runId, limit: 5 });
    expect(await runRow(runId)).toMatchObject({ status: 'extracting', jobId });
    expect((await jobsOf('run')).map((j) => [j.id, j.payload])).toEqual([[jobId, { runId, limit: 5 }]]);
  });

  it('an enqueue that fails leaves the run as it was: not extracting with no job', async () => {
    const runId = await plannedRun();
    failEnqueue.on = true;
    try { await expect(startRunJob(db, { runId })).rejects.toThrow('the database went away'); } finally { failEnqueue.on = false; }
    expect(await runRow(runId)).toMatchObject({ status: 'planned', jobId: null });
  });

  it('a cancelling run is not flipped, and still gets its job (whose first look settles the Stop)', async () => {
    const runId = await plannedRun();
    await db.update(runs).set({ status: 'cancelling' }).where(eq(runs.id, runId));
    const jobId = await startRunJob(db, { runId });
    expect(await runRow(runId)).toMatchObject({ status: 'cancelling', jobId });
  });
});
