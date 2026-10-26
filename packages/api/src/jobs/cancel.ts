// packages/api/src/jobs/cancel.ts
// Deleting a website stops its jobs (first run 2026-10-25, ruling): a coverage check of a website deleted minutes
// before held the worker's only browser while a new customer's reachability check timed out behind it.
import { sql, type SQL } from 'drizzle-orm';
import type { DbOrTx } from './queue.js';

/** Which websites: one, a project's, or an organisation's. */
export type WebsiteScope = { sourceId: string } | { projectId: string } | { orgId: string };

export const WEBSITE_DELETED = 'cancelled: the website was deleted';

function sourceIds(scope: WebsiteScope): SQL {
  if ('sourceId' in scope) return sql`SELECT ${scope.sourceId}::uuid AS id`;
  if ('projectId' in scope) return sql`SELECT s.id FROM sources s JOIN datasets d ON d.id = s.dataset_id WHERE d.project_id = ${scope.projectId}`;
  return sql`SELECT s.id FROM sources s JOIN datasets d ON d.id = s.dataset_id JOIN projects p ON p.id = d.project_id WHERE p.org_id = ${scope.orgId}`;
}

/**
 * Fails, at once, every queued or running job of these websites, in every queue: one that names the website
 * (`sourceId`), or its coverage or drift check, its proof-page capture or its run — and any job a row of the
 * website is stamped with. Call it in the transaction that deletes the website, before the delete (the rows that
 * tie a job to the website cascade away with it).
 *
 * A queued job never starts. A running one is no longer its worker's: the worker's next lease renewal finds it
 * failed, aborts the handler and closes its browsers (runner.ts heartbeat), and every outcome write it would make
 * is guarded by its claim, so it writes nothing to the job. The website's own rows are gone with the delete.
 */
export async function cancelWebsiteJobs(dbOrTx: DbOrTx, scope: WebsiteScope): Promise<Array<{ id: string; type: string }>> {
  const result = JSON.stringify({ error: { kind: 'unavailable', message: WEBSITE_DELETED } });
  return (await dbOrTx.execute(sql`
    WITH src AS MATERIALIZED (${sourceIds(scope)}),
    stamped AS MATERIALIZED (
      SELECT job_id FROM coverage_checks WHERE source_id IN (SELECT id FROM src) AND job_id IS NOT NULL
      UNION SELECT job_id FROM drift_checks WHERE source_id IN (SELECT id FROM src) AND job_id IS NOT NULL
      UNION SELECT job_id FROM source_verifications WHERE source_id IN (SELECT id FROM src) AND job_id IS NOT NULL
      UNION SELECT job_id FROM captures WHERE source_id IN (SELECT id FROM src) AND job_id IS NOT NULL
      UNION SELECT job_id FROM runs WHERE source_id IN (SELECT id FROM src) AND job_id IS NOT NULL)
    UPDATE jobs SET status = 'failed', error = ${WEBSITE_DELETED}, result = ${result}::jsonb, finished_at = now(),
           locked_by = NULL, locked_until = NULL
     WHERE status IN ('queued', 'running') AND (
           payload->>'sourceId' IN (SELECT id::text FROM src)
        OR id IN (SELECT job_id FROM stamped)
        OR (type = 'coverage-check' AND payload->>'checkId' IN (SELECT id::text FROM coverage_checks WHERE source_id IN (SELECT id FROM src)))
        OR (type = 'drift-check' AND payload->>'checkId' IN (SELECT id::text FROM drift_checks WHERE source_id IN (SELECT id FROM src)))
        OR (type = 'proof-page-capture' AND payload->>'captureId' IN (SELECT id::text FROM captures WHERE source_id IN (SELECT id FROM src)))
        OR (type IN ('run', 'run-delivery') AND payload->>'runId' IN (SELECT id::text FROM runs WHERE source_id IN (SELECT id FROM src))))
    RETURNING id, type`)) as unknown as Array<{ id: string; type: string }>;
}
