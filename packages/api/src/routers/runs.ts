import { z } from 'zod';
import { eq, desc, asc, sql } from 'drizzle-orm';
import { runs, captures, extractions, datasets, projects, sources } from '@robot/db';
import { router, publicProcedure, protectedProcedure } from '../trpc';
import { runInOrg, sourceInOrg } from '../auth/scope.js';

const VIEW_ROW_CAP = 500;

export const runsRouter = router({
  getWithDetails: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await runInOrg(ctx, input.id);
      const run = await ctx.db.query.runs.findFirst({
        where: eq(runs.id, input.id),
        with: {
          source: {
            // confirmedAt: the confirm gate (mvp-simplification task 10) shows
            // its Yes/No gate only for a probe run on a still-unconfirmed
            // Source; without it every probe run would gate forever, even
            // after the operator already said yes on an earlier one.
            columns: {
              id: true, slug: true, name: true, urlTemplate: true, datasetId: true,
              selectorsJson: true, confirmedAt: true,
            },
            with: {
              dataset: {
                columns: { id: true, slug: true, name: true, projectId: true },
                with: {
                  project: {
                    columns: { id: true, slug: true, name: true, orgId: true },
                    with: { org: { columns: { id: true, slug: true, name: true } } },
                  },
                },
              },
            },
          },
        },
      });
      if (!run) return null;

      const [latestCapture, extractionRows, [rowTotal], backfillRuns] = await Promise.all([
        ctx.db.query.captures.findFirst({
          where: eq(captures.runId, input.id),
          orderBy: [desc(captures.createdAt)],
        }),
        // Capped at the DB layer: a 5000-extraction crawl must not pull every
        // extraction's data into API-server memory just to discard 90% of it
        // after slicing. Ordering by createdAt then id gives a stable order
        // even when extractions share a createdAt (e.g. issued in one
        // transaction, where Postgres now() is transaction-start-time and
        // identical across statements).
        ctx.db.query.extractions.findMany({
          where: eq(extractions.runId, input.id),
          orderBy: [asc(extractions.createdAt), asc(extractions.id)],
          columns: { data: true, confidence: true },
          limit: VIEW_ROW_CAP,
        }),
        // The true row total, independent of the cap above. One extraction can
        // hold several rows (a single-page run: one extraction, N rows) or many
        // extractions can hold one row each (phase 2: N extractions, one row
        // each) — jsonb_array_length summed in SQL is exact in both shapes and
        // never requires reading the row data itself into memory.
        ctx.db
          .select({ total: sql<number>`coalesce(sum(jsonb_array_length(${extractions.data})), 0)::int` })
          .from(extractions)
          .where(eq(extractions.runId, input.id)),
        // The reverse of `parentRunId` — which backfill runs (if any) were
        // spawned to repair THIS run's gaps, so its page can render a
        // "Backfilled by run <short-id>" line without a second round-trip
        // once the operator navigates there. Kept tiny on purpose: id and
        // status are all the breadcrumb line needs.
        ctx.db.query.runs.findMany({
          where: eq(runs.parentRunId, input.id),
          columns: { id: true, status: true },
        }),
      ]);

      const allRows = extractionRows.flatMap((e) => (Array.isArray(e.data) ? e.data : []));

      return {
        run: {
          id: run.id,
          status: run.status,
          startedAt: run.startedAt,
          completedAt: run.completedAt,
          resultCount: run.resultCount,
          errorMessage: run.errorMessage,
          inputLabel: run.inputLabel,
          createdAt: run.createdAt,
          // `formatPlanLog`'s free-text "warning: .../error: input N: ..."
          // lines — the only place a PERSISTED run's plan warnings/errors
          // survive (the mutation response is gone once the page reloads).
          // `parseRunLog` (dashboard) recovers the original strings for the
          // probe confirm gate's evidence summary and diagnosis panel.
          logs: run.logs,
          // Task 10 (repair-engine): the run this one was spawned to
          // backfill, and the fields it was targeting — null/null on an
          // ordinary run, both set on a backfill run (`planBackfillRun`,
          // backfill.ts). Drives the "Backfill of run <short-id> · fields:
          // ..." breadcrumb.
          parentRunId: run.parentRunId,
          targetFields: run.targetFields as string[] | null,
        },
        source: run.source,
        // The reverse breadcrumb — see the Promise.all query above.
        backfillRuns,
        // id + url only. `screenshotPath` used to ride along here, but no
        // live path ever writes `captures.screenshot_path` — the crawl
        // capture writer (extract-item.ts) records url/metadata only, and
        // analyze screenshots live on `selectorsJson.screenshotUrl` — so the
        // dashboard block rendering it could never appear.
        capture: latestCapture ? {
          id: latestCapture.id,
          url: latestCapture.url,
        } : null,
        extraction: extractionRows.length > 0 ? {
          // Phase 2 writes one extraction per URL, so a run's rows are all of
          // them in extraction order. Capped for the view: the table shows 500,
          // and a 5000-item crawl must not ship megabytes to a browser. The CSV
          // export is the way to get everything.
          data: allRows.slice(0, VIEW_ROW_CAP),
          confidence: extractionRows[0]!.confidence,
          // The true total, not allRows.length — the extraction query above is
          // itself capped, so allRows can undercount once a run's extraction
          // count exceeds VIEW_ROW_CAP (the phase 2 shape: one extraction per
          // row).
          rowCount: rowTotal?.total ?? 0,
        } : null,
      };
    }),

  listBySource: publicProcedure
    .input(z.object({ sourceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await sourceInOrg(ctx, input.sourceId);
      const results = await ctx.db.query.runs.findMany({
        where: eq(runs.sourceId, input.sourceId),
        columns: {
          id: true, status: true, inputLabel: true,
          startedAt: true, completedAt: true, resultCount: true,
          errorMessage: true, createdAt: true,
        },
        orderBy: [desc(runs.createdAt)],
        limit: 50,
      });
      return results;
    }),

  /**
   * Every run in the session's organisation, newest first (spec 2026-09-21
   * §5, the org-wide Runs page). Session-only — the old dashboard has no such
   * screen, so there is no `orgSlug` to shim. Scoped through the run's
   * website → project → org in one join; a run with no website (a legacy row)
   * belongs to nobody and is not listed, as `runInOrg` also rules.
   */
  listByOrg: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        id: runs.id, status: runs.status, inputLabel: runs.inputLabel,
        startedAt: runs.startedAt, completedAt: runs.completedAt, resultCount: runs.resultCount,
        errorMessage: runs.errorMessage, createdAt: runs.createdAt, costUsd: runs.costUsd,
        projectName: projects.name, projectSlug: projects.slug,
        websiteName: sources.name, websiteSlug: sources.slug,
      })
      .from(runs)
      .innerJoin(sources, eq(runs.sourceId, sources.id))
      .innerJoin(datasets, eq(sources.datasetId, datasets.id))
      .innerJoin(projects, eq(datasets.projectId, projects.id))
      .where(eq(projects.orgId, ctx.session.org.id))
      .orderBy(desc(runs.createdAt))
      .limit(100);
    return rows.map(({ projectName, projectSlug, websiteName, websiteSlug, costUsd, ...run }) => ({
      ...run,
      costUsd: Number(costUsd),
      project: { name: projectName, slug: projectSlug },
      website: { name: websiteName, slug: websiteSlug },
    }));
  }),
});
