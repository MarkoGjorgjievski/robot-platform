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
// for their groups and together overshoot the cap. The skipped tally is kept
// per product (skippedByProduct), so it is exact. No page load happens inside it.

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
      // Rare: an earlier member's call skipped this product, and the cap has
      // room now — its pages are queued after all, so withdraw its skip.
      await setSkippedByProduct(tx, args.runId,
        sql`coalesce(variant_summary->'skippedByProduct', '{}'::jsonb) - ${args.productKey}::text`,
        sql`variant_summary->'skippedByProduct' ? ${args.productKey}::text`);
      return { queued: inserted.length, skippedForBudget: 0 };
    }

    // SET per product, never added: two members of one product that are both
    // already in the run each recompute the same `missing`, and must count it
    // once (Task 4 fix round 1).
    await setSkippedByProduct(tx, args.runId,
      sql`coalesce(variant_summary->'skippedByProduct', '{}'::jsonb) || jsonb_build_object(${args.productKey}::text, ${missing.length}::int)`);
    return { queued: 0, skippedForBudget: missing.length };
  });
}

type Tx = Parameters<Parameters<typeof Database.transaction>[0]>[0];

/**
 * Writes `runs.variant_summary.skippedByProduct` (product key → its skipped
 * page count) to `nextMap`, and `variantsSkippedForBudget` to the sum of that
 * map's values — the number finaliseRun reads as `skipped` (ruling R1). Every
 * other summary key is kept. Runs inside the caller's locked transaction.
 */
async function setSkippedByProduct(tx: Tx, runId: string, nextMap: ReturnType<typeof sql>, onlyIf?: ReturnType<typeof sql>) {
  await tx.execute(sql`
    UPDATE runs r
       SET variant_summary = x.s || jsonb_build_object(
             'variantsSkippedForBudget',
             (SELECT coalesce(sum(e.v::int), 0) FROM jsonb_each_text(x.s->'skippedByProduct') AS e(k, v))
           )
      FROM (
        SELECT jsonb_set(coalesce(variant_summary, '{}'::jsonb), '{skippedByProduct}', ${nextMap}) AS s
          FROM runs
         WHERE id = ${runId}
      ) x
     WHERE r.id = ${runId}${onlyIf ? sql` AND ${onlyIf}` : sql``}
  `);
}
