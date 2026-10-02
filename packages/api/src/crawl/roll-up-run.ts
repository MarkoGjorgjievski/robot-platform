// packages/api/src/crawl/roll-up-run.ts
// What a run's status is, given what happened to its items.

import { and, eq, sql } from 'drizzle-orm';
import { runs, runItems, extractions } from '@robot/db';
import type { db as Database } from '@robot/db';
import { summariseVariantRows, type VariantRunSummary } from '@robot/scraper';

export type RunRollup = 'completed' | 'partial' | 'failed' | 'extracting' | 'cancelled';

/**
 * `cancelled` reflects whether the run was told to stop (`status='cancelling'`)
 * — not whether it actually has pending work. Only when BOTH are true does the
 * roll-up settle to `'cancelled'`: pending work really is left unclaimed, and
 * saying so is honest. If nothing is pending, the work genuinely all finished
 * before the cancel took effect — rolling that up as `'cancelled'` would be a
 * lie, so it falls through to the normal completed/partial/failed logic.
 *
 * `limitReached` is Finding 1's fix (final-review-findings.md): a probe
 * stopped by its own sample limit (executeRun's `opts.limit`) also leaves
 * `pending > 0`, with `cancelled` still `false` — that combination used to
 * fall through to `'extracting'`, a status the dashboard reads as "a loop is
 * still working this run" forever, since nothing will ever claim the rest.
 * A limit break is a deliberate, honest stop, not a cancel and not a lie:
 * `'partial'` says exactly what happened — some items were extracted, the
 * rest were never attempted by design — and it is terminal, so `finaliseRun`
 * writes a real `completedAt`. `cancelled` takes priority when both are true
 * (unreachable today — the limit check runs before the cancel check — but a
 * future caller has no reason to guess which wins).
 */
export function rollUpStatus(
  counts: { pending: number; running: number; done: number; failed: number },
  cancelled = false,
  limitReached = false,
): RunRollup {
  // `running` is unfinished work exactly as `pending` is — an item claimed by
  // `claimNextItem` and never resolved (an api-server restart mid-item is the
  // way that happens) must not be rolled up as if it were never there. Leaving
  // it out is what let a run of 8 with item 5 stuck `running` report
  // `completed` with resultCount=7 and no complaint anywhere. `running` is a
  // required field, not optional-with-a-default, so a future caller has to
  // decide about it rather than silently reintroduce this.
  if (counts.pending > 0 || counts.running > 0) {
    if (cancelled) return 'cancelled';
    if (limitReached) return 'partial';
    return 'extracting';
  }
  if (counts.failed === 0) return 'completed';
  // `partial` exists because at scale "480 of 500 succeeded" is the normal
  // outcome, and a binary completed/failed cannot express it.
  return counts.done > 0 ? 'partial' : 'failed';
}

/**
 * Writes the run's final state, its extracted row count, and (variants plan
 * 3) its variant summary.
 *
 * `resultCount` means EXTRACTED ROWS everywhere else in this codebase — the
 * dashboard renders it as "N rows". It is the sum of `extractions.rowCount`
 * for the run (`jsonb_array_length`, the same SQL `runs.getWithDetails`
 * already sums), not the count of done items: a list-method variants run
 * writes several rows in the one extraction a product page produces, so
 * "rows" and "items" diverge there. For a run without variants the two are
 * equal — only `extract-item.ts`/`merge-backfill.ts` ever insert into
 * `extractions`, and both write exactly one row per item unless a variant
 * plan says otherwise.
 *
 * This is derived from the DB, not taken from a caller-supplied number. A
 * caller's own in-memory counter is only ever that caller's partial view: two
 * concurrent `executeRun` loops on the same run would each know only the
 * items *they* claimed, and whichever call lands last would overwrite
 * `resultCount` with an undercount. Reading the DB instead means the true
 * total is what gets written no matter how many callers raced to finalise.
 *
 * `variantSummary` is written only when the run's rows carry any
 * `_product_key` (i.e. this is a variants run) — `summariseVariantRows`
 * derives `variants`/`products`/`withoutVariants`/`partial` straight from the
 * stored rows. `variantsSkippedForBudget` is NOT derivable from the rows
 * (skipped pages were never extracted, so they never produced one) — Task 4's
 * `queueVariantGroup` is the only place that increments it, straight onto
 * `runs.variant_summary`. Controller ruling R1: this function must read
 * whatever is already there as `skipped` and preserve it in the summary it
 * writes, so a run that finalises after Task 4 has already recorded a skip
 * does not lose it to a recompute that defaults back to 0.
 */
export async function finaliseRun(
  db: typeof Database,
  runId: string,
  cancelled = false,
  limitReached = false,
): Promise<RunRollup> {
  const [counts] = await db
    .select({
      pending: sql<number>`count(*) filter (where ${runItems.status} = 'pending')::int`,
      running: sql<number>`count(*) filter (where ${runItems.status} = 'running')::int`,
      done: sql<number>`count(*) filter (where ${runItems.status} = 'done')::int`,
      failed: sql<number>`count(*) filter (where ${runItems.status} = 'failed')::int`,
    })
    .from(runItems)
    .where(and(eq(runItems.runId, runId), eq(runItems.kind, 'detail')));

  const done = Number(counts?.done ?? 0);
  const status = rollUpStatus({
    pending: Number(counts?.pending ?? 0),
    running: Number(counts?.running ?? 0),
    done,
    failed: Number(counts?.failed ?? 0),
  }, cancelled, limitReached);

  const [rowTotal] = await db
    .select({ total: sql<number>`coalesce(sum(jsonb_array_length(${extractions.data})), 0)::int` })
    .from(extractions)
    .where(eq(extractions.runId, runId));
  const resultCount = Number(rowTotal?.total ?? 0);

  const extractionRows = await db
    .select({ data: extractions.data })
    .from(extractions)
    .where(eq(extractions.runId, runId));
  const allRows = extractionRows.flatMap((e) => (Array.isArray(e.data) ? e.data as Record<string, unknown>[] : []));
  const hasVariantRows = allRows.some((r) => r._product_key !== undefined && r._product_key !== null);

  let variantSummary: VariantRunSummary | undefined;
  if (hasVariantRows) {
    const [current] = await db.select({ variantSummary: runs.variantSummary }).from(runs).where(eq(runs.id, runId));
    const skipped = (current?.variantSummary as VariantRunSummary | null)?.variantsSkippedForBudget ?? 0;
    variantSummary = summariseVariantRows(allRows, skipped);
  }

  await db.update(runs)
    .set({
      status,
      resultCount,
      completedAt: status === 'extracting' ? null : new Date(),
      ...(variantSummary ? { variantSummary } : {}),
    })
    .where(eq(runs.id, runId));

  return status;
}
