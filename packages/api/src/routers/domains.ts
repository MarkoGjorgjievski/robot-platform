import { z } from 'zod';
import { eq, sql, and } from 'drizzle-orm';
import { domains, sources, datasets, projects, orgs } from '@robot/db';
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
});
