// packages/api/src/metering/cap-state.ts
// An organisation's monthly AI limit (spec 2026-10-24 metering §2.2): its own value, else ORG_AI_CAP_USD ($25 unless
// set; `none` = no default). The state is computed on demand from what the month recorded — no counter table.
import { eq } from 'drizzle-orm';
import { orgs, type Database } from '@robot/db';
import { orgIdForSource } from '../export/org-for-export.js';
import { monthKeyOf, orgUsage } from './org-usage.js';

export const DEFAULT_ORG_AI_CAP_USD = 25;
/** What one planning (or legacy execution) model call is projected at (spec §2.3). */
export const PLAN_CALL_USD = 0.05;

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;
let warned = false;

/** The default limit. Anything but `none` or a non-negative number falls back to $25: a typo never lifts the limit. */
export function defaultCapUsd(env: Record<string, string | undefined> = process.env): number | null {
  const raw = (env.ORG_AI_CAP_USD ?? '').trim();
  if (raw === '') return DEFAULT_ORG_AI_CAP_USD;
  if (raw.toLowerCase() === 'none') return null;
  const n = /^\d+(\.\d+)?$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isFinite(n)) {
    if (!warned) { warned = true; console.warn(`[metering] ORG_AI_CAP_USD=${JSON.stringify(raw)} is not a number or "none"; using $${DEFAULT_ORG_AI_CAP_USD}`); }
    return DEFAULT_ORG_AI_CAP_USD;
  }
  return round2(n);
}

export type CapSetting = { capUsd: number | null; isDefault: boolean; ownCapUsd: number | null; defaultCapUsd: number | null };

export function effectiveCap(own: string | number | null | undefined, env: Record<string, string | undefined> = process.env): CapSetting {
  const ownCapUsd = own === null || own === undefined ? null : Number(own);
  const fallback = defaultCapUsd(env);
  return ownCapUsd === null
    ? { capUsd: fallback, isDefault: true, ownCapUsd: null, defaultCapUsd: fallback }
    : { capUsd: ownCapUsd, isDefault: false, ownCapUsd, defaultCapUsd: fallback };
}

export type CapState = { capUsd: number | null; spentUsd: number; remainingUsd: number | null; reached: boolean };

/** `reached` at equality; what is left never goes below 0 (a limit lowered under the spend has nothing left). */
export function capStateOf(capUsd: number | null, spentUsd: number): CapState {
  if (capUsd === null) return { capUsd: null, spentUsd, remainingUsd: null, reached: false };
  return { capUsd, spentUsd, remainingUsd: Math.max(0, round4(capUsd - spentUsd)), reached: spentUsd >= capUsd };
}

/** % of the limit used, one decimal; a limit of 0 is 100 % used from the start; no limit, none. */
export function percentUsed(capUsd: number | null, spentUsd: number): number | null {
  if (capUsd === null) return null;
  if (capUsd === 0) return 100;
  return Math.round((spentUsd / capUsd) * 1000) / 10;
}

export async function orgCapState(db: Database, orgId: string, now: Date = new Date()): Promise<CapState> {
  const org = await db.query.orgs.findFirst({ where: eq(orgs.id, orgId), columns: { aiCapUsd: true } });
  const { capUsd } = effectiveCap(org?.aiCapUsd ?? null);
  const { aiUsd } = await orgUsage(db, orgId, monthKeyOf(now));
  return capStateOf(capUsd, aiUsd);
}

/** For a worker job, which has no session: the website's org, or no limit for a website with no org. */
export async function capStateForSource(db: Database, sourceId: string, now: Date = new Date()): Promise<CapState & { orgId: string | null }> {
  const orgId = await orgIdForSource(db, sourceId);
  if (!orgId) return { orgId: null, capUsd: null, spentUsd: 0, remainingUsd: null, reached: false };
  return { orgId, ...(await orgCapState(db, orgId, now)) };
}
