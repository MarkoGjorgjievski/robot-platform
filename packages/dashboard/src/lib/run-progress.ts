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
