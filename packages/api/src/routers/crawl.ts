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
          persisted = await ctx.db.insert(runItems).values(
            outcome.items.map((item: PlannedItem) => ({
              runId: run!.id,
              kind: item.kind,
              url: item.url,
              inputIndex: item.inputIndex,
              inputValues: item.inputValues,
              listingValues: item.listingValues,
              pageNumber: item.pageNumber,
            })),
          ).onConflictDoNothing().returning({ kind: runItems.kind });
        }

        const listingPages = persisted.filter((i) => i.kind === 'listing').length;
        const itemCount = persisted.length - listingPages;

        await ctx.db.update(runs)
          .set({ status: 'planned', completedAt: new Date() })
          .where(eq(runs.id, run!.id));

        return {
          runId: run!.id,
          itemCount,
          listingPages,
          warnings: outcome.warnings,
          errors: outcome.errors,
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
});
