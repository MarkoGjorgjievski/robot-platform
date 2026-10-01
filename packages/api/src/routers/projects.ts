import { z } from 'zod';
import { eq, sql, and, desc, inArray } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { projects, datasets, sources, runs } from '@robot/db';
import { router, publicProcedure, type Context } from '../trpc';
import { slugify, uniqueSlug } from '../slug.js';
import { resolveOrg } from '../auth/session.js';
import { loadCurrentCertification, loadFieldCurrency } from '../verify/current-certification.js';
import { contractFields } from '../contract.js';
import { loadProjectExport } from '../export/load-project-export.js';

/** How many rows the Output screen renders. The file behind the download has them all. */
const OUTPUT_ROW_CAP = 500;

/**
 * The project by slug, inside the resolved org (spec 2026-09-21 §6 as restated:
 * the procedures a rebuilt screen calls take the org from the session; the old
 * dashboard still names it). Null when it is not there — callers decide between
 * NOT_FOUND and a null answer.
 * TODO(cut-over, spec 2026-09-21 §2): drop the `'default'` fallback with the old dashboard.
 */
async function findProjectInOrg(ctx: Context, projectSlug: string, orgSlug?: string) {
  const org = await resolveOrg(ctx, orgSlug ?? 'default');
  return ctx.db.query.projects.findFirst({ where: and(eq(projects.orgId, org.id), eq(projects.slug, projectSlug)) });
}

export const projectsRouter = router({
  // TODO(cut-over, spec 2026-09-21 §2): the `orgSlug ?? 'default'` fallback exists only for the
  // old dashboard, which calls this with no input at all. Once it is retired, drop the fallback
  // and let a session-less, orgSlug-less call fail UNAUTHORIZED like every other org-scoped route.
  list: publicProcedure
    .input(z.object({ orgSlug: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const org = await resolveOrg(ctx, input?.orgSlug ?? 'default');
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
          // Counts keyed entries with `e ? 'key'`, same as `contractFields`,
          // and excludes axis entries (spec 2026-10-01 §2, `kind: 'axis'`)
          // the same way — an axis has a `key` too but is never a field.
          fieldCount: sql<number>`coalesce(sum((select count(*) from jsonb_array_elements(case when jsonb_typeof(${datasets.schema}) = 'array' then ${datasets.schema} else '[]'::jsonb end) e where e ? 'key' and coalesce(e->>'kind', '') <> 'axis')), 0)::int`,
        })
        .from(projects)
        .leftJoin(datasets, eq(projects.id, datasets.projectId))
        .where(eq(projects.orgId, org.id))
        .groupBy(projects.id)
        .orderBy(projects.name);

      const sourceRows = await ctx.db
        .select({ projectId: datasets.projectId, id: sources.id })
        .from(sources)
        .innerJoin(datasets, eq(sources.datasetId, datasets.id));

      const lastRuns = await ctx.db
        .selectDistinctOn([datasets.projectId], {
          projectId: datasets.projectId,
          createdAt: runs.createdAt,
          resultCount: runs.resultCount,
          // The run status dot is the app's one carried signal (spec 2026-09-21 §4):
          // without the status every project's last run renders grey, which is the
          // one thing the dot exists not to do.
          status: runs.status,
          completedAt: runs.completedAt,
        })
        .from(runs)
        .innerJoin(sources, eq(runs.sourceId, sources.id))
        .innerJoin(datasets, eq(sources.datasetId, datasets.id))
        .orderBy(datasets.projectId, desc(runs.createdAt), desc(runs.id));

      const verifiedByProject = new Map<string, number>();
      const countByProject = new Map<string, number>();
      for (const s of sourceRows) {
        countByProject.set(s.projectId, (countByProject.get(s.projectId) ?? 0) + 1);
        const cert = await loadCurrentCertification(ctx.db, s.id);
        if (cert) verifiedByProject.set(s.projectId, (verifiedByProject.get(s.projectId) ?? 0) + 1);
      }

      const lastRunByProject = new Map<string, { createdAt: Date; resultCount: number | null; status: string; completedAt: Date | null }>();
      for (const r of lastRuns) {
        lastRunByProject.set(r.projectId, { createdAt: r.createdAt, resultCount: r.resultCount, status: r.status, completedAt: r.completedAt });
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
    .input(z.object({ projectSlug: z.string(), orgSlug: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const project = await findProjectInOrg(ctx, input.projectSlug, input.orgSlug);
      if (!project) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Project not found: ${input.projectSlug}` });
      }

      const full = await ctx.db.query.projects.findFirst({
        where: eq(projects.id, project.id),
        with: {
          datasets: true,
        },
      });

      if (!full) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Project not found: ${input.projectSlug}` });
      }

      return full;
    }),

  /**
   * The project home in one round trip (spec 2026-09-21 §5): the project, its
   * contract, and every website with how many fields are verified on it and
   * its last run. "Verified" is per-field currency — `loadFieldCurrency` — so
   * a website that has certified 3 of 8 fields says so, rather than reading as
   * unverified until every field is.
   */
  get: publicProcedure
    .input(z.object({ projectSlug: z.string().min(1), orgSlug: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const project = await findProjectInOrg(ctx, input.projectSlug, input.orgSlug);
      if (!project) throw new TRPCError({ code: 'NOT_FOUND', message: `Project ${input.projectSlug} not found` });

      const dataset = await ctx.db.query.datasets.findFirst({
        where: eq(datasets.projectId, project.id),
        orderBy: (d, { asc }) => [asc(d.createdAt)],
        columns: { id: true, schema: true, variantMode: true },
      });
      // `projects.create` always makes the dataset; a project without one is a
      // legacy row, and the home reads as empty rather than failing.
      const fields = dataset ? contractFields(dataset.schema) : [];

      const siteRows = dataset
        ? await ctx.db
            .select({ id: sources.id, slug: sources.slug, name: sources.name, url: sources.urlTemplate })
            .from(sources)
            .where(eq(sources.datasetId, dataset.id))
            .orderBy(sources.name)
        : [];

      const lastRuns = siteRows.length
        ? await ctx.db
            .selectDistinctOn([runs.sourceId], {
              sourceId: runs.sourceId,
              status: runs.status,
              createdAt: runs.createdAt,
              completedAt: runs.completedAt,
              resultCount: runs.resultCount,
            })
            .from(runs)
            .where(inArray(runs.sourceId, siteRows.map((s) => s.id)))
            .orderBy(runs.sourceId, desc(runs.createdAt), desc(runs.id))
        : [];
      const lastRunBySource = new Map(lastRuns.map((r) => [r.sourceId!, { status: r.status, createdAt: r.createdAt, completedAt: r.completedAt, resultCount: r.resultCount }]));

      const websites = await Promise.all(
        siteRows.map(async (s) => ({
          ...s,
          verifiedFields: (await loadFieldCurrency(ctx.db, s.id)).currentKeys.length,
          lastRun: lastRunBySource.get(s.id) ?? null,
        })),
      );

      return {
        id: project.id,
        name: project.name,
        slug: project.slug,
        datasetId: dataset?.id ?? null,
        createdAt: project.createdAt,
        // Variants setting (spec 2026-10-01 §2): 'ignore' for a legacy project without a dataset.
        variantMode: dataset?.variantMode ?? 'ignore',
        fields,
        websites,
      };
    }),

  /** The Output screen (spec 2026-09-21 §5): the project export, capped for the browser. The file has everything. */
  output: publicProcedure
    .input(z.object({ projectSlug: z.string().min(1), orgSlug: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const project = await findProjectInOrg(ctx, input.projectSlug, input.orgSlug);
      if (!project) throw new TRPCError({ code: 'NOT_FOUND', message: `Project ${input.projectSlug} not found` });
      // Narrow, but real: the project was found a line ago, and one deleted in
      // between should still read as gone rather than as a server fault.
      const x = await loadProjectExport(ctx.db, project.id);
      if (!x) throw new TRPCError({ code: 'NOT_FOUND', message: `Project ${input.projectSlug} not found` });
      return { ...x, rows: x.rows.slice(0, OUTPUT_ROW_CAP) };
    }),

  getWithStats: publicProcedure
    .input(z.object({ projectSlug: z.string(), orgSlug: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const project = await findProjectInOrg(ctx, input.projectSlug, input.orgSlug);
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
   * in the session's org — see the TODO on `list` above for the `default` shim.
   */
  create: publicProcedure
    .input(z.object({ name: z.string().trim().min(1).max(255), description: z.string().trim().max(2000).optional(), orgSlug: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const org = await resolveOrg(ctx, input.orgSlug ?? 'default');

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

  /**
   * A project outside the resolved org is NOT_FOUND, same as if it never
   * existed, rather than renameable by anyone who knows its id — the same rule
   * `delete` enforces, and this is the other write in the set.
   * TODO(cut-over, spec 2026-09-21 §2): the `'default'` fallback exists only for the
   * old dashboard, which calls this with no session at all. Once it is retired, drop
   * the fallback and require a session here too.
   */
  rename: publicProcedure
    .input(z.object({ projectId: z.string().uuid(), name: z.string().trim().min(1).max(255) }))
    .mutation(async ({ ctx, input }) => {
      const org = await resolveOrg(ctx, 'default');
      const project = await ctx.db.query.projects.findFirst({ where: eq(projects.id, input.projectId), columns: { id: true, orgId: true } });
      if (!project || project.orgId !== org.id) throw new TRPCError({ code: 'NOT_FOUND', message: `Project ${input.projectId} not found` });
      const [row] = await ctx.db
        .update(projects)
        .set({ name: input.name, updatedAt: new Date() })
        .where(eq(projects.id, input.projectId))
        .returning({ id: projects.id, name: projects.name });
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: `Project ${input.projectId} not found` });
      return row;
    }),

  /**
   * Test and cleanup use only for now: cascades datasets, sources and runs,
   * and bypasses the confirmed-source refusal that `sources.delete` enforces.
   * A project outside the resolved org is NOT_FOUND, same as if it never
   * existed, rather than deletable by anyone who knows its id.
   * TODO(cut-over, spec 2026-09-21 §2): the `'default'` fallback exists only for the
   * old dashboard, which calls this with no session at all (its smoke-test cleanup
   * included). Once it is retired, drop the fallback and require a session here too.
   */
  delete: publicProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const org = await resolveOrg(ctx, 'default');
      const project = await ctx.db.query.projects.findFirst({ where: eq(projects.id, input.projectId), columns: { id: true, orgId: true } });
      if (!project || project.orgId !== org.id) throw new TRPCError({ code: 'NOT_FOUND', message: `Project ${input.projectId} not found` });
      const rows = await ctx.db.delete(projects).where(eq(projects.id, input.projectId)).returning({ id: projects.id });
      return { deleted: rows.length > 0 };
    }),
});
