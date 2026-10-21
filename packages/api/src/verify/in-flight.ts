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
import { sources, sourceVerifications } from '@robot/db';
import type { Database } from '@robot/db';
import { VERIFY_STALL_MS } from '@robot/scraper';

/** The database or a transaction on it. */
export type DbOrTx = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * The website row lock (`SELECT … FROM sources WHERE id = … FOR UPDATE`). Every Verify start and every
 * refresh (verify/refresh-values.ts) take it in the transaction that checks "Verify in flight?" and writes,
 * so the two never interleave (fix wave 1, item 5); `updateBinding` and `saveVariantAnswer` take it too.
 */
export async function lockSource(tx: DbOrTx, sourceId: string): Promise<boolean> {
  const [row] = await tx.select({ id: sources.id }).from(sources).where(eq(sources.id, sourceId)).for('update');
  return !!row;
}

/**
 * Starts a Verify: under the website row lock, the in-flight check (with its stall rule) and the new
 * verification row's insert, in one transaction. A Verify already in flight is handed back (`in-progress`)
 * and nothing is inserted. The caller fires the run itself, after this returns.
 */
export async function startVerificationRow(
  db: Database,
  sourceId: string,
  definitionHash: string,
): Promise<{ verificationId: string; status: 'started' | 'in-progress' }> {
  return db.transaction(async (tx) => {
    await lockSource(tx, sourceId);
    const inFlight = await resolveInFlightVerification(tx, sourceId);
    if (inFlight) return { verificationId: inFlight.id, status: 'in-progress' as const };
    const [row] = await tx.insert(sourceVerifications).values({ sourceId, definitionHash }).returning({ id: sourceVerifications.id });
    return { verificationId: row!.id, status: 'started' as const };
  });
}

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
  db: DbOrTx,
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
