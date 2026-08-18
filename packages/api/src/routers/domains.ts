import { z } from 'zod';
import { detectPathConflicts } from '@robot/scraper';
import { eq, sql, and } from 'drizzle-orm';
import { domains, sources, datasets, projects, orgs, domainIntelligence } from '@robot/db';
import { router, publicProcedure } from '../trpc';

export const domainsRouter = router({
  list: publicProcedure.query(async ({ ctx }) => {
    const results = await ctx.db.query.domains.findMany({
      orderBy: (domains, { asc }) => [asc(domains.name)],
    });

    return results;
  }),

  getById: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const domain = await ctx.db.query.domains.findFirst({
        where: eq(domains.id, input.id),
        with: {
          robotOverrides: true,
        },
      });

      if (!domain) {
        throw new Error(`Domain with id ${input.id} not found`);
      }

      return domain;
    }),

  create: publicProcedure
    .input(
      z.object({
        name: z.string().min(1).max(255),
        prefix: z.string().max(10).nullable().optional(),
        hasGotoOverride: z.boolean().optional(),
        hasSetZipCodeOverride: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [domain] = await ctx.db.insert(domains).values(input).returning();
      return domain;
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(255).optional(),
        prefix: z.string().max(10).nullable().optional(),
        hasGotoOverride: z.boolean().optional(),
        hasSetZipCodeOverride: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const [domain] = await ctx.db
        .update(domains)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(domains.id, id))
        .returning();

      if (!domain) {
        throw new Error(`Domain with id ${id} not found`);
      }

      return domain;
    }),

  listByProject: publicProcedure
    .input(z.object({ orgSlug: z.string(), projectSlug: z.string() }))
    .query(async ({ ctx, input }) => {
      const results = await ctx.db
        .selectDistinctOn([sql<string>`split_part(${sources.urlTemplate}, '/', 3)`], {
          hostname: sql<string>`split_part(${sources.urlTemplate}, '/', 3)`.as('hostname'),
          sourceCount: sql<number>`count(*) over (partition by split_part(${sources.urlTemplate}, '/', 3))::int`.as('source_count'),
        })
        .from(sources)
        .innerJoin(datasets, eq(sources.datasetId, datasets.id))
        .innerJoin(projects, eq(datasets.projectId, projects.id))
        .innerJoin(orgs, eq(projects.orgId, orgs.id))
        .where(and(
          eq(orgs.slug, input.orgSlug),
          eq(projects.slug, input.projectSlug),
          eq(sources.isSandbox, false),
        ));

      return results
        .filter((r) => r.hostname && r.hostname.length > 0)
        .map((r) => ({
          hostname: r.hostname.replace(/^www\./, ''),
          sourceCount: r.sourceCount,
        }));
    }),

  detailByProject: publicProcedure
    .input(z.object({
      orgSlug: z.string(),
      projectSlug: z.string(),
      domain: z.string(),
    }))
    .query(async ({ ctx, input }) => {
      const sourcesInDomain = await ctx.db
        .select({
          id: sources.id,
          slug: sources.slug,
          name: sources.name,
          urlTemplate: sources.urlTemplate,
          datasetSlug: datasets.slug,
          datasetName: datasets.name,
          inputStrategy: sources.inputStrategy,
          listingMode: sources.listingMode,
          createdAt: sources.createdAt,
        })
        .from(sources)
        .innerJoin(datasets, eq(sources.datasetId, datasets.id))
        .innerJoin(projects, eq(datasets.projectId, projects.id))
        .innerJoin(orgs, eq(projects.orgId, orgs.id))
        .where(and(
          eq(orgs.slug, input.orgSlug),
          eq(projects.slug, input.projectSlug),
          eq(sources.isSandbox, false),
          sql`split_part(${sources.urlTemplate}, '/', 3) IN (${input.domain}, ${'www.' + input.domain})`,
        ));

      const intelligence = await ctx.db.query.domainIntelligence.findFirst({
        where: (di, { eq: dieq }) => dieq(di.domain, input.domain),
      });

      return {
        hostname: input.domain,
        sources: sourcesInDomain,
        intelligence: intelligence ? {
          pageType: intelligence.pageType,
          totalRuns: intelligence.totalRuns,
          successfulRuns: intelligence.successfulRuns,
          consecutiveFailures: intelligence.consecutiveFailures,
          lastUsedAt: intelligence.lastUsedAt,
          lastVerifiedAt: intelligence.lastVerifiedAt,
        } : null,
      };
    }),

  // ─── Global DomainIntelligence views (read-only) ───────────────────────────
  intelligenceDetail: publicProcedure
    .input(z.object({ domain: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db.query.domainIntelligence.findMany({
        where: (di, { eq: dieq }) => dieq(di.domain, input.domain),
      });

      type PathLike = {
        path: string; source: string; hits: number; misses: number;
        lastValue: unknown; lastUsedAt: string;
      };
      const pageTypes = rows.map((r) => {
        const fieldPaths = (r.fieldPaths ?? {}) as Record<string, { paths?: PathLike[] }>;
        const selectors: Array<{
          field: string; source: string | null; hits: number; misses: number;
          hitRate: number; lastValue: unknown; lastUsedAt: string | null;
        }> = [];
        for (const [field, set] of Object.entries(fieldPaths)) {
          const paths = set?.paths ?? [];
          if (paths.length === 0) {
            selectors.push({ field, source: null, hits: 0, misses: 0, hitRate: 0, lastValue: null, lastUsedAt: null });
            continue;
          }
          for (const p of paths) {
            const total = p.hits + p.misses;
            selectors.push({
              field, source: p.source, hits: p.hits, misses: p.misses,
              hitRate: total > 0 ? Math.round((p.hits / total) * 100) : 0,
              lastValue: p.lastValue ?? null, lastUsedAt: p.lastUsedAt ?? null,
            });
          }
        }
        return {
          pageType: r.pageType,
          totalRuns: r.totalRuns,
          successfulRuns: r.successfulRuns,
          successRate: r.totalRuns > 0 ? Math.round((r.successfulRuns / r.totalRuns) * 100) : 0,
          lastUsedAt: r.lastUsedAt,
          lastVerifiedAt: r.lastVerifiedAt,
          hasJsonLd: r.hasJsonLd,
          hasNextData: r.hasNextData,
          apiEndpoints: (r.apiEndpoints ?? []) as unknown[],
          selectors,
          // Fields whose stored paths currently disagree about the value. This is
          // how a poisoned cache path announces itself — the cache has always
          // detected it and never surfaced it. Reported only; per CLAUDE.md,
          // degradation is flagged for human review and never auto-reset.
          conflicts: detectPathConflicts(
            (r.fieldPaths ?? {}) as Parameters<typeof detectPathConflicts>[0],
          ),
        };
      });

      const sourcesAcross = await ctx.db
        .select({
          id: sources.id,
          slug: sources.slug,
          name: sources.name,
          urlTemplate: sources.urlTemplate,
          projectSlug: projects.slug,
          projectName: projects.name,
          datasetName: datasets.name,
        })
        .from(sources)
        .innerJoin(datasets, eq(sources.datasetId, datasets.id))
        .innerJoin(projects, eq(datasets.projectId, projects.id))
        .where(and(
          eq(sources.isSandbox, false),
          sql`split_part(${sources.urlTemplate}, '/', 3) IN (${input.domain}, ${'www.' + input.domain})`,
        ));

      return { domain: input.domain, pageTypes, sources: sourcesAcross };
    }),

  intelligenceList: publicProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.query.domainIntelligence.findMany();

    type Agg = {
      domain: string;
      pageTypes: string[];
      totalRuns: number;
      successfulRuns: number;
      fields: Set<string>;
      lastVerifiedAt: Date;
    };
    const byDomain = new Map<string, Agg>();
    for (const r of rows) {
      const fieldPaths = (r.fieldPaths ?? {}) as Record<string, unknown>;
      const agg = byDomain.get(r.domain) ?? {
        domain: r.domain, pageTypes: [], totalRuns: 0, successfulRuns: 0,
        fields: new Set<string>(), lastVerifiedAt: r.lastVerifiedAt,
      };
      agg.pageTypes.push(r.pageType);
      agg.totalRuns += r.totalRuns;
      agg.successfulRuns += r.successfulRuns;
      for (const f of Object.keys(fieldPaths)) agg.fields.add(f);
      if (r.lastVerifiedAt > agg.lastVerifiedAt) agg.lastVerifiedAt = r.lastVerifiedAt;
      byDomain.set(r.domain, agg);
    }

    return [...byDomain.values()]
      .map((d) => ({
        domain: d.domain,
        pageTypes: [...d.pageTypes].sort(),
        totalRuns: d.totalRuns,
        successfulRuns: d.successfulRuns,
        successRate: d.totalRuns > 0 ? Math.round((d.successfulRuns / d.totalRuns) * 100) : 0,
        fieldCount: d.fields.size,
        lastVerifiedAt: d.lastVerifiedAt,
      }))
      .sort((a, b) => b.lastVerifiedAt.getTime() - a.lastVerifiedAt.getTime());
  }),
});
