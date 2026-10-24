// packages/api/src/email/attention-sync.ts
// Spec 2026-10-24 email §3.2: "Needs attention" is computed, not stored; `attention_since` records the turn. After
// every write that can change it (a Verify, a finished check, an edit), this computes it: on, with attention_since
// null → claim it (`WHERE attention_since IS NULL`) and only the writer that wins queues the emails, in the same
// transaction; off → back to null, so a later turn is a new event. A claim whose queueing throws rolls back: the
// next sync tries again.
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { sources, type Database } from '@robot/db';
import { needsAttention, websiteAttention } from '../verify/attention.js';
import { loadCertificationState, runnableOf } from '../verify/current-certification.js';
import { queueEmails } from './queue-emails.js';

export type AttentionSync = { on: boolean; turnedOn: boolean; queued: number };

export async function syncAttention(dbh: Database, sourceId: string, deps: { now?: () => Date } = {}): Promise<AttentionSync> {
  const attention = await websiteAttention(dbh, sourceId);
  if (!needsAttention(attention)) {
    await dbh.update(sources).set({ attentionSince: null }).where(and(eq(sources.id, sourceId), isNotNull(sources.attentionSince)));
    return { on: false, turnedOn: false, queued: 0 };
  }
  const runnable = runnableOf(await loadCertificationState(dbh, sourceId));
  const now = deps.now?.() ?? new Date();
  return dbh.transaction(async (tx) => {
    const [won] = await tx.update(sources).set({ attentionSince: now })
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
      console.error(`[email] "needs attention" for website ${id} could not be synced:`, err);
    }
  }
}
