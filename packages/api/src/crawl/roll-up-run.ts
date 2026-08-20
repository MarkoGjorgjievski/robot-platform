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
 */
export async function finaliseRun(
  db: typeof Database,
  runId: string,
  rowCount: number,
): Promise<RunRollup> {
  const [counts] = await db
    .select({
      pending: sql<number>`count(*) filter (where ${runItems.status} = 'pending')::int`,
      done: sql<number>`count(*) filter (where ${runItems.status} = 'done')::int`,
      failed: sql<number>`count(*) filter (where ${runItems.status} = 'failed')::int`,
    })
    .from(runItems)
    .where(and(eq(runItems.runId, runId), eq(runItems.kind, 'detail')));

  const status = rollUpStatus({
    pending: Number(counts?.pending ?? 0),
    done: Number(counts?.done ?? 0),
    failed: Number(counts?.failed ?? 0),
  });

  await db.update(runs)
    .set({
      status,
      resultCount: rowCount,
      completedAt: status === 'extracting' ? null : new Date(),
    })
    .where(eq(runs.id, runId));

  return status;
}
