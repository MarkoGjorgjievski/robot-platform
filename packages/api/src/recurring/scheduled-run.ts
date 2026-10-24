// packages/api/src/recurring/scheduled-run.ts
// The `scheduled-run` job (spec 2026-10-24 §3.2): plans the run the sweep wrote, exactly as `crawl.plan` does at
// the website's run limits (certified paths only, free), and starts it with `startRunJob`; from there it is an
// ordinary run. A plan that fails stays failed with its own reason; one that planned no products is closed failed
// with a sentence — a scheduled run is never left `planned` with nothing behind it.
import { and, eq } from 'drizzle-orm';
import { db, runs } from '@robot/db';
import { planSource } from '../crawl/plan-source.js';
import { startRunJob } from '../jobs/handlers/run.js';
import type { JobPayloads } from '../jobs/types.js';

export const NOTHING_PLANNED = 'This run found no products to extract.';

export async function runScheduledRun(
  p: JobPayloads['scheduled-run'],
  deps: { plan?: typeof planSource; start?: typeof startRunJob } = {},
): Promise<{ started: boolean }> {
  const result = await (deps.plan ?? planSource)(db, p.sourceId, { probe: false, runId: p.runId });
  if (result.status !== 'planned' || result.itemCount === 0) {
    if (result.status === 'planned') {
      await db.update(runs).set({ status: 'failed', errorMessage: NOTHING_PLANNED })
        .where(and(eq(runs.id, p.runId), eq(runs.status, 'planned')));
    }
    return { started: false };
  }
  await (deps.start ?? startRunJob)(db, { runId: p.runId });
  return { started: true };
}
