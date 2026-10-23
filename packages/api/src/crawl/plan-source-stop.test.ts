// planSource as the `plan` job's body (spec 2026-10-23 §4.4): a stopped job writes no outcome (final
// review I1), and every write is conditional on the run still `planning` (M2). No browser, no model:
// the walk (`planRun`) and the session are stubbed.
import { describe, it, expect, vi, afterAll, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, runs, runItems, inputSets, sources } from '@robot/db';
import { createProjectWithSource } from '../test-helpers/customer-source.js';
import { signedInCaller } from '../test-helpers/identity.js';
import { jobContext } from '../test-helpers/jobs.js';
import { runInJob } from '../jobs/context.js';

const { planRunMock } = vi.hoisted(() => ({ planRunMock: vi.fn() }));
vi.mock('@robot/scraper', async (orig) => ({ ...(await orig<typeof import('@robot/scraper')>()), planRun: planRunMock }));
vi.mock('@robot/agent', async (orig) => {
  const actual = await orig<typeof import('@robot/agent')>();
  class NoAgent {}
  return { ...actual, SchemaAgent: NoAgent };
});
vi.mock('../browser-session.js', () => ({ withBrowserSession: async (fn: (b: unknown) => Promise<unknown>) => fn({}) }));

const { planSource, planningRunValues } = await import('./plan-source.js');

const me = await signedInCaller('plan-source-stop');
afterAll(async () => { await me.cleanup(); });
afterEach(() => { planRunMock.mockReset(); });

async function plannable(tag: string) {
  const f = await createProjectWithSource(me.caller, { tag, fields: [{ name: 'Title', type: 'text' }] });
  const [set] = await db.insert(inputSets).values({ projectId: f.projectId, type: 'direct', name: tag, columns: [{ name: 'url', primary: true }], rows: [{ url: `https://test-${tag}.example.com/list` }] }).returning({ id: inputSets.id });
  await db.update(sources).set({ inputSetId: set!.id }).where(eq(sources.id, f.sourceId));
  const source = (await db.query.sources.findFirst({ where: eq(sources.id, f.sourceId) }))!;
  const [run] = await db.insert(runs).values(planningRunValues(source, false)).returning({ id: runs.id });
  return { ...f, runId: run!.id };
}

const outcome = (tag: string) => ({
  items: [
    { kind: 'listing', url: `https://test-${tag}.example.com/list`, inputIndex: 0, inputValues: {}, listingValues: {}, pageNumber: 1 },
    { kind: 'detail', url: `https://test-${tag}.example.com/p/1`, inputIndex: 0, inputValues: {}, listingValues: {}, pageNumber: 1 },
  ],
  inputs: [{ inputIndex: 0, status: 'ok' }], warnings: [], errors: [], cacheWarm: false,
});
const runRow = async (id: string) => (await db.query.runs.findFirst({ where: eq(runs.id, id) }))!;
const itemsOf = async (id: string) => db.select().from(runItems).where(eq(runItems.runId, id));

describe('planSource in a stopped job (final review I1)', () => {
  it('stopped mid-walk, the run stays planning with no items — the walk failing or finishing alike — and the next claim plans it', async () => {
    const f = await plannable('plan-stop');
    try {
      // Shutdown: the browser is closed under the walk, which throws.
      const first = new AbortController();
      planRunMock.mockImplementationOnce(async () => { first.abort('shutdown'); throw new Error('Target page, context or browser has been closed'); });
      await expect(runInJob(jobContext('plan', first), () => planSource(db, f.sourceId, { runId: f.runId }))).rejects.toThrow();
      expect(await runRow(f.runId)).toMatchObject({ status: 'planning', errorMessage: null, completedAt: null });
      // Stopped, but the walk came back anyway: no items, no status.
      const second = new AbortController();
      planRunMock.mockImplementationOnce(async () => { second.abort('lease lost'); return outcome('plan-stop'); });
      await expect(runInJob(jobContext('plan', second), () => planSource(db, f.sourceId, { runId: f.runId }))).rejects.toThrow();
      expect(await runRow(f.runId)).toMatchObject({ status: 'planning', completedAt: null });
      expect(await itemsOf(f.runId)).toEqual([]);
      // Claimed again: the plan is written.
      planRunMock.mockResolvedValueOnce(outcome('plan-stop'));
      const out = await runInJob(jobContext('plan', new AbortController(), { retry: true }), () => planSource(db, f.sourceId, { runId: f.runId }));
      expect(out).toMatchObject({ status: 'planned', itemCount: 1, listingPages: 1 });
      expect(await runRow(f.runId)).toMatchObject({ status: 'planned' });
      expect(await itemsOf(f.runId)).toHaveLength(2);
    } finally { await f.cleanup(); }
  });
});

describe('planSource writes only a run still planning (M2)', () => {
  it('a run closed while it was walked keeps what closed it: no items, no status, its sentence stands', async () => {
    const f = await plannable('plan-closed');
    try {
      const close = () => db.update(runs).set({ status: 'failed', errorMessage: 'closed', completedAt: new Date() }).where(eq(runs.id, f.runId));
      planRunMock.mockImplementationOnce(async () => { await close(); return outcome('plan-closed'); });
      await expect(planSource(db, f.sourceId, { runId: f.runId })).rejects.toThrow();
      expect(await runRow(f.runId)).toMatchObject({ status: 'failed', errorMessage: 'closed' });
      expect(await itemsOf(f.runId)).toEqual([]);
      planRunMock.mockImplementationOnce(async () => { throw new Error('the walk failed'); });
      await expect(planSource(db, f.sourceId, { runId: f.runId })).rejects.toThrow();
      expect(await runRow(f.runId)).toMatchObject({ status: 'failed', errorMessage: 'closed' });
    } finally { await f.cleanup(); }
  });

  it('a run already closed is not walked at all', async () => {
    const f = await plannable('plan-gone');
    try {
      await db.update(runs).set({ status: 'failed', errorMessage: 'stalled', completedAt: new Date() }).where(eq(runs.id, f.runId));
      await expect(planSource(db, f.sourceId, { runId: f.runId })).rejects.toThrow();
      expect(planRunMock).not.toHaveBeenCalled();
    } finally { await f.cleanup(); }
  });
});
