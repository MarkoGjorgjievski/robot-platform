// packages/api/src/crawl/start-execution.ts
// Phase 2's fire-and-forget wrapper — extracted out of `crawl.ts`'s `execute`
// procedure (mvp-simplification task 8) so `crawl.probeAndSample` can start
// the exact same loop instead of duplicating it, and so BOTH call sites can be
// exercised in tests (via `vi.mock` on this module's own path) without ever
// launching a browser.

import { eq, sql } from 'drizzle-orm';
import { SchemaAgent, snapshotUsage } from '@robot/agent';
import { HARD_ITEM_CEILING, leanRunStateFromEnv, leanSummary, type OriginField, type SchemaDefinitionField, type VariantRunPlan } from '@robot/scraper';
import { db, extractions, runs, sources } from '@robot/db';
import type { db as Database } from '@robot/db';
import { withBrowserSession } from '../browser-session.js';
import { loadCurrentCertification, type Certification } from '../verify/current-certification.js';
import { loadVariantRunPlan } from './variant-run-plan.js';
import { claimNextItem } from './claim-item.js';
import { failPendingForWall, markItemDone, markItemFailed } from './record-outcome.js';
import { mergeBackfillResult } from './merge-backfill.js';
import { finaliseRun } from './roll-up-run.js';
import { isRunCancelled } from './is-cancelled.js';
import { executeRun, type ExecuteDeps } from './execute-run.js';
import { extractItem } from './extract-item.js';
import { flagDrift } from './drift.js';
import { startDriftCheck } from '../verify/run-drift-check.js';
import { safeErrorMessage } from './plan-source.js';
import { addRunCost, costSince } from './record-run-cost.js';
import { enqueueRunDelivery } from '../delivery/run-delivery.js';

/**
 * The one decision `startExecution` wires into `executeRun`'s `onDone`:
 * a plain run only needs the item marked done, but a backfill run
 * (`opts.mergeToParent`) also has to fold its row into the parent item.
 * Pulled out and exported so it is testable against stubbed
 * `markItemDone`/`markItemFailed`/`mergeBackfillResult` without a browser, an
 * API key, or a database — `startExecution` itself is not otherwise
 * unit-testable, since it hard-wires the real browser session and every
 * other collaborator inline.
 *
 * R4 (fix round 2): for a merge-to-parent run, 'done' means MERGED. The
 * merge runs FIRST, before the item is marked done — the two are not atomic,
 * and a backfill item durably marked `done` with its merge never having
 * landed would report success having changed nothing on the parent it exists
 * to repair. If the merge itself throws, the item is marked `failed` (not
 * `done`) with the underlying error preserved, which makes it retryable
 * through the existing `retryFailed` flow instead of silently vanishing as a
 * false-green backfill.
 */
export function buildOnDone(
  db: typeof Database,
  mergeToParent: boolean | undefined,
  deps: {
    markItemDone?: typeof markItemDone;
    markItemFailed?: typeof markItemFailed;
    mergeBackfillResult?: typeof mergeBackfillResult;
    /** The run's variant plan, if any: lets the merge clear `_variant_partial`
     * on rows a repair completed (final review M4). */
    variantPlan?: VariantRunPlan | null;
  } = {},
): ExecuteDeps['onDone'] {
  const doMarkDone = deps.markItemDone ?? markItemDone;
  const doMarkFailed = deps.markItemFailed ?? markItemFailed;
  const doMerge = deps.mergeBackfillResult ?? mergeBackfillResult;
  const planArg: [VariantRunPlan] | [] = deps.variantPlan ? [deps.variantPlan] : [];

  if (!mergeToParent) {
    return (itemId, extractionId) => doMarkDone(db, itemId, extractionId);
  }
  return async (itemId, extractionId, row, targetFields) => {
    try {
      await doMerge(db, itemId, extractionId, row, targetFields ?? [], ...planArg);
    } catch (err) {
      await doMarkFailed(db, itemId, `merge failed: ${safeErrorMessage(err)}`);
      return;
    }
    await doMarkDone(db, itemId, extractionId);
  };
}

/**
 * Drift bookkeeping can never change a run's status. `finaliseRun` has
 * ALREADY committed the run's terminal status by the time this looks at
 * `certification` — a throw out of `flagDrift` must never be allowed to
 * propagate past that point, because `executeRun`'s `finally` calls
 * `deps.finalise` and any exception it throws escapes into `startExecution`'s
 * outer catch, which then overwrites the already-committed status with
 * `'failed'` — replacing a truthful `'completed'`/`'partial'` with a lie.
 * So `flagDrift` runs inside its own try/catch, logged and swallowed:
 * missing one run's drift flag is a much smaller loss than corrupting that
 * run's status.
 *
 * When drift is flagged, the free drift check (drift repair, spec D3) starts
 * right after, un-awaited, handed each drifted field's empty share — inside
 * the same try, so a check that fails to start is logged like a failed flag
 * and never touches the run's status either.
 *
 * After drift, a settled run's delivery (its file and webhook, spec 2026-10-24) is queued the same way —
 * logged and swallowed if it fails.
 *
 * Pulled out and exported, mirroring `buildOnDone` above, so this is testable
 * with stubbed `finaliseRun`/`flagDrift`/`startDriftCheck` — no browser, no real DB.
 */
export function buildFinalise(
  db: typeof Database,
  runId: string,
  sourceId: string,
  certification: Certification | null,
  deps: {
    finaliseRun?: typeof finaliseRun;
    flagDrift?: typeof flagDrift;
    startDriftCheck?: typeof startDriftCheck;
    enqueueDelivery?: (db: typeof Database, runId: string) => Promise<unknown>;
  } = {},
): ExecuteDeps['finalise'] {
  const doFinaliseRun = deps.finaliseRun ?? finaliseRun;
  const doFlagDrift = deps.flagDrift ?? flagDrift;
  const doStartDriftCheck = deps.startDriftCheck ?? startDriftCheck;
  const doEnqueueDelivery = deps.enqueueDelivery ?? enqueueRunDelivery;

  return async (_rowCount, cancelled, limitReached) => {
    const status = await doFinaliseRun(db, runId, cancelled, limitReached);
    // Drift is only meaningful once the run has actually stopped — checking
    // it mid-loop (status still 'extracting') would judge a miss share off
    // a partial, still-growing sample.
    if (certification && status !== 'extracting') {
      try {
        const drift = await doFlagDrift(
          db, runId, sourceId,
          // A default-only field has no path and never drifts (spec 2026-10-13 §5).
          Object.keys(certification.paths).filter((k) => certification.paths[k]!.length > 0),
          Object.keys(certification.defaults ?? {}),
        );
        if (drift.keys.length > 0) {
          void doStartDriftCheck(sourceId, runId, { emptyShare: drift.emptyShare })
            .catch((err) => console.error(`[crawl] drift check failed to start for run ${runId}:`, err));
        }
      } catch (err) {
        console.error(`[crawl] drift flagging failed for run ${runId}:`, err);
      }
    }
    // Spec 2026-10-24 §3.3: a settled run of a website with a schedule or a webhook gets its file and its post.
    // In its own try, like drift: a delivery that cannot be queued never changes the run's status.
    if (status !== 'extracting') {
      try {
        await doEnqueueDelivery(db, runId);
      } catch (err) {
        console.error(`[crawl] run delivery could not be queued for run ${runId}:`, err);
      }
    }
    return status;
  };
}

/**
 * Runs the loop outside the request: 200 items at ~30s each is ~100 minutes,
 * which no HTTP mutation can hold open. Runs are `run` jobs (spec 2026-10-23
 * §4.4, jobs/handlers/run.ts): the worker calls this, one executor per run, and
 * a crash or a stuck attempt resumes the run by itself — `run_items` survives,
 * and the retry puts the items its earlier attempt held back to pending.
 *
 * `opts.hooks` is the job's side: `onItem` after each recorded item (the job's
 * progress), `aborted` when the worker stopped this attempt — the loop stops
 * between items without finalising and the run is left for the retry.
 *
 * This function must never reject: every step of the failure path — reading
 * the error, and recording it — is itself guarded (the operator CLI still calls
 * it un-awaited, where an unhandled rejection would kill the process).
 */
export async function startExecution(
  runId: string,
  sourceId: string,
  schema: OriginField[],
  limit?: number,
  opts?: { mergeToParent?: boolean; hooks?: { onItem?: () => void; aborted?: () => boolean } },
): Promise<void> {
  const hooks = opts?.hooks;
  // Snapshotted outside the try: the cost of a run that failed part-way is
  // still money the customer spent, and Usage must show it.
  const before = snapshotUsage();
  try {
    // `withBrowserSession` owns launch-and-always-close, including the case
    // where `launch()` itself throws part-way. The hand-rolled
    // try/finally this replaces closed on every path too, but only because
    // this procedure remembered to write it — and its `finally { await
    // browser.close(); }` would have let a throwing close() replace the real
    // execution error on its way out.
    await withBrowserSession(async (browser) => {
      const agent = new SchemaAgent();
      // Loaded once per execution: a certified Source runs ONLY its certified
      // paths for the whole loop (extractItem never falls back to the cache/AI
      // chain), and after the loop finishes, drift is checked against exactly
      // these same certified keys.
      const certification = await loadCurrentCertification(db, sourceId);
      const sourceRow = certification
        ? await db.query.sources.findFirst({ where: eq(sources.id, sourceId), columns: { schemaDefinition: true } })
        : null;
      const schemaDefinition = (sourceRow?.schemaDefinition as SchemaDefinitionField[] | null) ?? undefined;
      // Read once per run, off the same certification — null unless it carries variants.
      const variantPlan = await loadVariantRunPlan(db, sourceId, certification);
      // The run's item cap for links-method variant pages (queue-variant-pages.ts):
      // HARD_ITEM_CEILING, not the source's item budget. Marko, 2026-10-05: the
      // budget counts products; variant pages ride along, up to the run's hard
      // limit of 5,000 pages — planning of products still uses the source budget.
      const runItemCap = HARD_ITEM_CEILING;
      const onDone = buildOnDone(db, opts?.mergeToParent, { variantPlan });
      // Spec 2026-10-23 run speed §3.4: one lean state per execution of a certified run; RUN_CAPTURE=full turns it off.
      // A website with variants builds its rows from the capture, which no lean check compares: today's capture throughout (final review I1).
      const lean = certification ? leanRunStateFromEnv(process.env, { variants: variantPlan != null }) : undefined;

      try {
        await executeRun(runId, {
          claim: (id) => claimNextItem(db, id),
          extractItem: (item) => extractItem(db, item, { browser, agent, sourceId, runId, schema, certification, schemaDefinition, variantPlan, itemCap: runItemCap, ...(lean ? { lean } : {}) }),
          onDone: async (...args) => { await onDone(...args); hooks?.onItem?.(); },
          onFailed: async (itemId, message) => { await markItemFailed(db, itemId, message); hooks?.onItem?.(); },
          ...(hooks?.aborted ? { aborted: hooks.aborted } : {}),
          // Both `cancelling` (the stop request) and `cancelled` (a stop another
          // loop already carried out) end this loop — see is-cancelled.ts.
          isCancelled: () => isRunCancelled(db, runId),
          stopForWall: (message) => failPendingForWall(db, runId, message),
          // No rowCount passed: finaliseRun derives it from the DB itself, so a
          // stale local counter from this loop can never overwrite a truer total.
          // `cancelled` and `limitReached` ARE threaded through — executeRun's
          // own record of why the loop stopped with items still pending, and
          // finaliseRun needs both to roll a still-pending run up to
          // 'cancelled'/'partial' instead of leaving it stuck at 'extracting'.
          finalise: buildFinalise(db, runId, sourceId, certification),
        }, { limit });
      } finally {
        // Logged on every way out, a loop that threw included: what the run took up to there.
        if (lean) console.log(`[crawl] ${leanSummary(runId, lean)}`);
      }
    });
  } catch (err) {
    console.error(`[crawl] execution of run ${runId} failed:`, err);
    // The worker stopped this attempt and closed its browser under it: what threw is the stop, not the
    // run. The run is left as it is; the job's retry resumes it.
    if (hooks?.aborted?.()) return;
    try {
      // Its rows are counted here (no finalise ran), so delivery can tell a failed run with rows from one without.
      await db.update(runs)
        .set({
          status: 'failed', errorMessage: safeErrorMessage(err).slice(0, 1000), completedAt: new Date(),
          resultCount: sql`(SELECT coalesce(sum(jsonb_array_length(${extractions.data})), 0)::int FROM ${extractions} WHERE ${extractions.runId} = ${runId})`,
        })
        .where(eq(runs.id, runId));
      // Spec 2026-10-24 §3.3: a failed run with rows gets its file and its post like a finalised one (final review I1).
      try {
        await enqueueRunDelivery(db, runId);
      } catch (deliveryErr) {
        console.error(`[crawl] run delivery could not be queued for run ${runId}:`, deliveryErr);
      }
    } catch (recoveryErr) {
      // If the DB is what broke, recording the failure will break the same
      // way — that must not become a second, uncaught throw. There's nothing
      // more we can do here beyond logging; crawl.status will show the run
      // stuck at 'extracting', which is the honest state, and a restart or a
      // fixed DB lets a re-issued execute resume it.
      console.error(`[crawl] failed to record failure status for run ${runId}:`, recoveryErr);
    }
  } finally {
    try {
      await addRunCost(db, runId, costSince(before));
    } catch (costErr) {
      // A cost that could not be written is a gap in Usage, not a broken run;
      // and this must not become the unhandled rejection the comment above
      // this function exists to prevent.
      console.error(`[crawl] failed to record cost for run ${runId}:`, costErr);
    }
  }
}
