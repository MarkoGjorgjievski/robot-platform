// Runs this test file's queue in-process: module mocks (browser-session, plan-source, …) apply to the
// handlers exactly as they did to the old fire-and-forget bodies. Never a real browser unless the test
// itself provides one.
import { eq, and, asc } from 'drizzle-orm';
import { db, jobs } from '@robot/db';
import { jobQueueName, openJobCount, type JobRow } from '../jobs/queue.js';
import { startJobRunner, type Registry } from '../jobs/runner.js';
import type { JobContext } from '../jobs/context.js';

async function registryOrDefault(registry?: Registry): Promise<Registry> {
  if (registry) return registry;
  const { jobRegistry } = await import('../jobs/handlers.js');
  return jobRegistry();
}

const runnerFor = (registry: Registry) => startJobRunner({
  queue: jobQueueName(), registry, lanes: { interactive: 3, background: 2, runs: 1 },
  pollMs: 25, reapEveryMs: 60_000, retryBaseMs: 10, log: () => {},
});

/** Runs `fn` (a procedure that awaits a job) with a runner working this file's queue. */
export async function withJobRunner<T>(fn: () => Promise<T>, opts: { registry?: Registry } = {}): Promise<T> {
  const runner = runnerFor(await registryOrDefault(opts.registry));
  try { return await fn(); } finally { await runner.stop(5000); }
}

/** Runs every due job of this file's queue (and the jobs they enqueue) until none is left. */
export async function runQueuedJobs(opts: { registry?: Registry; timeoutMs?: number } = {}): Promise<void> {
  const runner = runnerFor(await registryOrDefault(opts.registry));
  const until = Date.now() + (opts.timeoutMs ?? 30_000);
  try {
    while ((await openJobCount(jobQueueName())) > 0) {
      if (Date.now() > until) throw new Error('jobs still open after the timeout');
      await new Promise((r) => setTimeout(r, 25));
    }
  } finally { await runner.stop(5000); }
}

/** This file's queue's jobs of a type, oldest first. */
export async function jobsOf(type: string): Promise<JobRow[]> {
  const found = await db.query.jobs.findMany({ where: and(eq(jobs.queue, jobQueueName()), eq(jobs.type, type)), orderBy: [asc(jobs.createdAt)] });
  return found as unknown as JobRow[];
}

/** A job context for running a handler body inline, as the runner would; abort `controller` to stop it. */
export function jobContext(type: string, controller = new AbortController(), opts: { jobId?: string; retry?: boolean } = {}): JobContext {
  return {
    jobId: opts.jobId ?? '00000000-0000-4000-8000-000000000000', claim: 'test#00000000', type, lane: 'background', attempt: 1,
    retry: opts.retry ?? false, signal: controller.signal, progress: () => {},
  };
}
