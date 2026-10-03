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
 * recorded. Returns both ids: the backfill item's own `extractionId` is what
 * a merge-aware `onDone` now passes into `mergeBackfillResult` directly (R4,
 * fix round 2) — the item row's `extractionId` column is deliberately NOT set
 * yet at merge time, since `mergeBackfillResult` runs before `markItemDone`.
 */
async function seedBackfillItem(sourceId: string, backfillRunId: string, parentItemId: string) {
  const [capture] = await db.insert(captures).values({ sourceId, runId: backfillRunId, url: 'https://example.com/p/1', metadata: {} }).returning();
  const [extraction] = await db.insert(extractions).values({
    sourceId, captureId: capture!.id, runId: backfillRunId, data: [{}], rowCount: 1,
  }).returning();
  const [backfillItem] = await db.insert(runItems).values({
    runId: backfillRunId, kind: 'detail', url: 'https://example.com/p/1', inputIndex: 0,
    status: 'running', parentId: parentItemId,
  }).returning();
  return { backfillItemId: backfillItem!.id, extractionId: extraction!.id };
}

async function loadParentData(parentItemId: string): Promise<Record<string, unknown>> {
  const parentItem = await db.query.runItems.findFirst({
    where: eq(runItems.id, parentItemId),
    with: { extraction: true },
  });
  return (parentItem!.extraction!.data as Record<string, unknown>[])[0]!;
}

/** All rows of the parent item's extraction, plus its `rowCount` column — for
 * the multi-row (variants) merge path, where every row matters, not just row 0. */
async function loadParentRowsAndCount(parentItemId: string): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }> {
  const parentItem = await db.query.runItems.findFirst({
    where: eq(runItems.id, parentItemId),
    with: { extraction: true },
  });
  return {
    rows: parentItem!.extraction!.data as Record<string, unknown>[],
    rowCount: parentItem!.extraction!.rowCount,
  };
}

/** A parent-run item whose extraction holds several rows (a list-method
 * variants extraction, Task 3) instead of the ordinary single row. */
async function seedParentItemWithRows(
  sourceId: string, parentRunId: string, rows: Record<string, unknown>[], absentFields: string[] = [],
) {
  const [capture] = await db.insert(captures).values({ sourceId, runId: parentRunId, url: 'https://example.com/p/1', metadata: {} }).returning();
  const [extraction] = await db.insert(extractions).values({
    sourceId, captureId: capture!.id, runId: parentRunId, data: rows, rowCount: rows.length,
  }).returning();
  const [parentItem] = await db.insert(runItems).values({
    runId: parentRunId, kind: 'detail', url: 'https://example.com/p/1', inputIndex: 0,
    status: 'done', extractionId: extraction!.id, absentFields,
  }).returning();
  return parentItem!.id;
}

/** A backfill item whose own re-extraction also holds several rows — what a
 * backfill re-extraction of a list-method product page actually yields
 * (extractItem, Task 3). `row` (what a merge-aware `onDone` threads in
 * directly) is `rows[0]`, mirroring extract-item.ts's persistRows contract;
 * `mergeBackfillResult` reads the rest back off `extractionId`. */
async function seedBackfillItemWithRows(sourceId: string, backfillRunId: string, parentItemId: string, rows: Record<string, unknown>[]) {
  const [capture] = await db.insert(captures).values({ sourceId, runId: backfillRunId, url: 'https://example.com/p/1', metadata: {} }).returning();
  const [extraction] = await db.insert(extractions).values({
    sourceId, captureId: capture!.id, runId: backfillRunId, data: rows, rowCount: rows.length,
  }).returning();
  const [backfillItem] = await db.insert(runItems).values({
    runId: backfillRunId, kind: 'detail', url: 'https://example.com/p/1', inputIndex: 0,
    status: 'running', parentId: parentItemId,
  }).returning();
  return { backfillItemId: backfillItem!.id, extractionId: extraction!.id, row: rows[0]! };
}

async function loadParentItem(parentItemId: string) {
  const [row] = await db.select().from(runItems).where(eq(runItems.id, parentItemId));
  return row!;
}

describe('mergeBackfillResult', () => {
  it('never overwrites a filled parent cell', async () => {
    const { sourceId, parentRunId, backfillRunId } = await seedOrgSourceRuns();
    const parentItemId = await seedParentItemWithExtraction(sourceId, parentRunId, { title: 'Real' });
    const { backfillItemId, extractionId } = await seedBackfillItem(sourceId, backfillRunId, parentItemId);

    await mergeBackfillResult(db, backfillItemId, extractionId, { title: 'Other' }, ['title']);

    expect((await loadParentData(parentItemId)).title).toBe('Real');
  });

  it('treats 0 as filled (mirrors coverage.ts exactly) — a backfill must not overwrite it', async () => {
    const { sourceId, parentRunId, backfillRunId } = await seedOrgSourceRuns();
    const parentItemId = await seedParentItemWithExtraction(sourceId, parentRunId, { stock: 0 });
    const { backfillItemId, extractionId } = await seedBackfillItem(sourceId, backfillRunId, parentItemId);

    await mergeBackfillResult(db, backfillItemId, extractionId, { stock: 5 }, ['stock']);

    expect((await loadParentData(parentItemId)).stock).toBe(0);
  });

  it('treats false as filled — same coverage semantics, the other falsy edge', async () => {
    const { sourceId, parentRunId, backfillRunId } = await seedOrgSourceRuns();
    const parentItemId = await seedParentItemWithExtraction(sourceId, parentRunId, { inStock: false });
    const { backfillItemId, extractionId } = await seedBackfillItem(sourceId, backfillRunId, parentItemId);

    await mergeBackfillResult(db, backfillItemId, extractionId, { inStock: true }, ['inStock']);

    expect((await loadParentData(parentItemId)).inStock).toBe(false);
  });

  it('fills an empty parent cell from the backfill row, leaving other cells untouched', async () => {
    const { sourceId, parentRunId, backfillRunId } = await seedOrgSourceRuns();
    const parentItemId = await seedParentItemWithExtraction(sourceId, parentRunId, { title: 'Real', isbn: null });
    const { backfillItemId, extractionId } = await seedBackfillItem(sourceId, backfillRunId, parentItemId);

    await mergeBackfillResult(db, backfillItemId, extractionId, { isbn: '978-1' }, ['isbn']);

    const data0 = await loadParentData(parentItemId);
    expect(data0.isbn).toBe('978-1');
    expect(data0.title).toBe('Real');
  });

  it('marks a target field still empty after the merge as absent', async () => {
    const { sourceId, parentRunId, backfillRunId } = await seedOrgSourceRuns();
    const parentItemId = await seedParentItemWithExtraction(sourceId, parentRunId, { title: 'Real', publisher: null });
    const { backfillItemId, extractionId } = await seedBackfillItem(sourceId, backfillRunId, parentItemId);

    await mergeBackfillResult(db, backfillItemId, extractionId, { publisher: null }, ['publisher']);

    expect((await loadParentItem(parentItemId)).absentFields).toEqual(['publisher']);
  });

  it('clears a previously-absent field once the backfill fills it', async () => {
    const { sourceId, parentRunId, backfillRunId } = await seedOrgSourceRuns();
    const parentItemId = await seedParentItemWithExtraction(sourceId, parentRunId, { publisher: null }, ['publisher']);
    const { backfillItemId, extractionId } = await seedBackfillItem(sourceId, backfillRunId, parentItemId);

    await mergeBackfillResult(db, backfillItemId, extractionId, { publisher: 'Acme' }, ['publisher']);

    expect((await loadParentItem(parentItemId)).absentFields).toEqual([]);
    expect((await loadParentData(parentItemId)).publisher).toBe('Acme');
  });

  it('heals a parent item that failed originally and never got an extraction', async () => {
    const { sourceId, parentRunId, backfillRunId } = await seedOrgSourceRuns();
    const [parentItem] = await db.insert(runItems).values({
      runId: parentRunId, kind: 'detail', url: 'https://example.com/p/2', inputIndex: 0, status: 'failed', error: 'blocked',
    }).returning();
    const { backfillItemId, extractionId } = await seedBackfillItem(sourceId, backfillRunId, parentItem!.id);

    await mergeBackfillResult(db, backfillItemId, extractionId, { title: 'Healed', isbn: '999' }, ['title', 'isbn']);

    const healed = await loadParentItem(parentItem!.id);
    expect(healed.status).toBe('done');
    expect(healed.extractionId).not.toBeNull();

    const [extraction] = await db.select().from(extractions).where(eq(extractions.id, healed.extractionId!));
    expect(extraction!.data).toEqual([{ title: 'Healed', isbn: '999' }]);
    expect(extraction!.rowCount).toBe(1);
    expect(extraction!.sourceId).toBe(sourceId);
    expect(extraction!.runId).toBe(parentRunId);

    // R4: captureId came from the explicitly-passed extractionId, not from
    // reading the backfill item's own (not-yet-set) row column — proves the
    // new threading actually resolved a real capture, not a coincidental one.
    const [backfillExtraction] = await db.select().from(extractions).where(eq(extractions.id, extractionId!));
    expect(extraction!.captureId).toBe(backfillExtraction!.captureId);
  });

  // R3: a healed item's targetFields that came back empty must still be
  // absent-marked, or a future backfill re-fetches them forever — the
  // confirmed_absent gate never engages for a row that only ever healed
  // through this path.
  it('absent-marks a healed item\'s target fields that are still empty in the fresh row', async () => {
    const { sourceId, parentRunId, backfillRunId } = await seedOrgSourceRuns();
    const [parentItem] = await db.insert(runItems).values({
      runId: parentRunId, kind: 'detail', url: 'https://example.com/p/4', inputIndex: 0, status: 'failed', error: 'blocked',
    }).returning();
    const { backfillItemId, extractionId } = await seedBackfillItem(sourceId, backfillRunId, parentItem!.id);

    await mergeBackfillResult(db, backfillItemId, extractionId, { title: 'Healed' }, ['title', 'isbn']);

    const healed = await loadParentItem(parentItem!.id);
    expect(healed.status).toBe('done');
    expect(healed.absentFields).toEqual(['isbn']);

    const [extraction] = await db.select().from(extractions).where(eq(extractions.id, healed.extractionId!));
    expect(extraction!.data).toEqual([{ title: 'Healed' }]);
  });

  // Finding 5 (minor, final-review-findings.md): healing a parent item
  // (rule 5 — it failed originally, never got an extraction) flips it to
  // 'done', but the PARENT RUN's own resultCount/status were never
  // recomputed — the run header's "Rows" stat and its status (e.g. 'partial'
  // that is now actually complete) undercounted forever. Only the heal path
  // changes counts; a plain cell-fill merge (parent item already 'done')
  // does not touch done/failed counts and must not trigger a rollup.
  it('re-rolls-up the parent run resultCount/status after healing a failed parent item', async () => {
    const { sourceId, parentRunId, backfillRunId } = await seedOrgSourceRuns();
    // One item already done (contributes to the stale count), one failed —
    // the one this test heals.
    await seedParentItemWithExtraction(sourceId, parentRunId, { title: 'Real' });
    const [parentItem] = await db.insert(runItems).values({
      runId: parentRunId, kind: 'detail', url: 'https://example.com/p/2', inputIndex: 0, status: 'failed', error: 'blocked',
    }).returning();
    const { backfillItemId, extractionId } = await seedBackfillItem(sourceId, backfillRunId, parentItem!.id);
    // Stale rollup, as if finaliseRun ran back when only the first item was done.
    await db.update(runs).set({ status: 'partial', resultCount: 1, completedAt: new Date() }).where(eq(runs.id, parentRunId));

    await mergeBackfillResult(db, backfillItemId, extractionId, { title: 'Healed' }, ['title']);

    const [parentRun] = await db.select().from(runs).where(eq(runs.id, parentRunId));
    // Both items are 'done' now (the healed one is no longer 'failed') — a
    // real rollup recomputes 'completed' and resultCount 2, not the stale
    // 'partial'/1 that predates the heal.
    expect(parentRun!.status).toBe('completed');
    expect(parentRun!.resultCount).toBe(2);
    expect(parentRun!.completedAt).not.toBeNull();
  });

  // Residual on Finding 5 (re-review): the heal's rollup hardcoded
  // `cancelled: false` — a CANCELLED parent run (completedAt set, so
  // crawl.backfill's guard 2 allows a backfill against it; its
  // never-attempted pending items surface as gaps via loadRunCoverage) that
  // gets healed while OTHER items are still pending would have its
  // 'cancelled' status silently overwritten: rollUpStatus sees
  // `pending > 0 && !cancelled` and returns 'extracting', un-cancelling a
  // run the operator explicitly stopped and clearing its completedAt — stuck
  // "active" forever if the backfill doesn't heal every pending item.
  it('a heal on a cancelled parent with other pending items preserves cancelled status (does not un-cancel it)', async () => {
    const { sourceId, parentRunId, backfillRunId } = await seedOrgSourceRuns();
    // The parent run was stopped mid-crawl: cancelled, with completedAt set
    // (the state crawl.backfill's guard 2 requires to allow a backfill at all).
    await db.update(runs).set({ status: 'cancelled', completedAt: new Date(), resultCount: 1 }).where(eq(runs.id, parentRunId));
    // One item already done.
    await seedParentItemWithExtraction(sourceId, parentRunId, { title: 'Real' });
    // One item that failed originally — the one this test heals.
    const [failedItem] = await db.insert(runItems).values({
      runId: parentRunId, kind: 'detail', url: 'https://example.com/p/2', inputIndex: 0, status: 'failed', error: 'blocked',
    }).returning();
    // Another item still pending — never attempted, because the crawl was
    // stopped before reaching it. This is what stays pending>0 after the heal.
    await db.insert(runItems).values({
      runId: parentRunId, kind: 'detail', url: 'https://example.com/p/3', inputIndex: 0, status: 'pending',
    });
    const { backfillItemId, extractionId } = await seedBackfillItem(sourceId, backfillRunId, failedItem!.id);

    await mergeBackfillResult(db, backfillItemId, extractionId, { title: 'Healed' }, ['title']);

    const [parentRun] = await db.select().from(runs).where(eq(runs.id, parentRunId));
    // Status stays 'cancelled' (not un-cancelled to 'extracting'), completedAt
    // stays set (finaliseRun still writes one — just not null), and
    // resultCount is still recomputed (2 done items; the pending one doesn't count).
    expect(parentRun!.status).toBe('cancelled');
    expect(parentRun!.completedAt).not.toBeNull();
    expect(parentRun!.resultCount).toBe(2);
  });

  it('does NOT roll up the parent run for a plain merge (parent item already had an extraction)', async () => {
    const { sourceId, parentRunId, backfillRunId } = await seedOrgSourceRuns();
    const parentItemId = await seedParentItemWithExtraction(sourceId, parentRunId, { title: 'Real', isbn: null });
    const { backfillItemId, extractionId } = await seedBackfillItem(sourceId, backfillRunId, parentItemId);
    await db.update(runs).set({ status: 'partial', resultCount: 1, completedAt: new Date() }).where(eq(runs.id, parentRunId));

    await mergeBackfillResult(db, backfillItemId, extractionId, { isbn: '978-1' }, ['isbn']);

    const [parentRun] = await db.select().from(runs).where(eq(runs.id, parentRunId));
    // Untouched: a plain cell-fill merge never changes an item's done/failed
    // status, so there is nothing for a rollup to recompute — asserting the
    // stale values stayed put proves no rollup fired.
    expect(parentRun!.status).toBe('partial');
    expect(parentRun!.resultCount).toBe(1);
  });

  it('is a no-op when the item passed in has no parentId — not a backfill item', async () => {
    const { parentRunId } = await seedOrgSourceRuns();
    // A plain (non-backfill) item: no parentId at all.
    const [plainItem] = await db.insert(runItems).values({
      runId: parentRunId, kind: 'detail', url: 'https://example.com/p/3', inputIndex: 0, status: 'done',
    }).returning();

    await expect(mergeBackfillResult(db, plainItem!.id, null, { title: 'x' }, ['title'])).resolves.toBeUndefined();
  });

  describe('a parent extraction holding several rows (variants)', () => {
    // Review Focus 4: a parent with rows A1 (missing price) and A2 (missing
    // price), plus a backfill result with A2 price:21 and A1 price:20 (order
    // DELIBERATELY reversed from the parent's), fills each row by its own
    // `_variant_key` — never row 0's value copied to all.
    it('fills each variant row by its own _variant_key, not by position', async () => {
      const { sourceId, parentRunId, backfillRunId } = await seedOrgSourceRuns();
      const parentItemId = await seedParentItemWithRows(sourceId, parentRunId, [
        { _variant_key: 'A1', price: null },
        { _variant_key: 'A2', price: null },
      ]);
      const { backfillItemId, extractionId, row } = await seedBackfillItemWithRows(sourceId, backfillRunId, parentItemId, [
        { _variant_key: 'A2', price: 21 },
        { _variant_key: 'A1', price: 20 },
      ]);

      await mergeBackfillResult(db, backfillItemId, extractionId, row, ['price']);

      const { rows, rowCount } = await loadParentRowsAndCount(parentItemId);
      expect(rows.find((r) => r._variant_key === 'A1')!.price).toBe(20);
      expect(rows.find((r) => r._variant_key === 'A2')!.price).toBe(21);
      expect(rowCount).toBe(2);
    });

    it('never overwrites an already-filled cell on a matched row', async () => {
      const { sourceId, parentRunId, backfillRunId } = await seedOrgSourceRuns();
      const parentItemId = await seedParentItemWithRows(sourceId, parentRunId, [
        { _variant_key: 'A1', price: 5 },
        { _variant_key: 'A2', price: null },
      ]);
      const { backfillItemId, extractionId, row } = await seedBackfillItemWithRows(sourceId, backfillRunId, parentItemId, [
        { _variant_key: 'A1', price: 999 },
        { _variant_key: 'A2', price: 21 },
      ]);

      await mergeBackfillResult(db, backfillItemId, extractionId, row, ['price']);

      const { rows } = await loadParentRowsAndCount(parentItemId);
      expect(rows.find((r) => r._variant_key === 'A1')!.price).toBe(5);
      expect(rows.find((r) => r._variant_key === 'A2')!.price).toBe(21);
    });

    it('appends a backfill row whose _variant_key matches no parent row, without removing any parent row', async () => {
      const { sourceId, parentRunId, backfillRunId } = await seedOrgSourceRuns();
      const parentItemId = await seedParentItemWithRows(sourceId, parentRunId, [
        { _variant_key: 'A1', price: null },
        { _variant_key: 'A2', price: 9 },
      ]);
      const { backfillItemId, extractionId, row } = await seedBackfillItemWithRows(sourceId, backfillRunId, parentItemId, [
        { _variant_key: 'A1', price: 20 },
        { _variant_key: 'A3', price: 30 }, // new variant, not in the parent
      ]);

      await mergeBackfillResult(db, backfillItemId, extractionId, row, ['price']);

      const { rows, rowCount } = await loadParentRowsAndCount(parentItemId);
      expect(rowCount).toBe(3);
      expect(rows.find((r) => r._variant_key === 'A1')!.price).toBe(20);
      expect(rows.find((r) => r._variant_key === 'A2')!.price).toBe(9); // untouched, never removed
      expect(rows.find((r) => r._variant_key === 'A3')!.price).toBe(30); // appended whole
    });

    it('marks a target field absent only when it is still missing on at least one row after the merge', async () => {
      const { sourceId, parentRunId, backfillRunId } = await seedOrgSourceRuns();
      const parentItemId = await seedParentItemWithRows(sourceId, parentRunId, [
        { _variant_key: 'A1', price: null },
        { _variant_key: 'A2', price: null },
      ]);
      const { backfillItemId, extractionId, row } = await seedBackfillItemWithRows(sourceId, backfillRunId, parentItemId, [
        { _variant_key: 'A1', price: 20 },
        { _variant_key: 'A2', price: null }, // still missing on this row
      ]);

      await mergeBackfillResult(db, backfillItemId, extractionId, row, ['price']);

      expect((await loadParentItem(parentItemId)).absentFields).toEqual(['price']);
    });

    it('clears a previously-absent field once the merge fills it on every row', async () => {
      const { sourceId, parentRunId, backfillRunId } = await seedOrgSourceRuns();
      const parentItemId = await seedParentItemWithRows(sourceId, parentRunId, [
        { _variant_key: 'A1', price: null },
        { _variant_key: 'A2', price: null },
      ], ['price']);
      const { backfillItemId, extractionId, row } = await seedBackfillItemWithRows(sourceId, backfillRunId, parentItemId, [
        { _variant_key: 'A1', price: 20 },
        { _variant_key: 'A2', price: 21 },
      ]);

      await mergeBackfillResult(db, backfillItemId, extractionId, row, ['price']);

      expect((await loadParentItem(parentItemId)).absentFields).toEqual([]);
    });
  });
});
