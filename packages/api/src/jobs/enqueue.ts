// packages/api/src/jobs/enqueue.ts
// The one way api code starts a job: the type's policy decides its priority, attempts and window.
import { createHash } from 'node:crypto';
import { db } from '@robot/db';
import { JOB_POLICIES, type JobPayloads, type JobType } from './types.js';
import { awaitJob, enqueueJob, type DbOrTx } from './queue.js';

export async function enqueue<T extends JobType>(dbOrTx: DbOrTx, type: T, payload: JobPayloads[T], opts: { key?: string | null; priority?: number; runAfter?: Date } = {}): Promise<string> {
  const p = JOB_POLICIES[type];
  const { id } = await enqueueJob(dbOrTx, {
    type, payload, key: opts.key ?? null, priority: opts.priority ?? p.priority, maxAttempts: p.maxAttempts,
    startWithinMs: p.startWithinMs, runAfter: opts.runAfter,
  });
  return id;
}

/**
 * A job key made from an address (final review I3): `<prefix>:<sha1 of the url>`, so a key is one length
 * whatever the address (jobs.key holds 200 characters; a listing or product URL can be longer).
 */
export function urlKey(prefix: string, url: string): string {
  return `${prefix}:${createHash('sha1').update(url).digest('hex')}`;
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
