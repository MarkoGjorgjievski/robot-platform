import { z } from 'zod';
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { captures, datasets, projects, runs, sourceVerifications, sources } from '@robot/db';
import { router, protectedProcedure } from '../trpc.js';

/** `[first instant of the month, first instant of the next)`, in UTC. */
export function monthBounds(month: string): { start: Date; end: Date } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)) };
}

/**
 * What the organisation spent this month and how many pages it captured, per
 * project (spec 2026-09-21 §5). Spend is `source_verifications.cost_usd` (by
 * the verification's start) plus `runs.cost_usd` (by the run's creation);
 * pages are `captures` rows (by creation). Every project in the org is listed,
 * a quiet one at zero — the table is the org's projects, not its receipts.
 * A run with no website (`source_id = null`) and a sandbox source with no
 * dataset contribute nothing here, the same rule `runs.listByOrg` documents
 * for itself.
 */
export const usageRouter = router({
  byProject: protectedProcedure
    .input(z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'YYYY-MM') }))
    .query(async ({ ctx, input }) => {
      const orgId = ctx.session.org.id;
      const { start, end } = monthBounds(input.month);
      // `AnyPgColumn`, not one table's column type: the three timestamps live
      // on three tables and Drizzle types each by its table.
      const inMonth = (col: AnyPgColumn) => and(gte(col, start), lt(col, end));

      const list = await ctx.db.select({ id: projects.id, name: projects.name, slug: projects.slug })
        .from(projects).where(eq(projects.orgId, orgId));

      const inOrgAndMonth = (extra: ReturnType<typeof and>) => and(eq(projects.orgId, orgId), extra);

      const verificationSpend = await ctx.db
        .select({ projectId: projects.id, usd: sql<string>`coalesce(sum(${sourceVerifications.costUsd}), 0)` })
        .from(sourceVerifications)
        .innerJoin(sources, eq(sourceVerifications.sourceId, sources.id))
        .innerJoin(datasets, eq(sources.datasetId, datasets.id))
        .innerJoin(projects, eq(datasets.projectId, projects.id))
        .where(inOrgAndMonth(inMonth(sourceVerifications.startedAt)))
        .groupBy(projects.id);

      const runSpend = await ctx.db
        .select({ projectId: projects.id, usd: sql<string>`coalesce(sum(${runs.costUsd}), 0)` })
        .from(runs)
        .innerJoin(sources, eq(runs.sourceId, sources.id))
        .innerJoin(datasets, eq(sources.datasetId, datasets.id))
        .innerJoin(projects, eq(datasets.projectId, projects.id))
        .where(inOrgAndMonth(inMonth(runs.createdAt)))
        .groupBy(projects.id);

      const pages = await ctx.db
        .select({ projectId: projects.id, n: sql<number>`count(*)::int` })
        .from(captures)
        .innerJoin(sources, eq(captures.sourceId, sources.id))
        .innerJoin(datasets, eq(sources.datasetId, datasets.id))
        .innerJoin(projects, eq(datasets.projectId, projects.id))
        .where(inOrgAndMonth(inMonth(captures.createdAt)))
        .groupBy(projects.id);

      const spend = new Map<string, number>();
      for (const r of [...verificationSpend, ...runSpend]) spend.set(r.projectId, (spend.get(r.projectId) ?? 0) + Number(r.usd));
      const captured = new Map(pages.map((r) => [r.projectId, Number(r.n)]));

      // Four decimals in the column, four decimals out: summing floats from
      // two tables must not turn 0.03 + 0.02 into 0.049999….
      const round = (n: number) => Math.round(n * 10_000) / 10_000;
      const rows = list
        .map((p) => ({ ...p, spendUsd: round(spend.get(p.id) ?? 0), pagesCaptured: captured.get(p.id) ?? 0 }))
        .sort((a, b) => b.spendUsd - a.spendUsd || a.name.localeCompare(b.name));
      return {
        month: input.month,
        projects: rows,
        total: {
          spendUsd: round(rows.reduce((s, r) => s + r.spendUsd, 0)),
          pagesCaptured: rows.reduce((s, r) => s + r.pagesCaptured, 0),
        },
      };
    }),
});
