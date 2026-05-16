import { z } from 'zod';
import { eq, sql, and, desc } from 'drizzle-orm';
import { projects, orgs, datasets, sources, runs } from '@robot/db';
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
        datasetCount: sql<number>`count(${datasets.id})::int`,
      })
      .from(projects)
      .leftJoin(datasets, eq(projects.id, datasets.projectId))
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
          datasetCount: sql<number>`count(${datasets.id})::int`,
        })
        .from(projects)
        .leftJoin(datasets, eq(projects.id, datasets.projectId))
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
          datasets: true,
        },
      });

      if (!project) {
        throw new Error(`Project not found: ${input.orgSlug}/${input.projectSlug}`);
      }

      return project;
    }),

  getWithStats: publicProcedure
    .input(z.object({ orgSlug: z.string(), projectSlug: z.string() }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({ projectId: projects.id })
        .from(projects)
        .innerJoin(orgs, eq(projects.orgId, orgs.id))
        .where(and(eq(orgs.slug, input.orgSlug), eq(projects.slug, input.projectSlug)))
        .limit(1);

      const row = rows[0];
      if (!row) return null;

      const project = await ctx.db.query.projects.findFirst({
        where: eq(projects.id, row.projectId),
      });
      if (!project) return null;

      const [datasetCount, sourceCount, runCount, lastRun] = await Promise.all([
        ctx.db
          .select({ c: sql<number>`count(*)::int` })
          .from(datasets)
          .where(eq(datasets.projectId, project.id))
          .then((r) => r[0]?.c ?? 0),
        ctx.db
          .select({ c: sql<number>`count(${sources.id})::int` })
          .from(sources)
          .innerJoin(datasets, eq(sources.datasetId, datasets.id))
          .where(eq(datasets.projectId, project.id))
          .then((r) => r[0]?.c ?? 0),
        ctx.db
          .select({ c: sql<number>`count(${runs.id})::int` })
          .from(runs)
          .innerJoin(sources, eq(runs.sourceId, sources.id))
          .innerJoin(datasets, eq(sources.datasetId, datasets.id))
          .where(eq(datasets.projectId, project.id))
          .then((r) => r[0]?.c ?? 0),
        ctx.db
          .select({
            id: runs.id,
            sourceId: runs.sourceId,
            sourceSlug: sources.slug,
            status: runs.status,
            createdAt: runs.createdAt,
            completedAt: runs.completedAt,
            resultCount: runs.resultCount,
          })
          .from(runs)
          .innerJoin(sources, eq(runs.sourceId, sources.id))
          .innerJoin(datasets, eq(sources.datasetId, datasets.id))
          .where(eq(datasets.projectId, project.id))
          .orderBy(desc(runs.createdAt))
          .limit(1)
          .then((r) => r[0] ?? null),
      ]);

      return { project, datasetCount, sourceCount, runCount, lastRun };
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
