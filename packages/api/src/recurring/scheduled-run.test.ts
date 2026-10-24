// Spec 2026-10-24 §3.2 "Starting": the scheduled-run job plans like crawl.plan, then starts the run — stubbed planner.
import { describe, it, expect, afterAll, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, runs } from '@robot/db';
import { signedInCaller } from '../test-helpers/identity.js';
import { createProjectWithSource } from '../test-helpers/customer-source.js';
import { jobRegistry } from '../jobs/handlers.js';
import { JOB_POLICIES } from '../jobs/types.js';
import type { planSource } from '../crawl/plan-source.js';
import type { startRunJob } from '../jobs/handlers/run.js';
import { NOTHING_PLANNED, runScheduledRun } from './scheduled-run.js';

const me = await signedInCaller('scheduled-run');
afterAll(async () => { await me.cleanup(); });

const planned = (status: 'planned' | 'failed', itemCount: number) => vi.fn(async (_db: unknown, _s: string, o: { runId?: string }) => ({
  runId: o.runId!, status, itemCount, listingPages: 0, warnings: [], errors: [], inputs: [], cacheWarm: true,
})) as unknown as typeof planSource & ReturnType<typeof vi.fn>;

async function withRun(status: string, errorMessage: string | null = null) {
  const f = await createProjectWithSource(me.caller, { tag: 'scheduled-run', fields: [{ name: 'Price', type: 'money' }] });
  const [run] = await db.insert(runs).values({ sourceId: f.sourceId, status, inputLabel: 'scheduled', errorMessage }).returning({ id: runs.id });
  return { ...f, runId: run!.id };
}

describe('runScheduledRun', () => {
  it('plans at full limits on the run it was given, and starts the run when products were found', async () => {
    const f = await withRun('planning');
    try {
      const plan = planned('planned', 3);
      const start = vi.fn(async () => 'job-1') as unknown as typeof startRunJob & ReturnType<typeof vi.fn>;
      expect(await runScheduledRun({ sourceId: f.sourceId, runId: f.runId }, { plan, start })).toEqual({ started: true });
      expect(plan).toHaveBeenCalledWith(db, f.sourceId, { probe: false, runId: f.runId });
      expect(start).toHaveBeenCalledWith(db, { runId: f.runId });
    } finally { await f.cleanup(); }
  });
  it('a failed plan stays failed with its own reason; nothing starts', async () => {
    const f = await withRun('failed', 'The listing page could not be read.');
    try {
      const start = vi.fn() as unknown as typeof startRunJob & ReturnType<typeof vi.fn>;
      expect(await runScheduledRun({ sourceId: f.sourceId, runId: f.runId }, { plan: planned('failed', 0), start })).toEqual({ started: false });
      expect(start).not.toHaveBeenCalled();
      expect(await db.query.runs.findFirst({ where: eq(runs.id, f.runId), columns: { status: true, errorMessage: true } }))
        .toEqual({ status: 'failed', errorMessage: 'The listing page could not be read.' });
    } finally { await f.cleanup(); }
  });
  it('a plan that found no products is closed failed with a sentence, not left planned', async () => {
    const f = await withRun('planned');
    try {
      const start = vi.fn() as unknown as typeof startRunJob & ReturnType<typeof vi.fn>;
      expect(await runScheduledRun({ sourceId: f.sourceId, runId: f.runId }, { plan: planned('planned', 0), start })).toEqual({ started: false });
      expect(start).not.toHaveBeenCalled();
      expect(await db.query.runs.findFirst({ where: eq(runs.id, f.runId), columns: { status: true, errorMessage: true } }))
        .toEqual({ status: 'failed', errorMessage: NOTHING_PLANNED });
    } finally { await f.cleanup(); }
  });
  it('the worker knows the job, with its policy and its run as the row it owns', () => {
    const def = jobRegistry()['scheduled-run']!;
    expect(def.policy).toBe(JOB_POLICIES['scheduled-run']);
    expect(def.subject?.({ sourceId: 's', runId: 'r' })).toEqual({ table: 'runs', id: 'r' });
  });
});
