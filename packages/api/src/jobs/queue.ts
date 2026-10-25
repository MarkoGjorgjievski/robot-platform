// packages/api/src/jobs/queue.ts
// The jobs table's operations (spec 2026-10-23 §4.1). Every claim and enqueue is scoped to one
// JOB_QUEUE; a worker never sees another queue. Raw SQL, like crawl/claim-item.ts: postgres-js via
// drizzle returns the row list itself.
import { randomUUID } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';
import { db } from '@robot/db';
import type { Database } from '@robot/db';
import { closeJobRows, deliverClosedRuns } from './rows.js';
import { JobUnavailableError, rebuildError, type SerializedError } from './errors.js';
import { runSentenceFor } from './types.js';

/** The database or a transaction on it. */
export type DbOrTx = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

export type JobStatus = 'queued' | 'running' | 'done' | 'failed';
export type JobRow = {
  id: string; queue: string; type: string; key: string | null; payload: unknown; status: JobStatus;
  priority: number; attempts: number; maxAttempts: number; runAfter: Date; expiresAt: Date | null;
  lockedBy: string | null; lockedUntil: Date | null; result: unknown; error: string | null;
  /** Set by a claim: this job was started before (a retry, or given back at shutdown) — not `attempts > 1`, which a give-back does not raise. */
  startedBefore?: boolean;
};
type RawJob = {
  id: string; queue: string; type: string; key: string | null; payload: unknown; status: JobStatus; priority: number;
  attempts: number; max_attempts: number; run_after: Date | string; expires_at: Date | string | null;
  locked_by: string | null; locked_until: Date | string | null; result: unknown; error: string | null;
  started_before?: boolean;
};
const date = (v: Date | string | null): Date | null => (v === null ? null : v instanceof Date ? v : new Date(v));
const toJob = (r: RawJob): JobRow => ({
  id: r.id, queue: r.queue, type: r.type, key: r.key, payload: r.payload, status: r.status, priority: r.priority,
  attempts: r.attempts, maxAttempts: r.max_attempts, runAfter: date(r.run_after)!, expiresAt: date(r.expires_at),
  lockedBy: r.locked_by, lockedUntil: date(r.locked_until), result: r.result, error: r.error,
  ...(r.started_before === undefined ? {} : { startedBefore: r.started_before }),
});
const rows = <T>(r: unknown) => r as T[];
const secs = (ms: number) => Math.max(ms, 1) / 1000;
/**
 * A job back in the queue after it started (a retry, a give-back) is due at `dueAt` and gets its start
 * window again from then, as long as the one it was enqueued with (spec §4.2: the window is for the start,
 * not for the work). Read in the same UPDATE, the old run_after and expires_at give that length; none stays none.
 */
const requeuedAt = (dueAt: SQL) => sql`run_after = ${dueAt}, expires_at = ${dueAt} + (expires_at - run_after)`;

export function jobQueueName(env: Record<string, string | undefined> = process.env): string {
  return (env.JOB_QUEUE ?? '').trim() || 'default';
}

export type EnqueueSpec = {
  type: string; payload: unknown; key?: string | null; priority?: number; maxAttempts?: number; queue?: string;
  /** Due this long after it is written (default: at once). */
  delayMs?: number;
  /** Failed 'expired' when not started this long after it is due; null or absent: no window. Both on the database clock. */
  startWithinMs?: number | null;
};

/** Inserts a job, or hands back the queued/running one with the same key. Use the caller's transaction. */
export async function enqueueJob(dbOrTx: DbOrTx, spec: EnqueueSpec): Promise<{ id: string; created: boolean }> {
  const queue = spec.queue ?? jobQueueName();
  const key = spec.key ?? null;
  // A queued job of this key whose start window passed will never run: it is not handed back (the caller
  // would wait on an answer that cannot come) but failed 'expired' here, its rows closed, and the key freed (M6).
  if (key !== null) {
    const late = rows<{ id: string; type: string }>(await dbOrTx.execute(sql`
      UPDATE jobs SET status = 'failed', error = 'expired', result = ${JSON.stringify({ error: { kind: 'unavailable', message: 'expired' } })}::jsonb,
             finished_at = now()
       WHERE queue = ${queue} AND key = ${key} AND status = 'queued' AND expires_at < now()
      RETURNING id, type`));
    for (const j of late) await closeJobRows(dbOrTx, j.id, { runSentence: runSentenceFor(j.type) });
  }
  for (let tries = 0; tries < 3; tries++) {
    const id = randomUUID();
    const due = sql`now() + make_interval(secs => ${(spec.delayMs ?? 0) / 1000})`;
    const window = spec.startWithinMs === undefined || spec.startWithinMs === null ? sql`NULL::timestamptz`
      : sql`${due} + make_interval(secs => ${spec.startWithinMs / 1000})`;
    const inserted = rows<{ id: string }>(await dbOrTx.execute(sql`
      INSERT INTO jobs (id, queue, type, key, payload, priority, max_attempts, run_after, expires_at)
      VALUES (${id}, ${queue}, ${spec.type}, ${key}, ${JSON.stringify(spec.payload ?? {})}::jsonb,
              ${spec.priority ?? 10}, ${spec.maxAttempts ?? 1}, ${due}, ${window})
      ON CONFLICT (queue, key) WHERE status IN ('queued', 'running') AND key IS NOT NULL DO NOTHING
      RETURNING id`));
    if (inserted[0]) return { id: inserted[0].id, created: true };
    const existing = rows<{ id: string }>(await dbOrTx.execute(sql`
      SELECT id FROM jobs WHERE queue = ${queue} AND key = ${key} AND status IN ('queued', 'running') LIMIT 1`));
    if (existing[0]) return { id: existing[0].id, created: false };
    // The active one finished between the two statements: the key is free again — insert.
  }
  throw new Error(`could not enqueue ${spec.type} (${key})`);
}

/**
 * Claims the next due job. Its `lockedBy` names this claim — the worker id and a token of the claim — and is
 * the owner every later write of it passes, so a write left over from an earlier claim (of this worker, too)
 * never touches a later one.
 */
export async function claimJob(opts: { queue: string; workerId: string; types: string[]; leaseMs: number }): Promise<JobRow | null> {
  if (opts.types.length === 0) return null;
  const types = sql.join(opts.types.map((t) => sql`${t}`), sql`, `);
  // The pick is a MATERIALIZED CTE: evaluated once. As a subquery in FROM, a nested-loop plan rescans it per
  // row of `jobs` — and each rescan skips the row this statement already locked and updated, so one claim
  // took a second job (and a third…) that nothing then ran, under a lock no hold of this worker knew.
  const claimed = rows<RawJob>(await db.execute(sql`
    WITH prev AS MATERIALIZED (
       SELECT id, started_at FROM jobs
        WHERE queue = ${opts.queue} AND status = 'queued' AND type IN (${types})
          AND run_after <= now() AND (expires_at IS NULL OR expires_at > now())
        ORDER BY priority, run_after, created_at
        LIMIT 1
        FOR UPDATE SKIP LOCKED)
    UPDATE jobs AS j SET status = 'running', attempts = j.attempts + 1, locked_by = ${`${opts.workerId}#${randomUUID().slice(0, 8)}`},
           locked_until = now() + make_interval(secs => ${secs(opts.leaseMs)}), started_at = now(), progress_at = now()
      FROM prev
     WHERE j.id = prev.id
    RETURNING j.*, prev.started_at IS NOT NULL AS started_before`));
  if (claimed.length > 1) throw new Error(`a claim took ${claimed.length} jobs`);
  return claimed[0] ? toJob(claimed[0]) : null;
}

export async function renewLease(id: string, owner: string, leaseMs: number): Promise<boolean> {
  const r = rows(await db.execute(sql`UPDATE jobs SET locked_until = now() + make_interval(secs => ${secs(leaseMs)})
    WHERE id = ${id} AND locked_by = ${owner} AND status = 'running' RETURNING id`));
  return r.length > 0;
}

/** Spec 2026-10-25 monitoring §2.3: the job's last progress, outside the worker's memory. This claim's only; best-effort. */
export async function markProgress(id: string, owner: string): Promise<void> {
  await db.execute(sql`UPDATE jobs SET progress_at = now() WHERE id = ${id} AND locked_by = ${owner} AND status = 'running'`);
}

export async function completeJob(id: string, owner: string, value: unknown): Promise<boolean> {
  const r = rows(await db.execute(sql`UPDATE jobs SET status = 'done', result = ${JSON.stringify({ value: value ?? null })}::jsonb,
      error = NULL, finished_at = now(), locked_by = NULL, locked_until = NULL
    WHERE id = ${id} AND locked_by = ${owner} AND status = 'running' RETURNING id`));
  return r.length > 0;
}

export async function retryJob(id: string, owner: string, error: string, delayMs: number): Promise<boolean> {
  const r = rows(await db.execute(sql`UPDATE jobs SET status = 'queued', error = ${error.slice(0, 1000)}, locked_by = NULL, locked_until = NULL,
      ${requeuedAt(sql`now() + make_interval(secs => ${secs(delayMs)})`)}
    WHERE id = ${id} AND locked_by = ${owner} AND status = 'running' RETURNING id`));
  return r.length > 0;
}

/** Who may fail the job: its owner (the claim's `lockedBy`), a reaper (the lease lapsed), or anyone while it is still queued. */
export type FailGuard = { owner: string } | 'lapsed' | 'queued';

export async function failJobTerminal(id: string, guard: FailGuard, detail: SerializedError, runSentence: string): Promise<boolean> {
  const where = guard === 'lapsed' ? sql`status = 'running' AND locked_until < now()`
    : guard === 'queued' ? sql`status = 'queued'`
    : sql`status = 'running' AND locked_by = ${guard.owner}`;
  const closed = await db.transaction(async (tx) => {
    const r = rows(await tx.execute(sql`UPDATE jobs SET status = 'failed', error = ${detail.message.slice(0, 1000)},
        result = ${JSON.stringify({ error: detail })}::jsonb, finished_at = now(), locked_by = NULL, locked_until = NULL
      WHERE id = ${id} AND ${where} RETURNING id`));
    if (r.length === 0) return null;
    return (await closeJobRows(tx, id, { runSentence })).runIds;
  });
  if (closed === null) return false;
  // A run it closed gets the delivery a finalised run gets (spec 2026-10-24 §3.3; final review I1).
  await deliverClosedRuns(db, closed);
  return true;
}

/**
 * Shutdown: back to the queue at once, its attempt not spent. `unstarted`: this claim never ran its
 * handler and the job had never started before — it goes back as never started (not a retry next time).
 */
export async function releaseJob(id: string, owner: string, opts: { unstarted?: boolean } = {}): Promise<void> {
  await db.execute(sql`UPDATE jobs SET status = 'queued', attempts = GREATEST(attempts - 1, 0), locked_by = NULL,
      locked_until = NULL, ${requeuedAt(sql`now()`)}${opts.unstarted ? sql`, started_at = NULL` : sql``}
    WHERE id = ${id} AND locked_by = ${owner} AND status = 'running'`);
}

export async function reapJobs(queue: string, opts: { retryBaseMs: number }): Promise<{ retried: string[]; failed: string[]; expired: string[] }> {
  const out = { retried: [] as string[], failed: [] as string[], expired: [] as string[] };
  const lapsed = rows<{ id: string; type: string; attempts: number; max_attempts: number }>(await db.execute(sql`
    SELECT id, type, attempts, max_attempts FROM jobs
     WHERE queue = ${queue} AND status = 'running' AND locked_until < now() ORDER BY created_at`));
  for (const j of lapsed) {
    if (j.attempts < j.max_attempts) {
      const delay = opts.retryBaseMs * 2 ** Math.max(j.attempts - 1, 0);
      const r = rows(await db.execute(sql`UPDATE jobs SET status = 'queued', error = 'lease expired', locked_by = NULL,
          locked_until = NULL, ${requeuedAt(sql`now() + make_interval(secs => ${secs(delay)})`)}
        WHERE id = ${j.id} AND status = 'running' AND locked_until < now() RETURNING id`));
      if (r.length) out.retried.push(j.id);
    } else if (await failJobTerminal(j.id, 'lapsed', { kind: 'unavailable', message: 'stalled' }, runSentenceFor(j.type))) {
      out.failed.push(j.id);
    }
  }
  const late = rows<{ id: string; type: string }>(await db.execute(sql`
    SELECT id, type FROM jobs WHERE queue = ${queue} AND status = 'queued' AND expires_at < now() ORDER BY created_at`));
  for (const j of late) {
    if (await failJobTerminal(j.id, 'queued', { kind: 'unavailable', message: 'expired' }, runSentenceFor(j.type))) out.expired.push(j.id);
  }
  return out;
}

export async function purgeJobs(queue: string, olderThanMs = 7 * 86_400_000): Promise<void> {
  await db.execute(sql`DELETE FROM jobs WHERE queue = ${queue} AND status IN ('done', 'failed')
    AND finished_at < now() - make_interval(secs => ${secs(olderThanMs)})`);
}

/** The ids among `ids` whose job is queued within its window, or running under an unexpired lease. */
export async function liveJobIds(dbOrTx: DbOrTx, ids: Array<string | null | undefined>): Promise<Set<string>> {
  const wanted = [...new Set(ids.filter((i): i is string => typeof i === 'string' && i.length > 0))];
  if (wanted.length === 0) return new Set();
  const list = sql.join(wanted.map((i) => sql`${i}::uuid`), sql`, `);
  const live = rows<{ id: string }>(await dbOrTx.execute(sql`SELECT id FROM jobs WHERE id IN (${list})
    AND ((status = 'queued' AND (expires_at IS NULL OR expires_at > now())) OR (status = 'running' AND locked_until > now()))`));
  return new Set(live.map((r) => r.id));
}

export async function isJobLive(dbOrTx: DbOrTx, id: string | null | undefined): Promise<boolean> {
  return id ? (await liveJobIds(dbOrTx, [id])).has(id) : false;
}

/** Jobs of this queue still to do now (queued and due, or running) — what a test drains. */
export async function openJobCount(queue: string): Promise<number> {
  const r = rows<{ n: number }>(await db.execute(sql`SELECT count(*)::int AS n FROM jobs WHERE queue = ${queue}
    AND (status = 'running' OR (status = 'queued' AND run_after <= now() AND (expires_at IS NULL OR expires_at > now())))`));
  return r[0]?.n ?? 0;
}

/**
 * Waits for a job's answer (spec §4.1): its value when done; its error, rebuilt, when failed. A queued
 * job past its window is failed here and its rows closed; past `ceilingMs` the caller stops waiting.
 */
export async function awaitJob(id: string, ceilingMs: number, pollMs = 150): Promise<unknown> {
  const until = Date.now() + ceilingMs;
  for (;;) {
    const [row] = rows<{ status: JobStatus; result: { value?: unknown; error?: SerializedError } | null; error: string | null; type: string; expired: boolean }>(
      await db.execute(sql`SELECT status, result, error, type, (expires_at IS NOT NULL AND expires_at < now()) AS expired FROM jobs WHERE id = ${id}`));
    if (!row) throw new JobUnavailableError('gone');
    if (row.status === 'done') return row.result?.value ?? null;
    if (row.status === 'failed') throw rebuildError(row.result?.error ?? { kind: 'unavailable', message: row.error ?? 'failed' });
    if (row.status === 'queued' && row.expired) {
      // An awaited job's rows (a plan's run) close with its type's sentence.
      await failJobTerminal(id, 'queued', { kind: 'unavailable', message: 'expired' }, runSentenceFor(row.type));
      throw new JobUnavailableError('expired');
    }
    if (Date.now() >= until) throw new JobUnavailableError('no answer in time');
    await new Promise((r) => setTimeout(r, pollMs));
  }
}
