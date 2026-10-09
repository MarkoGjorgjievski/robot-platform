// packages/api/src/crawl/execute-guard.ts

/**
 * May `crawl.execute` run this run? A run that failed while planning and has
 * no items is refused with its own reason: `markRunExtracting` would otherwise
 * flip it to extracting and `finaliseRun` roll an empty run up to completed —
 * the green "Done" with 0 rows the 2026-10-08 campaign recorded (spec
 * 2026-10-09 §A2). A failed run that still has items is a retry, allowed.
 */
export function canExecute(
  run: { status: string; errorMessage: string | null },
  itemCount: number,
): { ok: true } | { ok: false; message: string } {
  if (run.status === 'failed' && itemCount === 0) {
    return { ok: false, message: `This run failed while planning: ${run.errorMessage ?? 'no reason was recorded'}` };
  }
  return { ok: true };
}
