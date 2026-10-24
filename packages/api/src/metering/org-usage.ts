// packages/api/src/metering/org-usage.ts
// What an organisation used in a month (spec 2026-10-24 metering §2.1), counted from the recorded rows — the same
// tables and rules as `usage.byProject`, grouped by org. No counter table: it cannot drift from the costs (§3.5).
// Every measure reaches its org one way: website → dataset → project. A website with no dataset counts nowhere.
import { and, eq, gte, inArray, lt, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { captures, datasets, jevReadings, projects, runs, sourceVerifications, sources, type Database } from '@robot/db';
import { monthBounds } from '../routers/usage.js';

export type OrgUsage = { pages: number; runs: number; aiUsd: number; jevUsd: number };
export const NO_USAGE: Readonly<OrgUsage> = Object.freeze({ pages: 0, runs: 0, aiUsd: 0, jevUsd: 0 });

/** `YYYY-MM` in UTC — the grain `usage.byProject` takes. */
export function monthKeyOf(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

// Four decimals in the run and verification cost columns, six in Jev's.
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;
const round6 = (n: number) => Math.round(n * 1_000_000) / 1_000_000;

export async function usageByOrg(db: Database, month: string, orgIds?: string[]): Promise<Map<string, OrgUsage>> {
  if (orgIds && orgIds.length === 0) return new Map();
  const { start, end } = monthBounds(month);
  const inMonth = (col: AnyPgColumn) => and(gte(col, start), lt(col, end));
  const scoped = (extra: SQL | undefined) => and(orgIds ? inArray(projects.orgId, orgIds) : undefined, extra);

  const [pages, ran, verified, runSpend, jev] = await Promise.all([
    db.select({ orgId: projects.orgId, n: sql<number>`count(*)::int` }).from(captures)
      .innerJoin(sources, eq(captures.sourceId, sources.id)).innerJoin(datasets, eq(sources.datasetId, datasets.id)).innerJoin(projects, eq(datasets.projectId, projects.id))
      .where(scoped(inMonth(captures.createdAt))).groupBy(projects.orgId),
    db.select({ orgId: projects.orgId, n: sql<number>`count(*)::int` }).from(runs)
      .innerJoin(sources, eq(runs.sourceId, sources.id)).innerJoin(datasets, eq(sources.datasetId, datasets.id)).innerJoin(projects, eq(datasets.projectId, projects.id))
      // A sample is not a run (spec §2.1); a run with no label is.
      .where(scoped(and(inMonth(runs.createdAt), sql`${runs.inputLabel} IS DISTINCT FROM 'probe'`))).groupBy(projects.orgId),
    db.select({ orgId: projects.orgId, usd: sql<string>`coalesce(sum(${sourceVerifications.costUsd}), 0)` }).from(sourceVerifications)
      .innerJoin(sources, eq(sourceVerifications.sourceId, sources.id)).innerJoin(datasets, eq(sources.datasetId, datasets.id)).innerJoin(projects, eq(datasets.projectId, projects.id))
      .where(scoped(inMonth(sourceVerifications.startedAt))).groupBy(projects.orgId),
    // Every run's spend, samples included — the same as Usage.
    db.select({ orgId: projects.orgId, usd: sql<string>`coalesce(sum(${runs.costUsd}), 0)` }).from(runs)
      .innerJoin(sources, eq(runs.sourceId, sources.id)).innerJoin(datasets, eq(sources.datasetId, datasets.id)).innerJoin(projects, eq(datasets.projectId, projects.id))
      .where(scoped(inMonth(runs.createdAt))).groupBy(projects.orgId),
    db.select({ orgId: projects.orgId, usd: sql<string>`coalesce(sum(${jevReadings.costUsd}), 0)` }).from(jevReadings)
      .innerJoin(sources, eq(jevReadings.sourceId, sources.id)).innerJoin(datasets, eq(sources.datasetId, datasets.id)).innerJoin(projects, eq(datasets.projectId, projects.id))
      .where(scoped(inMonth(jevReadings.createdAt))).groupBy(projects.orgId),
  ]);

  const out = new Map<string, OrgUsage>();
  const of = (orgId: string) => {
    let u = out.get(orgId);
    if (!u) { u = { ...NO_USAGE }; out.set(orgId, u); }
    return u;
  };
  for (const r of pages) of(r.orgId).pages = Number(r.n);
  for (const r of ran) of(r.orgId).runs = Number(r.n);
  for (const r of [...verified, ...runSpend]) of(r.orgId).aiUsd += Number(r.usd);
  for (const r of jev) of(r.orgId).jevUsd += Number(r.usd);
  for (const u of out.values()) { u.aiUsd = round4(u.aiUsd); u.jevUsd = round6(u.jevUsd); }
  return out;
}

export async function orgUsage(db: Database, orgId: string, month: string): Promise<OrgUsage> {
  return (await usageByOrg(db, month, [orgId])).get(orgId) ?? { ...NO_USAGE };
}

/** How many websites each org has (every website in its projects). */
export async function websitesByOrg(db: Database, orgIds: string[]): Promise<Map<string, number>> {
  if (orgIds.length === 0) return new Map();
  const rows = await db.select({ orgId: projects.orgId, n: sql<number>`count(*)::int` }).from(sources)
    .innerJoin(datasets, eq(sources.datasetId, datasets.id)).innerJoin(projects, eq(datasets.projectId, projects.id))
    .where(inArray(projects.orgId, orgIds)).groupBy(projects.orgId);
  return new Map(rows.map((r) => [r.orgId, Number(r.n)]));
}
