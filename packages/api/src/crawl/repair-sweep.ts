// packages/api/src/crawl/repair-sweep.ts
// Staged repair execution (spec §2.5): sample a few items first, evaluate the
// sample against the PARENT's already-merged rows, then either sweep the
// rest of the backfill run for free (the cached paths the samples minted) or
// stop honest and terminal, leaving the cells still missing.
//
// `deadFieldStrategy` is deliberately NOT persisted anywhere (controller
// Ruling R5, task 7): this whole staged flow lives inline in one request's
// fire-and-forget call — there is no durable "this run is mid-repair-sweep"
// marker on the run row or elsewhere. A crash between the sample execute and
// the sweep execute leaves the run finalised `'partial'` (F1 semantics, step
// 1 below) with whatever cached paths the samples that did complete already
// minted. That is the recovery path: the human sees a partial run, re-runs
// `backfillPreview`, and re-issues `backfill` — no column, no resume
// machinery to keep consistent with the run's real state.

import { and, asc, eq, inArray } from 'drizzle-orm';
import { runItems } from '@robot/db';
import type { db as Database } from '@robot/db';
import { markRunExtracting } from './mark-extracting.js';
import { appendRunLog } from './plan-source.js';
import { REPAIR_SAMPLE_COUNT, REPAIR_SUCCESS_MIN } from './backfill.js';

/** Mirrors coverage.ts / merge-backfill.ts: `0` and `false` count as filled. */
function isEmpty(value: unknown): boolean {
  return value == null || value === '';
}

export async function runRepairSweep(
  db: typeof Database,
  runId: string,
  deadFields: string[],
  // Typed against the real `startExecution` (Promise<void>), not the
  // brief's `Promise<ExecuteOutcome>` — startExecution itself returns void
  // (start-execution.ts), and this function never reads the resolved value
  // either way. Verified against the live file before wiring, per the task-7
  // controller ruling.
  execute: (opts?: { limit?: number }) => Promise<void>,
): Promise<'swept' | 'repair_failed'> {
  // Step 1: the first REPAIR_SAMPLE_COUNT items — executeRun's own claim
  // order. This execute run finalises the run 'partial' on its own (F1
  // semantics): a limited run always leaves items pending, and finaliseRun
  // rolls that up to 'partial', not 'extracting'.
  await execute({ limit: REPAIR_SAMPLE_COUNT });

  // Step 2: evaluate. "First completed" = completion order, restricted to
  // items whose own targetFields actually touch a dead field — a sample item
  // can carry other, healthy target fields too, when targetNames mixed both.
  const deadSet = new Set(deadFields);
  const candidates = await db.query.runItems.findMany({
    where: and(
      eq(runItems.runId, runId),
      eq(runItems.kind, 'detail'),
      inArray(runItems.status, ['done', 'failed']),
    ),
    orderBy: [asc(runItems.completedAt)],
    columns: { id: true, parentId: true, targetFields: true, status: true },
  });
  const samples = candidates
    .filter((item) => Array.isArray(item.targetFields) && (item.targetFields as string[]).some((f) => deadSet.has(f)))
    .slice(0, REPAIR_SAMPLE_COUNT);

  let resolved = 0;
  for (const sample of samples) {
    // A failed sample counts as unresolved, not skipped (R4): the merge that
    // would have filled the parent cell never ran for it, so there is
    // nothing to read back — no need to even look at the parent row.
    if (sample.status === 'failed' || !sample.parentId) continue;

    const parentItem = await db.query.runItems.findFirst({
      where: eq(runItems.id, sample.parentId),
      with: { extraction: true },
    });
    const row = ((parentItem?.extraction?.data as Record<string, unknown>[] | null)?.[0]) ?? {};
    const itemDeadFields = (sample.targetFields as string[]).filter((f) => deadSet.has(f));
    if (itemDeadFields.length > 0 && itemDeadFields.every((f) => !isEmpty(row[f]))) resolved++;
  }

  // Step 3: enough of the sample resolved — sweep the rest, no limit. The
  // cached paths the samples minted make this the free tier for the items
  // that follow.
  if (resolved >= REPAIR_SUCCESS_MIN) {
    await markRunExtracting(db, runId);
    await execute({});
    return 'swept';
  }

  // Step 4: the sample says the repair didn't take. Say so and stop — the
  // run stays 'partial' (already finalised by step 1's execute), honest and
  // terminal, with completedAt already set.
  await appendRunLog(
    db,
    runId,
    `warning: repair failed for ${deadFields.join(', ')} — sweep skipped, cells left missing`,
  );
  return 'repair_failed';
}
