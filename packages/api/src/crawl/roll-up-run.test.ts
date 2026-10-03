// packages/api/src/crawl/roll-up-run.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, runs, runItems, captures, extractions, sources, orgs, projects, datasets } from '@robot/db';
import { summariseVariantRows } from '@robot/scraper';
import { rollUpStatus, finaliseRun } from './roll-up-run.js';

const SLUG = 'test-roll-up-run';
let orgId: string | null = null;

afterEach(async () => {
  if (orgId) await db.delete(orgs).where(eq(orgs.id, orgId));
  orgId = null;
});

describe('rollUpStatus', () => {
  it('is completed when every item succeeded', () => {
    expect(rollUpStatus({ pending: 0, running: 0, done: 12, failed: 0 })).toBe('completed');
  });

  it('is partial when some failed — the normal outcome at scale', () => {
    // Spec §1.2: "480 of 500 succeeded" is what a real run looks like, and the
    // old binary completed/failed could not say it.
    expect(rollUpStatus({ pending: 0, running: 0, done: 480, failed: 20 })).toBe('partial');
  });

  it('is failed only when nothing succeeded at all', () => {
    expect(rollUpStatus({ pending: 0, running: 0, done: 0, failed: 8 })).toBe('failed');
  });

  it('stays extracting while work remains', () => {
    expect(rollUpStatus({ pending: 3, running: 0, done: 5, failed: 1 })).toBe('extracting');
  });

  it('treats a run with no items at all as completed rather than failed', () => {
    // A detail-mode source whose InputSet was empty planned nothing. That is an
    // empty result, not an error.
    expect(rollUpStatus({ pending: 0, running: 0, done: 0, failed: 0 })).toBe('completed');
  });

  // Finding 1: a cancel with pending work left must settle to 'cancelled', not
  // silently revert to 'extracting' (which the dashboard treats as still active
  // and polls forever).
  it('settles to cancelled when told to stop and work is still pending', () => {
    expect(rollUpStatus({ pending: 3, running: 0, done: 5, failed: 1 }, true)).toBe('cancelled');
  });

  it('rolls up normally when cancelled but nothing is pending — the work genuinely finished, saying "cancelled" would be a lie', () => {
    expect(rollUpStatus({ pending: 0, running: 0, done: 12, failed: 0 }, true)).toBe('completed');
    expect(rollUpStatus({ pending: 0, running: 0, done: 480, failed: 20 }, true)).toBe('partial');
    expect(rollUpStatus({ pending: 0, running: 0, done: 0, failed: 8 }, true)).toBe('failed');
  });

  it('cancelled: false (or omitted) leaves today\'s behaviour unchanged', () => {
    expect(rollUpStatus({ pending: 3, running: 0, done: 5, failed: 1 }, false)).toBe('extracting');
    expect(rollUpStatus({ pending: 3, running: 0, done: 5, failed: 1 })).toBe('extracting');
  });

  // --- `running` is a status too. Nothing counted it, so an item left
  // `running` by an api-server restart (claimNextItem set it; nothing moves it
  // back) was invisible here: pending=0, done=7, failed=0 rolled a run of 8 up
  // to `completed` with the eighth row silently missing from the customer's CSV.
  it('is not terminal while an item is still running — a claimed item is unfinished work', () => {
    expect(rollUpStatus({ pending: 0, running: 1, done: 7, failed: 0 })).toBe('extracting');
  });

  it('never reports completed while an item is running, even with nothing pending', () => {
    // The exact restart shape: item 5 stuck `running`, the rest done. Saying
    // `completed` here is the lie — resultCount would be a row short and
    // nothing anywhere would say so.
    expect(rollUpStatus({ pending: 0, running: 1, done: 7, failed: 0 })).not.toBe('completed');
    expect(rollUpStatus({ pending: 0, running: 1, done: 5, failed: 2 })).not.toBe('partial');
  });

  it('settles a running item to cancelled when a stop was requested, exactly as pending does', () => {
    expect(rollUpStatus({ pending: 0, running: 1, done: 7, failed: 0 }, true)).toBe('cancelled');
  });

  // Finding 1: a probe stopped by its own sample limit must also settle to a
  // terminal status (not 'extracting') even though items are left pending —
  // see execute-run.test.ts / crawl-execute.test.ts for the real-path version.
  it('settles to partial when the sample limit was reached and work is still pending', () => {
    expect(rollUpStatus({ pending: 27, running: 0, done: 3, failed: 0 }, false, true)).toBe('partial');
  });

  it('limitReached: false (or omitted) leaves today\'s behaviour unchanged', () => {
    expect(rollUpStatus({ pending: 3, running: 0, done: 5, failed: 1 }, false, false)).toBe('extracting');
    expect(rollUpStatus({ pending: 3, running: 0, done: 5, failed: 1 })).toBe('extracting');
  });

  // Re-review residual #2 (fix-wave-report.md): the tie-break was implemented
  // (rollUpStatus checks `cancelled` before `limitReached`) but never
  // directly asserted — cancel semantics must win when a run was BOTH told
  // to stop AND happened to hit its own sample limit, since 'cancelled' is
  // the stronger, deliberately-requested stop.
  it('cancelled takes priority over limitReached when both are true', () => {
    expect(rollUpStatus({ pending: 27, running: 0, done: 3, failed: 0 }, true, true)).toBe('cancelled');
  });
});

describe('finaliseRun', () => {
  it('derives resultCount from the DB — a caller cannot corrupt it with a stale local counter', async () => {
    const [org] = await db.insert(orgs).values({ name: SLUG, slug: SLUG }).returning();
    orgId = org!.id;
    const [project] = await db.insert(projects).values({ orgId: org!.id, name: SLUG, slug: SLUG }).returning();
    const [dataset] = await db.insert(datasets).values({ projectId: project!.id, name: SLUG, slug: SLUG, schema: [] }).returning();
    const [source] = await db.insert(sources).values({ datasetId: dataset!.id, name: SLUG, slug: SLUG, country: 'US' }).returning();
    const [run] = await db.insert(runs).values({ sourceId: source!.id, status: 'extracting' }).returning();
    await db.insert(runItems).values([
      { runId: run!.id, kind: 'detail', url: 'https://example.com/p/1', inputIndex: 0, status: 'done' },
      { runId: run!.id, kind: 'detail', url: 'https://example.com/p/2', inputIndex: 0, status: 'done' },
      { runId: run!.id, kind: 'detail', url: 'https://example.com/p/3', inputIndex: 0, status: 'done' },
      { runId: run!.id, kind: 'detail', url: 'https://example.com/p/4', inputIndex: 0, status: 'failed', error: 'blocked' },
    ]);
    // Task 3: resultCount is now the sum of extractions.rowCount, not the
    // done-item count — for a run without variants (one row per done item)
    // the two are equal, which this exercises directly.
    for (const i of [1, 2, 3]) {
      const [capture] = await db.insert(captures).values({ sourceId: source!.id, runId: run!.id, url: `https://example.com/p/${i}` }).returning({ id: captures.id });
      await db.insert(extractions).values({ sourceId: source!.id, captureId: capture!.id, runId: run!.id, data: [{ title: `item ${i}` }], rowCount: 1 });
    }

    // No rowCount argument any more — the old signature let a caller (e.g. one
    // of two concurrent loops) hand in its own partial, in-memory count and
    // overwrite the true total. finaliseRun must compute it itself.
    const status = await finaliseRun(db, run!.id);
    expect(status).toBe('partial');

    const [row] = await db.select().from(runs).where(eq(runs.id, run!.id));
    expect(row!.resultCount).toBe(3);
  });

  // The api-server-restart shape, end to end through the aggregate: one item
  // left `running` because the process died mid-item. Before this fix the
  // aggregate counted only pending/done/failed, so it saw pending=0, done=3,
  // failed=0 and wrote `completed` with resultCount=3 for a 4-item work list.
  it('does not report a run completed while one of its items is still running', async () => {
    const [org] = await db.insert(orgs).values({ name: SLUG, slug: SLUG }).returning();
    orgId = org!.id;
    const [project] = await db.insert(projects).values({ orgId: org!.id, name: SLUG, slug: SLUG }).returning();
    const [dataset] = await db.insert(datasets).values({ projectId: project!.id, name: SLUG, slug: SLUG, schema: [] }).returning();
    const [source] = await db.insert(sources).values({ datasetId: dataset!.id, name: SLUG, slug: SLUG, country: 'US' }).returning();
    const [run] = await db.insert(runs).values({ sourceId: source!.id, status: 'extracting' }).returning();
    await db.insert(runItems).values([
      { runId: run!.id, kind: 'listing', url: 'https://example.com/c/1', inputIndex: 0, status: 'done' },
      { runId: run!.id, kind: 'detail', url: 'https://example.com/p/1', inputIndex: 0, status: 'done' },
      { runId: run!.id, kind: 'detail', url: 'https://example.com/p/2', inputIndex: 0, status: 'done' },
      { runId: run!.id, kind: 'detail', url: 'https://example.com/p/3', inputIndex: 0, status: 'done' },
      { runId: run!.id, kind: 'detail', url: 'https://example.com/p/4', inputIndex: 0, status: 'running', startedAt: new Date() },
    ]);

    const status = await finaliseRun(db, run!.id);
    expect(status).toBe('extracting');

    const [row] = await db.select().from(runs).where(eq(runs.id, run!.id));
    expect(row!.status).toBe('extracting');
    // Non-terminal, so no completion timestamp is invented for a run that is
    // not actually done.
    expect(row!.completedAt).toBeNull();
  });

  async function seedRun() {
    const [org] = await db.insert(orgs).values({ name: SLUG, slug: SLUG }).returning();
    orgId = org!.id;
    const [project] = await db.insert(projects).values({ orgId: org!.id, name: SLUG, slug: SLUG }).returning();
    const [dataset] = await db.insert(datasets).values({ projectId: project!.id, name: SLUG, slug: SLUG, schema: [] }).returning();
    const [source] = await db.insert(sources).values({ datasetId: dataset!.id, name: SLUG, slug: SLUG, country: 'US' }).returning();
    const [run] = await db.insert(runs).values({ sourceId: source!.id, status: 'extracting' }).returning();
    return { sourceId: source!.id, runId: run!.id };
  }

  async function addExtraction(sourceId: string, runId: string, url: string, rows: Record<string, unknown>[]) {
    const [capture] = await db.insert(captures).values({ sourceId, runId, url }).returning({ id: captures.id });
    await db.insert(extractions).values({ sourceId, captureId: capture!.id, runId, data: rows, rowCount: rows.length });
  }

  // Task 3 (variants plan 3): `resultCount` is the sum of `rowCount` across
  // the run's extractions, not the count of done items — a list-method
  // product page's one extraction can hold several rows.
  it('sums extractions.rowCount for resultCount, not the number of done items', async () => {
    const { sourceId, runId } = await seedRun();
    // One product page, extracted once (`kind='detail'`, one `done` item),
    // but its extraction holds 2 variant rows.
    await db.insert(runItems).values({ runId, kind: 'detail', url: 'https://example.com/p/1', inputIndex: 0, status: 'done' });
    await addExtraction(sourceId, runId, 'https://example.com/p/1', [
      { _product_key: 'https://example.com/p/1', _variant_key: 'SKU-A' },
      { _product_key: 'https://example.com/p/1', _variant_key: 'SKU-B' },
    ]);

    const status = await finaliseRun(db, runId);
    expect(status).toBe('completed');

    const [row] = await db.select().from(runs).where(eq(runs.id, runId));
    expect(row!.resultCount).toBe(2); // not 1, the done-item count
  });

  // variantSummary is derived from the rows themselves via SQL aggregates
  // (fix round 1 — see finaliseRun's doc comment) and written only when a
  // run actually has variant rows.
  it('writes variantSummary from the rows when they carry a _product_key', async () => {
    const { sourceId, runId } = await seedRun();
    await db.insert(runItems).values([
      { runId, kind: 'detail', url: 'https://example.com/p/1', inputIndex: 0, status: 'done' },
      { runId, kind: 'detail', url: 'https://example.com/p/2', inputIndex: 0, status: 'done' },
    ]);
    await addExtraction(sourceId, runId, 'https://example.com/p/1', [
      { _product_key: 'https://example.com/p/1', _variant_key: 'SKU-A' },
      { _product_key: 'https://example.com/p/1', _variant_key: 'SKU-B' },
    ]);
    // A product without variants: its own row, _product_key set, no _variant_key.
    await addExtraction(sourceId, runId, 'https://example.com/p/2', [
      { _product_key: 'https://example.com/p/2' },
    ]);

    await finaliseRun(db, runId);

    const [row] = await db.select().from(runs).where(eq(runs.id, runId));
    expect(row!.variantSummary).toEqual({
      variants: 2,
      products: 2,
      withoutVariants: 1,
      partial: 0,
      variantsSkippedForBudget: 0,
    });
  });

  it('leaves variantSummary unwritten when no row carries a _product_key', async () => {
    const { sourceId, runId } = await seedRun();
    await db.insert(runItems).values({ runId, kind: 'detail', url: 'https://example.com/p/1', inputIndex: 0, status: 'done' });
    await addExtraction(sourceId, runId, 'https://example.com/p/1', [{ title: 'Kallax' }]);

    await finaliseRun(db, runId);

    const [row] = await db.select().from(runs).where(eq(runs.id, runId));
    expect(row!.variantSummary).toBeNull();
  });

  // Controller ruling R1: Task 4's queueVariantGroup increments
  // runs.variant_summary.variantsSkippedForBudget mid-run, straight onto the
  // row. finaliseRun must read that existing value as `skipped` and preserve
  // it in the summary it writes — it must not recompute back to 0.
  it('preserves an existing variantsSkippedForBudget already recorded on the run', async () => {
    const { sourceId, runId } = await seedRun();
    await db.update(runs).set({
      variantSummary: { variants: 0, products: 0, withoutVariants: 0, partial: 0, variantsSkippedForBudget: 3 },
    }).where(eq(runs.id, runId));
    await db.insert(runItems).values({ runId, kind: 'detail', url: 'https://example.com/p/1', inputIndex: 0, status: 'done' });
    await addExtraction(sourceId, runId, 'https://example.com/p/1', [
      { _product_key: 'https://example.com/p/1', _variant_key: 'SKU-A' },
    ]);

    await finaliseRun(db, runId);

    const [row] = await db.select().from(runs).where(eq(runs.id, runId));
    expect(row!.variantSummary).toMatchObject({ variantsSkippedForBudget: 3 });
  });

  // Task 4 fix round 1: the per-product skip map queueVariantGroup keeps (so
  // the tally is exact) must survive finalise too, not just its sum.
  it('preserves skippedByProduct alongside the recomputed counts', async () => {
    const { sourceId, runId } = await seedRun();
    await db.update(runs).set({
      variantSummary: { variantsSkippedForBudget: 2, skippedByProduct: { 'https://example.com/p/0': 2 } },
    }).where(eq(runs.id, runId));
    await db.insert(runItems).values({ runId, kind: 'detail', url: 'https://example.com/p/1', inputIndex: 0, status: 'done' });
    await addExtraction(sourceId, runId, 'https://example.com/p/1', [
      { _product_key: 'https://example.com/p/1', _variant_key: 'SKU-A' },
    ]);

    await finaliseRun(db, runId);

    const [row] = await db.select().from(runs).where(eq(runs.id, runId));
    expect(row!.variantSummary).toEqual({
      variants: 1, products: 1, withoutVariants: 0, partial: 0,
      variantsSkippedForBudget: 2, skippedByProduct: { 'https://example.com/p/0': 2 },
    });
  });

  // Fix round 1: finaliseRun now computes variants/products/withoutVariants/
  // partial with SQL aggregates instead of `summariseVariantRows` over an
  // in-memory row array. The two implementations must never silently drift
  // apart, so this seeds a richer mix (a multi-variant product, a
  // without-variants product, and a partial variant row) and asserts the SQL
  // result (read back off the run) equals what `summariseVariantRows` (the
  // scraper package's pure JS implementation, @robot/scraper) computes over
  // the exact same rows.
  it('agrees with summariseVariantRows (scraper) over the same seeded rows', async () => {
    const { sourceId, runId } = await seedRun();
    await db.insert(runItems).values([
      { runId, kind: 'detail', url: 'https://example.com/p/1', inputIndex: 0, status: 'done' },
      { runId, kind: 'detail', url: 'https://example.com/p/2', inputIndex: 0, status: 'done' },
      { runId, kind: 'detail', url: 'https://example.com/p/3', inputIndex: 0, status: 'done' },
    ]);
    const rowsByExtraction = [
      [
        { _product_key: 'https://example.com/p/1', _variant_key: 'SKU-A' },
        { _product_key: 'https://example.com/p/1', _variant_key: 'SKU-B', _variant_partial: true },
      ],
      [{ _product_key: 'https://example.com/p/2' }], // without variants
      [{ _product_key: 'https://example.com/p/3', _variant_key: 'SKU-C' }],
    ];
    for (const [i, rows] of rowsByExtraction.entries()) {
      await addExtraction(sourceId, runId, `https://example.com/p/${i + 1}`, rows);
    }

    await finaliseRun(db, runId);

    const [row] = await db.select().from(runs).where(eq(runs.id, runId));
    const expected = summariseVariantRows(rowsByExtraction.flat(), 0);
    expect(row!.variantSummary).toEqual(expected);
    // Pinned explicitly too, so a bug shared by both implementations (which
    // the equality check above would miss) still fails this test.
    expect(row!.variantSummary).toEqual({
      variants: 3, products: 3, withoutVariants: 1, partial: 1, variantsSkippedForBudget: 0,
    });
  });
});
