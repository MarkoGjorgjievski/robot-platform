// packages/api/src/routers/crawl-backfill.test.ts
//
// `crawl.backfill`'s six ordered guards (task-6-brief.md) plus the happy
// path. `startExecution` is mocked exactly the way sources.test.ts mocks
// `planSource` — this file exercises the mutation's own behaviour (guards,
// the inserted run/items shapes, the args passed to execution), never a real
// browser or extraction chain.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, runs, runItems, extractions, captures, sources, orgs, projects, datasets } from '@robot/db';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from './index.js';

const { startExecutionMock } = vi.hoisted(() => ({ startExecutionMock: vi.fn() }));
vi.mock('../crawl/start-execution.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../crawl/start-execution.js')>();
  return { ...actual, startExecution: startExecutionMock };
});

const caller = createCallerFactory(appRouter)({ db });
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

afterEach(async () => {
  startExecutionMock.mockReset();
  if (orgId) await db.delete(orgs).where(eq(orgs.id, orgId));
  orgId = null;
});

describe('crawl.backfill', () => {
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
    expect(call[3]).toBeUndefined(); // no limit
    expect(call[4]).toEqual({ mergeToParent: true });
  });
});
