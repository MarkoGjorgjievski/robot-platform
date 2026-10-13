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
  // `_`-prefixed keys (`_product_key`, `_variant_key`, `_variant_partial`,
  // `_url`, …) are this row's own provenance, never a certified field — the
  // one caller (start-execution.ts's buildFinalise) only ever passes
  // `Object.keys(certification.paths)`, which can't contain one, but a
  // variants run's "without variants" rows carry no `_variant_key` at all
  // (Global Constraints), so filtering here defends against a future caller
  // flagging that absence as drift on its own bookkeeping.
  const own = keys.filter((k) => !k.startsWith('_'));
  const shares = emptyShares(rows, own);
  return own.filter((k) => shares[k]! >= DRIFT_MISS_SHARE);
}

/** Pure: each key's share of `rows` where it is null/undefined/empty-string — the miss share drift is judged on, and what the drift check reports as "% of products empty". An empty `rows` is 0 for every key. */
export function emptyShares(rows: Array<Record<string, unknown>>, keys: string[]): Record<string, number> {
  return Object.fromEntries(keys.map((k) => [k, rows.length === 0 ? 0 : rows.filter((r) => r[k] === null || r[k] === undefined || r[k] === '').length / rows.length]));
}

/** Pure: the rows with every key the default filled (`defaulted`, from the extraction's validation_result) read as empty, for the keys in `defaultKeys` only — so a path that stopped hitting on a defaulted field still shows as drift (spec 2026-10-13 §5). The rows as given when nothing applies. */
export function blankDefaulted(rows: Array<Record<string, unknown>>, defaulted: string[], defaultKeys: ReadonlySet<string>): Array<Record<string, unknown>> {
  const blank = defaulted.filter((k) => defaultKeys.has(k));
  if (blank.length === 0) return rows;
  return rows.map((r) => ({ ...r, ...Object.fromEntries(blank.map((k) => [k, null])) }));
}

/** Every row a run extracted, flattened across its extractions; a field the default filled reads as empty for the keys in `defaultKeys`. */
async function runRows(db: Database, runId: string, defaultKeys: ReadonlySet<string> = new Set()): Promise<Array<Record<string, unknown>>> {
  const found = await db.query.extractions.findMany({ where: eq(extractions.runId, runId), columns: { data: true, validationResult: true } });
  return found.flatMap((e) => blankDefaulted(
    Array.isArray(e.data) ? (e.data as Array<Record<string, unknown>>) : [],
    (e.validationResult as { defaulted?: string[] } | null)?.defaulted ?? [],
    defaultKeys,
  ));
}

/** Each key's empty share in a finished run, read from its extractions — how a drift check started on demand learns the shares `flagDrift` handed the automatic one. `defaultKeys`: the website's fields with a default, whose defaulted cells count as empty. */
export async function runEmptyShares(db: Database, runId: string, keys: string[], defaultKeys: string[] = []): Promise<Record<string, number>> {
  return emptyShares(await runRows(db, runId, new Set(defaultKeys)), keys);
}

/** Reads every row this run actually extracted, computes drift over the
 * certified field keys, and persists it — always on the run (even an empty
 * array is the honest "checked, nothing drifted"), and on the Source as
 * `null` rather than `[]` when nothing drifted, matching the column's
 * existing "absent means clean" convention (run-source-verification.ts).
 *
 * Returns the drifted keys and each one's empty share in this run (drift
 * repair Task 2): the caller hands the shares to the drift check it starts,
 * which shows them as "% of products empty". */
export async function flagDrift(db: Database, runId: string, sourceId: string, keys: string[], defaultKeys: string[] = []): Promise<{ keys: string[]; emptyShare: Record<string, number> }> {
  const rows = await runRows(db, runId, new Set(defaultKeys));
  const drifted = driftedKeys(rows, keys);
  await db.update(runs).set({ driftedFields: drifted }).where(eq(runs.id, runId));
  await db.update(sources).set({ driftedFields: drifted.length ? drifted : null, updatedAt: new Date() }).where(eq(sources.id, sourceId));
  return { keys: drifted, emptyShare: emptyShares(rows, drifted) };
}
