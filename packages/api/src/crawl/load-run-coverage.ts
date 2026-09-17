// packages/api/src/crawl/load-run-coverage.ts
// The db-touching half of a run's coverage report: load the run, its Source's
// effective schema, and its detail items, then hand off to `computeCoverage`
// (coverage.ts, deliberately db-free — Task 2's purity constraint). Shared by
// `crawl.coverage` and `crawl.backfillPreview` so there is exactly one
// implementation of "what a run's coverage load does", not two that can
// drift.

import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { type Database, runs, runItems } from '@robot/db';
import { effectiveSchema } from './effective-schema.js';
import { computeCoverage, type RunCoverage } from './coverage.js';
import { computeMisses, type FieldMisses } from './misses.js';

/**
 * The run + its Source (for schema) + its detail items, loaded once and
 * shared by `loadRunCoverage` and `loadRunMisses` — one implementation of
 * "what loading a run for a per-item report does", not two that can drift.
 * Error codes/messages are `loadRunCoverage`'s original ones, unchanged.
 */
async function loadRunAndItems(db: Database, runId: string) {
  const run = await db.query.runs.findFirst({
    where: eq(runs.id, runId),
    with: {
      source: {
        columns: { id: true, selectorsJson: true, datasetId: true, schemaDefinition: true },
        with: { dataset: { columns: { schema: true } } },
      },
    },
  });
  if (!run) throw new TRPCError({ code: 'NOT_FOUND', message: `Run ${runId} not found` });
  if (!run.source) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Run has no Source' });
  // Captured here, as a const, so the non-null narrowing above survives past
  // this function's return — a property narrowing on `run.source` itself
  // does not (same reasoning as crawl.ts's `sourceId` const in `backfill`).
  const source = run.source;

  const items = await db.query.runItems.findMany({
    where: and(eq(runItems.runId, runId), eq(runItems.kind, 'detail')),
    columns: { id: true, url: true, absentFields: true, inputValues: true },
    with: { extraction: { columns: { data: true } } },
  });

  return { run, source, items };
}

export async function loadRunCoverage(db: Database, runId: string): Promise<RunCoverage> {
  const { source, items } = await loadRunAndItems(db, runId);

  const fields = effectiveSchema(source);
  return computeCoverage(fields, items.map((i) => ({
    id: i.id,
    url: i.url,
    row: Array.isArray(i.extraction?.data) ? (i.extraction!.data[0] as Record<string, unknown> ?? null) : null,
    absentFields: (i.absentFields as string[] | null) ?? [],
  })));
}

/** The listing a product was found on, as planning recorded it on the item (`input_values.url`); null for a product url given directly. */
function listingUrlOf(inputValues: unknown): string | null {
  const v = (inputValues as { url?: unknown } | null)?.url;
  return typeof v === 'string' && v !== '' ? v : null;
}

export async function loadRunMisses(db: Database, runId: string): Promise<{ sourceId: string; fields: FieldMisses[] }> {
  const { source, items } = await loadRunAndItems(db, runId);
  const fields = effectiveSchema(source);
  return {
    sourceId: source.id,
    fields: computeMisses(fields, items.map((i) => ({
      url: i.url,
      // A detail item found on a listing carries the listing's url; a detail
      // item that IS the input carries its own url there, which is not a listing.
      listingUrl: listingUrlOf(i.inputValues) === i.url ? null : listingUrlOf(i.inputValues),
      row: Array.isArray(i.extraction?.data) ? (i.extraction!.data[0] as Record<string, unknown> ?? null) : null,
      absentFields: (i.absentFields as string[] | null) ?? [],
    }))),
  };
}
