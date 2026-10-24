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

import { randomUUID } from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { sources, sourceVerifications } from '@robot/db';
import type { Database } from '@robot/db';
import { VERIFY_STALL_MS } from '@robot/scraper';
import { enqueue } from '../jobs/enqueue.js';
import { isJobLive } from '../jobs/queue.js';
import type { VerifyJobOptions } from '../jobs/types.js';

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
 * and nothing is inserted. With `job`, the row's `verify` job is enqueued in the same transaction and the
 * worker runs it (spec 2026-10-23 §4.4); without, the caller runs it itself (scripts).
 */
export async function startVerificationRow(
  db: Database,
  sourceId: string,
  definitionHash: string,
  /** Written in the same transaction as the new row (a refresh's re-verify names itself in the refresh log, review Minor 1). */
  onStarted?: (tx: DbOrTx, verificationId: string) => Promise<unknown>,
  /** With options, the `verify` job is enqueued in this transaction (spec 2026-10-23 §4.4); without, the caller runs it. */
  job?: VerifyJobOptions,
): Promise<{ verificationId: string; status: 'started' | 'in-progress' }> {
  return db.transaction(async (tx) => {
    await lockSource(tx, sourceId);
    const inFlight = await resolveInFlightVerification(tx, sourceId);
    if (inFlight) return { verificationId: inFlight.id, status: 'in-progress' as const };
    const id = randomUUID();
    const jobId = job ? await enqueue(tx, 'verify', { sourceId, verificationId: id, ...job }, { key: `verify:${id}` }) : null;
    await tx.insert(sourceVerifications).values({ id, sourceId, definitionHash, jobId });
    if (onStarted) await onStarted(tx, id);
    return { verificationId: id, status: 'started' as const };
  });
}

/**
 * The Source's genuinely in-flight verification, or null.
 *
 * A row whose job is live (queued within its window, or running under its lease) is in flight however
 * old (spec 2026-10-23 §4.5); otherwise the time rule:
 * a `completed_at IS NULL` row younger than `VERIFY_STALL_MS` is real work in
 * progress and is returned as-is. One OLDER than that is a crash leftover (an
 * api-server restart mid-verify): it is closed out with
 * `errorMessage: 'stalled'` — so it can never wedge this Source — and null is
 * returned, leaving the caller free to proceed.
 */
export async function resolveInFlightVerification(
  db: DbOrTx,
  sourceId: string,
): Promise<{ id: string } | null> {
  const { inFlight, stale } = await readInFlight(db, sourceId);
  if (inFlight) return { id: inFlight };
  if (!stale) return null;

  await db
    .update(sourceVerifications)
    .set({ errorMessage: 'stalled', completedAt: new Date() })
    .where(eq(sourceVerifications.id, stale));
  return null;
}

/**
 * The same answer as `resolveInFlightVerification`, with the same stall rule, but read-only: a stale row is
 * "not in flight" and is left as it is. For callers that must never write a Verify row (the email sync, spec
 * 2026-10-24 email §4.3 — and no lock-order inversion with a Verify's result transaction, final review M1).
 */
export async function verificationInFlight(db: DbOrTx, sourceId: string): Promise<{ id: string } | null> {
  const { inFlight } = await readInFlight(db, sourceId);
  return inFlight ? { id: inFlight } : null;
}

/** The newest open verification row: in flight (live job, or younger than the stall limit), or stale. */
async function readInFlight(db: DbOrTx, sourceId: string): Promise<{ inFlight: string | null; stale: string | null }> {
  const open = await db.query.sourceVerifications.findFirst({
    where: and(eq(sourceVerifications.sourceId, sourceId), isNull(sourceVerifications.completedAt)),
    orderBy: [desc(sourceVerifications.startedAt)],
    columns: { id: true, startedAt: true, jobId: true },
  });
  if (!open) return { inFlight: null, stale: null };
  if (await isJobLive(db, open.jobId)) return { inFlight: open.id, stale: null };
  if (Date.now() - open.startedAt.getTime() < VERIFY_STALL_MS) return { inFlight: open.id, stale: null };
  return { inFlight: null, stale: open.id };
}
