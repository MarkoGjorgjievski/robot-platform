// packages/api/src/crawl/plan-source.ts
// Phase 1's planning body — extracted out of `crawl.ts`'s `plan` procedure
// (mvp-simplification task 7) so `sources.confirm` can invoke the exact same
// logic at full budget instead of duplicating it. `crawl.ts`'s `plan`
// procedure is now a thin wrapper over this; `probe` behaviour (row slicing,
// PROBE_BUDGET, the `inputLabel: 'probe'` run label) is preserved exactly.

import { TRPCError } from '@trpc/server';
import { and, eq, sql } from 'drizzle-orm';
import { SchemaAgent, snapshotUsage, cappedAgent, openCapLedger, isCapReached, type CapLedger } from '@robot/agent';
import { planRun, type PlannedItem, type PlanInputReport } from '@robot/scraper';
import { CAP_REACHED_MESSAGE } from '@robot/scraper/customer-copy';
import { runs, runItems, sources } from '@robot/db';
import type { db as Database } from '@robot/db';
import { withBrowserSession } from '../browser-session.js';
import { PROBE_BUDGET } from './probe.js';
import { effectiveSchema } from './effective-schema.js';
import { addRunCost, costSince } from './record-run-cost.js';
import { jobStopped } from '../jobs/context.js';
import { orgCapState, PLAN_CALL_USD } from '../metering/cap-state.js';
import { orgIdForSource } from '../export/org-for-export.js';

/** The run was closed (stalled, stopped) before planning could write it: nothing is written (final review M2). */
export class PlanningClosedError extends Error {
  constructor(runId: string) {
    super(`Run ${runId} is no longer planning; its plan was not written.`);
    this.name = 'PlanningClosedError';
  }
}

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
 * Appends one free-text line to `runs.logs` (a text column), separated from
 * whatever is already there by `\n` — the same line shape `formatPlanLog`
 * produces, so `parseRunLog` (dashboard) picks up an appended `warning: ...`
 * line exactly as it would one planSource wrote at run creation. Read-modify-
 * write done in SQL (`coalesce(logs || '\n', '') || line`) rather than
 * fetch-then-set from the caller, so a concurrent appender can never clobber
 * this one's line.
 */
export async function appendRunLog(
  db: typeof Database,
  runId: string,
  line: string,
): Promise<void> {
  await db.update(runs)
    .set({ logs: sql`coalesce(${runs.logs} || ${'\n'}, '') || ${line}` })
    .where(eq(runs.id, runId));
}

export type PlanSourceResult = {
  runId: string;
  status: 'planned' | 'failed';
  itemCount: number;
  listingPages: number;
  warnings: string[];
  errors: Array<{ inputIndex: number; message: string }>;
  inputs: PlanInputReport[];
  cacheWarm: boolean;
};

/** The source as planning reads it, or the precondition error it has always thrown. */
export async function assertPlannable(db: typeof Database, sourceId: string) {
  const source = await db.query.sources.findFirst({
    where: eq(sources.id, sourceId),
    with: { dataset: { columns: { schema: true } }, inputSet: { columns: { columns: true, rows: true } } },
  });
  if (!source) {
    throw new TRPCError({ code: 'NOT_FOUND', message: `Source ${sourceId} not found` });
  }
  if (!source.inputSet) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: `Source ${sourceId} has no InputSet to plan from` });
  }
  return { ...source, inputSet: source.inputSet };
}

/**
 * The `planning` run row a plan fills in. A probe run's label overrides the
 * usual "what was this run pointed at" text: `crawl.status` readers need to
 * tell a probe apart from a real crawl at a glance, and 'probe' is
 * unambiguous where a URL template or source name is not.
 */
export function planningRunValues(source: { id: string; urlTemplate: string | null; name: string }, probe: boolean) {
  return {
    sourceId: source.id,
    status: 'planning' as const,
    startedAt: new Date(),
    inputLabel: probe ? 'probe' : (source.urlTemplate ?? source.name).slice(0, 200),
  };
}

/**
 * With `opts.runId`, the planning run row already exists (written with its `plan` job by
 * `planViaWorker`, spec 2026-10-23 §4.4) and is filled in; without, one is inserted here.
 */
export async function planSource(
  db: typeof Database,
  sourceId: string,
  opts: { probe?: boolean; runId?: string } = {},
): Promise<PlanSourceResult> {
  const source = await assertPlannable(db, sourceId);
  // Bound here rather than read inside the planRun closure below: a
  // property narrowing (`source.inputSet` is not null) does not survive
  // into a callback, but a const does.
  const inputSet = source.inputSet;

  const probe = opts.probe === true;

  // A run closed before its job started (a stalled plan claimed again) is not walked: nothing would be written.
  if (opts.runId) {
    const existing = await db.query.runs.findFirst({ where: eq(runs.id, opts.runId), columns: { status: true } });
    if (existing?.status !== 'planning') throw new PlanningClosedError(opts.runId);
  }

  // Nothing has been written yet, so a failure above leaves no trace to clean up.
  const [run] = opts.runId
    ? [{ id: opts.runId }]
    : await db.insert(runs).values(planningRunValues(source, probe)).returning({ id: runs.id });
  const before = snapshotUsage();
  let ledger: CapLedger | undefined;

  // From here on, the run row exists: every exit path (including a launch
  // failure) must land it in a terminal status, and the browser — whether
  // or not it ever launched — must be closed.
  //
  // `withBrowserSession` owns that close, on every path including a
  // `launch()` that throws part-way. It replaces a hand-rolled
  // `finally { await browser.close(); }` that had the exact defect the
  // helper's inner try/catch prevents: a throwing close() there replaced
  // the real planning error with a cleanup error. Scoping the session to
  // the walk itself also means no chromium is held open across the DB
  // writes below.
  try {
    // Spec 2026-10-24 metering §2.3: every model method of the planning agent is guarded by the organisation's monthly
    // AI limit, at PLAN_CALL_USD a call. A walk that needs no model call (a certified listing's cached selectors) is
    // never refused, whatever the limit. The org's slot is taken before what is left is read (metering review I1), so
    // a sibling job that records its cost and closes in between is seen by the read or by the slot.
    const orgId = await orgIdForSource(db, sourceId);
    ledger = openCapLedger(orgId);
    const cap = orgId ? await orgCapState(db, orgId) : { remainingUsd: null };
    const agent = cappedAgent(new SchemaAgent(), { remainingUsd: cap.remainingUsd, perCallUsd: PLAN_CALL_USD, ledger });

    const rows = (inputSet.rows ?? []) as Array<Record<string, unknown>>;
    // A probe only ever needs to know whether the FIRST input row works —
    // slicing here (rather than trusting `PROBE_BUDGET` alone to keep the
    // run small) means a probe never plans work for rows 2+ even if the
    // budget were misconfigured.
    const planRows = probe ? rows.slice(0, 1) : rows;
    const planBudget = probe ? PROBE_BUDGET : source.budget;

    const outcome = await withBrowserSession((browser) => planRun(
      {
        source: {
          listingMode: source.listingMode,
          inputStrategy: (source.inputStrategy ?? 'direct') as 'direct' | 'template' | 'category' | 'search',
          urlTemplate: source.urlTemplate,
          budget: planBudget,
        },
        // Dataset schema when non-empty; a Scratch source's own
        // selectorsJson.fields otherwise — see effective-schema.ts.
        schema: effectiveSchema(source),
        inputSet: {
          columns: (inputSet.columns ?? []) as Array<{ name: string; primary?: boolean; propagate?: boolean }>,
          rows: planRows,
        },
        // The website's proof pages: known product pages that corroborate the
        // listing's product-link group (`reconcileWithProductGroup`).
        knownDetailUrls: (source.verificationSet as { urls?: string[] } | null)?.urls ?? [],
      },
      { browser, agent },
    ));
    // Stopped (stuck, lease lost, shutdown): the walk ran on a browser closed under it. Nothing is written;
    // the run is the runner's or the next claim's (final review I1).
    if (jobStopped()) throw new Error(`planning run ${run!.id} stopped`);

    // planRun keeps walking past a failed model step; a step the limit refused means the plan is short of what it
    // needed, so it is not written: the run fails with the one customer sentence (spec §2.3), no items, and no log —
    // the walk's own warnings would name the model step.
    const capped = (ledger?.refused ?? 0) > 0;

    // onConflictDoNothing() is the dedupe backstop for a URL surfaced twice
    // (e.g. two input rows landing on the same listing entry) — it cannot
    // throw on the unique (run_id, url) constraint. .returning() reports
    // only the rows actually written, so the counts below describe what
    // was persisted, not what planRun merely proposed.
    // One transaction, on a run still planning (M2): a run closed meanwhile (the runner stopped this
    // attempt) gets no items and keeps its status and sentence.
    const written = await db.transaction(async (tx) => {
      const [open] = await tx.select({ id: runs.id }).from(runs)
        .where(and(eq(runs.id, run!.id), eq(runs.status, 'planning'))).for('update');
      if (!open) return null;
      if (capped) {
        await tx.update(runs)
          .set({ status: 'failed', logs: null, errorMessage: CAP_REACHED_MESSAGE, completedAt: new Date() })
          .where(eq(runs.id, run!.id));
        return { itemCount: 0, listingPages: 0, allInputsFailed: true };
      }
      let persisted: Array<{ kind: string }> = [];
      if (outcome.items.length > 0) {
        const now = new Date();
        persisted = await tx.insert(runItems).values(
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

      await tx.update(runs)
        .set({
          status: allInputsFailed ? 'failed' : 'planned',
          logs,
          // The first input's own reason (a blocked listing's message is the
          // capture verdict's customer sentence), not a count — the count and
          // every other error stay in `logs`.
          errorMessage: allInputsFailed
            ? (outcome.errors[0]?.message ?? `planning failed for all ${outcome.inputs.length} input(s)`)
            : null,
          completedAt: new Date(),
        })
        .where(eq(runs.id, run!.id));
      return { itemCount, listingPages, allInputsFailed };
    });
    if (!written) throw new PlanningClosedError(run!.id);
    const { itemCount, listingPages, allInputsFailed } = written;

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
    // Stopped: the run stays planning for the runner or the next claim (final review I1). Closed: left as it is (M2).
    if (!jobStopped() && !(err instanceof PlanningClosedError)) {
      await db.update(runs)
        // safeErrorMessage, not `(err as Error).message`: a rejection that
        // is not an Error (a string, a driver object) would otherwise write
        // `undefined` into the run's fatal-reason field.
        // A walk that ended on a refusal of the monthly limit (or after one) gets the one customer sentence (§2.3).
        .set({
          status: 'failed',
          errorMessage: isCapReached(err) || (ledger?.refused ?? 0) > 0 ? CAP_REACHED_MESSAGE : safeErrorMessage(err),
          completedAt: new Date(),
        })
        .where(and(eq(runs.id, run!.id), eq(runs.status, 'planning')));
    }
    throw err;
  } finally {
    // The planning walk's own model calls (pagination detection, the
    // catalogue judge) are this run's money too; execution adds its own later.
    try {
      await addRunCost(db, run!.id, costSince(before));
    } catch (costErr) {
      console.error(`[crawl] failed to record planning cost for run ${run!.id}:`, costErr);
    }
    // After the cost is written: the org's other jobs read it from the database from now on (metering review I2).
    ledger?.close();
  }
}
