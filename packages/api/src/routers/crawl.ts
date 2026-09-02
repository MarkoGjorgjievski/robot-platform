// Phase 1 of the v2 crawler over HTTP. Thin by design: every decision lives in
// @robot/scraper's crawl module; this file owns the DB writes and the tRPC
// boundary only.

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { and, eq, isNull } from 'drizzle-orm';
import { db, runs, runItems, sources } from '@robot/db';
import { router, publicProcedure } from '../trpc';
import { requeueStaleRunningItems } from '../crawl/requeue-stale.js';
import { markRunExtracting } from '../crawl/mark-extracting.js';
import { planSource, safeErrorMessage, formatPlanLog } from '../crawl/plan-source.js';
import { effectiveSchema } from '../crawl/effective-schema.js';
import { startExecution } from '../crawl/start-execution.js';
import { PROBE_SAMPLE_LIMIT } from '../crawl/probe.js';
import { loadRunCoverage } from '../crawl/load-run-coverage.js';
import {
  classifyFields, deriveBackfillItems, planBackfillRun, EST_AI_COST_PER_PAGE_USD, type BackfillItemPlan,
} from '../crawl/backfill.js';
import { runRepairSweep } from '../crawl/repair-sweep.js';

// `crawl-execute.test.ts` imports `safeErrorMessage` from this module's own
// path — re-exported from its new home (`plan-source.ts`, mvp-simplification
// task 7) rather than re-derived, so both `plan` (below, via `planSource`)
// and `startExecution`'s recovery path share exactly one implementation.
export { safeErrorMessage, formatPlanLog };

/**
 * The statuses `crawl.cancel` will act on: a run phase 2 is working, or one
 * already asked to stop (so a second Stop is idempotent rather than an error).
 * Deliberately the same set `isRunActive` calls active on the dashboard side —
 * cancel is a message to a running loop, and the other statuses have no loop
 * to send it to. `planning` is excluded too: phase 1 never checks for a
 * cancel, so accepting one there would report a stop that never happens.
 */
const CANCELLABLE_STATUSES = ['extracting', 'cancelling'];

export const crawlRouter = router({
  // The planning body itself lives in `planSource` (../crawl/plan-source.js,
  // mvp-simplification task 7) — `sources.confirm` calls the exact same
  // function at full budget (`probe: false`), so there is exactly one
  // implementation of "what a plan run does" rather than two that can drift.
  plan: publicProcedure
    .input(z.object({
      sourceId: z.string().uuid(),
      /** A quick, single-row planning pass to sanity-check a Source before committing it to a full crawl. */
      probe: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      return planSource(ctx.db, input.sourceId, { probe: input.probe === true });
    }),
  /**
   * Probe-and-sample: a probe plan (`planSource(..., { probe: true })`) followed
   * immediately by a small, fire-and-forget execution of what it found — spec
   * §3's "one run, small and bounded" step 1. `crawl.execute`'s own guard
   * comments (above `startExecution`, `start-execution.ts`) apply verbatim
   * here: the loop is deliberately not awaited, so this mutation returns as
   * soon as planning is done and the dashboard polls `crawl.status`/`crawl.items`
   * for the sample rows as they land.
   *
   * If planning itself failed — every input errored, or nothing was planned —
   * there is no work list for execution to pick up, and starting the loop
   * anyway would just claim nothing and finalise immediately. Returning the
   * plan outcome's warnings/errors as-is is what lets the dashboard's
   * diagnosis panel (`diagnose-run.ts`) explain the failure instead of
   * silently reporting an empty sample.
   */
  probeAndSample: publicProcedure
    .input(z.object({ sourceId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Finding 3 (final-review-findings.md): neither guard below existed —
      // the "Probe & sample" button reappears on every mount while
      // unconfirmed, so a double-click, two tabs, or a re-mount fired a
      // fresh PAID probe every time.
      const source = await ctx.db.query.sources.findFirst({
        where: eq(sources.id, input.sourceId),
        columns: { id: true, confirmedAt: true },
      });
      if (!source) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Source ${input.sourceId} not found` });
      }
      // A confirmed Source is either already crawling for real or already
      // crawled — probing it again makes no sense, and there is no
      // "existing run" to sensibly hand back the way the duplicate-probe
      // guard below does.
      if (source.confirmedAt) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `Source ${input.sourceId} is already confirmed; probeAndSample only applies before confirmation`,
        });
      }
      // An unfinished probe already exists for this Source: refuse to start a
      // SECOND one (planSource never runs, so nothing is spent) and hand back
      // the one already in flight instead — the caller (source-setup.tsx)
      // navigates on `runId` alone, so this reads to the operator as "took me
      // to the probe already running" rather than an error.
      //
      // Live-bug fix (found post-merge): this used to key "in flight" off a
      // status allowlist, which treated `'planned'` as always non-terminal.
      // `'planned'` is NOT unambiguous — `planSource` (plan-source.ts) writes
      // it for two different situations: a probe genuinely mid-flight, about
      // to be flipped to `'extracting'` a few lines later in THIS mutation,
      // and a 0-item listing walk that will never reach that flip at all
      // (the `outcome.itemCount > 0` guard below skips straight past it) —
      // which is exactly as terminal as `'completed'`, just spelled
      // differently. A status list can't tell those two `'planned'`s apart;
      // `completed_at` can, because `finaliseRun`'s own rule (and
      // `planSource`'s identical one) is that `completed_at` is set if and
      // only if nothing further will touch the run. Keying on `IS NULL` here
      // is the same terminal marker every other reader in this codebase
      // already trusts, not a second, competing definition of "done".
      const existingProbe = await ctx.db.query.runs.findFirst({
        where: and(
          eq(runs.sourceId, input.sourceId),
          eq(runs.inputLabel, 'probe'),
          isNull(runs.completedAt),
        ),
        columns: { id: true },
      });
      if (existingProbe) {
        return {
          runId: existingProbe.id,
          status: 'in-progress' as const,
          itemCount: 0,
          warnings: [],
          errors: [],
        };
      }

      const outcome = await planSource(ctx.db, input.sourceId, { probe: true });

      // `status === 'failed'` covers "every input errored"; `itemCount === 0`
      // additionally covers the case planSource itself doesn't mark failed —
      // an empty InputSet, or a probe row that planned nothing without any
      // input erroring — where a work list of zero items is still nothing for
      // execution to claim.
      if (outcome.status === 'planned' && outcome.itemCount > 0) {
        const execSource = await ctx.db.query.sources.findFirst({
          where: eq(sources.id, input.sourceId),
          // selectorsJson: a Scratch source's schema falls back here when its
          // dataset schema is empty — see effective-schema.ts. Mirrors
          // `execute`'s own lookup exactly, so a probe source and a confirmed
          // source resolve their schema the same way.
          columns: { id: true, selectorsJson: true },
          with: { dataset: { columns: { schema: true } } },
        });
        // planSource already confirmed sourceId exists (it would have thrown
        // NOT_FOUND otherwise) — this can only be null if the Source was
        // deleted in the gap between the two queries, which is not this
        // mutation's job to recover from; skipping execution is the safe
        // response to a Source that is no longer there.
        if (execSource) {
          // `planSource` leaves the run at `planned` — `execute` is the ONLY
          // procedure that otherwise ever flips a run to `extracting`, and
          // both `crawl.cancel` (CANCELLABLE_STATUSES) and the dashboard's
          // `isRunActive` key off that status. Without this, a probe's
          // execution window was invisible to both: Stop refused with
          // "not active" and the polling UI read the run as idle while a
          // browser was, in fact, working it. Called before the
          // fire-and-forget `startExecution` below, exactly as `execute`
          // orders it — the flip is the visible, synchronous half of
          // starting a loop, and it must be persisted before the background
          // work (which the caller does not await) begins.
          await markRunExtracting(ctx.db, outcome.runId);
          // Deliberately not awaited — see start-execution.ts's own doc
          // comment for why this must never become an unhandled rejection,
          // and `execute`'s identical `.catch()` below for the pattern this
          // copies.
          void startExecution(outcome.runId, execSource.id, effectiveSchema(execSource), PROBE_SAMPLE_LIMIT)
            .catch((err) => {
              console.error(`[crawl] startExecution rejected outside its own guards for run ${outcome.runId}:`, err);
            });
        }
      }

      return {
        runId: outcome.runId,
        status: outcome.status,
        itemCount: outcome.itemCount,
        warnings: outcome.warnings,
        errors: outcome.errors,
      };
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
          // Task 10 (repair-engine): the run page's ResultsTable renders a
          // confirmed-absent cell as "not on page" instead of a plain blank
          // — it needs to know which fields were confirmed absent per item,
          // and this is the only reader of the work list that can supply it.
          absentFields: true,
        },
      });

      // `running` is counted here, exactly as crawl.status counts it. Omitting
      // it made the two readers of one run disagree about what it contained:
      // pending + done + failed stopped summing to `detail` the moment an item
      // stalled, so a run with work in flight read as if items had simply
      // vanished. A per-status breakdown that fails to account for every item
      // is how "2 of 1 extracted" reached this branch once already.
      const counts = { listing: 0, detail: 0, pending: 0, running: 0, done: 0, failed: 0 };
      for (const row of rows) {
        if (row.kind === 'listing') { counts.listing++; continue; }
        counts.detail++;
        // Same bug pattern crawl.status already had fixed: a listing item is
        // planning bookkeeping, already `done` before phase 2 ever runs.
        // Counting it into pending/done/failed here would inflate `done`
        // against a `detail` total that excludes it — exactly what produced
        // "2 of 1 extracted" on the dashboard before that fix.
        if (row.status in counts) counts[row.status as 'pending' | 'running' | 'done' | 'failed']++;
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
        where: eq(runs.id, input.runId), columns: { id: true, status: true },
      });
      if (!run) throw new TRPCError({ code: 'NOT_FOUND', message: `Run ${input.runId} not found` });
      // Only a run something is actually working can be stopped. `cancelling`
      // is a request addressed to a loop: written on a run with no loop behind
      // it, nothing ever observes it and nothing ever finalises it, while
      // `isRunActive` reports it as active and the dashboard polls it forever.
      // That is a permanent trap, and it was reachable on any run in any
      // status — including a `completed` one — from the CLI or any API client.
      if (!CANCELLABLE_STATUSES.includes(run.status)) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `Run ${input.runId} is not active (status: ${run.status}) and cannot be cancelled`,
        });
      }
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
      /** Stop claiming once extracted + failed reach this many items; the rest stay pending. */
      limit: z.number().int().positive().max(100).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const run = await ctx.db.query.runs.findFirst({
        where: eq(runs.id, input.runId),
        with: {
          source: {
            // selectorsJson: a Scratch source's schema falls back here when
            // its dataset schema is empty — see effective-schema.ts.
            columns: { id: true, datasetId: true, selectorsJson: true },
            with: { dataset: { columns: { schema: true } } },
          },
        },
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
      // The count is returned to the caller, not just acted on: the dashboard's
      // "Resume N stalled" button appears the moment an item is `running`,
      // while the reclaim only acts past the threshold — so inside that window
      // a click did real work (a chromium launch) and changed nothing visible.
      // Reporting what was actually reclaimed is what lets the UI say so.
      const requeued = await requeueStaleRunningItems(ctx.db, input.runId);

      if (input.retryFailed) {
        await ctx.db.update(runItems)
          .set({ status: 'pending', error: null })
          .where(and(eq(runItems.runId, input.runId), eq(runItems.status, 'failed')));
      }

      // dryRun exists to test the requeue behaviour above without launching a
      // browser: it must be fully inert otherwise, so the status flip below —
      // the observable sign that a loop is running — happens only past this
      // return.
      if (input.dryRun) return { runId: input.runId, started: false, requeued };

      // Guarded: `markRunExtracting` flips anything but a `cancelling` run, so
      // a second execute arriving between a Stop and the loop noticing it
      // cannot silently void that Stop. Re-entry itself stays permitted —
      // crash-resume is exactly this call arriving on an `extracting` run —
      // and a run whose status did NOT flip still gets a loop, because that
      // loop's first between-items check is what finally settles a
      // `cancelling` run whose original loop already died.
      await markRunExtracting(ctx.db, input.runId);

      // Returns immediately: hundreds of items at ~30s each outlives any HTTP
      // request. All state lives in run_items, so progress is read with
      // crawl.status and a crash resumes by calling execute again.
      //
      // Deliberately not awaited. startExecution guards its own failure path,
      // but this `.catch()` is a second line of defense: nothing thrown by a
      // background crawl may become an unhandled rejection that kills the
      // api-server process serving the dashboard.
      //
      // Finding 1 (final-review-findings.md): `execute` is the ONLY entry
      // point for every non-initial execution of a backfill run — Retry-N-
      // failed, Extract-N-pending, crash-resume — none of which go through
      // `crawl.backfill`'s own `mergeToParent: true` call. `run` was already
      // loaded above with no column restriction, so `run.parentRunId` is
      // free to read here: a set parentRunId means this run IS a backfill
      // run, and every one of its executions must merge into the parent or
      // a healed row lands only on the backfill run's own extraction,
      // breaking R4's "'done' MEANS merged".
      void startExecution(
        input.runId,
        run.source.id,
        effectiveSchema(run.source),
        input.limit,
        run.parentRunId ? { mergeToParent: true } : undefined,
      )
        .catch((err) => {
          console.error(`[crawl] startExecution rejected outside its own guards for run ${input.runId}:`, err);
        });
      return { runId: input.runId, started: true, requeued };
    }),

  /**
   * Per-run coverage report: how many detail items filled each field, and
   * which items still have gaps. Read-only, AI-free — pure computation over
   * what's already in the DB (`coverage.ts`), consumed verbatim by the
   * repair-run tasks that follow this one.
   */
  coverage: publicProcedure
    .input(z.object({ runId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return loadRunCoverage(ctx.db, input.runId);
    }),

  /**
   * A read-only preview of what a backfill run against this run would do:
   * how many gap items it would re-fetch, an "up to" cost estimate (a
   * backfill item may resolve for free at a cheaper extraction tier — see
   * EST_AI_COST_PER_PAGE_USD's doc comment), and the dead/healthy
   * classification of the target fields. No mutation, no AI — pure
   * derivation (backfill.ts) over the same coverage load `crawl.coverage`
   * uses.
   */
  backfillPreview: publicProcedure
    .input(z.object({
      runId: z.string().uuid(),
      targetFields: z.array(z.string().min(1)).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const cov = await loadRunCoverage(ctx.db, input.runId);
      const targetNames = input.targetFields ?? cov.fields.filter((f) => f.missing > 0).map((f) => f.name);
      const items = deriveBackfillItems(cov.gapItems, targetNames);
      return {
        // One detail fetch per gap item — a page count and an item count are
        // the same number here, so only the page count is reported.
        pages: items.length,
        estCostUsd: Number((items.length * EST_AI_COST_PER_PAGE_USD).toFixed(2)),
        fields: classifyFields(cov.fields, targetNames),
      };
    }),

  /**
   * Creates a backfill run from `input.runId`'s gaps and fires its execution
   * merged back into the parent run's items (`startExecution`'s
   * `mergeToParent`, Task 5). Six guards precede the write, in order — see
   * task-6-brief.md for the exact contract this mirrors.
   *
   * Guard 5 requires `deadFieldStrategy` whenever a dead field is in scope;
   * guard 6 below is where that value finally matters — `repair_sweep` stages
   * the run through `runRepairSweep` (sample, evaluate against the parent's
   * merged rows, then sweep or stop honest), while `full_focus` (and the
   * no-dead-fields case, where the value is irrelevant) takes the plain path
   * straight through `startExecution`.
   */
  backfill: publicProcedure
    .input(z.object({
      runId: z.string().uuid(),
      targetFields: z.array(z.string().min(1)).optional(),
      itemIds: z.array(z.string().uuid()).optional(),
      deadFieldStrategy: z.enum(['repair_sweep', 'full_focus']).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Guard 1: mirrors `execute`'s own run+source guard (crawl.ts:297-298)
      // — a backfill needs the same source `execute` would.
      const parent = await ctx.db.query.runs.findFirst({
        where: eq(runs.id, input.runId),
        with: {
          source: {
            columns: { id: true, selectorsJson: true, datasetId: true },
            with: { dataset: { columns: { schema: true } } },
          },
        },
      });
      if (!parent) throw new TRPCError({ code: 'NOT_FOUND', message: `Run ${input.runId} not found` });
      if (!parent.source) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Run has no Source' });

      // Guard 1b (Finding 3, final-review-findings.md): a backfill run's own
      // rows are deliberately partial — every non-target field reads dead by
      // design, not because the page lacks it. Backfilling a backfill run is
      // reachable (this guard was missing) and strands data/money: the
      // grandchild's merges fold into the BACKFILL run's own items, never
      // into the real parent, whose coverage stays gappy and whose pages
      // stay re-purchasable indefinitely. Refuse, naming the real parent so
      // the caller can retarget the request instead of guessing.
      if (parent.inputLabel === 'backfill') {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `Run ${input.runId} is itself a backfill run — backfill its parent run ${parent.parentRunId} instead`,
        });
      }

      // Guard 2: a still-executing parent has no settled coverage to
      // backfill from — its gaps are still moving under it.
      if (!parent.completedAt) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'parent run is still executing' });
      }

      // Guard 3: in-flight reuse — same `completed_at IS NULL` terminal
      // marker `probeAndSample`'s duplicate-probe guard uses above, keyed on
      // `parentRunId` instead of `(sourceId, inputLabel)`.
      const existing = await ctx.db.query.runs.findFirst({
        where: and(eq(runs.parentRunId, input.runId), isNull(runs.completedAt)),
        columns: { id: true },
      });
      if (existing) {
        return { backfillRunId: existing.id, status: 'in-progress' as const };
      }

      // Guard 4: derive the work list (Tasks 2-3 helpers) — the same
      // coverage load and derivation `backfillPreview` uses above, so a
      // preview and the run it describes never drift.
      const cov = await loadRunCoverage(ctx.db, input.runId);
      const targetNames = input.targetFields ?? cov.fields.filter((f) => f.missing > 0).map((f) => f.name);
      const items = deriveBackfillItems(cov.gapItems, targetNames, input.itemIds);
      if (items.length === 0) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'nothing to backfill — no items are missing the requested fields',
        });
      }

      // Guard 5: a dead field (fill < DEAD_FIELD_FILL_THRESHOLD) among the
      // targets means the cached path is broken, not merely unlucky — the
      // caller must say how to handle that before any budget is spent.
      const fieldClasses = classifyFields(cov.fields, targetNames);
      if (fieldClasses.some((f) => f.classification === 'dead') && !input.deadFieldStrategy) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'deadFieldStrategy required: fields with a broken path are in scope',
        });
      }

      // `deadFieldStrategy` is never written to the DB (controller Ruling
      // R5, task 7) — it only ever matters for the lifetime of THIS request,
      // to pick which fire-and-forget path runs below. There is no durable
      // "mid repair-sweep" marker anywhere: if the process dies between the
      // sample execute and the sweep execute, the run simply finalises
      // 'partial' (runRepairSweep step 1's own F1 semantics) and sits there,
      // honest and terminal, until a human re-runs backfillPreview and
      // re-issues backfill — that IS the recovery path, not a bug to guard
      // against with more state.
      const deadFields = fieldClasses.filter((f) => f.classification === 'dead').map((f) => f.name);
      const isRepairSweep = input.deadFieldStrategy === 'repair_sweep' && deadFields.length > 0;

      // Finding 6 (final-review-findings.md): a repair-sweep's sample stage
      // (repair-sweep.ts step 1) claims the first REPAIR_SAMPLE_COUNT items
      // off THIS run — without ordering, a mixed-target backfill whose first
      // claims happen to be healthy-only gaps spuriously reports
      // repair_failed. Passing the dead-field intersection as `orderFirst`
      // (planBackfillRun, backfill.ts) makes the sample actually land on
      // dead-target items. `undefined` (not repair-sweep, or no dead field
      // in scope) keeps the plain path's inputIndex copy unchanged.
      const deadSet = new Set(deadFields);
      const orderFirst = isRepairSweep
        ? (item: BackfillItemPlan) => item.targetFields.some((f) => deadSet.has(f))
        : undefined;

      // Guard 6: plan the run, flip it to extracting, and fire its execution
      // the same way `execute` above does — not awaited (see startExecution's
      // own doc comment for why this must never become an unhandled
      // rejection), merged back into the parent's items via `mergeToParent`.
      const backfillRunId = await planBackfillRun(ctx.db, input.runId, parent.source.id, items, targetNames, orderFirst);
      await markRunExtracting(ctx.db, backfillRunId);

      // Bound to a const rather than read as `parent.source.id` inside the
      // closure below: a property narrowing (`parent.source` is not null,
      // established by guard 1) does not survive into a callback, but a
      // const does — same reasoning as effective-schema.ts's `inputSet`.
      const sourceId = parent.source.id;
      const schema = effectiveSchema(parent.source);
      const execute = (opts?: { limit?: number }) =>
        startExecution(backfillRunId, sourceId, schema, opts?.limit, { mergeToParent: true });

      if (isRepairSweep) {
        void runRepairSweep(ctx.db, backfillRunId, deadFields, execute).catch((err) => {
          console.error(`[crawl] runRepairSweep rejected outside its own guards for run ${backfillRunId}:`, err);
        });
      } else {
        void execute().catch((err) => {
          console.error(`[crawl] startExecution rejected outside its own guards for run ${backfillRunId}:`, err);
        });
      }

      return { backfillRunId, items: items.length };
    }),
});
