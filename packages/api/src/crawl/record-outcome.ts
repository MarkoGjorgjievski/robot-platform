// packages/api/src/crawl/record-outcome.ts
// How an item's fate is written down. Separate from the loop so the loop reads
// as what it does, and so both outcomes are impossible to get subtly different.

import { and, eq } from 'drizzle-orm';
import { runItems, runs } from '@robot/db';
import type { db as Database } from '@robot/db';

/** A page's error can arrive as a full stack; the column is for a reason, not a dump. */
const MAX_ERROR = 1000;

export async function markItemDone(
  db: typeof Database,
  itemId: string,
  extractionId: string | null,
): Promise<void> {
  await db.update(runItems)
    .set({ status: 'done', extractionId, error: null, completedAt: new Date() })
    .where(eq(runItems.id, itemId));
}

/**
 * The circuit breaker's write (review C2, 2026-10-09): the site walled three
 * items in a row, so every detail item still pending is failed with
 * "Not tried: <sentence>" (retryable, like any failed item), and the sentence
 * becomes the run's errorMessage, the line the run page and the Sample show.
 */
export async function failPendingForWall(
  db: typeof Database,
  runId: string,
  sentence: string,
): Promise<void> {
  await db.update(runItems)
    .set({ status: 'failed', error: `Not tried: ${sentence}`.slice(0, MAX_ERROR), completedAt: new Date() })
    .where(and(eq(runItems.runId, runId), eq(runItems.kind, 'detail'), eq(runItems.status, 'pending')));
  await db.update(runs).set({ errorMessage: sentence.slice(0, MAX_ERROR) }).where(eq(runs.id, runId));
}

export async function markItemFailed(
  db: typeof Database,
  itemId: string,
  message: string,
): Promise<void> {
  await db.update(runItems)
    .set({ status: 'failed', error: message.slice(0, MAX_ERROR), completedAt: new Date() })
    .where(eq(runItems.id, itemId));
}
