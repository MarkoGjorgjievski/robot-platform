// packages/api/src/crawl/is-cancelled.ts
// "Has this run been stopped?", as the extraction loop asks it between items.
//
// Lives in its own module rather than inline in the router so the answer is
// testable against a real run row without launching a browser — the inline
// version had no test, and got the answer wrong for a reachable state.

import { eq } from 'drizzle-orm';
import { runs } from '@robot/db';
import type { db as Database } from '@robot/db';

/**
 * Every status that means "stop crawling this run".
 *
 * `cancelling` is the request `crawl.cancel` writes. `cancelled` is what a loop
 * writes when it has ACTED on that request and finalised the run — and it must
 * count here too, because two loops can be alive on one run at once.
 *
 * The reachable sequence, entirely through the shipped UI: Extract renders
 * alongside Stop on an active run (deliberately — re-entry is the documented
 * crash-resume path), so a user can Stop run R while loop A is mid-item, then
 * click Extract. Loop B starts, sees `cancelling` on its very first check,
 * breaks, and finalises R to `cancelled`. Loop A then finishes its item and
 * checks — and if this matched `cancelling` only, it would read the terminal
 * `cancelled` as "not cancelled", claim the next item, and carry on crawling a
 * run the user stopped and the UI shows as cancelled, finally overwriting
 * `cancelled` with `completed`/`partial`. A cancel that has already been
 * carried out is a stronger stop signal than one still pending, not a weaker one.
 */
export const CANCELLED_STATUSES: readonly string[] = ['cancelling', 'cancelled'];

export function isCancelledStatus(status: string | null | undefined): boolean {
  return status != null && CANCELLED_STATUSES.includes(status);
}

/**
 * Read the run's status and decide whether the loop should stop.
 *
 * A row that cannot be found is NOT a cancel: `executeRun` deliberately treats a
 * broken cancel check as "keep working" so a read problem can never stop a
 * healthy run, and answering `true` here would smuggle that failure mode back in.
 */
export async function isRunCancelled(db: typeof Database, runId: string): Promise<boolean> {
  const row = await db.query.runs.findFirst({ where: eq(runs.id, runId), columns: { status: true } });
  return isCancelledStatus(row?.status);
}
