// packages/api/src/routers/crawl-backfill.test.ts
//
// `crawl.backfill`'s six ordered guards (task-6-brief.md) plus the happy
// path. `startExecution` is mocked exactly the way sources.test.ts mocks
// `planSource` — this file exercises the mutation's own behaviour (guards,
// the inserted run/items shapes, the args passed to execution), never a real
// browser or extraction chain.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, runs, runItems, extractions, captures, sources, sourceVerifications, orgs, projects, datasets } from '@robot/db';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from './index.js';
import { effectiveSchema } from '../crawl/effective-schema.js';

const { startExecutionMock, runRepairSweepMock } = vi.hoisted(() => ({
  startExecutionMock: vi.fn(),
  runRepairSweepMock: vi.fn(),
}));
vi.mock('../crawl/start-execution.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../crawl/start-execution.js')>();
  return { ...actual, startExecution: startExecutionMock };
});
vi.mock('../crawl/repair-sweep.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../crawl/repair-sweep.js')>();
  return { ...actual, runRepairSweep: runRepairSweepMock };
});

const caller = createCallerFactory(appRouter)({ db, session: null });
const SLUG = 'test-crawl-backfill';
let orgId: string | null = null;

async function seedSource(schema: Array<{ name: string; type: string }>) {
  const [org] = await db.insert(orgs).values({ name: SLUG, slug: SLUG }).returning();
  orgId = org!.id;
  const [project] = await db.insert(projects).values({ orgId: org!.id, name: SLUG, slug: SLUG }).returning();
  const [dataset] = await db.insert(datasets).values({ projectId: project!.id, name: SLUG, slug: SLUG, schema }).returning();
  const [source] = await db.insert(sources).values({ datasetId: dataset!.id, name: SLUG, slug: SLUG, country: 'US' }).returning();
  return source!.id;
}

/** A parent run still executing (no completedAt) — guard 2's target. */
async function seedStillExecutingRun() {
  const sourceId = await seedSource([{ name: 'title', type: 'string' }]);
  const [run] = await db.insert(runs).values({ sourceId, status: 'extracting' }).returning();
  return run!.id;
}

/**
 * A completed BACKFILL run (inputLabel: 'backfill', its own parentRunId set)
 * with a gap of its own — the shape Finding 3 (final-review-findings.md)
 * says `crawl.backfill` must refuse: backfilling a backfill run strands the
 * merge on the backfill run's own (deliberately partial) items instead of
 * the real grandparent, whose coverage never improves and whose pages stay
 * re-purchasable indefinitely.
 */
async function seedCompletedBackfillRunWithGap() {
  const sourceId = await seedSource([{ name: 'title', type: 'string' }]);
  const [realParent] = await db.insert(runs).values({ sourceId, status: 'completed', completedAt: new Date() }).returning();
  const [backfillRun] = await db.insert(runs).values({
    sourceId, status: 'partial', completedAt: new Date(), inputLabel: 'backfill', parentRunId: realParent!.id, targetFields: ['title'],
  }).returning();
  await db.insert(runItems).values([
    { runId: backfillRun!.id, kind: 'detail', url: 'https://example.com/p/1', inputIndex: 0, status: 'failed', error: 'blocked' },
  ]);
  return { backfillRunId: backfillRun!.id, realParentRunId: realParent!.id };
}

/**
 * A completed parent with two detail items — one filled (`title`), one
 * failed with nothing extracted (both fields missing). `title` fills 1/2 =
 * 0.5 (healthy, the binding boundary); `isbn` fills 0/2 (dead). Mirrors
 * crawl-backfill-preview.test.ts's `seedRunWithGapItems`.
 */
async function seedCompletedRunWithDeadField() {
  const sourceId = await seedSource([{ name: 'title', type: 'string' }, { name: 'isbn', type: 'string' }]);
  const [run] = await db.insert(runs).values({ sourceId, status: 'completed', completedAt: new Date() }).returning();
  const [capture] = await db.insert(captures).values({ sourceId, runId: run!.id, url: 'https://example.com/p/1' }).returning();
  const [extraction] = await db.insert(extractions).values({
    sourceId, captureId: capture!.id, runId: run!.id,
    data: [{ title: 'A', isbn: null }],
  }).returning();
  await db.insert(runItems).values([
    { runId: run!.id, kind: 'detail', url: 'https://example.com/p/1', inputIndex: 0, status: 'done', extractionId: extraction!.id },
    { runId: run!.id, kind: 'detail', url: 'https://example.com/p/2', inputIndex: 0, status: 'failed', error: 'blocked' },
  ]);
  return { runId: run!.id, sourceId };
}

/** A completed parent whose only detail item fills every field — no gaps. */
async function seedCompletedRunWithNoGaps() {
  const sourceId = await seedSource([{ name: 'title', type: 'string' }]);
  const [run] = await db.insert(runs).values({ sourceId, status: 'completed', completedAt: new Date() }).returning();
  const [capture] = await db.insert(captures).values({ sourceId, runId: run!.id, url: 'https://example.com/p/1' }).returning();
  const [extraction] = await db.insert(extractions).values({
    sourceId, captureId: capture!.id, runId: run!.id,
    data: [{ title: 'A' }],
  }).returning();
  await db.insert(runItems).values({
    runId: run!.id, kind: 'detail', url: 'https://example.com/p/1', inputIndex: 0, status: 'done', extractionId: extraction!.id,
  });
  return run!.id;
}

/**
 * A completed parent with one healthy gap (`title` fills 1/2, the boundary —
 * no dead field, so `deadFieldStrategy` is not required). Parent items carry
 * distinctive inputValues/listingValues/inputIndex/pageNumber, so the happy
 * path can assert they were copied onto the backfill item.
 */
async function seedCompletedRunWithHealthyGap() {
  const sourceId = await seedSource([{ name: 'title', type: 'string' }]);
  const [run] = await db.insert(runs).values({ sourceId, status: 'completed', completedAt: new Date() }).returning();
  const [capture] = await db.insert(captures).values({ sourceId, runId: run!.id, url: 'https://example.com/p/1' }).returning();
  const [extraction] = await db.insert(extractions).values({
    sourceId, captureId: capture!.id, runId: run!.id,
    data: [{ title: 'A' }],
  }).returning();
  const [item1] = await db.insert(runItems).values({
    runId: run!.id, kind: 'detail', url: 'https://example.com/p/1', inputIndex: 0,
    inputValues: { sku: '1' }, listingValues: { cat: 'books' }, pageNumber: 1,
    status: 'done', extractionId: extraction!.id,
  }).returning();
  const [item2] = await db.insert(runItems).values({
    runId: run!.id, kind: 'detail', url: 'https://example.com/p/2', inputIndex: 2,
    inputValues: { sku: '2' }, listingValues: { cat: 'movies' }, pageNumber: 3,
    status: 'failed', error: 'blocked',
  }).returning();
  return { runId: run!.id, sourceId, item1Id: item1!.id, item2Id: item2!.id };
}

/**
 * Turns a seeded Source into a CUSTOMER-schema Source whose only
 * verification is stale: it completed and passed, but against a different
 * definition than the Source now carries (`definitionHash` mismatch), which
 * is exactly what `loadCurrentCertification` refuses to honour. I3's target.
 */
async function makeCustomerSchemaWithStaleCertification(sourceId: string) {
  const urls = ['https://example.com/p/1', 'https://example.com/p/2', 'https://example.com/p/3'];
  await db.update(sources).set({
    schemaDefinition: [{ key: 'title', name: 'Title', type: 'text', description: 'the product title', concept: 'title' }],
    verificationSet: { urls, expected: { title: Object.fromEntries(urls.map((u) => [u, 'A'])) } },
  }).where(eq(sources.id, sourceId));
  await db.insert(sourceVerifications).values({
    sourceId,
    definitionHash: 'a-hash-from-a-schema-this-source-no-longer-has',
    completedAt: new Date(),
    allPassed: true,
    results: { title: { key: 'title', cells: {}, certified: [{ source: 'api', path: 'title', transform: 'identity' }], weakEvidence: false, aiCalled: false, incomplete: false } },
  });
}

afterEach(async () => {
  startExecutionMock.mockReset();
  runRepairSweepMock.mockReset();
  if (orgId) await db.delete(orgs).where(eq(orgs.id, orgId));
  orgId = null;
});

describe('crawl.backfill', () => {
  // Finding 3 (important, final-review-findings.md): backfilling a backfill
  // run is reachable and strands data/money — the grandchild's merges fold
  // into the BACKFILL run's own items, never the real parent, whose gaps
  // stay open and whose pages stay re-purchasable indefinitely.
  it('refuses to backfill a run that is itself a backfill run, naming the real parent', async () => {
    const { backfillRunId, realParentRunId } = await seedCompletedBackfillRunWithGap();

    await expect(caller.crawl.backfill({ runId: backfillRunId }))
      .rejects.toThrow(new RegExp(`backfill.*parent.*${realParentRunId}`, 'i'));
    expect(startExecutionMock).not.toHaveBeenCalled();
  });

  // I3: a backfill buys pages exactly like `execute` does, and was the one
  // extraction entry point with no certification gate — so a customer Source
  // whose schema changed since its last verification could keep spending
  // against paths nobody has proven still work.
  it('refuses a customer Source whose certification is stale, writing nothing', async () => {
    const { runId, sourceId } = await seedCompletedRunWithHealthyGap();
    await makeCustomerSchemaWithStaleCertification(sourceId);

    await expect(caller.crawl.backfill({ runId })).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'Verify the schema before extracting',
    });

    expect(startExecutionMock).not.toHaveBeenCalled();
    // The gate runs before any side effect: no backfill run, no items.
    const children = await db.select().from(runs).where(eq(runs.parentRunId, runId));
    expect(children).toEqual([]);
  });

  // Guard 2: a still-executing parent has no settled coverage to backfill from.
  it('refuses a parent run that is still executing', async () => {
    const runId = await seedStillExecutingRun();

    await expect(caller.crawl.backfill({ runId })).rejects.toThrow(/still executing/i);
    expect(startExecutionMock).not.toHaveBeenCalled();
  });

  // Guard 3: an in-flight backfill against the same parent is reused, not duplicated.
  it('returns the same backfillRunId when a backfill for this parent is already in flight', async () => {
    const { runId, sourceId } = await seedCompletedRunWithHealthyGap();
    const [existingBackfill] = await db.insert(runs).values({
      sourceId, status: 'extracting', parentRunId: runId,
    }).returning();

    const result = await caller.crawl.backfill({ runId });

    expect(result).toEqual({ backfillRunId: existingBackfill!.id, status: 'in-progress' });
    expect(startExecutionMock).not.toHaveBeenCalled();
  });

  // Guard 4: nothing to derive means nothing to backfill.
  it('refuses a run with zero gaps', async () => {
    const runId = await seedCompletedRunWithNoGaps();

    await expect(caller.crawl.backfill({ runId })).rejects.toThrow(/nothing to backfill/i);
    expect(startExecutionMock).not.toHaveBeenCalled();
  });

  // Guard 5: a dead field among the targets needs an explicit strategy.
  it('refuses a dead target field without a deadFieldStrategy', async () => {
    const { runId } = await seedCompletedRunWithDeadField();

    await expect(caller.crawl.backfill({ runId })).rejects.toThrow(/deadFieldStrategy required/i);
    expect(startExecutionMock).not.toHaveBeenCalled();
  });

  it('creates the backfill run and its items, then fires merged execution', async () => {
    startExecutionMock.mockResolvedValue(undefined);
    const { runId, sourceId, item2Id } = await seedCompletedRunWithHealthyGap();

    const result = await caller.crawl.backfill({ runId });

    expect(result.items).toBe(1);
    const backfillRunId = result.backfillRunId as string;

    const [backfillRun] = await db.select().from(runs).where(eq(runs.id, backfillRunId));
    expect(backfillRun).toMatchObject({
      sourceId,
      parentRunId: runId,
      inputLabel: 'backfill',
      targetFields: ['title'],
    });
    // markRunExtracting flips 'planned' -> 'extracting' before this mutation returns.
    expect(backfillRun!.status).toBe('extracting');

    const backfillItems = await db.select().from(runItems).where(eq(runItems.runId, backfillRunId));
    expect(backfillItems).toHaveLength(1);
    expect(backfillItems[0]).toMatchObject({
      kind: 'detail',
      url: 'https://example.com/p/2',
      targetFields: ['title'],
      parentId: item2Id,
      // Copied verbatim from the parent item (item2), per the task-6 brief.
      inputValues: { sku: '2' },
      listingValues: { cat: 'movies' },
      inputIndex: 2,
      pageNumber: 3,
      status: 'pending',
    });

    expect(startExecutionMock).toHaveBeenCalledTimes(1);
    const call = startExecutionMock.mock.calls[0]!;
    expect(call[0]).toBe(backfillRunId);
    expect(call[1]).toBe(sourceId);
    // The schema arg is `effectiveSchema(parent.source)`'s output
    // (DETAIL_URL_FIELD-filtered) — computed the same way crawl.ts's guard 1
    // loads `parent.source`, not hardcoded, so this stays true if the
    // dataset schema shape ever changes.
    const source = await db.query.sources.findFirst({
      where: eq(sources.id, sourceId),
      // Mirrors crawl.ts guard 1's own column list exactly — `schemaDefinition`
      // included (ledger T10), since `effectiveSchema` branches on it.
      columns: { id: true, selectorsJson: true, datasetId: true, schemaDefinition: true },
      with: { dataset: { columns: { schema: true } } },
    });
    expect(call[2]).toEqual(effectiveSchema(source!));
    expect(call[3]).toBeUndefined(); // no limit
    expect(call[4]).toEqual({ mergeToParent: true });
  });

  // Fix round 1 (review finding): `deadFieldStrategy: 'repair_sweep'` sent
  // when NO dead field is actually in scope must take the plain path, not
  // hand `runRepairSweep` an empty deadFields list — that would always
  // evaluate zero eligible samples, always return 'repair_failed', and
  // strand the rest of the backfill run pending on a terminal run.
  it('takes the plain path when repair_sweep is requested but no target field is dead', async () => {
    startExecutionMock.mockResolvedValue(undefined);
    const { runId } = await seedCompletedRunWithHealthyGap();

    const result = await caller.crawl.backfill({ runId, deadFieldStrategy: 'repair_sweep' });

    expect(result.items).toBe(1);
    expect(runRepairSweepMock).not.toHaveBeenCalled();
    expect(startExecutionMock).toHaveBeenCalledTimes(1);
    const call = startExecutionMock.mock.calls[0]!;
    expect(call[3]).toBeUndefined(); // no limit
    expect(call[4]).toEqual({ mergeToParent: true });
  });
});
