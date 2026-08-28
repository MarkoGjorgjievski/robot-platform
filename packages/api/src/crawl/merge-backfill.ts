// packages/api/src/crawl/merge-backfill.ts
// Cell-level merge-back: a backfill item's extracted row folds into its
// parent run's item, one target field at a time. Binding invariant of the
// whole repair engine (spec §2.3/§5): a backfill NEVER overwrites a filled
// parent cell — it exists to fill gaps, not to second-guess data the parent
// run already has.
//
// Cell-emptiness mirrors Task 2's coverage exactly (coverage.ts): a value is
// empty iff `== null || === ''` — so `0` and `false` count as filled.
// Divergence here would make a backfill overwrite cells coverage already
// counted as filled.

import { desc, eq } from 'drizzle-orm';
import { captures, extractions, runItems, runs } from '@robot/db';
import type { db as Database } from '@robot/db';
import { finaliseRun } from './roll-up-run.js';

function isEmpty(value: unknown): boolean {
  return value == null || value === '';
}

export async function mergeBackfillResult(
  db: typeof Database,
  backfillItemId: string,
  extractionId: string | null,
  row: Record<string, unknown>,
  targetFields: string[],
): Promise<void> {
  const backfillItem = await db.query.runItems.findFirst({
    where: eq(runItems.id, backfillItemId),
    columns: { id: true, parentId: true },
  });
  // Not a backfill item (no parentId) — nothing to merge into. Defensive:
  // every item reaching a merge-enabled `onDone` should carry a parentId
  // (Task 6 sets it on every backfill item), but a broken link must not
  // blow up the run that carried it.
  if (!backfillItem?.parentId) return;

  const parentItem = await db.query.runItems.findFirst({
    where: eq(runItems.id, backfillItem.parentId),
    with: { extraction: true },
  });
  if (!parentItem) return;

  if (!parentItem.extraction) {
    // Rule 5: the parent item never got an extraction — it failed
    // originally. There is nothing to merge cell-by-cell into, so the
    // backfill row becomes the item's first real data, whole (not just the
    // target fields — the item had zero data before this).
    //
    // R3 (ruled): a healed item still needs rule-3 absent-marking — any
    // targetField still empty in the fresh row is a field the focused
    // re-check positively came back without, not merely "never asked". Left
    // as `missing`, the confirmed_absent gate never engages and every future
    // backfill re-fetches it forever.
    const [parentRun] = await db.select({ sourceId: runs.sourceId }).from(runs).where(eq(runs.id, parentItem.runId));
    if (!parentRun?.sourceId) return;

    const captureId = await resolveCaptureId(db, extractionId, parentItem.runId);
    if (!captureId) return;

    const [extraction] = await db.insert(extractions).values({
      sourceId: parentRun.sourceId,
      captureId,
      runId: parentItem.runId,
      data: [row],
      rowCount: 1,
    }).returning({ id: extractions.id });

    const stillMissing = targetFields.filter((field) => isEmpty(row[field]));
    const absentSet = new Set((parentItem.absentFields as string[] | null) ?? []);
    for (const field of stillMissing) absentSet.add(field);

    await db.update(runItems)
      .set({ extractionId: extraction!.id, status: 'done', absentFields: Array.from(absentSet) })
      .where(eq(runItems.id, parentItem.id));

    // Finding 5 (minor, final-review-findings.md): only the heal path
    // changes an item's done/failed status (failed -> done) — a plain
    // cell-fill merge below never does, so it must not trigger a rollup.
    // Without this, the PARENT RUN's own resultCount/status went stale the
    // moment a heal landed: the run header's "Rows" stat undercounted, and a
    // 'partial' run that just became fully done never flipped to
    // 'completed'. Reuses finaliseRun verbatim (roll-up-run.ts) — same
    // cancelled=false/limitReached=false a fresh non-cancelled rollup always
    // uses — rather than a second, competing "what's this run's status"
    // implementation.
    await finaliseRun(db, parentItem.runId, false, false);
    return;
  }

  const data0: Record<string, unknown> = {
    ...(((parentItem.extraction.data as Record<string, unknown>[] | null)?.[0]) ?? {}),
  };

  const stillMissing: string[] = [];
  const newlyFilled: string[] = [];
  for (const field of targetFields) {
    if (!isEmpty(data0[field])) continue; // filled parent cells are never touched
    if (!isEmpty(row[field])) {
      data0[field] = row[field];
      newlyFilled.push(field);
    } else {
      stillMissing.push(field);
    }
  }

  const absentSet = new Set((parentItem.absentFields as string[] | null) ?? []);
  for (const field of stillMissing) absentSet.add(field);
  for (const field of newlyFilled) absentSet.delete(field);

  await db.update(extractions)
    .set({ data: [data0] })
    .where(eq(extractions.id, parentItem.extraction.id));

  await db.update(runItems)
    .set({ absentFields: Array.from(absentSet) })
    .where(eq(runItems.id, parentItem.id));
}

/**
 * `extractions.captureId` is NOT NULL, so healing a failed parent item (Rule
 * 5) needs a capture id from somewhere. Preferred: the capture behind the
 * backfill item's own extraction — the row literally came from that page
 * load. `extractionId` arrives as a parameter straight from the caller
 * (executeRun's `extractItem` result, via `onDone`) rather than being read
 * off the backfill item's own row, because R4 (fix round 2) reordered
 * `buildOnDone` to merge BEFORE `markItemDone` — the item row's own
 * `extractionId` column is not yet set at merge time, on purpose, so a merge
 * failure never leaves the item durably `done`. Fallback: the parent run's
 * most recent capture, for a caller that passes `extractionId: null`.
 */
async function resolveCaptureId(
  db: typeof Database,
  backfillExtractionId: string | null,
  parentRunId: string,
): Promise<string | null> {
  if (backfillExtractionId) {
    const [ext] = await db.select({ captureId: extractions.captureId }).from(extractions)
      .where(eq(extractions.id, backfillExtractionId));
    if (ext?.captureId) return ext.captureId;
  }
  const [latest] = await db.select({ id: captures.id }).from(captures)
    .where(eq(captures.runId, parentRunId))
    .orderBy(desc(captures.createdAt))
    .limit(1);
  return latest?.id ?? null;
}
