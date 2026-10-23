// packages/api/src/jobs/rows.ts
// A job that will not run again closes every status row it owns (spec §4.5), with the code the app
// already words: 'stalled'. A run row gets the job's own sentence. On a retry, the rows an earlier
// attempt left half-done are closed the same way, except the one the payload names (it is reused).
import { sql } from 'drizzle-orm';
import type { DbOrTx } from './queue.js';

export type JobSubject = { table: 'source_verifications' | 'drift_checks' | 'coverage_checks' | 'captures' | 'runs'; id: string };

export async function closeJobRows(tx: DbOrTx, jobId: string, opts: { runSentence: string; except?: JobSubject | null }): Promise<void> {
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
  await tx.execute(sql`UPDATE runs SET
      error_message = CASE WHEN status = 'cancelling' THEN error_message ELSE ${opts.runSentence} END,
      status = CASE WHEN status = 'cancelling' THEN 'cancelled' ELSE 'failed' END,
      completed_at = now()
    WHERE job_id = ${jobId} AND status IN ('planning', 'extracting', 'cancelling') ${not('runs')}`);
}
