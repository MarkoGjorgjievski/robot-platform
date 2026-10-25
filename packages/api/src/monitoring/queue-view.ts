// ops' Queue view (spec 2026-10-25 monitoring §2.5): every worker row (this queue first), this queue's jobs by type and
// status (done and failed: the last 24 hours), what needs attention, and the last 20 failures with their error
// redacted. Ages on the database's clock. Staff only (`ops.queue`); read-only.
import { sql } from 'drizzle-orm';
import { db } from '@robot/db';
import type { Lane } from '../jobs/types.js';
import { findAttention, type AttentionItem } from './attention.js';
import { DEAD_WORKER_MS } from './heartbeat.js';
import { redactText } from './redact.js';

export type QueueWorker = {
  id: string; queue: string; version: string | null; startedAt: Date; beatAt: Date; beatAgeMs: number; dead: boolean;
  browsers: { inUse: number; max: number }; lanes: Partial<Record<Lane, number>>; websiteChecks: boolean; recurringRuns: boolean;
};
export type QueueTypeRow = { type: string; queued: number; running: number; done: number; failed: number; oldestQueuedMs: number | null; longestRunningMs: number | null };
export type QueueFailure = { jobId: string; type: string; attempts: number; maxAttempts: number; error: string | null; finishedAt: Date | null; agoMs: number | null };
export type QueueOverview = { queue: string; workers: QueueWorker[]; types: QueueTypeRow[]; attention: AttentionItem[]; failures: QueueFailure[] };

const rows = <T>(r: unknown) => r as T[];
const date = (v: Date | string | null): Date | null => (v === null ? null : v instanceof Date ? v : new Date(v));
const ms = (v: unknown): number | null => (v === null || v === undefined ? null : Math.round(Number(v)));
const browsersOf = (v: unknown): { inUse: number; max: number } => {
  const b = (v ?? {}) as { inUse?: unknown; max?: unknown };
  return { inUse: Number(b.inUse ?? 0), max: Number(b.max ?? 0) };
};

export async function queueOverview(queue: string): Promise<QueueOverview> {
  const [w, t, f, attention] = await Promise.all([
    db.execute(sql`SELECT id, queue, version, started_at, beat_at, browsers, lanes, website_checks, recurring_runs,
        (extract(epoch FROM now() - beat_at) * 1000)::float8 AS beat_age_ms,
        beat_at < now() - make_interval(secs => ${DEAD_WORKER_MS / 1000}) AS dead
      FROM workers ORDER BY (queue = ${queue}) DESC, beat_at DESC LIMIT 50`),
    db.execute(sql`SELECT type,
        count(*) FILTER (WHERE status = 'queued')::int AS queued,
        count(*) FILTER (WHERE status = 'running')::int AS running,
        count(*) FILTER (WHERE status = 'done' AND finished_at > now() - interval '1 day')::int AS done,
        count(*) FILTER (WHERE status = 'failed' AND finished_at > now() - interval '1 day')::int AS failed,
        (extract(epoch FROM now() - min(run_after) FILTER (WHERE status = 'queued' AND run_after <= now())) * 1000)::float8 AS oldest_queued_ms,
        (extract(epoch FROM now() - min(started_at) FILTER (WHERE status = 'running')) * 1000)::float8 AS longest_running_ms
      FROM jobs WHERE queue = ${queue}
      GROUP BY type
      HAVING count(*) FILTER (WHERE status IN ('queued', 'running') OR finished_at > now() - interval '1 day') > 0
      ORDER BY type`),
    db.execute(sql`SELECT id, type, attempts, max_attempts, error, finished_at,
        (extract(epoch FROM now() - finished_at) * 1000)::float8 AS ago_ms
      FROM jobs WHERE queue = ${queue} AND status = 'failed' ORDER BY finished_at DESC NULLS LAST LIMIT 20`),
    findAttention(queue),
  ]);
  return {
    queue,
    workers: rows<Record<string, unknown>>(w).map((r) => ({
      id: String(r.id), queue: String(r.queue), version: (r.version as string | null) ?? null,
      startedAt: date(r.started_at as Date | string)!, beatAt: date(r.beat_at as Date | string)!, beatAgeMs: ms(r.beat_age_ms) ?? 0, dead: r.dead === true,
      browsers: browsersOf(r.browsers), lanes: (r.lanes ?? {}) as Partial<Record<Lane, number>>,
      websiteChecks: r.website_checks === true, recurringRuns: r.recurring_runs === true,
    })),
    types: rows<Record<string, unknown>>(t).map((r) => ({
      type: String(r.type), queued: Number(r.queued), running: Number(r.running), done: Number(r.done), failed: Number(r.failed),
      oldestQueuedMs: ms(r.oldest_queued_ms), longestRunningMs: ms(r.longest_running_ms),
    })),
    attention,
    failures: rows<Record<string, unknown>>(f).map((r) => ({
      jobId: String(r.id), type: String(r.type), attempts: Number(r.attempts), maxAttempts: Number(r.max_attempts),
      error: r.error ? redactText(String(r.error)).slice(0, 500) : null, finishedAt: date((r.finished_at as Date | string | null) ?? null), agoMs: ms(r.ago_ms),
    })),
  };
}
