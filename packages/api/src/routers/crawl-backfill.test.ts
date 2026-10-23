// packages/api/src/routers/crawl-backfill.test.ts
//
// `crawl.backfill`'s six ordered guards (task-6-brief.md) plus the happy
// path. The mutation enqueues the backfill run's `run` job (spec 2026-10-23
// §4.4) and nothing here runs it — this file exercises the mutation's own
// behaviour (guards, the inserted run/items shapes, the job's payload), never
// a real browser or extraction chain. What the job does with the payload is
// jobs/handlers/run.test.ts.

import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, runs, runItems, extractions, captures, sourceVerifications, projects, datasets, sources } from '@robot/db';
import { signedInCaller } from '../test-helpers/identity.js';
import { jobsOf } from '../test-helpers/jobs.js';

const runJobsOf = async (runId: string) => (await jobsOf('run')).filter((j) => (j.payload as { runId: string }).runId === runId);
/** The run jobs for this run and its backfill runs: none, when a guard refused. */
const jobsUnder = async (runId: string) => {
  const ids = new Set([runId, ...(await db.select({ id: runs.id }).from(runs).where(eq(runs.parentRunId, runId))).map((r) => r.id)]);
  return (await jobsOf('run')).filter((j) => ids.has((j.payload as { runId: string }).runId));
};

// A throwaway signed-in identity: every customer procedure needs a session
// and works in its org only, so nothing here touches the seeded `default` org.
const me = await signedInCaller('crawl-backfill');
const caller = me.caller;
afterAll(async () => { await me.cleanup(); });
const SLUG = 'test-crawl-backfill';
let orgId: string | null = null;

async function seedSource(schema: Array<{ name: string; type: string }>) {
  const org = me.session.org; // the signed-in caller's org: procedures only see their own
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
  if (orgId) await db.delete(projects).where(eq(projects.orgId, orgId));
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
    expect(await jobsUnder(backfillRunId)).toEqual([]);
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

    expect(await jobsUnder(runId)).toEqual([]);
    // The gate runs before any side effect: no backfill run, no items.
    const children = await db.select().from(runs).where(eq(runs.parentRunId, runId));
    expect(children).toEqual([]);
  });

  // Guard 2: a still-executing parent has no settled coverage to backfill from.
  it('refuses a parent run that is still executing', async () => {
    const runId = await seedStillExecutingRun();

    await expect(caller.crawl.backfill({ runId })).rejects.toThrow(/still executing/i);
    expect(await jobsUnder(runId)).toEqual([]);
  });

  // Guard 3: an in-flight backfill against the same parent is reused, not duplicated.
  it('returns the same backfillRunId when a backfill for this parent is already in flight', async () => {
    const { runId, sourceId } = await seedCompletedRunWithHealthyGap();
    const [existingBackfill] = await db.insert(runs).values({
      sourceId, status: 'extracting', parentRunId: runId,
    }).returning();

    const result = await caller.crawl.backfill({ runId });

    expect(result).toEqual({ backfillRunId: existingBackfill!.id, status: 'in-progress' });
    expect(await jobsUnder(runId)).toEqual([]);
  });

  // Guard 4: nothing to derive means nothing to backfill.
  it('refuses a run with zero gaps', async () => {
    const runId = await seedCompletedRunWithNoGaps();

    await expect(caller.crawl.backfill({ runId })).rejects.toThrow(/nothing to backfill/i);
    expect(await jobsUnder(runId)).toEqual([]);
  });

  // Guard 5: a dead field among the targets needs an explicit strategy.
  it('refuses a dead target field without a deadFieldStrategy', async () => {
    const { runId } = await seedCompletedRunWithDeadField();

    await expect(caller.crawl.backfill({ runId })).rejects.toThrow(/deadFieldStrategy required/i);
    expect(await jobsUnder(runId)).toEqual([]);
  });

  it('creates the backfill run and its items, then fires merged execution', async () => {
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

    const jobs = await runJobsOf(backfillRunId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.payload).toEqual({ runId: backfillRunId });
    expect(backfillRun!.jobId).toBe(jobs[0]!.id);
  });

  it('a repair sweep\'s job carries the dead fields', async () => {
    const { runId } = await seedCompletedRunWithDeadField();

    const result = await caller.crawl.backfill({ runId, deadFieldStrategy: 'repair_sweep' });

    const backfillRunId = result.backfillRunId as string;
    const [job] = await runJobsOf(backfillRunId);
    expect(job!.payload).toEqual({ runId: backfillRunId, repairSweep: { deadFields: ['isbn'] } });
  });

  // Fix round 1 (review finding): `deadFieldStrategy: 'repair_sweep'` sent
  // when NO dead field is actually in scope must take the plain path, not
  // hand `runRepairSweep` an empty deadFields list — that would always
  // evaluate zero eligible samples, always return 'repair_failed', and
  // strand the rest of the backfill run pending on a terminal run.
  it('takes the plain path when repair_sweep is requested but no target field is dead', async () => {
    const { runId } = await seedCompletedRunWithHealthyGap();

    const result = await caller.crawl.backfill({ runId, deadFieldStrategy: 'repair_sweep' });

    expect(result.items).toBe(1);
    const [job] = await runJobsOf(result.backfillRunId as string);
    expect(job!.payload).toEqual({ runId: result.backfillRunId });
  });
});
