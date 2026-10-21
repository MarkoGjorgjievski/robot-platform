// packages/api/src/verify/attention.ts
// What needs the customer on a website that changed (spec 2026-10-21 §3.5):
// held fields, the newest check's findings that were not refreshed, and proof
// pages that are gone — plus each field's newest automatic refresh that still
// describes it (§5), and every refresh for ops (§6). Read-only.
//
// What a check says about why it did not refresh a field (`refresh.reason`) and
// the path a refresh read are staff-only (spec §5, §6): `forCustomer` and
// `customerDriftResults` strip them from what a customer session receives.
import { and, desc, eq, gt, inArray, isNull } from 'drizzle-orm';
import { driftChecks, sources, sourceVerifications, valueRefreshes, type Database } from '@robot/db';
import { fieldHash, type DriftCheckResults, type DriftFieldResult, type RefreshPage, type SchemaDefinitionField, type VerificationSet } from '@robot/scraper';
import { loadFieldCurrency } from './current-certification.js';

export type Attention = { fields: string[]; heldSince: Date | null; goneProducts: number[]; findings: Record<string, DriftFieldResult> };
export type RefreshLineData = { key: string; at: Date; pages: Record<string, RefreshPage> };
/** A refreshed page as a customer receives it: the values only, never the path that read them. */
export type CustomerRefreshPage = { was: string; now: string; path?: RefreshPage['path'] };

/** A finding the customer can act on: moved, lost, or a change that was not refreshed. */
function actionable(r: DriftFieldResult): boolean {
  return r.result === 'moved' || r.result === 'lost' || (r.result === 'changed' && r.refresh?.applied !== true);
}

async function sourceOf(db: Database, sourceId: string) {
  const s = await db.query.sources.findFirst({ where: eq(sources.id, sourceId), columns: { schemaDefinition: true, verificationSet: true } });
  return {
    fields: (Array.isArray(s?.schemaDefinition) ? s!.schemaDefinition : []) as SchemaDefinitionField[],
    set: (s?.verificationSet ?? { urls: [], expected: {} }) as VerificationSet,
  };
}

export async function websiteAttention(db: Database, sourceId: string): Promise<Attention> {
  const [{ fields, set }, currency, checks] = await Promise.all([
    sourceOf(db, sourceId),
    loadFieldCurrency(db, sourceId),
    db.query.driftChecks.findMany({
      where: and(eq(driftChecks.sourceId, sourceId), eq(driftChecks.status, 'done')),
      orderBy: [desc(driftChecks.createdAt), desc(driftChecks.id)],
      limit: 5,
      columns: { createdAt: true, results: true },
    }),
  ]);
  // Follow-ups §1: a current field's finding is superseded by a newer clean Verify of that field. A refresh's
  // re-verify verified only the fields it refreshed (its `value_refreshes` rows), every other clean Verify all.
  const oldestCheck = checks.at(-1)?.createdAt ?? null;
  const laterVerifies = oldestCheck === null ? [] : await db.select({ id: sourceVerifications.id, completedAt: sourceVerifications.completedAt })
    .from(sourceVerifications)
    .where(and(eq(sourceVerifications.sourceId, sourceId), gt(sourceVerifications.completedAt, oldestCheck), isNull(sourceVerifications.errorMessage)));
  const refreshedBy = new Map<string, Set<string>>();
  if (laterVerifies.length > 0) {
    const links = await db.select({ verificationId: valueRefreshes.verificationId, fieldKey: valueRefreshes.fieldKey }).from(valueRefreshes)
      .where(inArray(valueRefreshes.verificationId, laterVerifies.map((v) => v.id)));
    for (const l of links) {
      if (!l.verificationId) continue;
      if (!refreshedBy.has(l.verificationId)) refreshedBy.set(l.verificationId, new Set());
      refreshedBy.get(l.verificationId)!.add(l.fieldKey);
    }
  }
  const verifiedAfter = (key: string, at: Date) =>
    laterVerifies.some((v) => !!v.completedAt && v.completedAt > at && (refreshedBy.get(v.id)?.has(key) ?? true));
  // Final review M3: when each hold's failed Verify completed — a check from before it says nothing about the held field.
  const failedIds = [...new Set(currency.heldKeys.map((k) => currency.held[k]!.failedVerificationId).filter((id): id is string => !!id))];
  const failedAt = new Map(failedIds.length === 0 ? [] : (await db.select({ id: sourceVerifications.id, completedAt: sourceVerifications.completedAt })
    .from(sourceVerifications).where(inArray(sourceVerifications.id, failedIds))).map((r) => [r.id, r.completedAt] as const));
  const findings: Record<string, DriftFieldResult> = {};
  for (const f of fields) {
    const held = currency.heldKeys.includes(f.key);
    const failedId = held ? currency.held[f.key]!.failedVerificationId : null;
    const since = failedId ? failedAt.get(failedId) ?? null : null;
    for (const c of checks) {
      const r = (c.results as DriftCheckResults | null)?.fields?.[f.key];
      if (!r?.result) continue; // an entry with only its up-front share
      // The newest check that read the field decides; a current field's finding counts until a newer Verify of that field
      // (follow-ups §1), a held field's only when newer than the Verify that failed it.
      const newEnough = held ? !since || c.createdAt > since : !verifiedAfter(f.key, c.createdAt);
      if (newEnough && actionable(r)) findings[f.key] = r;
      break;
    }
  }
  const gone = new Set<number>();
  for (const r of Object.values((checks[0]?.results as DriftCheckResults | null)?.fields ?? {})) {
    for (const [url, p] of Object.entries(r.pages ?? {})) {
      const i = set.urls.indexOf(url);
      if (p.status === 'page-gone' && i >= 0) gone.add(i + 1);
    }
  }
  const heldTimes = currency.heldKeys.map((k) => currency.held[k]!.verifiedAt.getTime());
  return {
    fields: fields.map((f) => f.key).filter((k) => currency.heldKeys.includes(k) || k in findings),
    heldSince: heldTimes.length > 0 ? new Date(Math.min(...heldTimes)) : null,
    goneProducts: [...gone].sort((a, b) => a - b),
    findings,
  };
}

export function needsAttention(a: Attention): boolean {
  return a.fields.length > 0 || a.goneProducts.length > 0;
}

/** Each field's newest automatic refresh, while it still describes the field (its new hash is today's). */
export async function latestRefreshes(db: Database, sourceId: string): Promise<RefreshLineData[]> {
  const [{ fields, set }, rows] = await Promise.all([
    sourceOf(db, sourceId),
    db.select().from(valueRefreshes).where(eq(valueRefreshes.sourceId, sourceId)).orderBy(desc(valueRefreshes.at)).limit(200),
  ]);
  const out: RefreshLineData[] = [];
  for (const f of fields) {
    const newest = rows.find((r) => r.fieldKey === f.key);
    if (newest && newest.toHash === fieldHash(f, set)) out.push({ key: f.key, at: newest.at, pages: newest.pages as Record<string, RefreshPage> });
  }
  return out;
}

/** Every automatic refresh, newest first, at most 50 — the ops page's list (spec §6). */
export async function opsRefreshes(db: Database, sourceId: string): Promise<Array<{ at: Date; key: string; pages: Record<string, RefreshPage> }>> {
  const rows = await db.select().from(valueRefreshes).where(eq(valueRefreshes.sourceId, sourceId)).orderBy(desc(valueRefreshes.at)).limit(50);
  return rows.map((r) => ({ at: r.at, key: r.fieldKey, pages: r.pages as Record<string, RefreshPage> }));
}

/** A check's field result without its staff-only refresh reason. */
function withoutReason(r: DriftFieldResult): DriftFieldResult {
  return r.refresh ? { ...r, refresh: { applied: r.refresh.applied } } : r;
}

/** A check's results as a customer session receives them: no refresh reason (spec §6, staff only). Staff get them whole. */
export function customerDriftResults<T extends DriftCheckResults | null>(results: T, staff: boolean): T {
  if (staff || !results?.fields) return results;
  return { ...results, fields: Object.fromEntries(Object.entries(results.fields).map(([k, r]) => [k, withoutReason(r)])) } as T;
}

/** What `sources.attention` hands a session: for a customer, no refresh reason and no path a refresh read. */
export function forCustomer(
  a: Attention & { refreshes: RefreshLineData[] },
  staff: boolean,
): Attention & { refreshes: Array<{ key: string; at: Date; pages: Record<string, CustomerRefreshPage> }> } {
  if (staff) return a;
  return {
    ...a,
    findings: Object.fromEntries(Object.entries(a.findings).map(([k, r]) => [k, withoutReason(r)])),
    refreshes: a.refreshes.map((r) => ({ ...r, pages: Object.fromEntries(Object.entries(r.pages).map(([u, p]) => [u, { was: p.was, now: p.now }])) })),
  };
}
