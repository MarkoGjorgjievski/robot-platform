// Fetches the inputs `buildRunExport` needs. Mirrors what `runs.getWithDetails`
// already reads, so exports and the run detail view can never disagree about
// which extraction a run's rows come from.

import { eq, desc, asc } from 'drizzle-orm';
import { runs, captures, extractions } from '@robot/db';
import type { db as Database } from '@robot/db';
import { buildRunExport, type RunExport } from './build-run-export.js';

export async function loadRunExport(db: typeof Database, runId: string): Promise<RunExport | null> {
  const run = await db.query.runs.findFirst({
    where: eq(runs.id, runId),
    with: {
      source: {
        columns: { slug: true, name: true, urlTemplate: true, selectorsJson: true, schemaDefinition: true },
        with: { dataset: { columns: { schema: true, variantMode: true } } },
      },
    },
  });
  if (!run) return null;

  const [latestCapture, extractionRows] = await Promise.all([
    db.query.captures.findFirst({
      where: eq(captures.runId, runId),
      orderBy: [desc(captures.createdAt)],
      columns: { url: true },
    }),
    // Ordering by createdAt then id gives a stable, reproducible order even
    // when extractions share a createdAt (e.g. issued in one transaction,
    // where Postgres now() is transaction-start-time and identical across
    // statements) — so a crawl's CSV reads the same way on every export.
    db.query.extractions.findMany({
      where: eq(extractions.runId, runId),
      orderBy: [asc(extractions.createdAt), asc(extractions.id)],
      columns: { data: true },
    }),
  ]);

  // Phase 2 writes one extraction per URL, so a run's rows are the concatenation
  // of them in the order they were extracted. A single-extraction run (a
  // single-page run) flattens to exactly what it was before.
  const rows = extractionRows.flatMap((e) => (Array.isArray(e.data) ? e.data : []));

  return buildRunExport({
    run,
    source: run.source ?? null,
    captureUrl: latestCapture?.url ?? null,
    extractionData: rows,
    dataset: run.source?.dataset ?? null,
  });
}
