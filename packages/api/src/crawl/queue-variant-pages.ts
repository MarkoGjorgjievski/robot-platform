// packages/api/src/crawl/queue-variant-pages.ts
// Links-method variants (variants plan 3, Task 4): a product page's other
// variant pages join the SAME run as `detail` items, so executeRun's claim
// loop extracts them before the run finalises — no change to the loop needed.
//
// A group is all-or-nothing against the run's item cap (Global Constraints,
// "Budget"): a product half of whose colours made it into the export is worse
// than one counted under "variant pages skipped for the budget". The run never
// stops to ask.
//
// Concurrency: the count-check-insert-or-tally is one short transaction that
// holds the run row's lock (SELECT … FOR UPDATE), so two extractions of the
// same run — a resumed loop, a second api-server — can never both see room
// for their groups and together overshoot the cap, nor tally one group twice
// for one call. No page load ever happens inside it.

import { and, eq, inArray, sql } from 'drizzle-orm';
import { runItems } from '@robot/db';
import type { db as Database } from '@robot/db';
import type { ClaimedItem } from './claim-item.js';

export async function queueVariantGroup(db: typeof Database, args: {
  runId: string; sourceId: string; productKey: string; urls: string[]; from: ClaimedItem; cap: number;
}): Promise<{ queued: number; skippedForBudget: number }> {
  const urls = [...new Set(args.urls)];
  if (urls.length === 0) return { queued: 0, skippedForBudget: 0 };

  return db.transaction(async (tx) => {
    const locked = await tx.execute(sql`
      SELECT id FROM runs WHERE id = ${args.runId} AND source_id = ${args.sourceId} FOR UPDATE
    `);
    if ((locked as unknown as unknown[]).length === 0) {
      throw new Error(`queueVariantGroup: run ${args.runId} of source ${args.sourceId} not found`);
    }

    const [counted] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(runItems)
      .where(and(eq(runItems.runId, args.runId), eq(runItems.kind, 'detail')));
    const count = Number(counted?.n ?? 0);

    // "Already in the run" is by the unique (run_id, url) index, whatever the
    // item's kind — the same key the insert would conflict on.
    const present = new Set((await tx
      .select({ url: runItems.url })
      .from(runItems)
      .where(and(eq(runItems.runId, args.runId), inArray(runItems.url, urls)))).map((r) => r.url));
    const missing = urls.filter((u) => !present.has(u));
    if (missing.length === 0) return { queued: 0, skippedForBudget: 0 };

    if (count + missing.length <= args.cap) {
      const inserted = await tx.insert(runItems).values(missing.map((url) => ({
        runId: args.runId,
        kind: 'detail',
        url,
        status: 'pending',
        variantOf: args.productKey,
        inputIndex: args.from.inputIndex,
        inputValues: args.from.inputValues,
      }))).onConflictDoNothing().returning({ id: runItems.id });
      return { queued: inserted.length, skippedForBudget: 0 };
    }

    // finaliseRun reads this as `skipped` (ruling R1) and preserves it when it
    // writes the run's full variant summary.
    await tx.execute(sql`
      UPDATE runs
         SET variant_summary = jsonb_set(
               coalesce(variant_summary, '{}'::jsonb),
               '{variantsSkippedForBudget}',
               to_jsonb(coalesce((variant_summary->>'variantsSkippedForBudget')::int, 0) + ${missing.length}::int)
             )
       WHERE id = ${args.runId}
    `);
    return { queued: 0, skippedForBudget: missing.length };
  });
}
