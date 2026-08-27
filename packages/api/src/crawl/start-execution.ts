// packages/api/src/crawl/start-execution.ts
// Phase 2's fire-and-forget wrapper — extracted out of `crawl.ts`'s `execute`
// procedure (mvp-simplification task 8) so `crawl.probeAndSample` can start
// the exact same loop instead of duplicating it, and so BOTH call sites can be
// exercised in tests (via `vi.mock` on this module's own path) without ever
// launching a browser.

import { eq } from 'drizzle-orm';
import { SchemaAgent } from '@robot/agent';
import { type OriginField } from '@robot/scraper';
import { db, runs } from '@robot/db';
import { withBrowserSession } from '../browser-session.js';
import { claimNextItem } from './claim-item.js';
import { markItemDone, markItemFailed } from './record-outcome.js';
import { finaliseRun } from './roll-up-run.js';
import { isRunCancelled } from './is-cancelled.js';
import { executeRun } from './execute-run.js';
import { extractItem } from './extract-item.js';
import { safeErrorMessage } from './plan-source.js';

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
): Promise<void> {
  try {
    // `withBrowserSession` owns launch-and-always-close, including the case
    // where `launch()` itself throws part-way. The hand-rolled
    // try/finally this replaces closed on every path too, but only because
    // this procedure remembered to write it — and its `finally { await
    // browser.close(); }` would have let a throwing close() replace the real
    // execution error on its way out.
    await withBrowserSession(async (browser) => {
      const agent = new SchemaAgent();
      await executeRun(runId, {
        claim: (id) => claimNextItem(db, id),
        extractItem: (item) => extractItem(db, item, { browser, agent, sourceId, runId, schema }),
        onDone: (itemId, extractionId) => markItemDone(db, itemId, extractionId),
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
        finalise: (_rowCount, cancelled, limitReached) => finaliseRun(db, runId, cancelled, limitReached),
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
  }
}
