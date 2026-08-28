// packages/api/src/crawl/repair-sweep.test.ts
// `runRepairSweep`'s 4-step behaviour (task-7-brief.md, spec §2.5) against a
// scripted `execute` stub and seeded parent/backfill rows — no browser, no
// AI, no real `startExecution`. The parent items' extractions stand in for
// "already merged": Task 5's R4 ordering guarantees a 'done' backfill item's
// merge landed before the item itself is marked done, so by the time this
// function evaluates a sample, the parent row already reflects it.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, runs, runItems, extractions, captures, sources, orgs, projects, datasets } from '@robot/db';
import { REPAIR_SAMPLE_COUNT, REPAIR_SUCCESS_MIN } from './backfill.js';
import { runRepairSweep } from './repair-sweep.js';

const SLUG = 'test-repair-sweep';
let orgId: string | null = null;

// `runRepairSweep`'s `execute` param is typed against the real
// `startExecution` (Promise<void>) — see repair-sweep.ts's doc comment.
const stubExecute = () => vi.fn(async (_opts?: { limit?: number }) => {});

/**
 * One parent run with N already-completed items (each with an extraction,
 * standing in for the merged parent state) and a backfill run against it
 * with N backfill items, one per parent item, `targetFields: ['isbn']`.
 * `pairs[i].status` is the backfill item's outcome; `pairs[i].isbn` is what
 * the PARENT's merged row shows for `isbn` after that backfill item (only
 * meaningful for 'done' — a 'failed' item's merge never ran).
 */
async function seedScenario(pairs: Array<{ status: 'done' | 'failed'; isbn?: string | null }>) {
  const [org] = await db.insert(orgs).values({ name: SLUG, slug: SLUG }).returning();
  orgId = org!.id;
  const [project] = await db.insert(projects).values({ orgId: org!.id, name: SLUG, slug: SLUG }).returning();
  const [dataset] = await db.insert(datasets).values({
    projectId: project!.id, name: SLUG, slug: SLUG,
    schema: [{ name: 'title', type: 'string' }, { name: 'isbn', type: 'string' }],
  }).returning();
  const [source] = await db.insert(sources).values({ datasetId: dataset!.id, name: SLUG, slug: SLUG, country: 'US' }).returning();

  const [parentRun] = await db.insert(runs).values({ sourceId: source!.id, status: 'completed', completedAt: new Date() }).returning();
  const [backfillRun] = await db.insert(runs).values({
    sourceId: source!.id, status: 'partial', parentRunId: parentRun!.id, targetFields: ['isbn'], completedAt: new Date(),
  }).returning();

  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i]!;
    const [capture] = await db.insert(captures).values({ sourceId: source!.id, runId: parentRun!.id, url: `https://example.com/parent/${i}` }).returning();
    const [extraction] = await db.insert(extractions).values({
      sourceId: source!.id, captureId: capture!.id, runId: parentRun!.id,
      data: [{ title: 'A', isbn: pair.status === 'done' ? (pair.isbn ?? null) : null }],
    }).returning();
    const [parentItem] = await db.insert(runItems).values({
      runId: parentRun!.id, kind: 'detail', url: `https://example.com/parent/${i}`, inputIndex: i,
      status: 'done', extractionId: extraction!.id,
    }).returning();
    await db.insert(runItems).values({
      runId: backfillRun!.id, kind: 'detail', url: `https://example.com/backfill/${i}`, inputIndex: i,
      parentId: parentItem!.id, targetFields: ['isbn'],
      status: pair.status, error: pair.status === 'failed' ? 'blocked' : null,
      completedAt: new Date(Date.now() + i * 1000),
    });
  }

  return { sourceId: source!.id, parentRunId: parentRun!.id, backfillRunId: backfillRun!.id };
}

const readRun = async (runId: string) => (await db.select().from(runs).where(eq(runs.id, runId)))[0]!;

afterEach(async () => {
  if (orgId) await db.delete(orgs).where(eq(orgs.id, orgId));
  orgId = null;
});

describe('runRepairSweep', () => {
  it('sweeps (no limit) when at least REPAIR_SUCCESS_MIN of the sample resolves', async () => {
    expect(REPAIR_SAMPLE_COUNT).toBe(3);
    expect(REPAIR_SUCCESS_MIN).toBe(2);
    const { backfillRunId } = await seedScenario([
      { status: 'done', isbn: '111' },
      { status: 'done', isbn: '222' },
      { status: 'done', isbn: null }, // resolved for OTHER reasons but not this field
    ]);
    const execute = stubExecute();

    const outcome = await runRepairSweep(db, backfillRunId, ['isbn'], execute);

    expect(outcome).toBe('swept');
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenNthCalledWith(1, { limit: REPAIR_SAMPLE_COUNT });
    expect(execute).toHaveBeenNthCalledWith(2, {});
    expect((await readRun(backfillRunId)).status).toBe('extracting');
  });

  it('stops with a warning (no sweep) when only 1 of 3 resolves', async () => {
    const { backfillRunId } = await seedScenario([
      { status: 'done', isbn: '111' },
      { status: 'done', isbn: null },
      { status: 'failed' },
    ]);
    const execute = stubExecute();

    const outcome = await runRepairSweep(db, backfillRunId, ['isbn'], execute);

    expect(outcome).toBe('repair_failed');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenNthCalledWith(1, { limit: REPAIR_SAMPLE_COUNT });
    const run = await readRun(backfillRunId);
    expect(run.status).toBe('partial'); // untouched — markRunExtracting never ran
    const lines = (run.logs ?? '').split('\n');
    expect(lines).toContain('warning: repair failed for isbn — sweep skipped, cells left missing');
  });

  it('treats a wholly-failed sample as zero eligible resolutions, not a skip', async () => {
    const { backfillRunId } = await seedScenario([
      { status: 'failed' },
      { status: 'failed' },
      { status: 'failed' },
    ]);
    const execute = stubExecute();

    const outcome = await runRepairSweep(db, backfillRunId, ['isbn'], execute);

    expect(outcome).toBe('repair_failed');
    expect(execute).toHaveBeenCalledTimes(1);
    const run = await readRun(backfillRunId);
    expect(run.status).toBe('partial');
    expect(run.logs).toContain('warning: repair failed for isbn');
  });

  // Finding 2 (important, final-review-findings.md): the sample execute
  // (`execute({limit: 3})`) can itself finalise the run 'cancelled' — the
  // operator clicked Stop mid-sampling. `runRepairSweep` used to never
  // re-read status after that, so even a well-resolved sample would sweep
  // the ENTIRE remainder of a run the operator had just told to stop.
  it('skips the sweep and appends a warning when the run reads cancelled after sampling — even though the sample resolved', async () => {
    const { backfillRunId } = await seedScenario([
      { status: 'done', isbn: '111' },
      { status: 'done', isbn: '222' },
      { status: 'done', isbn: null },
    ]);
    // Simulate the Stop landing during step 1's real execute: by the time
    // runRepairSweep re-reads, the run is already 'cancelled' (finaliseRun's
    // own terminal marker), not the 'partial' seedScenario normally seeds.
    await db.update(runs).set({ status: 'cancelled' }).where(eq(runs.id, backfillRunId));
    const execute = stubExecute();

    const outcome = await runRepairSweep(db, backfillRunId, ['isbn'], execute);

    expect(outcome).toBe('stopped');
    // Only the sample execute ran — no second, unbounded execute({}) call.
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenNthCalledWith(1, { limit: REPAIR_SAMPLE_COUNT });
    const run = await readRun(backfillRunId);
    expect(run.status).toBe('cancelled'); // untouched — markRunExtracting never ran
    const lines = (run.logs ?? '').split('\n');
    expect(lines).toContain('warning: sweep skipped — run was stopped during sampling');
  });

  it('also skips the sweep when the run reads cancelling (Stop requested but the loop has not settled it yet)', async () => {
    const { backfillRunId } = await seedScenario([
      { status: 'done', isbn: '111' },
      { status: 'done', isbn: '222' },
      { status: 'done', isbn: null },
    ]);
    await db.update(runs).set({ status: 'cancelling' }).where(eq(runs.id, backfillRunId));
    const execute = stubExecute();

    const outcome = await runRepairSweep(db, backfillRunId, ['isbn'], execute);

    expect(outcome).toBe('stopped');
    expect(execute).toHaveBeenCalledTimes(1);
  });

  // Finding 4 (minor, folded into Finding 2's re-read): between stage-1
  // finaliseRun('partial') and the sweep's markRunExtracting, guard 3 (crawl.ts)
  // sees no in-flight child — a second backfill click in that window creates a
  // concurrent duplicate sibling against the SAME parent. The pre-sweep
  // re-read must also catch that and skip, not just the cancelled/cancelling
  // case.
  it('skips the sweep when a newer sibling backfill exists for the same parent (duplicate-backfill window)', async () => {
    const { sourceId, parentRunId, backfillRunId } = await seedScenario([
      { status: 'done', isbn: '111' },
      { status: 'done', isbn: '222' },
      { status: 'done', isbn: null },
    ]);
    // A second backfill against the same parent, created AFTER this one and
    // still in flight (no completedAt) — the concurrent-duplicate scenario.
    await db.insert(runs).values({
      sourceId, status: 'extracting', parentRunId, targetFields: ['isbn'],
      createdAt: new Date(Date.now() + 5000),
    });
    const execute = stubExecute();

    const outcome = await runRepairSweep(db, backfillRunId, ['isbn'], execute);

    expect(outcome).toBe('stopped');
    expect(execute).toHaveBeenCalledTimes(1);
    const run = await readRun(backfillRunId);
    expect(run.status).toBe('partial'); // untouched — markRunExtracting never ran
    const lines = (run.logs ?? '').split('\n');
    expect(lines.some((l) => l.includes('newer backfill run exists'))).toBe(true);
  });

  it('an OLDER sibling backfill (created before this one) does not block the sweep', async () => {
    const { sourceId, parentRunId, backfillRunId } = await seedScenario([
      { status: 'done', isbn: '111' },
      { status: 'done', isbn: '222' },
      { status: 'done', isbn: null },
    ]);
    await db.insert(runs).values({
      sourceId, status: 'extracting', parentRunId, targetFields: ['isbn'],
      createdAt: new Date(Date.now() - 5000),
    });
    const execute = stubExecute();

    const outcome = await runRepairSweep(db, backfillRunId, ['isbn'], execute);

    expect(outcome).toBe('swept');
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
