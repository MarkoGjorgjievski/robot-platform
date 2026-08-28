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

export async function loadRunCoverage(db: Database, runId: string): Promise<RunCoverage> {
  const run = await db.query.runs.findFirst({
    where: eq(runs.id, runId),
    with: {
      source: {
        columns: { id: true, selectorsJson: true, datasetId: true },
        with: { dataset: { columns: { schema: true } } },
      },
    },
  });
  if (!run) throw new TRPCError({ code: 'NOT_FOUND', message: `Run ${runId} not found` });
  if (!run.source) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Run has no Source' });

  const items = await db.query.runItems.findMany({
    where: and(eq(runItems.runId, runId), eq(runItems.kind, 'detail')),
    columns: { id: true, url: true, absentFields: true },
    with: { extraction: { columns: { data: true } } },
  });

  const fields = effectiveSchema(run.source);
  return computeCoverage(fields, items.map((i) => ({
    id: i.id,
    url: i.url,
    row: Array.isArray(i.extraction?.data) ? (i.extraction!.data[0] as Record<string, unknown> ?? null) : null,
    absentFields: (i.absentFields as string[] | null) ?? [],
  })));
}
