// packages/api/src/crawl/start-execution.ts
// Phase 2's fire-and-forget wrapper — extracted out of `crawl.ts`'s `execute`
// procedure (mvp-simplification task 8) so `crawl.probeAndSample` can start
// the exact same loop instead of duplicating it, and so BOTH call sites can be
// exercised in tests (via `vi.mock` on this module's own path) without ever
// launching a browser.

import { eq } from 'drizzle-orm';
import { SchemaAgent, snapshotUsage } from '@robot/agent';
import { type OriginField, type SchemaDefinitionField } from '@robot/scraper';
import { db, runs, sources } from '@robot/db';
import type { db as Database } from '@robot/db';
import { withBrowserSession } from '../browser-session.js';
import { loadCurrentCertification, type Certification } from '../verify/current-certification.js';
import { claimNextItem } from './claim-item.js';
import { markItemDone, markItemFailed } from './record-outcome.js';
import { mergeBackfillResult } from './merge-backfill.js';
import { finaliseRun } from './roll-up-run.js';
import { isRunCancelled } from './is-cancelled.js';
import { executeRun, type ExecuteDeps } from './execute-run.js';
import { extractItem } from './extract-item.js';
import { flagDrift } from './drift.js';
import { safeErrorMessage } from './plan-source.js';
import { addRunCost, costSince } from './record-run-cost.js';

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
  } = {},
): ExecuteDeps['onDone'] {
  const doMarkDone = deps.markItemDone ?? markItemDone;
  const doMarkFailed = deps.markItemFailed ?? markItemFailed;
  const doMerge = deps.mergeBackfillResult ?? mergeBackfillResult;

  if (!mergeToParent) {
    return (itemId, extractionId) => doMarkDone(db, itemId, extractionId);
  }
  return async (itemId, extractionId, row, targetFields) => {
    try {
      await doMerge(db, itemId, extractionId, row, targetFields ?? []);
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
 * Pulled out and exported, mirroring `buildOnDone` above, so this is testable
 * with stubbed `finaliseRun`/`flagDrift` — no browser, no real DB.
 */
export function buildFinalise(
  db: typeof Database,
  runId: string,
  sourceId: string,
  certification: Certification | null,
  deps: {
    finaliseRun?: typeof finaliseRun;
    flagDrift?: typeof flagDrift;
  } = {},
): ExecuteDeps['finalise'] {
  const doFinaliseRun = deps.finaliseRun ?? finaliseRun;
  const doFlagDrift = deps.flagDrift ?? flagDrift;

  return async (_rowCount, cancelled, limitReached) => {
    const status = await doFinaliseRun(db, runId, cancelled, limitReached);
    // Drift is only meaningful once the run has actually stopped — checking
    // it mid-loop (status still 'extracting') would judge a miss share off
    // a partial, still-growing sample.
    if (certification && status !== 'extracting') {
      try {
        await doFlagDrift(db, runId, sourceId, Object.keys(certification.paths));
      } catch (err) {
        console.error(`[crawl] drift flagging failed for run ${runId}:`, err);
      }
    }
    return status;
  };
}

/**
 * Runs the loop outside the request. Deliberately not awaited: 200 items at
 * ~30s each is ~100 minutes, which no HTTP mutation can hold open. The honest
 * limit of having no job queue is that an api-server restart pauses the run —
 * `run_items` survives, so calling execute again resumes it.
 *
 * This function must never reject in a way that escapes to its caller as an
 * unhandled promise rejection — every caller deliberately does not await it,
 * and under default Node behaviour an unhandled rejection kills the process,
 * taking the whole api-server (and the dashboard it serves) down with it. So
 * every step of the failure path — reading the error, and recording it — is
 * itself guarded; the `.catch()` at each call site is belt-and-braces for
 * anything this function's own guards still missed.
 */
export async function startExecution(
  runId: string,
  sourceId: string,
  schema: OriginField[],
  limit?: number,
  opts?: { mergeToParent?: boolean },
): Promise<void> {
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

      await executeRun(runId, {
        claim: (id) => claimNextItem(db, id),
        extractItem: (item) => extractItem(db, item, { browser, agent, sourceId, runId, schema, certification, schemaDefinition }),
        onDone: buildOnDone(db, opts?.mergeToParent),
        onFailed: (itemId, message) => markItemFailed(db, itemId, message),
        // Both `cancelling` (the stop request) and `cancelled` (a stop another
        // loop already carried out) end this loop — see is-cancelled.ts.
        isCancelled: () => isRunCancelled(db, runId),
        // No rowCount passed: finaliseRun derives it from the DB itself, so a
        // stale local counter from this loop can never overwrite a truer total.
        // `cancelled` and `limitReached` ARE threaded through — executeRun's
        // own record of why the loop stopped with items still pending, and
        // finaliseRun needs both to roll a still-pending run up to
        // 'cancelled'/'partial' instead of leaving it stuck at 'extracting'.
        finalise: buildFinalise(db, runId, sourceId, certification),
      }, { limit });
    });
  } catch (err) {
    console.error(`[crawl] execution of run ${runId} failed:`, err);
    try {
      await db.update(runs)
        .set({ status: 'failed', errorMessage: safeErrorMessage(err).slice(0, 1000), completedAt: new Date() })
        .where(eq(runs.id, runId));
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
