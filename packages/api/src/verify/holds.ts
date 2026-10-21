// packages/api/src/verify/holds.ts
// Websites change (spec 2026-10-21 §3.1): a hold keeps a field's last passing
// result after a Verify that did not pass it, while its paths still extract.
// This file loads holds and reads, the way a run would, what a set of paths
// writes on a set of captures (no page load). Writing holds lives here too
// (Task 5). Never a model call.
import { eq, inArray } from 'drizzle-orm';
import { fieldHolds, type Database } from '@robot/db';
import type { IBrowser, PageCapture } from '@robot/browser';
import { runVerifiedExtraction, type CertifiedPath, type FieldVerification, type PathReading, type SchemaDefinitionField } from '@robot/scraper';

/** The database or a transaction on it. */
export type HoldsDb = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

export type Hold = {
  fieldKey: string;
  result: FieldVerification;
  verificationId: string | null;
  verifiedAt: Date;
  failedVerificationId: string | null;
  fieldHashes: string[];
};

/** The result runs read for a field (its current result or its hold), with the hashes it stands for. */
export type Certifying = { result: FieldVerification; verificationId: string | null; verifiedAt: Date; fieldHashes: string[] };

/** Spec 4.4's pass rule, shared by currency and holds: something certifies it and every cell passed. */
export function resultPasses(r: FieldVerification | undefined): boolean {
  if (!r) return false;
  const cells = Object.values(r.cells);
  // A field passed by its default alone (spec 2026-10-13 §4) passes with no path.
  // A field not on this website (spec 2026-10-17 §2) passes with no path.
  return (r.certified.length > 0 || r.defaultOnly === true || r.notOnWebsite === true) && cells.length > 0 && cells.every((c) => c.status === 'pass');
}

function toHold(r: typeof fieldHolds.$inferSelect): Hold {
  return {
    fieldKey: r.fieldKey,
    result: r.result as FieldVerification,
    verificationId: r.verificationId,
    verifiedAt: r.verifiedAt,
    failedVerificationId: r.failedVerificationId,
    fieldHashes: Array.isArray(r.fieldHashes) ? (r.fieldHashes as string[]) : [],
  };
}

export async function loadHolds(db: HoldsDb, sourceId: string): Promise<Hold[]> {
  const rows = await db.select().from(fieldHolds).where(eq(fieldHolds.sourceId, sourceId));
  return rows.map(toHold);
}

export async function loadHoldsBatch(db: HoldsDb, sourceIds: string[]): Promise<Map<string, Hold[]>> {
  const out = new Map<string, Hold[]>();
  if (sourceIds.length === 0) return out;
  const rows = await db.select().from(fieldHolds).where(inArray(fieldHolds.sourceId, sourceIds));
  for (const r of rows) {
    const list = out.get(r.sourceId) ?? [];
    list.push(toHold(r));
    out.set(r.sourceId, list);
  }
  return out;
}

/**
 * What a run writes for `field` from `paths` on each captured page (`runVerifiedExtraction` with the
 * capture supplied: no page load). A null capture — a page that did not load — has no reading.
 */
export async function readingsOf(
  browser: IBrowser,
  field: SchemaDefinitionField,
  paths: CertifiedPath[],
  captures: Record<string, PageCapture | null>,
): Promise<Record<string, PathReading>> {
  const out: Record<string, PathReading> = {};
  for (const [url, capture] of Object.entries(captures)) {
    if (!capture) continue;
    const r = await runVerifiedExtraction({ url, fields: [{ key: field.key, type: field.type, concept: field.concept, paths }] }, { browser, capture });
    const hit = r.stats.find((s) => s.key === field.key && s.hit);
    const v = r.data[field.key];
    out[url] = { value: v === null || v === undefined ? null : String(v), path: hit?.path ?? null, shown: r.shown[field.key] ?? null };
  }
  return out;
}

/** Spec §3.1: the paths still extract — a value on some captured page, or nothing was captured (nothing learned), or the result has no paths. */
export function stillExtracts(result: Pick<FieldVerification, 'certified'>, readings: Record<string, PathReading>): boolean {
  if (result.certified.length === 0) return true;
  const read = Object.values(readings);
  return read.length === 0 || read.some((r) => r.value !== null);
}
