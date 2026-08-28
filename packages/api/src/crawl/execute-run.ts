// packages/api/src/crawl/execute-run.ts
// Phase 2: turn a work list into data, one item at a time.
//
// Sequential on purpose. A Source is one domain, and `runExtraction` already
// serialises same-domain work behind the per-domain lock plus a 2s politeness
// delay — so parallelism here would only fight the politeness rule that keeps us
// welcome on the site.
//
// Every collaborator is injected. The loop's logic — keep going after a failure,
// stop when cancelled, count what actually happened — is then testable without a
// browser, an API key, or a database.

import type { ClaimedItem } from './claim-item.js';

export type ExecuteDeps = {
  claim: (runId: string) => Promise<ClaimedItem | null>;
  // Widened (Task 5) to carry `row` and `targetFields` alongside `extractionId`
  // — the explicit-contract choice for threading a backfill item's result into
  // a merge-aware `onDone`, instead of `extractItem` capturing them in a
  // closure variable a separate `onDone` call would read back out. Explicit
  // costs one field on the return type; closure-capture would make the two
  // deps calls implicitly coupled through loop-local state, which today is
  // safe only because the loop is serial per run.
  extractItem: (item: ClaimedItem) => Promise<{ row: Record<string, unknown>; extractionId: string | null; targetFields: string[] | null }>;
  onDone: (itemId: string, extractionId: string | null, row: Record<string, unknown>, targetFields: string[] | null) => Promise<void>;
  onFailed: (itemId: string, message: string) => Promise<void>;
  isCancelled: () => Promise<boolean>;
  /**
   * `cancelled` is the loop's own outcome, not re-derived by re-reading
   * `isCancelled()` — the run row can move on between the last check and
   * finalise. Without threading it through, a cancel-with-pending-work run
   * rolls up as `'extracting'` (rollUpStatus sees `pending > 0` with no way
   * to know a stop was requested) and the dashboard polls forever.
   *
   * `limitReached` is the same kind of outcome for `opts.limit`: a probe
   * stopped by its own sample limit also leaves items `pending`, but with
   * `cancelled` still `false` — cancel and a limit break are NOT the same
   * event at roll-up, and conflating them is Finding 1 (final-review-findings.md):
   * a limit-stopped probe rolled up to `'extracting'` and stayed there
   * forever, because rollUpStatus saw `pending > 0` and no cancel.
   */
  finalise: (rowCount: number, cancelled: boolean, limitReached: boolean) => Promise<string>;
};

export type ExecuteOutcome = {
  extracted: number;
  failed: number;
  recordingFailures: number;
  cancelled: boolean;
  limitReached: boolean;
  status: string;
};

export async function executeRun(
  runId: string,
  deps: ExecuteDeps,
  opts?: { limit?: number },
): Promise<ExecuteOutcome> {
  let extracted = 0;
  let failed = 0;
  let recordingFailures = 0;
  let cancelled = false;
  let limitReached = false;
  let status = '';

  // `finalise` runs in `finally` so it fires on every exit path — normal
  // completion, cancellation, or a claim that broke the loop early. A run
  // left un-finalised is invisible to every reader: crawl.status, the
  // dashboard and the export all read the run row.
  try {
    for (;;) {
      // A limited run (Task 3's sample probe) stops claiming once it has
      // enough outcomes — extracted + failed, not just extracted, so a run of
      // all-blocked pages can't spin claiming forever past its limit. The
      // items left `pending` need finalise to know a limit (not a cancel)
      // is why they're still pending — see `limitReached` on ExecuteDeps.
      if (opts?.limit !== undefined && extracted + failed >= opts.limit) {
        limitReached = true;
        break;
      }

      // Between items, never mid-item: a cancelled run leaves clean state, and an
      // item already claimed is finished rather than abandoned as `running`.
      let isRunCancelled: boolean;
      try {
        isRunCancelled = await deps.isCancelled();
      } catch (err) {
        // A broken cancel check must never stop a working run.
        console.error(`executeRun: isCancelled check failed for run ${runId}, treating as not cancelled`, err);
        isRunCancelled = false;
      }
      if (isRunCancelled) {
        cancelled = true;
        break;
      }

      let item: ClaimedItem | null;
      try {
        item = await deps.claim(runId);
      } catch (err) {
        // No work can be obtained, so continuing would just spin — stop, but
        // still finalise via the `finally` below.
        console.error(`executeRun: claim failed for run ${runId}, stopping`, err);
        break;
      }
      if (!item) break;

      try {
        const { row, extractionId, targetFields } = await deps.extractItem(item);
        try {
          await deps.onDone(item.id, extractionId, row, targetFields);
          extracted++;
        } catch (recordErr) {
          // Genuinely extracted, but failed to be durably marked done. That is
          // a recording failure, not an extraction failure — conflating the two
          // would make a scraped-but-unrecorded row indistinguishable, in the
          // failure log, from a page that was actually blocked.
          recordingFailures++;
          console.error(`executeRun: onDone failed to record item ${item.id}`, recordErr);
        }
      } catch (err) {
        // One blocked page must never cost the other 299 in the run.
        const message = err instanceof Error ? err.message : String(err);
        try {
          await deps.onFailed(item.id, message);
          failed++;
        } catch (recordErr) {
          // The extraction failure itself couldn't even be recorded — still a
          // recording failure, and the loop must still reach the rest.
          recordingFailures++;
          console.error(`executeRun: onFailed failed to record item ${item.id}`, recordErr);
        }
      }
    }
  } finally {
    status = await deps.finalise(extracted, cancelled, limitReached);
  }

  return { extracted, failed, recordingFailures, cancelled, limitReached, status };
}
