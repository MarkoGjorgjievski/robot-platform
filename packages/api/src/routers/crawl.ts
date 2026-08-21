// Phase 1 of the v2 crawler over HTTP. Thin by design: every decision lives in
// @robot/scraper's crawl module; this file owns the DB writes and the tRPC
// boundary only.

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { PlaywrightBrowser } from '@robot/browser';
import { SchemaAgent } from '@robot/agent';
import { planRun, type PlannedItem, type OriginField } from '@robot/scraper';
import { db, runs, runItems, sources } from '@robot/db';
import { router, publicProcedure } from '../trpc';
import { claimNextItem } from '../crawl/claim-item.js';
import { markItemDone, markItemFailed } from '../crawl/record-outcome.js';
import { finaliseRun } from '../crawl/roll-up-run.js';
import { requeueStaleRunningItems } from '../crawl/requeue-stale.js';
import { executeRun } from '../crawl/execute-run.js';
import { extractItem } from '../crawl/extract-item.js';

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

/**
 * A rejection reaching startExecution's recovery path can be anything — a
 * genuine Error, a string, a bare object from a driver that doesn't use the
 * Error prototype. `.message` on a non-Error is undefined, and `undefined
 * .slice(...)` throws — from inside the very catch block whose job is to
 * report the failure safely. This never throws, for any input.
 */
export function safeErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Runs the loop outside the request. Deliberately not awaited: 200 items at
 * ~30s each is ~100 minutes, which no HTTP mutation can hold open. The honest
 * limit of having no job queue is that an api-server restart pauses the run —
 * `run_items` survives, so calling execute again resumes it.
 *
 * This function must never reject in a way that escapes to its caller as an
 * unhandled promise rejection — the caller deliberately does not await it, and
 * under default Node behaviour an unhandled rejection kills the process,
 * taking the whole api-server (and the dashboard it serves) down with it. So
 * every step of the failure path — reading the error, and recording it — is
 * itself guarded; the `.catch()` at the call site is belt-and-braces for
 * anything this function's own guards still missed.
 */
async function startExecution(runId: string, sourceId: string, schema: OriginField[]): Promise<void> {
  const browser = new PlaywrightBrowser();
  try {
    await browser.launch({ headless: true });
    const agent = new SchemaAgent();
    await executeRun(runId, {
      claim: (id) => claimNextItem(db, id),
      extractItem: (item) => extractItem(db, item, { browser, agent, sourceId, runId, schema }),
      onDone: (itemId, extractionId) => markItemDone(db, itemId, extractionId),
      onFailed: (itemId, message) => markItemFailed(db, itemId, message),
      isCancelled: async () => {
        const row = await db.query.runs.findFirst({ where: eq(runs.id, runId), columns: { status: true } });
        return row?.status === 'cancelling';
      },
      // No rowCount passed: finaliseRun derives it from the DB itself, so a
      // stale local counter from this loop can never overwrite a truer total.
      // `cancelled` IS threaded through — it's executeRun's own record of
      // whether the loop broke on a cancel check, and finaliseRun needs it to
      // roll a still-pending run up to 'cancelled' instead of 'extracting'.
      finalise: (_rowCount, cancelled) => finaliseRun(db, runId, cancelled),
    });
  } catch (err) {
    console.error(`[crawl] execution of run ${runId} failed:`, err);
    try {
      await db.update(runs)
        .set({ status: 'failed', errorMessage: safeErrorMessage(err).slice(0, 1000), completedAt: new Date() })
        .where(eq(runs.id, runId));
    } catch (recoveryErr) {
      // If the DB is what broke, recording the failure will break the same
      // way — that must not become a second, uncaught throw. There's nothing
      // more we can do here beyond logging; crawl.status will show the run
      // stuck at 'extracting', which is the honest state, and a restart or a
      // fixed DB lets a re-issued execute resume it.
      console.error(`[crawl] failed to record failure status for run ${runId}:`, recoveryErr);
    }
  } finally {
    await browser.close();
  }
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
        if (row.kind === 'listing') { counts.listing++; continue; }
        counts.detail++;
        // Same bug pattern crawl.status already had fixed: a listing item is
        // planning bookkeeping, already `done` before phase 2 ever runs.
        // Counting it into pending/done/failed here would inflate `done`
        // against a `detail` total that excludes it — exactly what produced
        // "2 of 1 extracted" on the dashboard before that fix.
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

  status: publicProcedure
    .input(z.object({ runId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const run = await ctx.db.query.runs.findFirst({
        where: eq(runs.id, input.runId),
        columns: { id: true, status: true, resultCount: true, errorMessage: true },
      });
      if (!run) throw new TRPCError({ code: 'NOT_FOUND', message: `Run ${input.runId} not found` });

      const rows = await ctx.db.query.runItems.findMany({
        where: eq(runItems.runId, input.runId),
        columns: { kind: true, status: true },
      });
      const counts = { pending: 0, running: 0, done: 0, failed: 0, listing: 0, detail: 0 };
      for (const row of rows) {
        if (row.kind === 'listing') { counts.listing++; continue; }
        counts.detail++;
        // Phase 2 never works listing items — they're planning bookkeeping,
        // already `done` before execute ever runs. Counting them here would
        // inflate `done` against a `detail` total that excludes them, which
        // is exactly what produced "2 of 1 extracted" on the dashboard.
        if (row.status in counts) counts[row.status as 'pending' | 'running' | 'done' | 'failed']++;
      }
      return { status: run.status, counts, rowCount: run.resultCount ?? 0, errorMessage: run.errorMessage };
    }),

  cancel: publicProcedure
    .input(z.object({ runId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const run = await ctx.db.query.runs.findFirst({
        where: eq(runs.id, input.runId), columns: { id: true },
      });
      if (!run) throw new TRPCError({ code: 'NOT_FOUND', message: `Run ${input.runId} not found` });
      // The loop checks between items, so pending work stays pending and resume
      // is the same mechanism as cancel.
      await ctx.db.update(runs).set({ status: 'cancelling' }).where(eq(runs.id, input.runId));
      return { status: 'cancelling' as const };
    }),

  execute: publicProcedure
    .input(z.object({
      runId: z.string().uuid(),
      retryFailed: z.boolean().optional(),
      /** Prepare the queue and return without running — used by tests. */
      dryRun: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const run = await ctx.db.query.runs.findFirst({
        where: eq(runs.id, input.runId),
        with: { source: { columns: { id: true, datasetId: true }, with: { dataset: { columns: { schema: true } } } } },
      });
      if (!run) throw new TRPCError({ code: 'NOT_FOUND', message: `Run ${input.runId} not found` });
      if (!run.source) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Run has no Source' });

      // An item abandoned at `running` — the api-server died mid-item — is
      // work nothing will ever pick up: `claimNextItem` claims `pending` only,
      // and `retryFailed` requeues `failed` only. Reclaiming it here, on every
      // entry rather than behind an opt-in flag, is what makes the documented
      // "call execute again" recovery actually reach it. The threshold inside
      // is ~50x one item's duration, so a live concurrent loop cannot lose a
      // claim to this.
      await requeueStaleRunningItems(ctx.db, input.runId);

      if (input.retryFailed) {
        await ctx.db.update(runItems)
          .set({ status: 'pending', error: null })
          .where(and(eq(runItems.runId, input.runId), eq(runItems.status, 'failed')));
      }

      // dryRun exists to test the requeue behaviour above without launching a
      // browser: it must be fully inert otherwise, so the status flip below —
      // the observable sign that a loop is running — happens only past this
      // return.
      if (input.dryRun) return { runId: input.runId, started: false };

      await ctx.db.update(runs).set({ status: 'extracting', startedAt: new Date() }).where(eq(runs.id, input.runId));

      // Returns immediately: hundreds of items at ~30s each outlives any HTTP
      // request. All state lives in run_items, so progress is read with
      // crawl.status and a crash resumes by calling execute again.
      //
      // Deliberately not awaited. startExecution guards its own failure path,
      // but this `.catch()` is a second line of defense: nothing thrown by a
      // background crawl may become an unhandled rejection that kills the
      // api-server process serving the dashboard.
      void startExecution(input.runId, run.source.id, (run.source.dataset?.schema ?? []) as OriginField[])
        .catch((err) => {
          console.error(`[crawl] startExecution rejected outside its own guards for run ${input.runId}:`, err);
        });
      return { runId: input.runId, started: true };
    }),
});
