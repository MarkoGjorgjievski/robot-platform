import { z } from 'zod';
import { eq, sql, and } from 'drizzle-orm';
import { collections, projects, orgs, sources } from '@robot/db';
import { router, publicProcedure } from '../trpc';

export const collectionsRouter = router({
  listByProject: publicProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const results = await ctx.db
        .select({
          id: collections.id,
          projectId: collections.projectId,
          name: collections.name,
          slug: collections.slug,
          description: collections.description,
          schema: collections.schema,
          createdAt: collections.createdAt,
          updatedAt: collections.updatedAt,
          sourceCount: sql<number>`count(${sources.id})::int`,
        })
        .from(collections)
        .leftJoin(sources, eq(collections.id, sources.collectionId))
        .where(eq(collections.projectId, input.projectId))
        .groupBy(collections.id)
        .orderBy(collections.name);

      return results;
    }),

  getBySlug: publicProcedure
    .input(
      z.object({
        orgSlug: z.string(),
        projectSlug: z.string(),
        collectionSlug: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({ collectionId: collections.id })
        .from(collections)
        .innerJoin(projects, eq(collections.projectId, projects.id))
        .innerJoin(orgs, eq(projects.orgId, orgs.id))
        .where(
          and(
            eq(orgs.slug, input.orgSlug),
            eq(projects.slug, input.projectSlug),
            eq(collections.slug, input.collectionSlug),
          ),
        )
        .limit(1);

      const row = rows[0];
      if (!row) {
        throw new Error(
          `Collection not found: ${input.orgSlug}/${input.projectSlug}/${input.collectionSlug}`,
        );
      }

      const collection = await ctx.db.query.collections.findFirst({
        where: eq(collections.id, row.collectionId),
        with: {
          sources: true,
        },
      });

      if (!collection) {
        throw new Error(
          `Collection not found: ${input.orgSlug}/${input.projectSlug}/${input.collectionSlug}`,
        );
      }

      return collection;
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
      const [collection] = await ctx.db.insert(collections).values(input).returning();
      return collection;
    }),

  updateSchema: publicProcedure
    .input(
      z.object({
        collectionId: z.string().uuid(),
        schema: z.array(
          z.object({
            name: z.string().min(1),
            type: z.string().min(1),
            required: z.boolean().optional(),
            description: z.string().optional(),
          }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [updated] = await ctx.db
        .update(collections)
        .set({ schema: input.schema })
        .where(eq(collections.id, input.collectionId))
        .returning();
      return updated;
    }),
});
