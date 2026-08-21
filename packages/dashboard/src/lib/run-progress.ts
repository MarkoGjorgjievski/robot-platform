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
    showExtract: counts.pending > 0,
    showRetry: counts.failed > 0,
    showStop: isRunActive(status),
  };
}
