// The job a piece of code is running in (spec §4.3): the runner sets it around each handler; rows a
// job inserts are stamped with its id, and the browser gate reads its lane and closes its browsers.
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Lane } from './types.js';

export type JobContext = { jobId: string; type: string; lane: Lane; attempt: number; signal: AbortSignal; progress: () => void };

const store = new AsyncLocalStorage<JobContext>();

export function currentJob(): JobContext | undefined { return store.getStore(); }
export function currentJobId(): string | null { return store.getStore()?.jobId ?? null; }
export function runInJob<T>(ctx: JobContext, fn: () => Promise<T>): Promise<T> { return store.run(ctx, fn); }
