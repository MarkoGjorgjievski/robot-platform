// packages/api/src/crawl/backfill.ts
// Pure derivation over Task 2's RunCoverage: which fields are worth repairing,
// and which already-crawled items to re-fetch to repair them. AI-free — no
// db, no extraction chain, consumed verbatim by `crawl.backfillPreview` below
// and by the repair-run execution tasks that follow this one.

import type { FieldCoverage, ItemGap } from './coverage.js';

/**
 * Below this fraction of items filled, a field is classified `dead` rather
 * than `healthy`. Binding boundary (task-3 brief): fill EXACTLY 0.5 is
 * healthy — the comparison is strict `<`, not `<=`.
 */
export const DEAD_FIELD_FILL_THRESHOLD = 0.5;

/** How many of a dead field's re-extracted sample items must fill it before the repair is judged to have worked. Consumed by the repair-run execution tasks that follow this one — unused here. */
export const REPAIR_SAMPLE_COUNT = 3;
export const REPAIR_SUCCESS_MIN = 2;

/**
 * Rough per-page upper bound for the AI extraction tiers a backfill item may
 * fall through to (tiers 5-6 of the extraction chain) — one detail fetch per
 * item. Preview copy must present the resulting `estCostUsd` as "up to", not
 * as an exact figure: a backfill item may resolve for free at a cheaper tier.
 */
export const EST_AI_COST_PER_PAGE_USD = 0.05;

export type FieldClassification = { name: string; fill: number; classification: 'healthy' | 'dead' };

/**
 * fill = filled / total (total 0 → fill 0, which is < threshold → dead).
 * dead iff fill < DEAD_FIELD_FILL_THRESHOLD; only fields named in
 * `targetNames` are classified.
 */
export function classifyFields(fields: FieldCoverage[], targetNames: string[]): FieldClassification[] {
  const targetSet = new Set(targetNames);
  return fields
    .filter((f) => targetSet.has(f.name))
    .map((f) => {
      const fill = f.total === 0 ? 0 : f.filled / f.total;
      return { name: f.name, fill, classification: fill < DEAD_FIELD_FILL_THRESHOLD ? 'dead' as const : 'healthy' as const };
    });
}

export type BackfillItemPlan = { parentItemId: string; url: string; targetFields: string[] };

/**
 * Items whose missingFields intersect targetNames, restricted to targetFields
 * = that intersection. Items with no intersection are dropped entirely — a
 * backfill item with an empty targetFields list would re-fetch a page with
 * nothing to repair. When `itemIds` is given (the manual, human-picked
 * handle), the gap set is intersected with that selection FIRST, so a chosen
 * item that has no matching gap still correctly drops out rather than
 * appearing with an empty targetFields list.
 *
 * Confirmed-absent-only items never reach this function at all: Task 2's
 * `computeCoverage` never includes a confirmed-absent field in an item's
 * missingFields, and an item with zero missing fields never becomes a
 * gapItem in the first place — so there is nothing here to specially exclude
 * beyond the ordinary "no intersection" case.
 */
export function deriveBackfillItems(
  gapItems: ItemGap[], targetNames: string[], itemIds?: string[],
): BackfillItemPlan[] {
  const targetSet = new Set(targetNames);
  const idSet = itemIds ? new Set(itemIds) : null;

  const plans: BackfillItemPlan[] = [];
  for (const item of gapItems) {
    if (idSet && !idSet.has(item.itemId)) continue;
    const targetFields = item.missingFields.filter((f) => targetSet.has(f));
    if (targetFields.length === 0) continue;
    plans.push({ parentItemId: item.itemId, url: item.url, targetFields });
  }
  return plans;
}
