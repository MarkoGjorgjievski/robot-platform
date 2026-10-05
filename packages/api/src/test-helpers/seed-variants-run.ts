// packages/api/src/test-helpers/seed-variants-run.ts
// A completed run with variant rows, inserted directly against the database —
// the one way a test gets an "existing run" to open without ever starting a
// real extraction. Built for the app's route smoke (Task 7 of
// 2026-10-02-variants-plan3): Verify and Extract are categorically off-limits
// there with an Anthropic key present, so the run page's variant counts,
// axis/key columns and download links can only be proven against a run that
// was never run — same bargain `customer-source.ts` strikes for a project and
// website, one level up the pipeline.
import { db, runs, captures, extractions } from '@robot/db';

export type SeedVariantsRunArgs = {
  rows: Array<Record<string, unknown>>;
  variantSummary: {
    variants: number;
    products: number;
    withoutVariants: number;
    partial: number;
    variantsSkippedForBudget: number;
  };
};

/** Inserts one capture and one extraction (`rows`, phase-1-shape: every row in one extraction) under a new, already-`completed` run of `sourceId`. Returns the run's id. */
export async function seedCompletedVariantsRun(sourceId: string, args: SeedVariantsRunArgs): Promise<string> {
  const [run] = await db.insert(runs).values({
    sourceId,
    status: 'completed',
    resultCount: args.rows.length,
    startedAt: new Date(),
    completedAt: new Date(),
    variantSummary: args.variantSummary,
  }).returning();
  const [capture] = await db.insert(captures).values({
    sourceId, runId: run!.id, url: 'https://example.com/seeded-for-smoke',
  }).returning({ id: captures.id });
  await db.insert(extractions).values({
    sourceId, captureId: capture!.id, runId: run!.id, data: args.rows, rowCount: args.rows.length,
  });
  return run!.id;
}
