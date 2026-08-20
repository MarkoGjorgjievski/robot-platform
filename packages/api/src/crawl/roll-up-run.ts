// packages/api/src/crawl/roll-up-run.ts
// What a run's status is, given what happened to its items.

import { and, eq, sql } from 'drizzle-orm';
import { runs, runItems } from '@robot/db';
import type { db as Database } from '@robot/db';

export type RunRollup = 'completed' | 'partial' | 'failed' | 'extracting';

export function rollUpStatus(counts: { pending: number; done: number; failed: number }): RunRollup {
  if (counts.pending > 0) return 'extracting';
  if (counts.failed === 0) return 'completed';
  // `partial` exists because at scale "480 of 500 succeeded" is the normal
  // outcome, and a binary completed/failed cannot express it.
  return counts.done > 0 ? 'partial' : 'failed';
}

/**
 * Writes the run's final state and its extracted row count.
 *
 * `resultCount` means EXTRACTED ROWS everywhere else in this codebase — the
 * dashboard renders it as "N rows" — so phase 1 deliberately leaves it null and
 * phase 2 is what fills it in.
 *
 * The row count is derived from the DB (`kind='detail'` items at `status='done'`
 * — extract-item writes exactly one row per item, so that count IS the row
 * count), not taken from a caller-supplied number. A caller's own in-memory
 * counter is only ever that caller's partial view: two concurrent `executeRun`
 * loops on the same run would each know only the items *they* claimed, and
 * whichever call lands last would overwrite `resultCount` with an undercount.
 * Reading the DB instead means the true total is what gets written no matter
 * how many callers raced to finalise.
 */
export async function finaliseRun(
  db: typeof Database,
  runId: string,
): Promise<RunRollup> {
  const [counts] = await db
    .select({
      pending: sql<number>`count(*) filter (where ${runItems.status} = 'pending')::int`,
      done: sql<number>`count(*) filter (where ${runItems.status} = 'done')::int`,
      failed: sql<number>`count(*) filter (where ${runItems.status} = 'failed')::int`,
    })
    .from(runItems)
    .where(and(eq(runItems.runId, runId), eq(runItems.kind, 'detail')));

  const done = Number(counts?.done ?? 0);
  const status = rollUpStatus({
    pending: Number(counts?.pending ?? 0),
    done,
    failed: Number(counts?.failed ?? 0),
  });

  await db.update(runs)
    .set({
      status,
      resultCount: done,
      completedAt: status === 'extracting' ? null : new Date(),
    })
    .where(eq(runs.id, runId));

  return status;
}
