// packages/api/src/recurring/scheduled-run.ts
// The `scheduled-run` job (spec 2026-10-24 §3.2): plans the run the sweep wrote, exactly as `crawl.plan` does at
// the website's run limits (certified paths only, free), and starts it with `startRunJob`; from there it is an
// ordinary run. A plan that fails stays failed with its own reason; one that planned no products is closed failed
// with a sentence — a scheduled run is never left `planned` with nothing behind it. Certification is checked
// again right before the start (as `crawl.execute` does): one lost since the sweep closes the run failed; a start
// that throws closes it failed with the run-stopped sentence, and the job fails with the error.
import { and, eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { db, runs } from '@robot/db';
import { planSource } from '../crawl/plan-source.js';
import { requireCertification } from '../crawl/require-certification.js';
import { startRunJob } from '../jobs/handlers/run.js';
import { RUN_STOPPED, type JobPayloads } from '../jobs/types.js';

export const NOTHING_PLANNED = 'This run found no products to extract.';
/** The run's sentence when the website lost its certification between the sweep and the start. */
export const NOT_CERTIFIED_RUN = 'The website needs verifying first.';

/** Closes a run that is still `planned` as failed, with `sentence`. */
async function closePlanned(runId: string, sentence: string): Promise<void> {
  await db.update(runs).set({ status: 'failed', errorMessage: sentence })
    .where(and(eq(runs.id, runId), eq(runs.status, 'planned')));
}

export async function runScheduledRun(
  p: JobPayloads['scheduled-run'],
  deps: { plan?: typeof planSource; start?: typeof startRunJob } = {},
): Promise<{ started: boolean }> {
  const result = await (deps.plan ?? planSource)(db, p.sourceId, { probe: false, runId: p.runId });
  if (result.status !== 'planned' || result.itemCount === 0) {
    if (result.status === 'planned') await closePlanned(p.runId, NOTHING_PLANNED);
    return { started: false };
  }
  try {
    await requireCertification(db, p.sourceId);
  } catch (err) {
    if (!(err instanceof TRPCError)) { await closePlanned(p.runId, RUN_STOPPED); throw err; }
    await closePlanned(p.runId, NOT_CERTIFIED_RUN);
    return { started: false };
  }
  try {
    await (deps.start ?? startRunJob)(db, { runId: p.runId });
  } catch (err) {
    await closePlanned(p.runId, RUN_STOPPED);
    throw err;
  }
  return { started: true };
}
