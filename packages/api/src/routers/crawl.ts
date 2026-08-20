// Phase 1 of the v2 crawler over HTTP. Thin by design: every decision lives in
// @robot/scraper's crawl module; this file owns the DB writes and the tRPC
// boundary only.

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { PlaywrightBrowser } from '@robot/browser';
import { SchemaAgent } from '@robot/agent';
import { planRun, type PlannedItem } from '@robot/scraper';
import { runs, runItems, sources } from '@robot/db';
import { router, publicProcedure } from '../trpc';

/** Warnings + errors as one free-text block, or null when planning was clean. */
export function formatPlanLog(
  warnings: string[],
  errors: Array<{ inputIndex: number; message: string }>,
): string | null {
  const lines = [
    ...warnings.map((w) => `warning: ${w}`),
    ...errors.map((e) => `error: input ${e.inputIndex}: ${e.message}`),
  ];
  return lines.length > 0 ? lines.join('\n') : null;
}

export const crawlRouter = router({
  plan: publicProcedure
    .input(z.object({ sourceId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const source = await ctx.db.query.sources.findFirst({
        where: eq(sources.id, input.sourceId),
        with: { dataset: { columns: { schema: true } }, inputSet: { columns: { columns: true, rows: true } } },
      });
      if (!source) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Source ${input.sourceId} not found` });
      }
      if (!source.inputSet) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: `Source ${input.sourceId} has no InputSet to plan from` });
      }

      // Nothing has been written yet, so a failure above leaves no trace to clean up.
      const [run] = await ctx.db.insert(runs).values({
        sourceId: source.id,
        status: 'planning',
        startedAt: new Date(),
        inputLabel: (source.urlTemplate ?? source.name).slice(0, 200),
      }).returning({ id: runs.id });

      // From here on, the run row exists: every exit path (including a launch
      // failure) must land it in a terminal status, and the browser — whether
      // or not it ever launched — must be closed.
      const browser = new PlaywrightBrowser();
      try {
        await browser.launch({ headless: true });

        const outcome = await planRun(
          {
            source: {
              listingMode: source.listingMode,
              inputStrategy: (source.inputStrategy ?? 'direct') as 'direct' | 'template' | 'category' | 'search',
              urlTemplate: source.urlTemplate,
              budget: source.budget,
            },
            schema: ((source.dataset?.schema ?? []) as Array<{ name: string; type: string }>),
            inputSet: {
              columns: (source.inputSet.columns ?? []) as Array<{ name: string; primary?: boolean; propagate?: boolean }>,
              rows: (source.inputSet.rows ?? []) as Array<Record<string, unknown>>,
            },
          },
          { browser, agent: new SchemaAgent() },
        );

        // onConflictDoNothing() is the dedupe backstop for a URL surfaced twice
        // (e.g. two input rows landing on the same listing entry) — it cannot
        // throw on the unique (run_id, url) constraint. .returning() reports
        // only the rows actually written, so the counts below describe what
        // was persisted, not what planRun merely proposed.
        let persisted: Array<{ kind: string }> = [];
        if (outcome.items.length > 0) {
          const now = new Date();
          persisted = await ctx.db.insert(runItems).values(
            outcome.items.map((item: PlannedItem) => ({
              runId: run!.id,
              kind: item.kind,
              url: item.url,
              inputIndex: item.inputIndex,
              inputValues: item.inputValues,
              listingValues: item.listingValues,
              pageNumber: item.pageNumber,
              // A listing item is not work waiting to happen: planning ALREADY
              // fetched and processed that page. Leaving it `pending` would park
              // rows in a queue phase 2 only ever claims `kind='detail'` from,
              // and any status rollup that forgot to filter `kind` would read
              // a finished run as unfinished.
              ...(item.kind === 'listing'
                ? { status: 'done' as const, completedAt: now }
                : { status: 'pending' as const }),
            })),
          ).onConflictDoNothing().returning({ kind: runItems.kind });
        }

        const listingPages = persisted.filter((i) => i.kind === 'listing').length;
        const itemCount = persisted.length - listingPages;

        // Every input errored and nothing was planned: there is no work list, so
        // calling this run `planned` invites phase 2 to run on nothing and hides
        // the failure behind a green status.
        const allInputsFailed =
          outcome.inputs.length > 0 &&
          outcome.inputs.every((i) => i.status === 'error') &&
          itemCount === 0;

        // Warnings and errors go to runs.logs, not runs.errorMessage: Plan B's
        // DB-polling crawl.status can only see what is persisted, and logs is
        // the free-text "what happened during this run" field. errorMessage is
        // the fatal-reason channel the dashboard renders as a red banner — a
        // `planned` run that merely carried warnings must not light that up. It
        // is set below only when the run genuinely failed.
        const logs = formatPlanLog(outcome.warnings, outcome.errors);

        await ctx.db.update(runs)
          .set({
            status: allInputsFailed ? 'failed' : 'planned',
            logs,
            errorMessage: allInputsFailed
              ? `planning failed for all ${outcome.inputs.length} input(s)`
              : null,
            completedAt: new Date(),
          })
          .where(eq(runs.id, run!.id));

        return {
          runId: run!.id,
          status: allInputsFailed ? 'failed' : 'planned',
          itemCount,
          listingPages,
          warnings: outcome.warnings,
          errors: outcome.errors,
          inputs: outcome.inputs,
          cacheWarm: outcome.cacheWarm,
        };
      } catch (err) {
        await ctx.db.update(runs)
          .set({ status: 'failed', errorMessage: (err as Error).message, completedAt: new Date() })
          .where(eq(runs.id, run!.id));
        throw err;
      } finally {
        await browser.close();
      }
    }),
  /**
   * The work list a plan produced — what phase 2 will fetch, before it fetches it.
   *
   * Listing items first (in page order), then the detail URLs they discovered, so
   * the shape of the crawl reads top to bottom: which pages were walked, and what
   * each one yielded.
   */
  items: publicProcedure
    .input(z.object({ runId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db.query.runItems.findMany({
        where: eq(runItems.runId, input.runId),
        columns: {
          id: true, kind: true, url: true, status: true, pageNumber: true,
          inputIndex: true, listingValues: true, error: true, completedAt: true,
        },
      });

      const counts = { listing: 0, detail: 0, pending: 0, done: 0, failed: 0 };
      for (const row of rows) {
        if (row.kind === 'listing') counts.listing++;
        if (row.kind === 'detail') counts.detail++;
        if (row.status === 'pending') counts.pending++;
        if (row.status === 'done') counts.done++;
        if (row.status === 'failed') counts.failed++;
      }

      const items = [...rows].sort((a, b) => {
        if (a.inputIndex !== b.inputIndex) return a.inputIndex - b.inputIndex;
        if (a.kind !== b.kind) return a.kind === 'listing' ? -1 : 1;
        return (a.pageNumber ?? 0) - (b.pageNumber ?? 0);
      });

      return { items, counts };
    }),
});
