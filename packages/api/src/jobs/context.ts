// The job a piece of code is running in (spec §4.3): the runner sets it around each handler; rows a
// job inserts are stamped with its id, and the browser gate reads its lane and closes its browsers.
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Lane } from './types.js';

export type JobContext = {
  jobId: string;
  /** This claim of the job (its lock owner): the browser gate tracks a hold's browsers by it. */
  claim: string;
  type: string; lane: Lane; attempt: number;
  /** The job was started before (a retry, or given back at shutdown): an earlier start may have left work half-done. */
  retry: boolean;
  signal: AbortSignal; progress: () => void;
};

const store = new AsyncLocalStorage<JobContext>();

export function currentJob(): JobContext | undefined { return store.getStore(); }
export function currentJobId(): string | null { return store.getStore()?.jobId ?? null; }
export function runInJob<T>(ctx: JobContext, fn: () => Promise<T>): Promise<T> { return store.run(ctx, fn); }

/**
 * The job this code runs in was stopped (stuck, its lease lost, shutdown). Its handler writes no outcome
 * from then on: the browser it was using was closed under it, so whatever it would write is the stop, not
 * the page — and the row is the runner's (stuck: closed 'stalled') or the next claim's (given back, reaped).
 */
export function jobStopped(): boolean { return store.getStore()?.signal.aborted === true; }
