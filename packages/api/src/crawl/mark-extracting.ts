// packages/api/src/crawl/mark-extracting.ts
// Flipping a run into `extracting` without ever voiding a Stop.

import { and, eq, ne, sql } from 'drizzle-orm';
import { runs } from '@robot/db';
import type { db as Database } from '@robot/db';

/**
 * Mark a run as extracting, and report whether the flip happened.
 *
 * Two rules, and they pull in opposite directions:
 *
 * 1. **Re-entry stays permitted.** Calling `execute` on a run that is already
 *    `extracting` is the documented crash-resume path — an api-server restart
 *    pauses a run and calling execute again is what resumes it. This must not
 *    become a guard that refuses.
 * 2. **`cancelling` is never overwritten.** A user clicks Stop; the loop checks
 *    between items, so up to ~30s can pass before it notices. An `execute`
 *    arriving in that window used to write `extracting` unconditionally — and
 *    the loop's own `isCancelled` then read `extracting`, returned false, and
 *    kept crawling a run the user had stopped.
 *
 * A conditional UPDATE satisfies both: everything but `cancelling` flips.
 * Returning false is not a failure the caller has to abort on — an execute
 * against a `cancelling` run is how a run whose loop already died gets
 * un-stuck: the new loop's first between-items check sees `cancelling`, stops,
 * and finalises it to `cancelled`.
 *
 * `startedAt` is set only if it was never set. Overwriting it on resume made a
 * run report its duration from the resume rather than from when the work began.
 * `completedAt` is cleared, because `finaliseRun` already holds the rule that a
 * non-terminal run has no completion time.
 */
export async function markRunExtracting(
  db: typeof Database,
  runId: string,
): Promise<boolean> {
  const flipped = await db.update(runs)
    .set({
      status: 'extracting',
      startedAt: sql`coalesce(${runs.startedAt}, now())`,
      completedAt: null,
    })
    .where(and(eq(runs.id, runId), ne(runs.status, 'cancelling')))
    .returning({ id: runs.id });
  return flipped.length > 0;
}
