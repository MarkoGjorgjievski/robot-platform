import { z } from 'zod';
import { eq, sql, and, desc } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { projects, orgs, datasets, sources, runs } from '@robot/db';
import { router, publicProcedure } from '../trpc';
import { slugify, uniqueSlug } from '../slug.js';
import { loadCurrentCertification } from '../verify/current-certification.js';

export const projectsRouter = router({
  list: publicProcedure.query(async ({ ctx }) => {
    const base = await ctx.db
      .select({
        id: projects.id,
        orgId: projects.orgId,
        name: projects.name,
        slug: projects.slug,
        description: projects.description,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
        datasetCount: sql<number>`count(${datasets.id})::int`,
        fieldCount: sql<number>`coalesce(sum(case when jsonb_typeof(${datasets.schema}) = 'array' then jsonb_array_length(${datasets.schema}) else 0 end), 0)::int`,
      })
      .from(projects)
      .leftJoin(datasets, eq(projects.id, datasets.projectId))
      .groupBy(projects.id)
      .orderBy(projects.name);

    const sourceRows = await ctx.db
      .select({ projectId: datasets.projectId, id: sources.id, schemaDefinition: sources.schemaDefinition, verificationSet: sources.verificationSet })
      .from(sources)
      .innerJoin(datasets, eq(sources.datasetId, datasets.id));

    const lastRuns = await ctx.db
      .select({
        projectId: datasets.projectId,
        createdAt: sql<Date>`max(${runs.createdAt})`,
      })
      .from(runs)
      .innerJoin(sources, eq(runs.sourceId, sources.id))
      .innerJoin(datasets, eq(sources.datasetId, datasets.id))
      .groupBy(datasets.projectId);

    const verifiedByProject = new Map<string, number>();
    const countByProject = new Map<string, number>();
    for (const s of sourceRows) {
      countByProject.set(s.projectId, (countByProject.get(s.projectId) ?? 0) + 1);
      const cert = await loadCurrentCertification(ctx.db, s.id);
      if (cert) verifiedByProject.set(s.projectId, (verifiedByProject.get(s.projectId) ?? 0) + 1);
    }

    const lastRunByProject = new Map<string, { createdAt: Date; resultCount: number | null }>();
    for (const r of lastRuns) {
      const createdAt = r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt);
      const run = await ctx.db.query.runs.findFirst({
        where: eq(runs.createdAt, createdAt),
        columns: { createdAt: true, resultCount: true },
      });
      if (run) lastRunByProject.set(r.projectId, run);
    }

    return base.map((p) => ({
      ...p,
      sourceCount: countByProject.get(p.id) ?? 0,
      verifiedSourceCount: verifiedByProject.get(p.id) ?? 0,
      lastRun: lastRunByProject.get(p.id) ?? null,
    }));
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

  /**
   * The customer names the project (spec 2, 5.2). It gets one dataset named
   * after it: the project's field list and output table (spec 4.1). Lives
   * under the single default org until auth arrives.
   */
  create: publicProcedure
    .input(z.object({ name: z.string().trim().min(1).max(255), description: z.string().trim().max(2000).optional() }))
    .mutation(async ({ ctx, input }) => {
      const org = await ctx.db.query.orgs.findFirst({ where: eq(orgs.slug, 'default') });
      if (!org) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'No default org. Run `pnpm db:seed` first.' });

      const slug = await uniqueSlug(slugify(input.name), async (s) =>
        !!(await ctx.db.query.projects.findFirst({ where: and(eq(projects.orgId, org.id), eq(projects.slug, s)), columns: { id: true } })),
      );

      return ctx.db.transaction(async (tx) => {
        const [project] = await tx
          .insert(projects)
          .values({ orgId: org.id, name: input.name, slug, description: input.description ?? null })
          .returning({ id: projects.id, slug: projects.slug, name: projects.name });
        const [dataset] = await tx
          .insert(datasets)
          .values({ projectId: project!.id, name: input.name, slug, schema: [] })
          .returning({ id: datasets.id });
        return { ...project!, datasetId: dataset!.id };
      });
    }),

  rename: publicProcedure
    .input(z.object({ projectId: z.string().uuid(), name: z.string().trim().min(1).max(255) }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .update(projects)
        .set({ name: input.name, updatedAt: new Date() })
        .where(eq(projects.id, input.projectId))
        .returning({ id: projects.id, name: projects.name });
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: `Project ${input.projectId} not found` });
      return row;
    }),
});
