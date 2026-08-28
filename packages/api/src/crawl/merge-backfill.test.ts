// packages/api/src/crawl/merge-backfill.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, orgs, projects, datasets, sources, runs, runItems, captures, extractions } from '@robot/db';
import { mergeBackfillResult } from './merge-backfill.js';

const SLUG = 'test-merge-backfill';
let orgId: string | null = null;

afterEach(async () => {
  if (orgId) await db.delete(orgs).where(eq(orgs.id, orgId));
  orgId = null;
});

/** One org → project → dataset → source, with a parent run and a backfill run against it. */
async function seedOrgSourceRuns() {
  const [org] = await db.insert(orgs).values({ name: SLUG, slug: SLUG }).returning();
  orgId = org!.id;
  const [project] = await db.insert(projects).values({ orgId: org!.id, name: SLUG, slug: SLUG }).returning();
  const [dataset] = await db.insert(datasets).values({ projectId: project!.id, name: SLUG, slug: SLUG, schema: [] }).returning();
  const [source] = await db.insert(sources).values({ datasetId: dataset!.id, name: SLUG, slug: SLUG, country: 'US' }).returning();
  const [parentRun] = await db.insert(runs).values({ sourceId: source!.id, status: 'completed' }).returning();
  const [backfillRun] = await db.insert(runs).values({ sourceId: source!.id, status: 'extracting', parentRunId: parentRun!.id }).returning();
  return { sourceId: source!.id, parentRunId: parentRun!.id, backfillRunId: backfillRun!.id };
}

/** A parent-run item with a real extraction behind it (the ordinary "already crawled" case). */
async function seedParentItemWithExtraction(
  sourceId: string, parentRunId: string, data0: Record<string, unknown>, absentFields: string[] = [],
) {
  const [capture] = await db.insert(captures).values({ sourceId, runId: parentRunId, url: 'https://example.com/p/1', metadata: {} }).returning();
  const [extraction] = await db.insert(extractions).values({
    sourceId, captureId: capture!.id, runId: parentRunId, data: [data0], rowCount: 1,
  }).returning();
  const [parentItem] = await db.insert(runItems).values({
    runId: parentRunId, kind: 'detail', url: 'https://example.com/p/1', inputIndex: 0,
    status: 'done', extractionId: extraction!.id, absentFields,
  }).returning();
  return parentItem!.id;
}

/**
 * A backfill item pointed at `parentItemId`, with its own extraction already
 * recorded — this is the state a merge-aware `onDone` sees, since it calls
 * `markItemDone` (which sets the backfill item's own `extractionId`) before
 * `mergeBackfillResult`.
 */
async function seedBackfillItem(sourceId: string, backfillRunId: string, parentItemId: string) {
  const [capture] = await db.insert(captures).values({ sourceId, runId: backfillRunId, url: 'https://example.com/p/1', metadata: {} }).returning();
  const [extraction] = await db.insert(extractions).values({
    sourceId, captureId: capture!.id, runId: backfillRunId, data: [{}], rowCount: 1,
  }).returning();
  const [backfillItem] = await db.insert(runItems).values({
    runId: backfillRunId, kind: 'detail', url: 'https://example.com/p/1', inputIndex: 0,
    status: 'done', parentId: parentItemId, extractionId: extraction!.id,
  }).returning();
  return backfillItem!.id;
}

async function loadParentData(parentItemId: string): Promise<Record<string, unknown>> {
  const parentItem = await db.query.runItems.findFirst({
    where: eq(runItems.id, parentItemId),
    with: { extraction: true },
  });
  return (parentItem!.extraction!.data as Record<string, unknown>[])[0]!;
}

async function loadParentItem(parentItemId: string) {
  const [row] = await db.select().from(runItems).where(eq(runItems.id, parentItemId));
  return row!;
}

describe('mergeBackfillResult', () => {
  it('never overwrites a filled parent cell', async () => {
    const { sourceId, parentRunId, backfillRunId } = await seedOrgSourceRuns();
    const parentItemId = await seedParentItemWithExtraction(sourceId, parentRunId, { title: 'Real' });
    const backfillItemId = await seedBackfillItem(sourceId, backfillRunId, parentItemId);

    await mergeBackfillResult(db, backfillItemId, { title: 'Other' }, ['title']);

    expect((await loadParentData(parentItemId)).title).toBe('Real');
  });

  it('treats 0 as filled (mirrors coverage.ts exactly) — a backfill must not overwrite it', async () => {
    const { sourceId, parentRunId, backfillRunId } = await seedOrgSourceRuns();
    const parentItemId = await seedParentItemWithExtraction(sourceId, parentRunId, { stock: 0 });
    const backfillItemId = await seedBackfillItem(sourceId, backfillRunId, parentItemId);

    await mergeBackfillResult(db, backfillItemId, { stock: 5 }, ['stock']);

    expect((await loadParentData(parentItemId)).stock).toBe(0);
  });

  it('treats false as filled — same coverage semantics, the other falsy edge', async () => {
    const { sourceId, parentRunId, backfillRunId } = await seedOrgSourceRuns();
    const parentItemId = await seedParentItemWithExtraction(sourceId, parentRunId, { inStock: false });
    const backfillItemId = await seedBackfillItem(sourceId, backfillRunId, parentItemId);

    await mergeBackfillResult(db, backfillItemId, { inStock: true }, ['inStock']);

    expect((await loadParentData(parentItemId)).inStock).toBe(false);
  });

  it('fills an empty parent cell from the backfill row, leaving other cells untouched', async () => {
    const { sourceId, parentRunId, backfillRunId } = await seedOrgSourceRuns();
    const parentItemId = await seedParentItemWithExtraction(sourceId, parentRunId, { title: 'Real', isbn: null });
    const backfillItemId = await seedBackfillItem(sourceId, backfillRunId, parentItemId);

    await mergeBackfillResult(db, backfillItemId, { isbn: '978-1' }, ['isbn']);

    const data0 = await loadParentData(parentItemId);
    expect(data0.isbn).toBe('978-1');
    expect(data0.title).toBe('Real');
  });

  it('marks a target field still empty after the merge as absent', async () => {
    const { sourceId, parentRunId, backfillRunId } = await seedOrgSourceRuns();
    const parentItemId = await seedParentItemWithExtraction(sourceId, parentRunId, { title: 'Real', publisher: null });
    const backfillItemId = await seedBackfillItem(sourceId, backfillRunId, parentItemId);

    await mergeBackfillResult(db, backfillItemId, { publisher: null }, ['publisher']);

    expect((await loadParentItem(parentItemId)).absentFields).toEqual(['publisher']);
  });

  it('clears a previously-absent field once the backfill fills it', async () => {
    const { sourceId, parentRunId, backfillRunId } = await seedOrgSourceRuns();
    const parentItemId = await seedParentItemWithExtraction(sourceId, parentRunId, { publisher: null }, ['publisher']);
    const backfillItemId = await seedBackfillItem(sourceId, backfillRunId, parentItemId);

    await mergeBackfillResult(db, backfillItemId, { publisher: 'Acme' }, ['publisher']);

    expect((await loadParentItem(parentItemId)).absentFields).toEqual([]);
    expect((await loadParentData(parentItemId)).publisher).toBe('Acme');
  });

  it('heals a parent item that failed originally and never got an extraction', async () => {
    const { sourceId, parentRunId, backfillRunId } = await seedOrgSourceRuns();
    const [parentItem] = await db.insert(runItems).values({
      runId: parentRunId, kind: 'detail', url: 'https://example.com/p/2', inputIndex: 0, status: 'failed', error: 'blocked',
    }).returning();
    const backfillItemId = await seedBackfillItem(sourceId, backfillRunId, parentItem!.id);

    await mergeBackfillResult(db, backfillItemId, { title: 'Healed', isbn: '999' }, ['title', 'isbn']);

    const healed = await loadParentItem(parentItem!.id);
    expect(healed.status).toBe('done');
    expect(healed.extractionId).not.toBeNull();

    const [extraction] = await db.select().from(extractions).where(eq(extractions.id, healed.extractionId!));
    expect(extraction!.data).toEqual([{ title: 'Healed', isbn: '999' }]);
    expect(extraction!.rowCount).toBe(1);
    expect(extraction!.sourceId).toBe(sourceId);
    expect(extraction!.runId).toBe(parentRunId);
  });

  it('is a no-op when the item passed in has no parentId — not a backfill item', async () => {
    const { parentRunId } = await seedOrgSourceRuns();
    // A plain (non-backfill) item: no parentId at all.
    const [plainItem] = await db.insert(runItems).values({
      runId: parentRunId, kind: 'detail', url: 'https://example.com/p/3', inputIndex: 0, status: 'done',
    }).returning();

    await expect(mergeBackfillResult(db, plainItem!.id, { title: 'x' }, ['title'])).resolves.toBeUndefined();
  });
});
