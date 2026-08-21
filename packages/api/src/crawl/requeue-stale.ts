// packages/api/src/crawl/requeue-stale.ts
// Giving abandoned work back to the queue.
//
// `claimNextItem` flips an item to `running` and stamps `started_at`. Nothing
// moves it back: if the process holding it dies (an api-server restart is the
// documented way a run pauses), that row sits at `running` forever. It is
// invisible to `claimNextItem` (which only claims `pending`) and to
// `retryFailed` (which only requeues `failed`), so the documented recovery —
// "call execute again" — would never reach it, and the run's roll-up would be
// permanently non-terminal.

import { and, eq, lt } from 'drizzle-orm';
import { runItems } from '@robot/db';
import type { db as Database } from '@robot/db';

/**
 * How long an item may sit at `running` before we assume nobody is working it.
 *
 * An item takes ~35s end to end, so 30 minutes is ~50x the real duration: long
 * enough that this can never steal a URL out from under a live loop, short
 * enough that a restarted api-server recovers on the operator's next click
 * rather than needing hand-edited SQL.
 */
export const STALE_RUNNING_MS = 30 * 60_000;

/**
 * Requeue this run's abandoned `running` items and report how many.
 *
 * Unconditional on `execute` entry — not gated behind `retryFailed`. An item
 * stuck for half an hour is not work in progress, and the operator calling
 * execute again is exactly the moment to reclaim it. `started_at` is cleared
 * because a `pending` item has not started; `claimNextItem` re-stamps it on the
 * next claim. `attempts` is deliberately left alone: it is the honest count of
 * how many times this URL has been tried.
 */
export async function requeueStaleRunningItems(
  db: typeof Database,
  runId: string,
  staleAfterMs: number = STALE_RUNNING_MS,
): Promise<number> {
  const cutoff = new Date(Date.now() - staleAfterMs);
  const requeued = await db.update(runItems)
    .set({ status: 'pending', startedAt: null })
    .where(and(
      eq(runItems.runId, runId),
      // Only detail items are ever claimed; listing rows are written `done` at
      // plan time and are none of this function's business.
      eq(runItems.kind, 'detail'),
      eq(runItems.status, 'running'),
      // `lt` excludes NULL started_at by construction, which is the right
      // reading: claimNextItem sets status and started_at in one UPDATE, so a
      // `running` row without a timestamp is not something this heuristic
      // knows how to age out.
      lt(runItems.startedAt, cutoff),
    ))
    .returning({ id: runItems.id });
  return requeued.length;
}
