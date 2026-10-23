// packages/api/src/crawl/plan-via-worker.ts
// Planning walks the listing in a browser, so it runs in the worker (job `plan`, spec 2026-10-23 §4.4).
// The run row is written here with the job, in one transaction; the request waits for the plan.
import { randomUUID } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { runs } from '@robot/db';
import type { db as Database } from '@robot/db';
import { assertPlannable, planningRunValues, type PlanSourceResult } from './plan-source.js';
import { enqueue, ceilingOf } from '../jobs/enqueue.js';
import { awaitJob, failJobTerminal } from '../jobs/queue.js';
import { JobUnavailableError } from '../jobs/errors.js';
import { PLAN_STOPPED } from '../jobs/types.js';

export async function planViaWorker(db: typeof Database, sourceId: string, opts: { probe: boolean }): Promise<PlanSourceResult> {
  // NOT_FOUND / PRECONDITION_FAILED before anything is written, exactly as planning has always refused.
  const source = await assertPlannable(db, sourceId);
  const runId = randomUUID();
  const jobId = await db.transaction(async (tx) => {
    const id = await enqueue(tx, 'plan', { sourceId, runId, probe: opts.probe }, { key: `plan:${runId}` });
    await tx.insert(runs).values({ id: runId, ...planningRunValues(source, opts.probe), jobId: id });
    return id;
  });
  try {
    return (await awaitJob(jobId, ceilingOf('plan'))) as PlanSourceResult;
  } catch (err) {
    // A refusal from planning itself keeps its code and words (they crossed the queue as a TRPCError).
    if (err instanceof TRPCError) throw err;
    if (err instanceof JobUnavailableError) {
      // Still queued when the caller stops waiting: it is not started later behind the customer's back —
      // failed here, which closes its run with the sentence (a running one finishes and writes its run).
      await failJobTerminal(jobId, 'queued', { kind: 'unavailable', message: err.reason }, PLAN_STOPPED);
    } else {
      console.error(`[crawl] plan ${runId} failed in the worker:`, err);
    }
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: PLAN_STOPPED });
  }
}
