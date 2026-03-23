import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { sources, collections, projects, orgs, domains } from '@robot/db';
import { router, publicProcedure } from '../trpc';

export const sourcesRouter = router({
  listByCollection: publicProcedure
    .input(z.object({ collectionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const results = await ctx.db
        .select({
          id: sources.id,
          collectionId: sources.collectionId,
          domainId: sources.domainId,
          domainName: domains.name,
          name: sources.name,
          slug: sources.slug,
          country: sources.country,
          locale: sources.locale,
          currency: sources.currency,
          dataCenter: sources.dataCenter,
          proxyType: sources.proxyType,
          loginPool: sources.loginPool,
          maximumInputs: sources.maximumInputs,
          runnerFramework: sources.runnerFramework,
          schemaValues: sources.schemaValues,
          variant: sources.variant,
          robotTemplate: sources.robotTemplate,
          parameters: sources.parameters,
          isActive: sources.isActive,
          createdAt: sources.createdAt,
          updatedAt: sources.updatedAt,
        })
        .from(sources)
        .leftJoin(domains, eq(sources.domainId, domains.id))
        .where(eq(sources.collectionId, input.collectionId))
        .orderBy(sources.name);

      return results;
    }),

  getBySlug: publicProcedure
    .input(
      z.object({
        orgSlug: z.string(),
        projectSlug: z.string(),
        collectionSlug: z.string(),
        sourceSlug: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          sourceId: sources.id,
          orgId: orgs.id,
          orgName: orgs.name,
          collectionId: collections.id,
          collectionName: collections.name,
          collectionSchema: collections.schema,
          domainId: sources.domainId,
          domainName: domains.name,
        })
        .from(sources)
        .innerJoin(collections, eq(sources.collectionId, collections.id))
        .innerJoin(projects, eq(collections.projectId, projects.id))
        .innerJoin(orgs, eq(projects.orgId, orgs.id))
        .leftJoin(domains, eq(sources.domainId, domains.id))
        .where(
          and(
            eq(orgs.slug, input.orgSlug),
            eq(projects.slug, input.projectSlug),
            eq(collections.slug, input.collectionSlug),
            eq(sources.slug, input.sourceSlug),
          ),
        )
        .limit(1);

      const row = rows[0];
      if (!row) {
        throw new Error(
          `Source not found: ${input.orgSlug}/${input.projectSlug}/${input.collectionSlug}/${input.sourceSlug}`,
        );
      }

      const [source] = await ctx.db
        .select()
        .from(sources)
        .where(eq(sources.id, row.sourceId))
        .limit(1);

      if (!source) {
        throw new Error(
          `Source not found: ${input.orgSlug}/${input.projectSlug}/${input.collectionSlug}/${input.sourceSlug}`,
        );
      }

      return {
        ...source,
        orgId: row.orgId,
        orgName: row.orgName,
        collectionId: row.collectionId,
        collectionName: row.collectionName,
        collectionSchema: row.collectionSchema,
        domainName: row.domainName,
      };
    }),

  create: publicProcedure
    .input(
      z.object({
        collectionId: z.string().uuid(),
        domainId: z.string().uuid().nullish(),
        name: z.string().min(1).max(255),
        slug: z.string().min(1).max(255),
        country: z.string().min(1).max(10),
        locale: z.string().max(10).nullish(),
        currency: z.string().max(10).nullish(),
        dataCenter: z.string().max(10).nullish(),
        proxyType: z.string().max(50).nullish(),
        loginPool: z.string().max(100).nullish(),
        maximumInputs: z.number().int().positive().nullish(),
        runnerFramework: z.string().max(50).nullish(),
        schemaValues: z.record(z.string()).optional().default({}),
        variant: z.string().max(50).optional(),
        robotTemplate: z.string().max(255).optional(),
        parameters: z.record(z.unknown()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [source] = await ctx.db.insert(sources).values(input).returning();
      return source;
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        isActive: z.boolean().optional(),
        domainId: z.string().uuid().nullish(),
        name: z.string().min(1).max(255).optional(),
        slug: z.string().min(1).max(255).optional(),
        country: z.string().min(1).max(10).optional(),
        locale: z.string().max(10).nullish(),
        currency: z.string().max(10).nullish(),
        dataCenter: z.string().max(10).nullish(),
        proxyType: z.string().max(50).nullish(),
        loginPool: z.string().max(100).nullish(),
        maximumInputs: z.number().int().positive().nullish(),
        runnerFramework: z.string().max(50).nullish(),
        variant: z.string().max(50).optional(),
        robotTemplate: z.string().max(255).optional(),
        parameters: z.record(z.unknown()).optional(),
        schemaValues: z.record(z.string()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, parameters, ...rest } = input;

      // If parameters is provided, merge with existing (don't replace)
      // This prevents one tab's save from clobbering another tab's data
      let mergedParams = parameters;
      if (parameters) {
        const existing = await ctx.db.query.sources.findFirst({
          where: eq(sources.id, id),
          columns: { parameters: true },
        });
        const currentParams = (existing?.parameters ?? {}) as Record<string, unknown>;
        mergedParams = { ...currentParams, ...parameters };
      }

      const [source] = await ctx.db
        .update(sources)
        .set({ ...rest, ...(mergedParams !== undefined ? { parameters: mergedParams } : {}), updatedAt: new Date() })
        .where(eq(sources.id, id))
        .returning();

      if (!source) {
        throw new Error(`Source with id ${id} not found`);
      }

      return source;
    }),
});
