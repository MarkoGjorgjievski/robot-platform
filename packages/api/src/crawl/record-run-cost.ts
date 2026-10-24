// packages/api/src/crawl/record-run-cost.ts
// Adds a run's model cost to its row. What a phase cost is measured by its own usage scope (@robot/agent
// withUsageScope; plan-source.ts, start-execution.ts), never the process-wide counter (final review I2).

import { eq, sql } from 'drizzle-orm';
import { runs } from '@robot/db';
import type { db as Database } from '@robot/db';

/**
 * Adds `usd` to the run's `cost_usd`. An increment, not an assignment: a run
 * is paid for in two phases (planning, then execution — sometimes execution
 * more than once, when a stalled run is resumed) and each must add its own
 * figure without reading the other's. Nothing-to-add is a no-op rather than a
 * round trip, and a NaN — an estimator fed a model it cannot price — must
 * never reach the column.
 */
export async function addRunCost(db: typeof Database, runId: string, usd: number): Promise<void> {
  if (!Number.isFinite(usd) || usd <= 0) return;
  await db.update(runs)
    .set({ costUsd: sql`${runs.costUsd} + ${usd.toFixed(4)}::numeric` })
    .where(eq(runs.id, runId));
}
