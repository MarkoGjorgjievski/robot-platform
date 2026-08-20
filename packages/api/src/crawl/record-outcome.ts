// packages/api/src/crawl/record-outcome.ts
// How an item's fate is written down. Separate from the loop so the loop reads
// as what it does, and so both outcomes are impossible to get subtly different.

import { eq } from 'drizzle-orm';
import { runItems } from '@robot/db';
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

export async function markItemFailed(
  db: typeof Database,
  itemId: string,
  message: string,
): Promise<void> {
  await db.update(runItems)
    .set({ status: 'failed', error: message.slice(0, MAX_ERROR), completedAt: new Date() })
    .where(eq(runItems.id, itemId));
}
