// packages/api/src/jobs/enqueue.ts
// The one way api code starts a job: the type's policy decides its priority, attempts and window.
import { db } from '@robot/db';
import { JOB_POLICIES, type JobPayloads, type JobType } from './types.js';
import { awaitJob, enqueueJob, type DbOrTx } from './queue.js';

export async function enqueue<T extends JobType>(dbOrTx: DbOrTx, type: T, payload: JobPayloads[T], opts: { key?: string | null; priority?: number } = {}): Promise<string> {
  const p = JOB_POLICIES[type];
  const { id } = await enqueueJob(dbOrTx, {
    type, payload, key: opts.key ?? null, priority: opts.priority ?? p.priority, maxAttempts: p.maxAttempts,
    expiresAt: p.startWithinMs === null ? null : new Date(Date.now() + p.startWithinMs),
  });
  return id;
}

/** How long the api-server waits for an awaited job: its start window, its stuck limit and ten seconds. `JOB_AWAIT_MAX_MS` caps it (tests). */
export function ceilingOf(type: JobType, env: Record<string, string | undefined> = process.env): number {
  const p = JOB_POLICIES[type];
  const ceiling = (p.startWithinMs ?? 0) + p.stuckMs + 10_000;
  const cap = Number(env.JOB_AWAIT_MAX_MS);
  return Number.isFinite(cap) && cap > 0 ? Math.min(ceiling, cap) : ceiling;
}

/** Enqueue and wait for the answer (the procedures that answered from a browser in the request). */
export async function runAndWait<T extends JobType>(type: T, payload: JobPayloads[T], opts: { key?: string | null } = {}): Promise<unknown> {
  const id = await enqueue(db, type, payload, opts);
  return awaitJob(id, ceilingOf(type));
}
