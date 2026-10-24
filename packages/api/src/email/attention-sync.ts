// packages/api/src/email/attention-sync.ts
// Spec 2026-10-24 email §3.2: "Needs attention" is computed, not stored; `attention_since` records the turn. After
// every write that can change it (a Verify, a finished check, an edit), this computes it: on, with attention_since
// null → claim it (`WHERE attention_since IS NULL`) and only the writer that wins queues the emails, in the same
// transaction; off → back to null, so a later turn is a new event. A claim whose queueing throws rolls back: the
// next sync tries again.
//
// Fix round 1: the whole sync is one transaction under the website row lock (`lockSource`), taken before attention
// is read — every writer of what attention reads takes that lock or touches the row, so a sync reads all that
// committed before it and the last sync decides: a reset can never land after another sync's claim (no second email
// for one turn). And while a Verify is in flight (`verificationInFlight`, read-only: a sync never closes a stalled row), a sync never claims — it may still
// reset — the Verify's own sync at its end decides (a refresh's momentary hold is never emailed by another writer).
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { sources, type Database } from '@robot/db';
import { needsAttention, websiteAttention } from '../verify/attention.js';
import { loadCertificationState, runnableOf } from '../verify/current-certification.js';
import { lockSource, verificationInFlight } from '../verify/in-flight.js';
import { errorLine, queueEmails } from './queue-emails.js';

export type AttentionSync = { on: boolean; turnedOn: boolean; queued: number };

const OFF: AttentionSync = { on: false, turnedOn: false, queued: 0 };

export async function syncAttention(
  dbh: Database,
  sourceId: string,
  /** `onRead`: a test seam — called after attention is read, before anything is written. */
  deps: { now?: () => Date; onRead?: (on: boolean) => Promise<void> } = {},
): Promise<AttentionSync> {
  return dbh.transaction(async (tx) => {
    if (!(await lockSource(tx, sourceId))) return OFF;
    // The readers take the database type; a transaction answers the same queries, on the locked connection.
    const read = tx as unknown as Database;
    const attention = await websiteAttention(read, sourceId);
    const on = needsAttention(attention);
    await deps.onRead?.(on);
    if (!on) {
      await tx.update(sources).set({ attentionSince: null }).where(and(eq(sources.id, sourceId), isNotNull(sources.attentionSince)));
      return OFF;
    }
    if (await verificationInFlight(tx, sourceId)) return { on: true, turnedOn: false, queued: 0 };
    const runnable = runnableOf(await loadCertificationState(read, sourceId));
    const [won] = await tx.update(sources).set({ attentionSince: deps.now?.() ?? new Date() })
      .where(and(eq(sources.id, sourceId), isNull(sources.attentionSince)))
      .returning({ since: sources.attentionSince });
    if (!won?.since) return { on: true, turnedOn: false, queued: 0 };
    const { queued } = await queueEmails(tx, { kind: 'attention', sourceId, since: won.since, attention, runnable });
    return { on: true, turnedOn: true, queued: queued.length };
  });
}

/** Spec §4.3: never throws — mail never changes the Verify, check or edit that called it. */
export async function syncAttentionSafely(dbh: Database, sourceIds: string | string[]): Promise<void> {
  for (const id of Array.isArray(sourceIds) ? sourceIds : [sourceIds]) {
    try {
      await syncAttention(dbh, id);
    } catch (err) {
      console.error(`[email] "needs attention" for website ${id} could not be synced: ${errorLine(err)}`);
    }
  }
}
