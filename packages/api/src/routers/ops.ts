import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { and, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { datasets, memberships, orgs, projects, runs, sourceVerifications, sources, type Database } from '@robot/db';
import { lookupDomainCache, type FieldPathSet, type SchemaDefinitionField } from '@robot/scraper';
import { router, publicProcedure, opsProcedure } from '../trpc.js';
import { isCustomerSchema } from '../crawl/effective-schema.js';
import { loadCurrentCertification, loadFieldCurrency, loadFieldCurrencyBatch } from '../verify/current-certification.js';
import { latestDriftCheck } from '../verify/run-drift-check.js';
import { monthBounds } from './usage.js';

/** The host for the quiet mono line under a website's name. Never throws: a
 * Source's `urlTemplate` is free text, and a malformed one just reads as no
 * host rather than failing the whole overview. */
function safeHost(url: string | null): string {
  if (!url) return '';
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/** `YYYY-MM` for "this month", in UTC — the same grain `usage.byProject` takes as input. */
function currentMonthKey(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

type LastRun = { status: string; createdAt: Date; resultCount: number | null };

/** The latest run per source, in one query (`selectDistinctOn`, the same shape `projects.get` reads `runs` with). */
async function lastRunsBySource(db: Database, sourceIds: string[]): Promise<Map<string, LastRun>> {
  if (sourceIds.length === 0) return new Map();
  const rows = await db
    .selectDistinctOn([runs.sourceId], { sourceId: runs.sourceId, status: runs.status, createdAt: runs.createdAt, resultCount: runs.resultCount })
    .from(runs)
    .where(inArray(runs.sourceId, sourceIds))
    .orderBy(runs.sourceId, desc(runs.createdAt), desc(runs.id));
  const out = new Map<string, LastRun>();
  for (const r of rows) {
    if (r.sourceId) out.set(r.sourceId, { status: r.status, createdAt: r.createdAt, resultCount: r.resultCount });
  }
  return out;
}

/**
 * What each website spent this month — the same two tables and rule
 * `usage.byProject` uses (`source_verifications.cost_usd` by the
 * verification's `started_at`, plus `runs.cost_usd` by the run's
 * `created_at`), grouped by source instead of by project.
 */
async function spendThisMonthBySource(db: Database, sourceIds: string[]): Promise<Map<string, number>> {
  if (sourceIds.length === 0) return new Map();
  const { start, end } = monthBounds(currentMonthKey(new Date()));

  const verificationSpend = await db
    .select({ sourceId: sourceVerifications.sourceId, usd: sql<string>`coalesce(sum(${sourceVerifications.costUsd}), 0)` })
    .from(sourceVerifications)
    .where(and(inArray(sourceVerifications.sourceId, sourceIds), gte(sourceVerifications.startedAt, start), lt(sourceVerifications.startedAt, end)))
    .groupBy(sourceVerifications.sourceId);

  const runSpend = await db
    .select({ sourceId: runs.sourceId, usd: sql<string>`coalesce(sum(${runs.costUsd}), 0)` })
    .from(runs)
    .where(and(inArray(runs.sourceId, sourceIds), gte(runs.createdAt, start), lt(runs.createdAt, end)))
    .groupBy(runs.sourceId);

  const spend = new Map<string, number>();
  for (const r of [...verificationSpend, ...runSpend]) {
    if (!r.sourceId) continue;
    spend.set(r.sourceId, (spend.get(r.sourceId) ?? 0) + Number(r.usd));
  }
  // Four decimals in the column, four decimals out — same rounding `usage.byProject` applies,
  // so summing two tables' floats never turns 0.03 + 0.02 into 0.049999….
  const round = (n: number) => Math.round(n * 10_000) / 10_000;
  for (const [id, usd] of spend) spend.set(id, round(usd));
  return spend;
}

/**
 * Operators (ops mode, 2026-10-06): staff who answer "which customer websites
 * need us, and why?" from their own shell, read-only. `me` is the one public
 * entry point the app's shell needs before it can decide what to show — it
 * never throws for a signed-out visitor, it just says no.
 */
export const opsRouter = router({
  me: publicProcedure.query(({ ctx }) => ({ isOperator: ctx.isOperator })),

  /**
   * Every customer-schema website across every org (plan "Ops design", Global
   * Constraints), one row per website, for the overview table. The operator's
   * own org memberships never scope this — ops answers for every customer,
   * not only the ones the operator happens to belong to (Review Focus 2).
   * Legacy (non-customer-schema) sources are left out (`isCustomerSchema`).
   *
   * Batched: one query for the sources+project+org join, one batched field-
   * currency read (`loadFieldCurrencyBatch`), one batched last-run read and
   * one batched spend read — never a per-source loop beyond those batches.
   */
  websites: opsProcedure.query(async ({ ctx }) => {
    const db = ctx.db;
    const siteRows = await db
      .select({
        sourceId: sources.id,
        sourceName: sources.name,
        sourceSlug: sources.slug,
        url: sources.urlTemplate,
        schemaDefinition: sources.schemaDefinition,
        verificationSet: sources.verificationSet,
        driftedFields: sources.driftedFields,
        orgId: orgs.id,
        orgName: orgs.name,
        orgSlug: orgs.slug,
        projectName: projects.name,
        projectSlug: projects.slug,
      })
      .from(sources)
      .innerJoin(datasets, eq(sources.datasetId, datasets.id))
      .innerJoin(projects, eq(datasets.projectId, projects.id))
      .innerJoin(orgs, eq(projects.orgId, orgs.id));

    const customerRows = siteRows.filter((r) => isCustomerSchema({ schemaDefinition: r.schemaDefinition }));
    if (customerRows.length === 0) return [];

    const sourceIds = customerRows.map((r) => r.sourceId);
    const [currencyBySource, lastRunBySource, spendBySource] = await Promise.all([
      loadFieldCurrencyBatch(db, customerRows.map((r) => ({ id: r.sourceId, schemaDefinition: r.schemaDefinition, verificationSet: r.verificationSet }))),
      lastRunsBySource(db, sourceIds),
      spendThisMonthBySource(db, sourceIds),
    ]);

    return customerRows.map((r) => {
      const fields = r.schemaDefinition as SchemaDefinitionField[];
      const driftedKeys = Array.isArray(r.driftedFields) ? (r.driftedFields as string[]) : [];
      const lastRun = lastRunBySource.get(r.sourceId) ?? null;

      return {
        sourceId: r.sourceId,
        org: { id: r.orgId, name: r.orgName, slug: r.orgSlug },
        project: { name: r.projectName, slug: r.projectSlug },
        website: { name: r.sourceName, slug: r.sourceSlug, host: safeHost(r.url) },
        fields: fields.length,
        currentFields: currencyBySource.get(r.sourceId)?.currentKeys.length ?? 0,
        drifted: driftedKeys.length,
        driftedFieldNames: driftedKeys.map((key) => fields.find((f) => f.key === key)?.name ?? key),
        lastRun: lastRun ? { status: lastRun.status, at: lastRun.createdAt.toISOString(), rows: lastRun.resultCount } : null,
        spentThisMonthUsd: spendBySource.get(r.sourceId) ?? 0,
      };
    });
  }),

  /**
   * One website's approved paths, readable (plan "Ops design"): every
   * contract field, with its currently certified paths in try order, named
   * with the customer's own field name — never the internal concept — and
   * each path's real run hit rate from the domain store. Never "cache" in
   * the output: the store is "approved paths" wording lives in the app.
   *
   * `cert` is null for a website that is not (or no longer) fully certified
   * (spec 4.4) — its fields still list, each with an empty `paths` array,
   * so an unverified website reads as "nothing approved yet" rather than a
   * server error.
   */
  website: opsProcedure.input(z.object({ sourceId: z.string().uuid() })).query(async ({ ctx, input }) => {
    const db = ctx.db;
    const [row] = await db
      .select({
        sourceId: sources.id,
        sourceName: sources.name,
        sourceSlug: sources.slug,
        url: sources.urlTemplate,
        schemaDefinition: sources.schemaDefinition,
        verificationSet: sources.verificationSet,
        driftedFields: sources.driftedFields,
        orgId: orgs.id,
        orgName: orgs.name,
        orgSlug: orgs.slug,
        projectName: projects.name,
        projectSlug: projects.slug,
      })
      .from(sources)
      .innerJoin(datasets, eq(sources.datasetId, datasets.id))
      .innerJoin(projects, eq(datasets.projectId, projects.id))
      .innerJoin(orgs, eq(projects.orgId, orgs.id))
      .where(eq(sources.id, input.sourceId))
      .limit(1);

    if (!row || !isCustomerSchema({ schemaDefinition: row.schemaDefinition })) {
      throw new TRPCError({ code: 'NOT_FOUND', message: `Website ${input.sourceId} is not in ops` });
    }

    const fields = row.schemaDefinition as SchemaDefinitionField[];
    const [cert, fieldCurrency, membership, lastRunBySource, drift] = await Promise.all([
      loadCurrentCertification(db, row.sourceId),
      // The summary strip's "Verified" cell reads the table's own per-field
      // currency (plan "Ops design": "as in the table") — partial counts
      // allowed — never `cert`'s all-or-nothing gate, which the "Approved
      // paths" section below uses instead (certified paths exist only once
      // EVERY field is current).
      loadFieldCurrency(db, row.sourceId),
      db.query.memberships.findFirst({ where: and(eq(memberships.userId, ctx.session.user.id), eq(memberships.orgId, row.orgId)) }),
      lastRunsBySource(db, [row.sourceId]),
      latestDriftCheck(row.sourceId),
    ]);

    // One read of the domain store for the whole page — never one per path
    // (M3's hostname is the only key a verified-path stat is ever booked
    // under, so there is exactly one row to read, whatever the field count).
    const domainCache = cert ? await lookupDomainCache(cert.hostname, 'detail') : null;
    const fieldPaths = (domainCache?.fieldPaths ?? {}) as Record<string, FieldPathSet>;

    const driftedKeys = Array.isArray(row.driftedFields) ? (row.driftedFields as string[]) : [];
    const lastRun = lastRunBySource.get(row.sourceId) ?? null;

    return {
      sourceId: row.sourceId,
      org: { id: row.orgId, name: row.orgName, slug: row.orgSlug },
      project: { name: row.projectName, slug: row.projectSlug },
      website: { name: row.sourceName, slug: row.sourceSlug, host: safeHost(row.url) },
      operatorIsMember: !!membership,
      verified: { current: fieldCurrency.currentKeys.length, total: fields.length },
      fields: fields.map((f) => {
        const concept = cert?.concepts[f.key] ?? f.concept;
        const certified = cert?.paths[f.key] ?? [];
        const stats = fieldPaths[concept]?.paths ?? [];
        return {
          key: f.key,
          name: f.name,
          type: f.type,
          paths: certified.map((p) => {
            // A verified stat's identity is (origin, path) — `sameVerified` in
            // domain-cache.ts, matched here by source + path alone (Review
            // Focus 3: a pruned or never-run path just has no match, never an error).
            const stat = stats.find((s) => s.source === 'verified' && s.origin === p.source && s.path === p.path);
            return {
              source: p.source,
              path: p.path,
              ...(p.provenOn ? { provenOn: p.provenOn } : {}),
              uses: (stat?.hits ?? 0) + (stat?.misses ?? 0),
              hits: stat?.hits ?? 0,
              ...(p.source === 'api' && stat?.lastUrl ? { container: stat.lastUrl } : {}),
            };
          }),
        };
      }),
      drift: drift ? { status: drift.status, results: drift.results } : null,
      driftedFieldNames: driftedKeys.map((key) => fields.find((f) => f.key === key)?.name ?? key),
      driftRunAt: drift?.runAt ? drift.runAt.toISOString() : null,
      lastRun: lastRun ? { status: lastRun.status, at: lastRun.createdAt.toISOString(), rows: lastRun.resultCount } : null,
      proofUrls: (row.verificationSet as { urls?: string[] } | null)?.urls ?? [],
    };
  }),
});
