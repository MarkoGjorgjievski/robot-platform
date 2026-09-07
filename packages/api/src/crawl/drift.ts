// packages/api/src/crawl/drift.ts
// A certified path can stop resolving without anyone noticing — the page
// changed layout, the API dropped a field. Drift is how a run at scale says
// so: after a certified run finishes, any field whose miss share crossed
// DRIFT_MISS_SHARE gets flagged on both the run (a historical record of what
// happened) and the Source (what the dashboard warns about going forward).

import { eq } from 'drizzle-orm';
import { DRIFT_MIN_ROWS, DRIFT_MISS_SHARE } from '@robot/scraper';
import { extractions, runs, sources } from '@robot/db';
import type { Database } from '@robot/db';

/** Pure: which of `keys` are null/undefined/empty-string in at least
 * DRIFT_MISS_SHARE of `rows`. Fewer than DRIFT_MIN_ROWS rows is too small a
 * sample to call drift — this returns [] rather than flag a field off a
 * couple of unlucky misses. */
export function driftedKeys(rows: Array<Record<string, unknown>>, keys: string[]): string[] {
  if (rows.length < DRIFT_MIN_ROWS) return [];
  return keys.filter((k) => rows.filter((r) => r[k] === null || r[k] === undefined || r[k] === '').length / rows.length >= DRIFT_MISS_SHARE);
}

/** Reads every row this run actually extracted, computes drift over the
 * certified field keys, and persists it — always on the run (even an empty
 * array is the honest "checked, nothing drifted"), and on the Source as
 * `null` rather than `[]` when nothing drifted, matching the column's
 * existing "absent means clean" convention (run-source-verification.ts). */
export async function flagDrift(db: Database, runId: string, sourceId: string, keys: string[]): Promise<string[]> {
  const found = await db.query.extractions.findMany({ where: eq(extractions.runId, runId), columns: { data: true } });
  const rows = found.flatMap((e) => (Array.isArray(e.data) ? (e.data as Array<Record<string, unknown>>) : []));
  const drifted = driftedKeys(rows, keys);
  await db.update(runs).set({ driftedFields: drifted }).where(eq(runs.id, runId));
  await db.update(sources).set({ driftedFields: drifted.length ? drifted : null, updatedAt: new Date() }).where(eq(sources.id, sourceId));
  return drifted;
}
