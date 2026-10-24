// Planning at the organisation's monthly limit (spec 2026-10-24 metering §2.3): a plan whose walk asked the model past
// the limit is failed with the one customer sentence and writes no items; a plan that needs no model call is the same
// at the limit. No browser and no model: the walk (`planRun`) is stubbed and asks the agent it is handed, swallowing a
// failed model step the way planRun does.
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { CAP_REACHED_MESSAGE } from '@robot/scraper/customer-copy';
import { capJobsOpen, recordUsage } from '@robot/agent';
import { db, inputSets, orgs, runItems, runs, sources } from '@robot/db';
import { createProjectWithSource } from '../test-helpers/customer-source.js';
import { signedInCaller } from '../test-helpers/identity.js';
import { withJobRunner, JOB_TEST_MS } from '../test-helpers/jobs.js';

const { planRunMock, detect } = vi.hoisted(() => ({ planRunMock: vi.fn(), detect: vi.fn(async () => ({ type: 'none' })) }));
vi.mock('@robot/scraper', async (orig) => ({ ...(await orig<typeof import('@robot/scraper')>()), planRun: planRunMock }));
vi.mock('@robot/agent', async (orig) => {
  const actual = await orig<typeof import('@robot/agent')>();
  class FakeSchemaAgent { detectPagination = detect; }
  return { ...actual, SchemaAgent: FakeSchemaAgent };
});
vi.mock('../browser-session.js', () => ({ withBrowserSession: async (fn: (b: unknown) => Promise<unknown>) => fn({}) }));

const { planSource, planningRunValues } = await import('./plan-source.js');
const me = await signedInCaller('plan-source-cap');
/** A second organisation, for plans of two orgs at once (final review I2). */
const other = await signedInCaller('plan-source-cap-other');
afterEach(async () => {
  planRunMock.mockReset(); detect.mockClear();
  await db.update(orgs).set({ aiCapUsd: null }).where(eq(orgs.id, me.org.id));
});
afterAll(async () => { await me.cleanup(); await other.cleanup(); });

async function plannable(tag: string, who: { caller: typeof me.caller } = me) {
  const f = await createProjectWithSource(who.caller, { tag, fields: [{ name: 'Title', type: 'text' }] });
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
/** A walk that asks the model `times` times and keeps going past a refusal, as planRun does past a failed model step. */
const askingWalk = (tag: string, times = 1) => async (_input: unknown, deps: { agent: { detectPagination: (html: string) => Promise<unknown> } }) => {
  for (let i = 0; i < times; i++) await deps.agent.detectPagination('<html></html>').catch(() => undefined);
  return outcome(tag);
};
const runRow = async (id: string) => (await db.query.runs.findFirst({ where: eq(runs.id, id) }))!;
const itemsOf = async (id: string) => db.select().from(runItems).where(eq(runItems.runId, id));

describe('planSource and the monthly limit (spec 2026-10-24 metering §2.3)', () => {
  it('at the limit, a plan that needs the model is failed with the sentence and writes no items; no call is made', async () => {
    await db.update(orgs).set({ aiCapUsd: '0.00' }).where(eq(orgs.id, me.org.id));
    const f = await plannable('plan-cap-at');
    try {
      planRunMock.mockImplementationOnce(askingWalk('plan-cap-at'));
      const out = await planSource(db, f.sourceId, { runId: f.runId });
      expect(out).toMatchObject({ status: 'failed', itemCount: 0, listingPages: 0 });
      // Final review I1: the answer carries the one sentence only — no walk warning naming a model step.
      expect(out.warnings).toEqual([]);
      expect(out.errors).toEqual([{ inputIndex: 0, message: CAP_REACHED_MESSAGE }]);
      expect(await runRow(f.runId)).toMatchObject({ status: 'failed', errorMessage: CAP_REACHED_MESSAGE, logs: null });
      expect(await itemsOf(f.runId)).toEqual([]);
      expect(detect).not.toHaveBeenCalled();
      // The plan's slot is released once its cost is recorded.
      expect(capJobsOpen()).toBe(0);
    } finally { await f.cleanup(); }
  });

  it("final review I1: crawl.plan at the limit answers the one sentence, never the walk's warnings or errors", async () => {
    await db.update(orgs).set({ aiCapUsd: '0.00' }).where(eq(orgs.id, me.org.id));
    const f = await plannable('plan-cap-answer');
    try {
      // The walk keeps going past the refusal and reports it in its own words, naming the model steps.
      planRunMock.mockImplementationOnce(async (input: unknown, deps: Parameters<ReturnType<typeof askingWalk>>[1]) => ({
        ...(await askingWalk('plan-cap-answer')(input, deps)),
        warnings: ["https://test-plan-cap-answer.example.com/list: XPath fallback (generateSelectors) failed: This organisation's monthly limit is reached."],
        errors: [{ inputIndex: 0, message: "pagination failed: This organisation's monthly limit is reached." }],
      }));
      const answer = await withJobRunner(() => me.caller.crawl.plan({ sourceId: f.sourceId, probe: true }));
      expect(answer).toMatchObject({ status: 'failed', itemCount: 0 });
      expect(answer.warnings).toEqual([]);
      expect(answer.errors).toEqual([{ inputIndex: 0, message: CAP_REACHED_MESSAGE }]);
    } finally { await f.cleanup(); }
  }, JOB_TEST_MS);

  it('a plan that needs no model call is planned at the limit (spec §3.2)', async () => {
    await db.update(orgs).set({ aiCapUsd: '0.00' }).where(eq(orgs.id, me.org.id));
    const f = await plannable('plan-cap-free');
    try {
      planRunMock.mockResolvedValueOnce(outcome('plan-cap-free'));
      expect(await planSource(db, f.sourceId, { runId: f.runId })).toMatchObject({ status: 'planned', itemCount: 1 });
      expect(await itemsOf(f.runId)).toHaveLength(2);
    } finally { await f.cleanup(); }
  });

  it('reached during planning ($0.10 left at $0.05 a call): two calls are made, the third stops the plan', async () => {
    await db.update(orgs).set({ aiCapUsd: '0.10' }).where(eq(orgs.id, me.org.id));
    const f = await plannable('plan-cap-during');
    try {
      planRunMock.mockImplementationOnce(askingWalk('plan-cap-during', 3));
      const out = await planSource(db, f.sourceId, { runId: f.runId });
      expect(out).toMatchObject({ status: 'failed', warnings: [], errors: [{ inputIndex: 0, message: CAP_REACHED_MESSAGE }] });
      expect(detect).toHaveBeenCalledTimes(2);
      expect((await runRow(f.runId)).errorMessage).toBe(CAP_REACHED_MESSAGE);
    } finally { await f.cleanup(); }
  });

  it('a refusal that ends the walk fails the run with the sentence too, never the internal error text', async () => {
    await db.update(orgs).set({ aiCapUsd: '0.00' }).where(eq(orgs.id, me.org.id));
    const f = await plannable('plan-cap-throw');
    try {
      planRunMock.mockImplementationOnce(async (_input: unknown, deps: { agent: { detectPagination: (h: string) => Promise<unknown> } }) => {
        await deps.agent.detectPagination('<html></html>');
        return outcome('plan-cap-throw');
      });
      await expect(planSource(db, f.sourceId, { runId: f.runId })).rejects.toThrow();
      expect(await runRow(f.runId)).toMatchObject({ status: 'failed', errorMessage: CAP_REACHED_MESSAGE });
      expect(await itemsOf(f.runId)).toEqual([]);
      expect(capJobsOpen()).toBe(0);
    } finally { await f.cleanup(); }
  });

  it('final review I2: two plans of two organisations at once each record only their own model calls', async () => {
    const a = await plannable('plan-conc-a');
    const b = await plannable('plan-conc-b', other);
    const tick = () => new Promise((r) => setTimeout(r, 5));
    try {
      // A asks once, B three times, interleaved; each call bills $0.06 (10k in, 2k out on claude-sonnet-5).
      planRunMock.mockImplementation(async (input: { inputSet: { rows: Array<{ url: string }> } }, deps: { agent: { detectPagination: (h: string) => Promise<unknown> } }) => {
        const tag = input.inputSet.rows[0]!.url.includes('plan-conc-a') ? 'plan-conc-a' : 'plan-conc-b';
        for (let i = 0; i < (tag === 'plan-conc-a' ? 1 : 3); i++) {
          await tick(); await deps.agent.detectPagination('<html></html>');
          recordUsage('claude-sonnet-5', { input_tokens: 10_000, output_tokens: 2_000 });
        }
        await tick();
        return outcome(tag);
      });
      await Promise.all([planSource(db, a.sourceId, { runId: a.runId }), planSource(db, b.sourceId, { runId: b.runId })]);
      expect((await runRow(a.runId)).costUsd).toBe('0.0600');
      expect((await runRow(b.runId)).costUsd).toBe('0.1800');
    } finally { await a.cleanup(); await b.cleanup(); }
  });

  it('with room, the model is asked and the plan is written', async () => {
    const f = await plannable('plan-cap-room');
    try {
      planRunMock.mockImplementationOnce(askingWalk('plan-cap-room'));
      expect(await planSource(db, f.sourceId, { runId: f.runId })).toMatchObject({ status: 'planned', itemCount: 1 });
      expect(detect).toHaveBeenCalledTimes(1);
    } finally { await f.cleanup(); }
  });
});
