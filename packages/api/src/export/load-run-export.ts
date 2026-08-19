// Fetches the inputs `buildRunExport` needs. Mirrors what `runs.getWithDetails`
// already reads, so exports and the run detail view can never disagree about
// which extraction a run's rows come from.

import { eq, desc } from 'drizzle-orm';
import { runs, captures, extractions } from '@robot/db';
import type { db as Database } from '@robot/db';
import { buildRunExport, type RunExport } from './build-run-export.js';

export async function loadRunExport(db: typeof Database, runId: string): Promise<RunExport | null> {
  const run = await db.query.runs.findFirst({
    where: eq(runs.id, runId),
    with: {
      source: { columns: { slug: true, name: true, urlTemplate: true, selectorsJson: true } },
    },
  });
  if (!run) return null;

  const [latestCapture, latestExtraction] = await Promise.all([
    db.query.captures.findFirst({
      where: eq(captures.runId, runId),
      orderBy: [desc(captures.createdAt)],
      columns: { url: true },
    }),
    db.query.extractions.findFirst({
      where: eq(extractions.runId, runId),
      orderBy: [desc(extractions.createdAt)],
      columns: { data: true },
    }),
  ]);

  return buildRunExport({
    run,
    source: run.source ?? null,
    captureUrl: latestCapture?.url ?? null,
    extractionData: latestExtraction?.data ?? null,
  });
}
