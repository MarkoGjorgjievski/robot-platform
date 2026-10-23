// The `run` job (spec 2026-10-23 §4.4): one executor per run (key run:<runId>). A retry knows its earlier
// attempt was the run's only executor, so every `running` item goes back to pending; a first attempt
// reclaims only stale ones (the operator CLI may be working the run). Then today's execution, reporting
// progress per item and stopping between items when the worker stops it.
import { and, eq } from 'drizzle-orm';
import { db, runs, runItems } from '@robot/db';
import type { Database } from '@robot/db';
import { requeueStaleRunningItems, STALE_RUNNING_MS } from '../../crawl/requeue-stale.js';
import { startExecution } from '../../crawl/start-execution.js';
import { runRepairSweep } from '../../crawl/repair-sweep.js';
import { effectiveSchema } from '../../crawl/effective-schema.js';
import { enqueue } from '../enqueue.js';
import type { JobContext } from '../context.js';
import type { JobPayloads } from '../types.js';

/** A run something should be working: `cancelling` too, so a Stop that lands before the job starts is settled by it. */
const ACTIVE = ['extracting', 'cancelling'];

/** Enqueues the run's job and stamps the run with it; while one is queued or running, that one is handed back. */
export async function enqueueRun(dbh: Database, payload: JobPayloads['run']): Promise<string> {
  return dbh.transaction(async (tx) => {
    const jobId = await enqueue(tx, 'run', payload, { key: `run:${payload.runId}` });
    await tx.update(runs).set({ jobId }).where(eq(runs.id, payload.runId));
    return jobId;
  });
}

/** Still active with work pending: put back while the last pass was ending (a Retry-failed or Extract
 * that found this job still running, so added none) — nothing else would run it. */
async function workLeft(runId: string): Promise<boolean> {
  const run = await db.query.runs.findFirst({ where: eq(runs.id, runId), columns: { status: true } });
  if (!run || !ACTIVE.includes(run.status)) return false;
  const pending = await db.query.runItems.findFirst({
    where: and(eq(runItems.runId, runId), eq(runItems.kind, 'detail'), eq(runItems.status, 'pending')),
    columns: { id: true },
  });
  return !!pending;
}

export async function runExecuteJob(
  p: JobPayloads['run'],
  ctx: JobContext,
  deps: { execute?: typeof startExecution; repairSweep?: typeof runRepairSweep } = {},
): Promise<RunJobValue> {
  const run = await db.query.runs.findFirst({
    where: eq(runs.id, p.runId),
    with: { source: { columns: { id: true, selectorsJson: true, schemaDefinition: true }, with: { dataset: { columns: { schema: true } } } } },
  });
  if (!run?.source || !ACTIVE.includes(run.status)) return { settled: false };
  // `ctx.retry`, not the attempt number: a job given back at shutdown keeps its attempt but was started before.
  await requeueStaleRunningItems(db, p.runId, ctx.retry ? 0 : STALE_RUNNING_MS);

  const execute = deps.execute ?? startExecution;
  const sourceId = run.source.id;
  const schema = effectiveSchema(run.source);
  // A backfill run's every execution merges into its parent (crawl.ts, Finding 1).
  const merge = run.parentRunId ? { mergeToParent: true } : {};
  let recorded = 0;
  const hooks = { onItem: () => { recorded++; ctx.progress(); }, aborted: () => ctx.signal.aborted };
  const go = async (o?: { limit?: number }) => {
    await execute(p.runId, sourceId, schema, o?.limit, { ...merge, hooks });
    // Stopped: the run is left unfinalised for the retry, and nothing after this stage may run (a repair
    // sweep's evaluation would read a half-done sample). The runner has already let this attempt go.
    if (ctx.signal.aborted) throw new Error(`run ${p.runId} stopped (${String(ctx.signal.reason)})`);
  };

  if (p.repairSweep) {
    await (deps.repairSweep ?? runRepairSweep)(db, p.runId, p.repairSweep.deadFields, go);
    return { settled: false };
  }
  const limit = p.limit !== undefined ? { limit: p.limit } : undefined;
  let left = false;
  do {
    recorded = 0;
    await go(limit);
  } while (recorded > 0 && (left = await workLeft(p.runId)));
  // Settled: the last pass did work and then found none left. A pass that recorded nothing is not one to repeat.
  return { settled: recorded > 0 && !left };
}

/** What a run job answers: whether it ended on a run with no work left (only then may work found later be its to restart). */
export type RunJobValue = { settled: boolean };

/**
 * After the run job is recorded done (M4): work put back while it was ending — a Retry failed or an Extract whose
 * enqueue found this job still running and so added none — gets a new run job now that the key is free. Only after
 * a settled end, so a run whose last pass could do nothing is never restarted in a loop.
 */
export async function afterRunJob(p: JobPayloads['run'], value: unknown): Promise<boolean> {
  if ((value as RunJobValue | null)?.settled !== true || !(await workLeft(p.runId))) return false;
  await enqueueRun(db, { runId: p.runId });
  return true;
}
