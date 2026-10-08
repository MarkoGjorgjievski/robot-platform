// packages/api/src/crawl/plan-source.ts
// Phase 1's planning body — extracted out of `crawl.ts`'s `plan` procedure
// (mvp-simplification task 7) so `sources.confirm` can invoke the exact same
// logic at full budget instead of duplicating it. `crawl.ts`'s `plan`
// procedure is now a thin wrapper over this; `probe` behaviour (row slicing,
// PROBE_BUDGET, the `inputLabel: 'probe'` run label) is preserved exactly.

import { TRPCError } from '@trpc/server';
import { eq, sql } from 'drizzle-orm';
import { SchemaAgent, snapshotUsage } from '@robot/agent';
import { planRun, type PlannedItem, type PlanInputReport } from '@robot/scraper';
import { runs, runItems, sources } from '@robot/db';
import type { db as Database } from '@robot/db';
import { withBrowserSession } from '../browser-session.js';
import { PROBE_BUDGET } from './probe.js';
import { effectiveSchema } from './effective-schema.js';
import { addRunCost, costSince } from './record-run-cost.js';

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

export async function planSource(
  db: typeof Database,
  sourceId: string,
  opts: { probe?: boolean } = {},
): Promise<PlanSourceResult> {
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
  // Bound here rather than read inside the planRun closure below: a
  // property narrowing (`source.inputSet` is not null) does not survive
  // into a callback, but a const does.
  const inputSet = source.inputSet;

  const probe = opts.probe === true;

  // Nothing has been written yet, so a failure above leaves no trace to clean up.
  const [run] = await db.insert(runs).values({
    sourceId: source.id,
    status: 'planning',
    startedAt: new Date(),
    // A probe run's label overrides the usual "what was this run
    // pointed at" text: `crawl.status` readers need to tell a probe
    // apart from a real crawl at a glance, and 'probe' is unambiguous
    // where a URL template or source name is not.
    inputLabel: probe ? 'probe' : (source.urlTemplate ?? source.name).slice(0, 200),
  }).returning({ id: runs.id });
  const before = snapshotUsage();

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
      { browser, agent: new SchemaAgent() },
    ));

    // onConflictDoNothing() is the dedupe backstop for a URL surfaced twice
    // (e.g. two input rows landing on the same listing entry) — it cannot
    // throw on the unique (run_id, url) constraint. .returning() reports
    // only the rows actually written, so the counts below describe what
    // was persisted, not what planRun merely proposed.
    let persisted: Array<{ kind: string }> = [];
    if (outcome.items.length > 0) {
      const now = new Date();
      persisted = await db.insert(runItems).values(
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

    await db.update(runs)
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
    await db.update(runs)
      // safeErrorMessage, not `(err as Error).message`: a rejection that
      // is not an Error (a string, a driver object) would otherwise write
      // `undefined` into the run's fatal-reason field.
      .set({ status: 'failed', errorMessage: safeErrorMessage(err), completedAt: new Date() })
      .where(eq(runs.id, run!.id));
    throw err;
  } finally {
    // The planning walk's own model calls (pagination detection, the
    // catalogue judge) are this run's money too; execution adds its own later.
    try {
      await addRunCost(db, run!.id, costSince(before));
    } catch (costErr) {
      console.error(`[crawl] failed to record planning cost for run ${run!.id}:`, costErr);
    }
  }
}
