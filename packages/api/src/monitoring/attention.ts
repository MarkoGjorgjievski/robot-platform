// What needs attention on a queue (spec 2026-10-25 monitoring §2.3), read by the watchdog, /readyz's `queue` check
// and ops' Queue view. Ages are on the database's clock. Read-only: nothing here changes a job.
//   backlog     queued, due more than 10 minutes ago, and its lane is idle on this queue — nothing of the lane running,
//               nothing of it claimed in the last 10 minutes ("a backlog nobody is taking"; plan "Settled here" 1)
//   silent      running under a live lease, no progress for more than half its policy's stuckMs
//   dead-worker running under a worker whose row's beat is more than 2 minutes old (matched exactly, never by LIKE)
import { sql } from 'drizzle-orm';
import { db } from '@robot/db';
import { JOB_POLICIES, type JobPolicy, type Lane } from '../jobs/types.js';
import { TEST_JOB_POLICIES } from '../jobs/test-jobs.js';
import { DEAD_WORKER_MS } from './heartbeat.js';
import { redactText } from './redact.js';

export const BACKLOG_MS = 10 * 60_000;
const DEFAULT_STUCK_MS = 15 * 60_000;
const UUID = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

export type AttentionKind = 'backlog' | 'silent' | 'dead-worker';
export type AttentionItem = {
  kind: AttentionKind; jobId: string; type: string; lane: Lane | null; ageMs: number; workerId: string | null;
  sourceId: string | null; websiteName: string | null; runId: string | null; lastError: string | null;
};

export function policyOf(type: string): JobPolicy | null {
  return (JOB_POLICIES as Record<string, JobPolicy>)[type] ?? TEST_JOB_POLICIES[type] ?? null;
}

type Raw = { id: string; type: string; error: string | null; age_ms: number | string; worker_id: string | null };
const rows = <T>(r: unknown) => r as T[];
const item = (kind: AttentionKind, j: Raw): AttentionItem => ({
  kind, jobId: j.id, type: j.type, lane: policyOf(j.type)?.lane ?? null, ageMs: Math.round(Number(j.age_ms)), workerId: j.worker_id,
  sourceId: null, websiteName: null, runId: null, lastError: j.error ? redactText(j.error).slice(0, 500) : null,
});

/** Every known type's lane, as a VALUES list, so the lane test runs in the query (a job of an unknown type has none). */
function laneValues() {
  const all = { ...TEST_JOB_POLICIES, ...(JOB_POLICIES as Record<string, JobPolicy>) };
  return sql.join(Object.entries(all).map(([type, p]) => sql`(${type}::text, ${p.lane}::text)`), sql`, `);
}

export async function findBacklog(queue: string, opts: { limit?: number } = {}): Promise<AttentionItem[]> {
  // A lane is busy on this queue while a job of it runs or one was claimed in the last 10 minutes. One bounded
  // query: the lane test runs in SQL, so a busy lane's waiting jobs never crowd another lane's out of the LIMIT.
  const window = sql`make_interval(secs => ${BACKLOG_MS / 1000})`;
  const waiting = rows<Raw>(await db.execute(sql`WITH lanes(type, lane) AS (VALUES ${laneValues()}),
    busy AS (SELECT DISTINCT l.lane FROM jobs b JOIN lanes l ON l.type = b.type
      WHERE b.queue = ${queue} AND (b.status = 'running' OR b.started_at > now() - ${window}))
    SELECT j.id, j.type, j.error, NULL::text AS worker_id, (extract(epoch FROM now() - j.run_after) * 1000)::float8 AS age_ms
    FROM jobs j LEFT JOIN lanes l ON l.type = j.type
    WHERE j.queue = ${queue} AND j.status = 'queued' AND j.run_after < now() - ${window}
      AND (l.lane IS NULL OR l.lane NOT IN (SELECT lane FROM busy))
    ORDER BY j.run_after LIMIT ${opts.limit ?? 50}`));
  return waiting.map((j) => item('backlog', j));
}

async function findSilent(queue: string): Promise<AttentionItem[]> {
  const live = rows<Raw>(await db.execute(sql`SELECT id, type, error, split_part(locked_by, '#', 1) AS worker_id,
      (extract(epoch FROM now() - coalesce(progress_at, started_at)) * 1000)::float8 AS age_ms
    FROM jobs WHERE queue = ${queue} AND status = 'running' AND locked_until > now() ORDER BY started_at LIMIT 200`));
  return live.filter((j) => Number(j.age_ms) > (policyOf(j.type)?.stuckMs ?? DEFAULT_STUCK_MS) / 2).map((j) => item('silent', j));
}

async function findDeadWorkerJobs(queue: string): Promise<AttentionItem[]> {
  const orphaned = rows<Raw>(await db.execute(sql`SELECT j.id, j.type, j.error, w.id AS worker_id,
      (extract(epoch FROM now() - w.beat_at) * 1000)::float8 AS age_ms
    FROM jobs j JOIN workers w ON w.id = split_part(j.locked_by, '#', 1)
    WHERE j.queue = ${queue} AND j.status = 'running' AND w.beat_at < now() - make_interval(secs => ${DEAD_WORKER_MS / 1000})
    ORDER BY w.beat_at LIMIT 200`));
  return orphaned.map((j) => item('dead-worker', j));
}

/** The website (payload `sourceId`, else the status row stamped with the job) and the run (payload `runId`, else the run stamped with it). */
async function withSubjects(items: AttentionItem[]): Promise<AttentionItem[]> {
  if (items.length === 0) return items;
  const ids = sql.join([...new Set(items.map((i) => i.jobId))].map((id) => sql`${id}::uuid`), sql`, `);
  const found = rows<{ id: string; source_id: string | null; run_id: string | null; website_name: string | null }>(await db.execute(sql`
    WITH s AS (
      SELECT j.id,
        coalesce(
          CASE WHEN j.payload->>'sourceId' ~* ${UUID} THEN (j.payload->>'sourceId')::uuid END,
          (SELECT r.source_id FROM runs r WHERE r.job_id = j.id LIMIT 1),
          (SELECT c.source_id FROM captures c WHERE c.job_id = j.id LIMIT 1),
          (SELECT v.source_id FROM source_verifications v WHERE v.job_id = j.id LIMIT 1),
          (SELECT d.source_id FROM drift_checks d WHERE d.job_id = j.id LIMIT 1),
          (SELECT cc.source_id FROM coverage_checks cc WHERE cc.job_id = j.id LIMIT 1),
          (SELECT r.source_id FROM runs r WHERE r.id = CASE WHEN j.payload->>'runId' ~* ${UUID} THEN (j.payload->>'runId')::uuid END)) AS source_id,
        coalesce(
          CASE WHEN j.payload->>'runId' ~* ${UUID} THEN (j.payload->>'runId')::uuid END,
          (SELECT r.id FROM runs r WHERE r.job_id = j.id LIMIT 1)) AS run_id
      FROM jobs j WHERE j.id IN (${ids}))
    SELECT s.id, s.source_id, s.run_id, src.name AS website_name FROM s LEFT JOIN sources src ON src.id = s.source_id`));
  const by = new Map(found.map((f) => [String(f.id), f]));
  return items.map((i) => {
    const f = by.get(i.jobId);
    return f ? { ...i, sourceId: f.source_id ? String(f.source_id) : null, runId: f.run_id ? String(f.run_id) : null, websiteName: f.website_name } : i;
  });
}

export async function findAttention(queue: string): Promise<AttentionItem[]> {
  const [backlog, silent, dead] = await Promise.all([findBacklog(queue), findSilent(queue), findDeadWorkerJobs(queue)]);
  return withSubjects([...backlog, ...silent, ...dead]);
}
