// packages/api/src/verify/holds.ts
// Websites change (spec 2026-10-21 §3.1): a hold keeps a field's last passing
// result after a Verify that did not pass it, while its paths still extract.
// This file loads holds and reads, the way a run would, what a set of paths
// writes on a set of captures (no page load), decides and writes a Verify's
// holds, and backfills them once for named websites. Never a model call.
import { and, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { fieldHolds, sourceVerifications, sources, type Database } from '@robot/db';
import type { IBrowser, PageCapture } from '@robot/browser';
import { fieldHash, runVerifiedExtraction, type CertifiedPath, type FieldVerification, type PathReading, type SchemaDefinitionField, type VerificationSet } from '@robot/scraper';
import { readCaptureFile, type StoredCaptureRef } from './capture-store.js';

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

/**
 * Spec §3.1: the paths still extract — a value on some captured page, or the result has no paths
 * (`defaultOnly` / `notOnWebsite`). No evidence, no hold (fix wave 1, item 1): when no page was read at all
 * (no capture, a capture file pruned from disk), this is false. The spec's "no page could be captured, nothing
 * learned" case is the caller's to decide — `decideHolds`'s `nothingCaptured` — never a default.
 */
export function stillExtracts(result: Pick<FieldVerification, 'certified'>, readings: Record<string, PathReading>): boolean {
  if (result.certified.length === 0) return true;
  return Object.values(readings).some((r) => r.value !== null);
}

/** Why a field a Verify checked has, or has no, hold. */
export type HoldWhy = 'passed' | 'held' | 'no-certifying' | 'no-evidence' | 'reads-nothing';

export type HoldPlan = { upsert: Hold[]; remove: string[]; readings: Record<string, Record<string, PathReading>>; why: Record<string, HoldWhy> };

/**
 * Spec §3.1, for each field a Verify checked (`keys`): a pass ends its hold; a field it did not pass is
 * held when it had a certifying result that itself passes, whose hashes include today's hash (the customer
 * has not edited it since), and whose paths still extract on the Verify's captures; otherwise it has no
 * hold. Reads the captures the way a run would (no page load, never a model call). Variants are not
 * fields: a hold never stands in for a failed variant check.
 *
 * No page read is no evidence and no hold, unless `nothingCaptured: 'hold'` — a live Verify that could load
 * no proof page at all learned nothing about the paths, and spec §3.1 keeps the hold then (a site down for a
 * minute does not take a certification away). A backfill never passes it: a pruned capture file is not an outage.
 */
export async function decideHolds(args: {
  fields: SchemaDefinitionField[];
  set: VerificationSet;
  keys: string[];
  outcome: Record<string, FieldVerification>;
  certifying: (key: string) => Certifying | null;
  captures: Record<string, PageCapture | null>;
  browser: IBrowser;
  failedVerificationId: string;
  nothingCaptured?: 'hold' | 'no-hold';
}): Promise<HoldPlan> {
  const plan: HoldPlan = { upsert: [], remove: [], readings: {}, why: {} };
  const drop = (key: string, why: HoldWhy) => { plan.remove.push(key); plan.why[key] = why; };
  const nothingCaptured = Object.values(args.captures).every((c) => !c);
  for (const field of args.fields.filter((f) => args.keys.includes(f.key))) {
    if (resultPasses(args.outcome[field.key])) { drop(field.key, 'passed'); continue; }
    const c = args.certifying(field.key);
    // A hold is only ever made from a result that passes (Task 3 review).
    if (!c || !resultPasses(c.result) || !c.fieldHashes.includes(fieldHash(field, args.set))) { drop(field.key, 'no-certifying'); continue; }
    const readings = await readingsOf(args.browser, field, c.result.certified, args.captures);
    plan.readings[field.key] = readings;
    const keepBlind = nothingCaptured && args.nothingCaptured === 'hold';
    if (!keepBlind && !stillExtracts(c.result, readings)) {
      drop(field.key, c.result.certified.length > 0 && Object.keys(readings).length === 0 ? 'no-evidence' : 'reads-nothing');
      continue;
    }
    plan.why[field.key] = 'held';
    plan.upsert.push({ fieldKey: field.key, result: c.result, verificationId: c.verificationId, verifiedAt: c.verifiedAt, failedVerificationId: args.failedVerificationId, fieldHashes: c.fieldHashes });
  }
  return plan;
}

/**
 * Writes a plan's holds and deletes its ended ones — call inside the Verify's own transaction. A hold whose
 * result does not pass is never written, whoever built the plan.
 */
export async function writeHolds(db: HoldsDb, sourceId: string, plan: Pick<HoldPlan, 'upsert' | 'remove'>): Promise<void> {
  for (const h of plan.upsert) {
    if (!resultPasses(h.result)) {
      console.error(`[holds] refused a hold for ${sourceId}/${h.fieldKey}: its result does not pass`);
      continue;
    }
    const values = { result: h.result, verificationId: h.verificationId, verifiedAt: h.verifiedAt, failedVerificationId: h.failedVerificationId, fieldHashes: h.fieldHashes, updatedAt: new Date() };
    await db.insert(fieldHolds).values({ sourceId, fieldKey: h.fieldKey, ...values })
      .onConflictDoUpdate({ target: [fieldHolds.sourceId, fieldHolds.fieldKey], set: values });
  }
  if (plan.remove.length > 0) await db.delete(fieldHolds).where(and(eq(fieldHolds.sourceId, sourceId), inArray(fieldHolds.fieldKey, plan.remove)));
}

/** Per field, what a backfill did: held, or skipped — for no evidence (no stored page could be read), or another reason. */
export type BackfillField = { held: true } | { held: false; reason: 'no-evidence' | 'reads-nothing' | 'no-earlier-pass' | 'passing' | 'already-held' };

/**
 * Spec 2026-10-21 §8: the hold rule applied after the fact to one named website's latest completed, clean
 * Verify — what it would have kept had this code run then. Callers name each website (the ten approved
 * ones); nothing here walks every website. A field's certifying result is its newest earlier pass at
 * today's hash; the pages are the latest Verify's stored capture files (read whatever their age, no page
 * load, never a model call). No evidence, no hold: a stored capture file that is missing or pruned reads as
 * nothing, and a field no stored page could be read for is not held (`fields[key].reason: 'no-evidence'`).
 * Fields the latest Verify passed, and fields already held, are left alone, so it is idempotent. With
 * `write`, writes the holds (never deletes one).
 */
export async function backfillHolds(
  db: Database,
  browser: IBrowser,
  sourceId: string,
  opts: { write?: boolean } = {},
): Promise<HoldPlan & { certifying: Record<string, Certifying>; latestId: string | null; passing: string[]; fields: Record<string, BackfillField> }> {
  const empty = { upsert: [], remove: [], readings: {}, why: {}, certifying: {}, latestId: null, passing: [], fields: {} };
  const source = await db.query.sources.findFirst({ where: eq(sources.id, sourceId), columns: { schemaDefinition: true, verificationSet: true } });
  if (!source || !Array.isArray(source.schemaDefinition) || !source.verificationSet) return empty;
  const fields = source.schemaDefinition as SchemaDefinitionField[];
  const set = source.verificationSet as VerificationSet;
  const runs = await db.query.sourceVerifications.findMany({
    where: and(eq(sourceVerifications.sourceId, sourceId), isNotNull(sourceVerifications.completedAt), isNull(sourceVerifications.errorMessage)),
    orderBy: [desc(sourceVerifications.completedAt), desc(sourceVerifications.id)],
    limit: 30,
  });
  const latest = runs[0];
  if (!latest) return empty;
  const latestResults = (latest.results ?? {}) as Record<string, FieldVerification>;
  const existing = await loadHolds(db, sourceId);
  const certifying: Record<string, Certifying> = {};
  const keys = fields.filter((f) => !resultPasses(latestResults[f.key]) && !existing.some((h) => h.fieldKey === f.key)).map((f) => f.key);
  for (const key of keys) {
    const field = fields.find((f) => f.key === key)!;
    const now = fieldHash(field, set);
    const good = runs.slice(1).find((r) => {
      const x = ((r.results ?? {}) as Record<string, FieldVerification>)[key];
      return resultPasses(x) && x!.fieldHash === now;
    });
    if (good) certifying[key] = { result: (good.results as Record<string, FieldVerification>)[key]!, verificationId: good.id, verifiedAt: good.completedAt!, fieldHashes: [now] };
  }
  const captures: Record<string, PageCapture | null> = {};
  for (const [url, ref] of Object.entries((latest.captures ?? {}) as Record<string, StoredCaptureRef>)) {
    if (url === '_stage' || !set.urls.includes(url)) continue;
    captures[url] = ref.captureId ? await readCaptureFile(ref.captureId) : null;
  }
  const plan = await decideHolds({ fields, set, keys: Object.keys(certifying), outcome: latestResults, certifying: (k) => certifying[k] ?? null, captures, browser, failedVerificationId: latest.id });
  if (opts.write) await writeHolds(db, sourceId, { upsert: plan.upsert, remove: [] });
  const passing = fields.filter((f) => resultPasses(latestResults[f.key])).map((f) => f.key);
  const out: Record<string, BackfillField> = {};
  for (const f of fields) {
    if (passing.includes(f.key)) out[f.key] = { held: false, reason: 'passing' };
    else if (existing.some((h) => h.fieldKey === f.key)) out[f.key] = { held: false, reason: 'already-held' };
    else if (!certifying[f.key]) out[f.key] = { held: false, reason: 'no-earlier-pass' };
    else if (plan.why[f.key] === 'held') out[f.key] = { held: true };
    else out[f.key] = { held: false, reason: plan.why[f.key] === 'no-evidence' ? 'no-evidence' : 'reads-nothing' };
  }
  return { ...plan, certifying, latestId: latest.id, passing, fields: out };
}
