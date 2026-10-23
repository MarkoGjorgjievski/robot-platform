// Spec 2026-10-20 §3.3: did a verification row end without finishing? A row closed with an error
// stopped (its raw error stays on the row, for ops); a row closed as 'stalled', or still in flight
// past the stall window with no live job (`resolveInFlightVerification`'s rule, in-flight.ts), stalled.
import { VERIFY_STALL_MS } from '@robot/scraper';

export type RunFailure = 'stopped' | 'stalled';

export function runFailure(row: { startedAt: Date; completedAt: Date | null; errorMessage: string | null }, now: number = Date.now(), live = false): RunFailure | null {
  if (row.completedAt !== null) return row.errorMessage === null ? null : row.errorMessage === 'stalled' ? 'stalled' : 'stopped';
  // A row whose job is queued or running is in flight, however long it waited (spec 2026-10-23 §4.5).
  if (live) return null;
  return now - row.startedAt.getTime() >= VERIFY_STALL_MS ? 'stalled' : null;
}
