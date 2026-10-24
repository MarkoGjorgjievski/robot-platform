// Spec 2026-10-24 §3.2 "Starting": the scheduled-run job plans like crawl.plan, then starts the run — stubbed planner.
import { describe, it, expect, afterAll, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, runs } from '@robot/db';
import { signedInCaller } from '../test-helpers/identity.js';
import { createProjectWithSource } from '../test-helpers/customer-source.js';
import { jobRegistry } from '../jobs/handlers.js';
import { JOB_POLICIES, RUN_STOPPED } from '../jobs/types.js';
import type { CertifiedPath } from '@robot/scraper';
import { seedPassingVerification } from '../test-helpers/seed-coverage-check.js';
import type { planSource } from '../crawl/plan-source.js';
import type { startRunJob } from '../jobs/handlers/run.js';
import { NOT_CERTIFIED_RUN, NOTHING_PLANNED, runScheduledRun } from './scheduled-run.js';

const me = await signedInCaller('scheduled-run');
afterAll(async () => { await me.cleanup(); });

const planned = (status: 'planned' | 'failed', itemCount: number) => vi.fn(async (_db: unknown, _s: string, o: { runId?: string }) => ({
  runId: o.runId!, status, itemCount, listingPages: 0, warnings: [], errors: [], inputs: [], cacheWarm: true,
})) as unknown as typeof planSource & ReturnType<typeof vi.fn>;

const LD: CertifiedPath = { source: 'json-ld', path: 'offers.price', transform: 'identity' };

/** A website (certified unless told otherwise) with one scheduled run in `status`. */
async function withRun(status: string, errorMessage: string | null = null, opts: { certified?: boolean } = {}) {
  const urls = [1, 2, 3].map((n) => `https://test-scheduled-run.example.com/p/${n}`);
  const f = await createProjectWithSource(me.caller, {
    tag: 'scheduled-run', urls, fields: [{ name: 'Price', type: 'money' }],
    expected: { Price: Object.fromEntries(urls.map((u, i) => [u, `${i + 1}.00`])) },
  });
  if (opts.certified !== false) await seedPassingVerification(f.sourceId, { [f.keys.Price!]: [LD] });
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
  it('a start that throws after a good plan closes the run failed, never left planned (fix round 1)', async () => {
    const f = await withRun('planned');
    try {
      const start = vi.fn(async () => { throw new Error('connection reset'); }) as unknown as typeof startRunJob & ReturnType<typeof vi.fn>;
      await expect(runScheduledRun({ sourceId: f.sourceId, runId: f.runId }, { plan: planned('planned', 3), start })).rejects.toThrow('connection reset');
      expect(await db.query.runs.findFirst({ where: eq(runs.id, f.runId), columns: { status: true, errorMessage: true } }))
        .toEqual({ status: 'failed', errorMessage: RUN_STOPPED });
    } finally { await f.cleanup(); }
  });
  it('certification is checked again before the start: lost since the sweep, the run is closed failed (fix round 1)', async () => {
    const f = await withRun('planned', null, { certified: false });
    try {
      const start = vi.fn() as unknown as typeof startRunJob & ReturnType<typeof vi.fn>;
      expect(await runScheduledRun({ sourceId: f.sourceId, runId: f.runId }, { plan: planned('planned', 3), start })).toEqual({ started: false });
      expect(start).not.toHaveBeenCalled();
      expect(await db.query.runs.findFirst({ where: eq(runs.id, f.runId), columns: { status: true, errorMessage: true } }))
        .toEqual({ status: 'failed', errorMessage: NOT_CERTIFIED_RUN });
    } finally { await f.cleanup(); }
  });
  it('the worker knows the job, with its policy and its run as the row it owns', () => {
    const def = jobRegistry()['scheduled-run']!;
    expect(def.policy).toBe(JOB_POLICIES['scheduled-run']);
    expect(def.subject?.({ sourceId: 's', runId: 'r' })).toEqual({ table: 'runs', id: 'r' });
  });
});
