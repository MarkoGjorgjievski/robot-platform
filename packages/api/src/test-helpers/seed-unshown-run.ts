// packages/api/src/test-helpers/seed-unshown-run.ts
// A completed run whose extractions carry `validation_result` (spec
// 2026-10-12 §4), inserted directly against the database — the same bargain
// `seed-variants-run.ts` strikes for a run the app's route smoke can open
// without ever running a real extraction (Verify and Extract are
// categorically off-limits there with an Anthropic key present).
//
// Unlike that helper's single extraction holding every row (phase-1 shape),
// this one writes one capture+extraction PER item, each behind its own
// `run_items` row of kind 'detail' pointing at it — the phase-2 shape
// `crawl.coverage` (`loadRunCoverage`) actually reads: it walks a run's
// `run_items`, not its extractions directly, so a seed with no `run_items`
// (as `seedCompletedVariantsRun` has none) would report empty coverage.
// Built for Task 6 of 2026-10-12-shown-on-the-page: the run page's
// not-shown column badge, panel and cell mark all read off `crawl.coverage`.
import { db, runs, captures, extractions, runItems } from '@robot/db';
import type { ValidationResult } from '../crawl/extract-item.js';

export type SeedUnshownItem = {
  url: string;
  /** The extraction's one row — whatever fields this source's contract has,
   * keyed by field key (not `_url`/`_page_number`: the helper adds those). */
  row: Record<string, unknown>;
  /** Omitted on an item whose extraction carries no `validation_result` at
   * all — old-row behaviour (spec §8 property 6): it counts as "not
   * checked", never as "not shown". */
  validationResult?: ValidationResult;
};

export type SeedUnshownRunArgs = { items: SeedUnshownItem[] };

/**
 * Inserts a completed run with one capture+extraction per item and a
 * `run_items` row of kind 'detail' per item, `extractionId` pointing at its
 * own extraction and `status: 'done'` — the same shape `record-outcome.ts`
 * leaves a real detail item in. Returns the run's id.
 */
export async function seedUnshownRun(sourceId: string, args: SeedUnshownRunArgs): Promise<string> {
  const [run] = await db.insert(runs).values({
    sourceId,
    status: 'completed',
    resultCount: args.items.length,
    startedAt: new Date(),
    completedAt: new Date(),
  }).returning();

  for (const item of args.items) {
    const [capture] = await db.insert(captures).values({
      sourceId, runId: run!.id, url: item.url,
    }).returning({ id: captures.id });

    const [extraction] = await db.insert(extractions).values({
      sourceId,
      captureId: capture!.id,
      runId: run!.id,
      data: [{ ...item.row, _url: item.url, _page_number: null }],
      rowCount: 1,
      ...(item.validationResult ? { validationResult: item.validationResult } : {}),
    }).returning({ id: extractions.id });

    await db.insert(runItems).values({
      runId: run!.id,
      kind: 'detail',
      url: item.url,
      status: 'done',
      extractionId: extraction!.id,
      completedAt: new Date(),
    });
  }

  return run!.id;
}
