// packages/api/src/delivery/run-files.ts
// A settled run's file, written once per format by its run-delivery job (spec 2026-10-24 §3.3): the snapshot of
// that moment. A later backfill's own delivery rewrites it; the run page's buttons keep serving the live rows.
import { and, eq } from 'drizzle-orm';
import { runFiles, type Database } from '@robot/db';
import { loadRunExport } from '../export/load-run-export.js';
import { EXPORT_FORMATS, renderRunExport, type ExportFormat } from '../export/render-run-export.js';

/** Null when the run is gone. */
export async function writeRunFiles(dbh: Database, runId: string): Promise<{ rows: number } | null> {
  const x = await loadRunExport(dbh, runId);
  if (!x) return null;
  const rendered = await Promise.all(EXPORT_FORMATS.map(async (format) => ({ format, ...(await renderRunExport(x, format)) })));
  const rows = x.rows.length;
  await dbh.transaction(async (tx) => {
    for (const r of rendered) {
      const createdAt = new Date();
      await tx.insert(runFiles).values({ runId, format: r.format, filename: r.filename, bytes: r.bytes, rows, createdAt })
        .onConflictDoUpdate({ target: [runFiles.runId, runFiles.format], set: { filename: r.filename, bytes: r.bytes, rows, createdAt } });
    }
  });
  return { rows };
}

export async function loadRunFile(dbh: Database, runId: string, format: ExportFormat): Promise<{ bytes: Buffer; filename: string; rows: number } | null> {
  const row = await dbh.query.runFiles.findFirst({
    where: and(eq(runFiles.runId, runId), eq(runFiles.format, format)),
    columns: { bytes: true, filename: true, rows: true },
  });
  return row ?? null;
}
