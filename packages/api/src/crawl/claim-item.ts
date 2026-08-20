// packages/api/src/crawl/claim-item.ts
// Taking one item off the queue, exactly once.
//
// `FOR UPDATE SKIP LOCKED` is what makes this safe to call from two places at
// the same time: a second caller skips the locked row instead of blocking on it
// or, worse, handing out the same URL twice. The loop is sequential today, but a
// re-entered `execute` (a crash, a resumed run, a second api-server) must never
// double-fetch a page.

import { sql } from 'drizzle-orm';
import type { db as Database } from '@robot/db';

export type ClaimedItem = {
  id: string;
  url: string;
  inputIndex: number;
  inputValues: Record<string, unknown>;
  listingValues: Record<string, unknown>;
  pageNumber: number | null;
  attempts: number;
};

export async function claimNextItem(
  db: typeof Database,
  runId: string,
): Promise<ClaimedItem | null> {
  const result = await db.execute(sql`
    UPDATE run_items
       SET status = 'running',
           attempts = attempts + 1,
           started_at = now()
     WHERE id = (
       SELECT id FROM run_items
        WHERE run_id = ${runId}
          AND kind = 'detail'
          AND status = 'pending'
        ORDER BY input_index, page_number NULLS FIRST, created_at
        FOR UPDATE SKIP LOCKED
        LIMIT 1
     )
    RETURNING id, url, input_index, input_values, listing_values, page_number, attempts
  `);

  // This driver (postgres-js via drizzle) returns the row list directly as an
  // array, not wrapped in a `{ rows }` object — confirmed with a scratch script
  // against the real connection. `result.rows` would silently be `undefined`.
  const row = (result as unknown as Array<Record<string, unknown>>)[0];
  if (!row) return null;

  return {
    id: String(row.id),
    url: String(row.url),
    inputIndex: Number(row.input_index ?? 0),
    inputValues: (row.input_values ?? {}) as Record<string, unknown>,
    listingValues: (row.listing_values ?? {}) as Record<string, unknown>,
    pageNumber: row.page_number === null || row.page_number === undefined ? null : Number(row.page_number),
    attempts: Number(row.attempts ?? 0),
  };
}
