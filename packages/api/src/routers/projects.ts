import { z } from 'zod';
import { eq, sql, and } from 'drizzle-orm';
import { projects, orgs, collections } from '@robot/db';
import { router, publicProcedure } from '../trpc';

export const projectsRouter = router({
  list: publicProcedure.query(async ({ ctx }) => {
    const results = await ctx.db
      .select({
        id: projects.id,
        orgId: projects.orgId,
        name: projects.name,
        slug: projects.slug,
        description: projects.description,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
        collectionCount: sql<number>`count(${collections.id})::int`,
      })
      .from(projects)
      .leftJoin(collections, eq(projects.id, collections.projectId))
      .groupBy(projects.id)
      .orderBy(projects.name);

    return results;
  }),

  listByOrg: publicProcedure
    .input(z.object({ orgId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const results = await ctx.db
        .select({
          id: projects.id,
          orgId: projects.orgId,
          name: projects.name,
          slug: projects.slug,
          description: projects.description,
          createdAt: projects.createdAt,
          updatedAt: projects.updatedAt,
          collectionCount: sql<number>`count(${collections.id})::int`,
        })
        .from(projects)
        .leftJoin(collections, eq(projects.id, collections.projectId))
        .where(eq(projects.orgId, input.orgId))
        .groupBy(projects.id)
        .orderBy(projects.name);

      return results;
    }),

  getBySlug: publicProcedure
    .input(z.object({ orgSlug: z.string(), projectSlug: z.string() }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({ projectId: projects.id })
        .from(projects)
        .innerJoin(orgs, eq(projects.orgId, orgs.id))
        .where(and(eq(orgs.slug, input.orgSlug), eq(projects.slug, input.projectSlug)))
        .limit(1);

      const row = rows[0];
      if (!row) {
        throw new Error(`Project not found: ${input.orgSlug}/${input.projectSlug}`);
      }

      const project = await ctx.db.query.projects.findFirst({
        where: eq(projects.id, row.projectId),
        with: {
          collections: true,
        },
      });

      if (!project) {
        throw new Error(`Project not found: ${input.orgSlug}/${input.projectSlug}`);
      }

      return project;
    }),

  create: publicProcedure
    .input(
      z.object({
        orgId: z.string().uuid(),
        name: z.string().min(1).max(255),
        slug: z.string().min(1).max(255),
        description: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [project] = await ctx.db.insert(projects).values(input).returning();
      return project;
    }),
});
