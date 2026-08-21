export type RunCounts = {
  pending: number; running: number; done: number; failed: number;
  listing: number; detail: number;
};

/** Statuses where work is still moving, and the view should keep polling. */
export function isRunActive(status: string): boolean {
  return status === 'extracting' || status === 'cancelling';
}

export function progressLabel(counts: RunCounts, status: string): string {
  const total = counts.detail;
  if (status === 'cancelled') return `Stopped after ${counts.done} of ${total}`;
  if (counts.done === 0 && counts.failed === 0) return `${total} URLs planned, not yet extracted`;
  const base = `${counts.done} of ${total} extracted`;
  return counts.failed > 0 ? `${base} · ${counts.failed} failed` : base;
}

export type RunControls = {
  /** Fetch and extract every pending URL — also the resume path for a stalled run. */
  showExtract: boolean;
  /** Re-queue the failed items and extract them again. */
  showRetry: boolean;
  /** Ask the running loop to stop between items. */
  showStop: boolean;
};

/**
 * Which controls the Run detail page offers for a run in this state.
 *
 * The rule that matters: **Extract and Retry do not depend on `isRunActive`.**
 * They used to — Stop was rendered in the `if (active)` branch and the other
 * two in the `else`, so an "active" run offered exactly one button. A run can
 * sit at `extracting` with no loop behind it (an api-server restart, or
 * `executeRun` breaking its loop on a transient claim failure and finalising a
 * still-pending run back to `extracting`), and in that state the only offered
 * action was Stop — which writes `cancelling`, which nothing alive will ever
 * observe, and which `isRunActive` also calls active. The run was then stuck
 * *and* un-resumable, with the page polling every 3s forever.
 *
 * Offering Extract on an active run is safe by design, not a race we tolerate:
 * `crawl.execute` is re-entrant on purpose (it is the documented crash-resume
 * path) and `claimNextItem`'s `FOR UPDATE SKIP LOCKED` means a second loop
 * skips whatever the first is holding rather than double-fetching it. An
 * earlier task deliberately declined to add a re-entry guard for exactly this
 * reason.
 */
export function runControls(status: string, counts: RunCounts): RunControls {
  return {
    // `running` counts as work a re-entered loop could pick up, not just
    // `pending`. If the LAST item of a run is the one abandoned at `running`
    // (an api-server restart on item 8 of 8), then pending is 0 while the run
    // is correctly still non-terminal — and keying this off `pending` alone
    // would leave Stop as the only button on exactly the run that needs
    // rescuing, with `requeueStaleRunningItems` reachable only from the CLI.
    // Closing the trap for items 1..N-1 but not item N is not closing it.
    // ...and `isRunActive` closes the last row of the trap table. A run can be
    // active with pending 0, running 0 AND failed 0: an api-server killed
    // between the final `markItemDone` and `finaliseRun` leaves every item
    // `done` and the run row never rolled up. On counts alone that state
    // offered Stop and nothing else — the original trap verbatim, where Stop
    // writes `cancelling` that no loop will ever observe. One `execute` there
    // claims nothing and finalises the run immediately, which is exactly the
    // repair it needs.
    showExtract: counts.pending > 0 || counts.running > 0 || isRunActive(status),
    showRetry: counts.failed > 0,
    showStop: isRunActive(status),
  };
}

/**
 * What the Extract button says for these counts.
 *
 * `running` items are not pending, so they must not be counted as pending —
 * "Extract 0 pending" on the one button that can rescue a stalled run would
 * read as a no-op and invite the operator to give up. When there is genuinely
 * pending work, that is the number to show: pending items are claimable
 * immediately, whereas a stalled one is only reclaimed once it is past the
 * staleness threshold.
 *
 * With neither pending nor running work, the button is on screen only because
 * the run is still active with every item finished (see `runControls`). Both
 * other labels would be lies there — there are no pending URLs to extract and
 * no stalled work to resume — so it says what the click actually does: roll the
 * run up to its terminal status.
 */
export function extractButtonLabel(counts: RunCounts): string {
  if (counts.pending === 0 && counts.running === 0) return 'Finish run';
  if (counts.pending === 0 && counts.running > 0) {
    return `Resume ${counts.running} stalled`;
  }
  return `Extract ${counts.pending} pending`;
}
