// The one place that answers "is a verification actually running for this
// Source right now?" — and cleans up after the api-server if the answer is
// "no, one just died mid-run".
//
// `sources.verify` has applied this stall rule since task 12. `updateSchema`
// had its own, cruder guard (any `completed_at IS NULL` row refuses the
// save), which meant a crashed verification locked the schema out of editing
// permanently: the Schema screen showed the stalled banner and an editable
// grid, and every save came back "has a verification in flight". Sharing one
// helper keeps the two procedures from drifting apart again.

import { and, desc, eq, isNull } from 'drizzle-orm';
import { sourceVerifications } from '@robot/db';
import type { Database } from '@robot/db';
import { VERIFY_STALL_MS } from '@robot/scraper';

/**
 * The Source's genuinely in-flight verification, or null.
 *
 * A `completed_at IS NULL` row younger than `VERIFY_STALL_MS` is real work in
 * progress and is returned as-is. One OLDER than that is a crash leftover (an
 * api-server restart mid-verify): it is closed out with
 * `errorMessage: 'stalled'` — so it can never wedge this Source — and null is
 * returned, leaving the caller free to proceed.
 */
export async function resolveInFlightVerification(
  db: Database,
  sourceId: string,
): Promise<{ id: string } | null> {
  const inFlight = await db.query.sourceVerifications.findFirst({
    where: and(eq(sourceVerifications.sourceId, sourceId), isNull(sourceVerifications.completedAt)),
    orderBy: [desc(sourceVerifications.startedAt)],
    columns: { id: true, startedAt: true },
  });
  if (!inFlight) return null;

  if (Date.now() - inFlight.startedAt.getTime() < VERIFY_STALL_MS) {
    return { id: inFlight.id };
  }

  await db
    .update(sourceVerifications)
    .set({ errorMessage: 'stalled', completedAt: new Date() })
    .where(eq(sourceVerifications.id, inFlight.id));
  return null;
}
