// packages/api/src/jobs/rows.ts
// A job that will not run again closes every status row it owns (spec §4.5), with the code the app
// already words: 'stalled'. A run row gets the job's own sentence. On a retry, the rows an earlier
// attempt left half-done are closed the same way, except the one the payload names (it is reused).
import { sql } from 'drizzle-orm';
import type { Database } from '@robot/db';
import type { DbOrTx } from './queue.js';
import { RUN_STOPPED } from './types.js';

export type JobSubject = { table: 'source_verifications' | 'drift_checks' | 'coverage_checks' | 'captures' | 'runs'; id: string };

/** Returns the runs it closed: the caller hands them to `deliverClosedRuns` once its transaction committed. */
export async function closeJobRows(tx: DbOrTx, jobId: string, opts: { runSentence: string; except?: JobSubject | null }): Promise<{ runIds: string[] }> {
  const not = (table: JobSubject['table']) => (opts.except?.table === table ? sql`AND id <> ${opts.except.id}` : sql``);
  await tx.execute(sql`UPDATE source_verifications SET error_message = 'stalled', completed_at = now()
    WHERE job_id = ${jobId} AND completed_at IS NULL ${not('source_verifications')}`);
  await tx.execute(sql`UPDATE drift_checks SET status = 'failed', error = 'stalled', completed_at = now()
    WHERE job_id = ${jobId} AND status = 'running' ${not('drift_checks')}`);
  await tx.execute(sql`UPDATE coverage_checks SET status = 'failed', error = 'stalled', completed_at = now()
    WHERE job_id = ${jobId} AND status = 'running' ${not('coverage_checks')}`);
  await tx.execute(sql`UPDATE captures SET metadata = jsonb_build_object(
      'kind', 'proof-page', 'status', 'failed', 'url', metadata->>'url', 'startedAt', metadata->>'startedAt', 'error', 'stalled')
    WHERE job_id = ${jobId} AND metadata->>'kind' = 'proof-page' AND metadata->>'status' = 'capturing' ${not('captures')}`);
  // A run it closes has no executor left: the item it was working goes back to pending, so "Extract again"
  // picks it up at once rather than after the 30-minute stale rule (spec §6's run sentence promises that).
  await tx.execute(sql`UPDATE run_items SET status = 'pending', started_at = NULL
    WHERE kind = 'detail' AND status = 'running' AND run_id IN (
      SELECT id FROM runs WHERE job_id = ${jobId} AND status IN ('planning', 'extracting', 'cancelling') ${not('runs')})`);
  // Its row count is counted here (no finalise ran): delivery reads it to decide whether a failed or cancelled
  // run has rows to send (spec 2026-10-24 §3.3).
  // A scheduled run's job also owns it once planned, until it starts the run (which stamps the run job): a job
  // that ends there — its worker died between the plan and the start — closes it with the run's sentence, never
  // leaving it `planned` with nothing to start it (final review M1). A plan by hand stays planned for its customer.
  const closed = (await tx.execute(sql`UPDATE runs SET
      error_message = CASE WHEN status = 'cancelling' THEN error_message WHEN status = 'planned' THEN ${RUN_STOPPED} ELSE ${opts.runSentence} END,
      status = CASE WHEN status = 'cancelling' THEN 'cancelled' ELSE 'failed' END,
      result_count = (SELECT coalesce(sum(jsonb_array_length(e.data)), 0)::int FROM extractions e WHERE e.run_id = runs.id),
      completed_at = now()
    WHERE job_id = ${jobId} ${not('runs')}
      AND (status IN ('planning', 'extracting', 'cancelling')
        OR (status = 'planned' AND EXISTS (SELECT 1 FROM jobs WHERE jobs.id = ${jobId} AND jobs.type = 'scheduled-run')))
    RETURNING id`)) as unknown as Array<{ id: string }>;
  return { runIds: closed.map((r) => String(r.id)) };
}

/**
 * Spec 2026-10-24 §3.3 for the runs a job closed (failed for good, reaped, stopped as stuck): the same delivery a
 * finalised run gets — `enqueueRunDelivery` applies the same rules (terminal; failed or cancelled only with rows; a
 * website with a schedule or a webhook; never a sample; a backfill its parent). Called after the closing
 * transaction committed. Never throws: a delivery that cannot be queued never changes how a job closes. And the
 * failed-run email (spec 2026-10-24 email §3.1): only `failed` sends; the dedupe key keeps a run reported twice to one
 * email per person.
 */
export async function deliverClosedRuns(dbh: Database, runIds: string[]): Promise<void> {
  if (runIds.length === 0) return;
  try {
    // Imported when needed: the delivery module enqueues through the queue module, which imports this one.
    const { enqueueRunDelivery } = await import('../delivery/run-delivery.js');
    const { notifyRunFailed } = await import('../email/run-failed.js');
    for (const id of runIds) {
      try {
        await enqueueRunDelivery(dbh, id);
      } catch (err) {
        console.error(`[jobs] run delivery could not be queued for closed run ${id}:`, err);
      }
      // Spec 2026-10-24 email §3.1: a run this job closed failed tells its owners and admins (never throws).
      await notifyRunFailed(dbh, id);
    }
  } catch (err) {
    console.error('[jobs] run delivery could not be queued for closed runs:', err);
  }
}
