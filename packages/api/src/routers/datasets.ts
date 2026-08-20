import { z } from 'zod';
import { eq, sql, and } from 'drizzle-orm';
import { datasets, projects, orgs, sources } from '@robot/db';
import { router, publicProcedure } from '../trpc';

/** One Dataset schema field. `origin` says WHERE the field is resolved; absent means 'detail'. */
export const datasetSchemaFieldSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  required: z.boolean().optional(),
  description: z.string().optional(),
  origin: z.enum(['detail', 'listing', 'input', 'system']).optional(),
  input_column: z.string().optional(),
});

export const datasetsRouter = router({
  listByProject: publicProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const results = await ctx.db
        .select({
          id: datasets.id,
          projectId: datasets.projectId,
          name: datasets.name,
          slug: datasets.slug,
          description: datasets.description,
          schema: datasets.schema,
          createdAt: datasets.createdAt,
          updatedAt: datasets.updatedAt,
          sourceCount: sql<number>`count(${sources.id})::int`,
        })
        .from(datasets)
        .leftJoin(sources, eq(datasets.id, sources.datasetId))
        .where(eq(datasets.projectId, input.projectId))
        .groupBy(datasets.id)
        .orderBy(datasets.name);

      return results;
    }),

  getBySlug: publicProcedure
    .input(
      z.object({
        orgSlug: z.string(),
        projectSlug: z.string(),
        datasetSlug: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({ datasetId: datasets.id })
        .from(datasets)
        .innerJoin(projects, eq(datasets.projectId, projects.id))
        .innerJoin(orgs, eq(projects.orgId, orgs.id))
        .where(
          and(
            eq(orgs.slug, input.orgSlug),
            eq(projects.slug, input.projectSlug),
            eq(datasets.slug, input.datasetSlug),
          ),
        )
        .limit(1);

      const row = rows[0];
      if (!row) {
        throw new Error(
          `Dataset not found: ${input.orgSlug}/${input.projectSlug}/${input.datasetSlug}`,
        );
      }

      const dataset = await ctx.db.query.datasets.findFirst({
        where: eq(datasets.id, row.datasetId),
        with: {
          sources: true,
        },
      });

      if (!dataset) {
        throw new Error(
          `Dataset not found: ${input.orgSlug}/${input.projectSlug}/${input.datasetSlug}`,
        );
      }

      return dataset;
    }),

  create: publicProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        name: z.string().min(1).max(255),
        slug: z.string().min(1).max(255),
        description: z.string().nullable().optional(),
        schema: z.union([z.record(z.unknown()), z.array(z.unknown())]).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [dataset] = await ctx.db.insert(datasets).values(input).returning();
      return dataset;
    }),

  updateSchema: publicProcedure
    .input(
      z.object({
        datasetId: z.string().uuid(),
        schema: z.array(datasetSchemaFieldSchema),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [updated] = await ctx.db
        .update(datasets)
        .set({ schema: input.schema })
        .where(eq(datasets.id, input.datasetId))
        .returning();
      return updated;
    }),
});
