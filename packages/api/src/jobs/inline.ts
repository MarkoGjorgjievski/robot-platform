// Operator scripts run their work inline, in their own process, with no browser gate (spec 2026-10-23 §3.4).
// What that work enqueues on the way — the drift check a run starts, the check after a Verify's holds —
// would otherwise wait for a worker: `startInlineJobs` gives the script its own private queue and an
// in-process runner for it, and `drain` waits for those jobs before the script exits (M5). No worker of
// Marko's ever sees the queue, and its rows are deleted at the end.
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db } from '@robot/db';
import { openJobCount } from './queue.js';
import { startJobRunner, type Registry } from './runner.js';

export type InlineJobs = { queue: string; drain(timeoutMs?: number): Promise<void> };

/** Call before anything is enqueued: from here on, this process enqueues on its own queue and runs it. */
export async function startInlineJobs(name: string, opts: { registry?: Registry; log?: (line: string) => void } = {}): Promise<InlineJobs> {
  const queue = `${name}-${randomUUID()}`.slice(0, 64);
  process.env.JOB_QUEUE = queue;
  const registry = opts.registry ?? (await import('./handlers.js')).jobRegistry();
  const log = opts.log ?? ((line: string) => console.log(`[${name} jobs] ${line}`));
  const runner = startJobRunner({ queue, registry, lanes: { interactive: 1, background: 1, runs: 1 }, pollMs: 200, workerName: name, log });
  return {
    queue,
    async drain(timeoutMs = 30 * 60_000) {
      const until = Date.now() + timeoutMs;
      try {
        while ((await openJobCount(queue)) > 0 && Date.now() < until) await new Promise((r) => setTimeout(r, 500));
        if ((await openJobCount(queue)) > 0) log(`jobs still open after ${timeoutMs} ms; stopping them`);
      } finally {
        await runner.stop(5000);
        await db.execute(sql`DELETE FROM jobs WHERE queue = ${queue}`);
      }
    },
  };
}
