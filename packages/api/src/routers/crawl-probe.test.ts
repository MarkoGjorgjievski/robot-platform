// packages/api/src/routers/crawl-probe.test.ts
// crawl.probeAndSample — the probe-confirm flow's fire-and-forget entry point
// (mvp-simplification task 8). Follows crawl.test.ts's stubbing pattern: the
// heavy dependencies (`planSource`, `startExecution`) are mocked at the
// module boundary so this exercises ONLY the router's own logic — what it
// passes down, and whether it starts execution at all — without a real
// planner, browser, or extraction loop.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, sources, orgs, projects, datasets, runs } from '@robot/db';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from './index.js';
import { PROBE_SAMPLE_LIMIT } from '../crawl/probe.js';
import type { PlanSourceResult } from '../crawl/plan-source.js';

const { planSourceMock, startExecutionMock, markRunExtractingMock } = vi.hoisted(() => ({
  planSourceMock: vi.fn(),
  startExecutionMock: vi.fn(),
  markRunExtractingMock: vi.fn(),
}));

vi.mock('../crawl/plan-source.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../crawl/plan-source.js')>();
  return { ...actual, planSource: planSourceMock };
});

vi.mock('../crawl/start-execution.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../crawl/start-execution.js')>();
  return { ...actual, startExecution: startExecutionMock };
});

// `planSource` is mocked and never actually inserts a `runs` row, so a real
// `markRunExtracting` — which UPDATEs `runs` by id — has nothing to act on
// for the fake run ids these tests use. Stubbed at the same module boundary
// as the other two, so what's under test is purely "did probeAndSample call
// it, with what argument, in which branch" — not the real UPDATE's behaviour,
// which `mark-extracting.test.ts` already covers.
vi.mock('../crawl/mark-extracting.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../crawl/mark-extracting.js')>();
  return { ...actual, markRunExtracting: markRunExtractingMock };
});

const caller = createCallerFactory(appRouter)({ db, session: null });
const SLUG = 'test-crawl-probe';
let orgId: string | null = null;

/** org → project → dataset → Source, no InputSet needed: planSource is mocked. */
async function makeSource() {
  const [org] = await db.insert(orgs).values({ name: SLUG, slug: SLUG }).returning();
  orgId = org!.id;
  const [project] = await db.insert(projects).values({ orgId: org!.id, name: SLUG, slug: SLUG }).returning();
  const [dataset] = await db.insert(datasets).values({ projectId: project!.id, name: SLUG, slug: SLUG, schema: [] }).returning();
  const [source] = await db.insert(sources).values({ datasetId: dataset!.id, name: SLUG, slug: SLUG, country: 'US' }).returning();
  return source!.id;
}

const OUTCOME_BASE: PlanSourceResult = {
  runId: 'run-placeholder',
  status: 'planned',
  itemCount: 0,
  listingPages: 0,
  warnings: [],
  errors: [],
  inputs: [],
  cacheWarm: false,
};

afterEach(async () => {
  planSourceMock.mockReset();
  startExecutionMock.mockReset();
  markRunExtractingMock.mockReset();
  if (orgId) await db.delete(orgs).where(eq(orgs.id, orgId));
  orgId = null;
});

describe('crawl.probeAndSample', () => {
  it('plans with probe: true, marks the run extracting, and starts execution at PROBE_SAMPLE_LIMIT when planning found work', async () => {
    const sourceId = await makeSource();
    planSourceMock.mockResolvedValue({
      ...OUTCOME_BASE,
      runId: 'run-1',
      status: 'planned',
      itemCount: 3,
      warnings: ['some warning'],
      errors: [],
    } satisfies PlanSourceResult);
    markRunExtractingMock.mockResolvedValue(true);
    startExecutionMock.mockResolvedValue(undefined);

    const result = await caller.crawl.probeAndSample({ sourceId });

    expect(planSourceMock).toHaveBeenCalledTimes(1);
    expect(planSourceMock).toHaveBeenCalledWith(expect.anything(), sourceId, { probe: true });

    // The run must be live-visible — `crawl.cancel` and the dashboard's
    // `isRunActive` both key off status, so a probe's execution window has to
    // flip the run to `extracting` exactly as `execute` does, not leave it at
    // `planned` for the whole sample.
    expect(markRunExtractingMock).toHaveBeenCalledTimes(1);
    expect(markRunExtractingMock).toHaveBeenCalledWith(expect.anything(), 'run-1');

    // Fire-and-forget, but the call itself is synchronous — the mock has
    // already recorded it by the time the mutation's promise resolves.
    expect(startExecutionMock).toHaveBeenCalledTimes(1);
    expect(startExecutionMock).toHaveBeenCalledWith('run-1', sourceId, expect.any(Array), PROBE_SAMPLE_LIMIT);

    // Order matters: the status flip is the synchronous, persisted half of
    // "starting a loop" and must land before the unawaited background call.
    const markOrder = markRunExtractingMock.mock.invocationCallOrder[0]!;
    const startOrder = startExecutionMock.mock.invocationCallOrder[0]!;
    expect(markOrder).toBeLessThan(startOrder);

    expect(result).toEqual({
      runId: 'run-1', status: 'planned', itemCount: 3, warnings: ['some warning'], errors: [],
    });
  });

  it('does not mark the run extracting or start execution when planning failed outright (all inputs failed)', async () => {
    const sourceId = await makeSource();
    planSourceMock.mockResolvedValue({
      ...OUTCOME_BASE,
      runId: 'run-2',
      status: 'failed',
      itemCount: 0,
      errors: [{ inputIndex: 0, message: 'listing capture failed: blocked' }],
    } satisfies PlanSourceResult);

    const result = await caller.crawl.probeAndSample({ sourceId });

    expect(markRunExtractingMock).not.toHaveBeenCalled();
    expect(startExecutionMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      runId: 'run-2',
      status: 'failed',
      itemCount: 0,
      warnings: [],
      errors: [{ inputIndex: 0, message: 'listing capture failed: blocked' }],
    });
  });

  it('does not mark the run extracting or start execution when planning "succeeded" but planned zero items', async () => {
    const sourceId = await makeSource();
    planSourceMock.mockResolvedValue({
      ...OUTCOME_BASE,
      runId: 'run-3',
      status: 'planned',
      itemCount: 0,
    } satisfies PlanSourceResult);

    const result = await caller.crawl.probeAndSample({ sourceId });

    expect(markRunExtractingMock).not.toHaveBeenCalled();
    expect(startExecutionMock).not.toHaveBeenCalled();
    expect(result.itemCount).toBe(0);
    expect(result.status).toBe('planned');
  });

  it('rejects a non-uuid sourceId', async () => {
    await expect(caller.crawl.probeAndSample({ sourceId: 'not-a-uuid' } as never)).rejects.toThrow();
    expect(planSourceMock).not.toHaveBeenCalled();
  });

  // Finding 3 (final-review-findings.md): the duplicate-probe guard did not
  // exist, so the "Probe & sample" button reappearing on every mount fired a
  // fresh PAID probe every click.
  describe('duplicate-probe guard', () => {
    // The Extract tab's first Extract stamps `confirmedAt`, and editing the
    // listing pages afterwards is ordinary — the tab's own banner asks for a
    // fresh sample when it happens. A probe is free (no AI), so the guard
    // that used to refuse a confirmed Source only produced a dead end.
    it('samples a confirmed Source, which the Extract tab asks for after a page edit', async () => {
      const sourceId = await makeSource();
      await db.update(sources).set({ confirmedAt: new Date() }).where(eq(sources.id, sourceId));
      planSourceMock.mockResolvedValue({ ...OUTCOME_BASE, runId: 'run-confirmed', status: 'planned', itemCount: 0 } satisfies PlanSourceResult);

      const result = await caller.crawl.probeAndSample({ sourceId });

      expect(result.runId).toBe('run-confirmed');
      expect(result.status).toBe('planned');
      expect(planSourceMock).toHaveBeenCalledWith(expect.anything(), sourceId, { probe: true });
    });

    it('hands back the existing run instead of starting a second probe when one is already in flight', async () => {
      const sourceId = await makeSource();
      const [existingRun] = await db.insert(runs)
        .values({ sourceId, status: 'extracting', inputLabel: 'probe' })
        .returning({ id: runs.id });

      const result = await caller.crawl.probeAndSample({ sourceId });

      expect(result.runId).toBe(existingRun!.id);
      expect(planSourceMock).not.toHaveBeenCalled();
      expect(markRunExtractingMock).not.toHaveBeenCalled();
      expect(startExecutionMock).not.toHaveBeenCalled();
    });

    it.each(['planning', 'planned', 'extracting', 'cancelling'])(
      'treats a probe run at %s as still in flight',
      async (status) => {
        const sourceId = await makeSource();
        const [existingRun] = await db.insert(runs)
          .values({ sourceId, status, inputLabel: 'probe' })
          .returning({ id: runs.id });

        const result = await caller.crawl.probeAndSample({ sourceId });

        expect(result.runId).toBe(existingRun!.id);
        expect(planSourceMock).not.toHaveBeenCalled();
      },
    );

    it.each(['completed', 'partial', 'failed', 'cancelled'])(
      'starts a fresh probe once the previous one reached a terminal status (%s)',
      async (status) => {
        const sourceId = await makeSource();
        // completedAt set alongside the terminal status: that's the only
        // combination `finaliseRun`/`planSource` ever actually write — a
        // terminal `status` with `completedAt` still null isn't a reachable
        // production state, so the fixture shouldn't simulate one either.
        await db.insert(runs).values({ sourceId, status, inputLabel: 'probe', completedAt: new Date() });
        planSourceMock.mockResolvedValue({
          ...OUTCOME_BASE,
          runId: 'run-fresh',
          status: 'planned',
          itemCount: 2,
        } satisfies PlanSourceResult);
        markRunExtractingMock.mockResolvedValue(true);
        startExecutionMock.mockResolvedValue(undefined);

        const result = await caller.crawl.probeAndSample({ sourceId });

        expect(result.runId).toBe('run-fresh');
        expect(planSourceMock).toHaveBeenCalledTimes(1);
      },
    );

    // Live bug (post-merge): `planSource` writes `status: 'planned'` for BOTH
    // a probe genuinely mid-flight (about to be flipped to 'extracting' a few
    // lines later) AND a 0-item listing walk that never reaches that flip at
    // all — as terminal as 'completed', just spelled differently. A status
    // list can't tell those apart; `completed_at` can, because it is set if
    // and only if nothing further will touch the run (finaliseRun's own
    // rule, which `planSource` follows identically). Live proof: run
    // f5b72f3a sat at 'planned' with completed_at set forever, and the old
    // status-list guard treated it as in-flight, making the Source
    // permanently unprobeable from the UI.
    it('does NOT reuse a probe run at planned when completed_at is set — that walk already finished with 0 items', async () => {
      const sourceId = await makeSource();
      await db.insert(runs).values({
        sourceId, status: 'planned', inputLabel: 'probe', completedAt: new Date(),
      });
      planSourceMock.mockResolvedValue({
        ...OUTCOME_BASE,
        runId: 'run-fresh-after-zero-item-planned',
        status: 'planned',
        itemCount: 2,
      } satisfies PlanSourceResult);
      markRunExtractingMock.mockResolvedValue(true);
      startExecutionMock.mockResolvedValue(undefined);

      const result = await caller.crawl.probeAndSample({ sourceId });

      expect(result.runId).toBe('run-fresh-after-zero-item-planned');
      expect(planSourceMock).toHaveBeenCalledTimes(1);
    });

    it('DOES reuse a probe run at planned when completed_at is still null — genuinely mid-flight', async () => {
      const sourceId = await makeSource();
      const [existingRun] = await db.insert(runs)
        .values({ sourceId, status: 'planned', inputLabel: 'probe', completedAt: null })
        .returning({ id: runs.id });

      const result = await caller.crawl.probeAndSample({ sourceId });

      expect(result.runId).toBe(existingRun!.id);
      expect(planSourceMock).not.toHaveBeenCalled();
    });

    it('does not mistake a real crawl (a non-probe run) for an in-flight probe', async () => {
      const sourceId = await makeSource();
      await db.insert(runs).values({ sourceId, status: 'extracting', inputLabel: 'a-real-crawl' });
      planSourceMock.mockResolvedValue({
        ...OUTCOME_BASE,
        runId: 'run-real-probe',
        status: 'planned',
        itemCount: 1,
      } satisfies PlanSourceResult);
      markRunExtractingMock.mockResolvedValue(true);
      startExecutionMock.mockResolvedValue(undefined);

      const result = await caller.crawl.probeAndSample({ sourceId });

      expect(result.runId).toBe('run-real-probe');
      expect(planSourceMock).toHaveBeenCalledTimes(1);
    });
  });
});

// ─── Task 13: the certification gate ────────────────────────────────────────

describe('crawl.probeAndSample — certification gate', () => {
  it('refuses a customer Source with no current certification, before touching planSource', async () => {
    const [org] = await db.insert(orgs).values({ name: SLUG, slug: SLUG }).returning();
    orgId = org!.id;
    const [project] = await db.insert(projects).values({ orgId: org!.id, name: SLUG, slug: SLUG }).returning();
    const [dataset] = await db.insert(datasets).values({ projectId: project!.id, name: SLUG, slug: SLUG, schema: [] }).returning();
    const [source] = await db.insert(sources).values({
      datasetId: dataset!.id, name: SLUG, slug: SLUG, country: 'US',
      schemaDefinition: [{ key: 'price', name: 'Price', type: 'money', description: 'x', concept: 'price' }],
    }).returning();

    await expect(caller.crawl.probeAndSample({ sourceId: source!.id }))
      .rejects.toThrow(/Verify the schema before extracting/);
    expect(planSourceMock).not.toHaveBeenCalled();
  });
});
