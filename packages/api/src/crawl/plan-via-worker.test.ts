// Planning answers from the worker (spec 2026-10-23 §4.4): the planning run row is written with its
// `plan` job; the request waits for the plan; a plan job that never answers closes its run.
import { describe, it, expect, vi, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, runs, inputSets, sources } from '@robot/db';
import { withJobRunner, jobsOf } from '../test-helpers/jobs.js';
import { createProjectWithSource } from '../test-helpers/customer-source.js';
import { signedInCaller } from '../test-helpers/identity.js';
import { JOB_POLICIES, PLAN_STOPPED } from '../jobs/types.js';
import type { Registry } from '../jobs/runner.js';

vi.mock('./plan-source.js', async (orig) => {
  const real = await orig<typeof import('./plan-source.js')>();
  return { ...real, planSource: vi.fn(async (_db: unknown, _s: string, o: { runId?: string }) => ({ runId: o.runId!, status: 'planned', itemCount: 2, listingPages: 1, warnings: [], errors: [], inputs: [], cacheWarm: false })) };
});
const { planViaWorker } = await import('./plan-via-worker.js');

const me = await signedInCaller('plan-via-worker');
afterAll(async () => { await me.cleanup(); });

/** A website with an input set to plan from (the precondition `assertPlannable` keeps). */
async function plannable(tag: string) {
  const f = await createProjectWithSource(me.caller, { tag, fields: [{ name: 'Title', type: 'text' }] });
  const [set] = await db.insert(inputSets).values({ projectId: f.projectId, type: 'direct', name: tag, columns: [{ name: 'url', primary: true }], rows: [{ url: `https://test-${tag}.example.com/list` }] }).returning({ id: inputSets.id });
  await db.update(sources).set({ inputSetId: set!.id }).where(eq(sources.id, f.sourceId));
  return f;
}

describe('planViaWorker (spec 2026-10-23 §4.4)', () => {
  it('inserts the planning run stamped with its plan job, and answers the plan', async () => {
    const f = await plannable('pvw');
    try {
      const out = await withJobRunner(() => planViaWorker(db, f.sourceId, { probe: true }));
      expect(out).toMatchObject({ status: 'planned', itemCount: 2 });
      const job = (await jobsOf('plan')).find((j) => (j.payload as { sourceId: string }).sourceId === f.sourceId);
      expect(job).toMatchObject({ status: 'done', key: `plan:${out.runId}`, payload: { sourceId: f.sourceId, runId: out.runId, probe: true } });
      expect(await db.query.runs.findFirst({ where: eq(runs.id, out.runId) })).toMatchObject({ jobId: job!.id, inputLabel: 'probe' });
    } finally { await f.cleanup(); }
  });

  it('a plan job that dies closes its run with the sentence, and the caller reads the sentence', async () => {
    const f = await plannable('pvw-dies');
    try {
      const dying: Registry = { plan: { policy: JOB_POLICIES.plan, run: async () => { throw new Error('worker died'); } } };
      await expect(withJobRunner(() => planViaWorker(db, f.sourceId, { probe: false }), { registry: dying }))
        .rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR', message: PLAN_STOPPED });
      const [run] = await db.query.runs.findMany({ where: eq(runs.sourceId, f.sourceId) });
      expect(run).toMatchObject({ status: 'failed', errorMessage: PLAN_STOPPED });
    } finally { await f.cleanup(); }
  });

  it('a precondition error from planning keeps its code across the worker', async () => {
    const f = await plannable('pvw-precondition');
    try {
      const refusing: Registry = { plan: { policy: JOB_POLICIES.plan, run: async () => { const { TRPCError } = await import('@trpc/server'); throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'no' }); } } };
      await expect(withJobRunner(() => planViaWorker(db, f.sourceId, { probe: true }), { registry: refusing }))
        .rejects.toMatchObject({ code: 'PRECONDITION_FAILED', message: 'no' });
    } finally { await f.cleanup(); }
  });

  it('with no worker the run closes with the sentence and the caller reads it', async () => {
    const f = await plannable('pvw-none');
    process.env.JOB_AWAIT_MAX_MS = '300';
    try {
      await expect(planViaWorker(db, f.sourceId, { probe: true })).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR', message: PLAN_STOPPED });
      // Not left to start later behind the customer's back: the job is failed and its run closed.
      const [run] = await db.query.runs.findMany({ where: eq(runs.sourceId, f.sourceId) });
      expect(run).toMatchObject({ status: 'failed', errorMessage: PLAN_STOPPED });
      expect((await jobsOf('plan')).find((j) => j.id === run!.jobId)).toMatchObject({ status: 'failed' });
    } finally { delete process.env.JOB_AWAIT_MAX_MS; await f.cleanup(); }
  });

  it('a website with no input set is refused before anything is written', async () => {
    const f = await createProjectWithSource(me.caller, { tag: 'pvw-noinput', fields: [{ name: 'Title', type: 'text' }] });
    try {
      await expect(planViaWorker(db, f.sourceId, { probe: true })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
      expect(await db.query.runs.findMany({ where: eq(runs.sourceId, f.sourceId) })).toEqual([]);
    } finally { await f.cleanup(); }
  });
});
