// packages/api/src/jobs/runner.ts
// The worker's loop (spec 2026-10-23 §4.3): three lanes claim jobs while they have a slot and memory;
// every held job's lease is renewed each quarter lease; lapsed leases (a crashed worker) are reaped
// every 15 s; a job with no progress past its limit is stopped; shutdown gives running jobs back.
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { db } from '@robot/db';
import type { JobPolicy, Lane } from './types.js';
import { runSentenceFor } from './types.js';
import type { JobSubject } from './rows.js';
import { closeJobRows } from './rows.js';
import { runInJob, type JobContext } from './context.js';
import { serializeError } from './errors.js';
import type { WorkerBrowserGate } from './browser-gate.js';
import { claimJob, completeJob, failJobTerminal, purgeJobs, reapJobs, releaseJob, renewLease, retryJob, type JobRow } from './queue.js';

export type JobDefinition = {
  policy: JobPolicy;
  /** The status row the payload names, reused by a retry (every other row the job owns is closed first). */
  subject?: (payload: any) => JobSubject | null;
  run: (payload: any, ctx: JobContext) => Promise<unknown>;
};
export type Registry = Record<string, JobDefinition>;

export type RunnerOptions = {
  queue: string;
  registry: Registry;
  lanes: Record<Lane, number>;
  leaseMs?: number;
  pollMs?: number;
  reapEveryMs?: number;
  stuckCheckMs?: number;
  retryBaseMs?: number;
  minFreeMb?: number;
  freeMb?: () => number;
  browsers?: Pick<WorkerBrowserGate, 'closeJob' | 'closeAll'>;
  workerName?: string;
  log?: (line: string) => void;
};

export type JobRunner = { workerId: string; active(): number; stop(graceMs?: number): Promise<void> };

type Active = { job: JobRow; def: JobDefinition; controller: AbortController; lastProgress: number; over: boolean; settled: Promise<void> };

/** At shutdown, how long an aborted handler may take to unwind before its job is given back. */
const UNWIND_MS = 2000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function startJobRunner(opts: RunnerOptions): JobRunner {
  const workerId = `${opts.workerName ?? os.hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  const leaseMs = opts.leaseMs ?? 60_000;
  const pollMs = opts.pollMs ?? 500;
  const retryBase = opts.retryBaseMs ?? 30_000;
  const log = opts.log ?? ((line: string) => console.log(`[worker] ${line}`));
  const freeMb = opts.freeMb ?? (() => os.freemem() / 1_048_576);
  const backoff = (attempt: number) => retryBase * 2 ** Math.max(attempt - 1, 0);
  /** The jobs held here, by claim (a job reaped from this worker and claimed by it again is a second hold). */
  const active = new Map<string, Active>();
  /** Outcome writes still in flight (a job's slot is free before its row says so); stop waits for them. */
  const settling = new Set<Promise<unknown>>();
  const track = (p: Promise<unknown>) => { settling.add(p); void p.finally(() => settling.delete(p)); };
  let stopping = false;

  /** The claim's owner: every write of a hold passes it, so none reaches a later claim of the job. */
  const owner = (job: JobRow) => job.lockedBy!;

  /** An outcome write that found the job no longer this hold's (reaped, and maybe claimed again): nothing written. */
  const lostBefore = (job: JobRow, what: string) => log(`lost the lease on ${job.type} ${job.id} before ${what}`);

  const count = (pred: (a: Active) => boolean) => [...active.values()].filter(pred).length;

  /** Ends a job's hold here: the slot is free at once, whatever its handler still does. */
  const finish = (a: Active) => { a.over = true; if (active.get(owner(a.job)) === a) active.delete(owner(a.job)); };

  const start = (job: JobRow) => {
    const def = opts.registry[job.type]!;
    const controller = new AbortController();
    const a: Active = { job, def, controller, lastProgress: Date.now(), over: false, settled: Promise.resolve() };
    active.set(owner(job), a);
    const ctx: JobContext = {
      jobId: job.id, claim: owner(job), type: job.type, lane: def.policy.lane, attempt: job.attempts, retry: job.startedBefore ?? job.attempts > 1, signal: controller.signal,
      progress: () => { a.lastProgress = Date.now(); },
    };
    log(`claimed ${job.type} ${job.id} (attempt ${job.attempts} of ${job.maxAttempts})`);
    a.settled = (async () => {
      let value: unknown;
      try {
        // Started before (a retry, or given back at attempt 1): the rows an earlier start left half-done
        // are closed, except the one the payload names.
        if (ctx.retry) await closeJobRows(db, job.id, { runSentence: runSentenceFor(job.type), except: def.subject?.(job.payload) ?? null });
        value = await runInJob(ctx, () => def.run(job.payload, ctx));
      } catch (err) {
        if (a.over) return;
        finish(a);
        track((async () => {
          if (job.attempts < job.maxAttempts) {
            if (await retryJob(job.id, owner(job), msg(err), backoff(job.attempts))) log(`retry ${job.type} ${job.id} after: ${msg(err)}`);
            else lostBefore(job, `its failure was recorded: ${msg(err)}`);
          } else if (await failJobTerminal(job.id, { owner: owner(job) }, serializeError(err), runSentenceFor(job.type))) {
            log(`failed ${job.type} ${job.id}: ${msg(err)}`);
          } else lostBefore(job, `its failure was recorded: ${msg(err)}`);
        })().catch((recordErr) => log(`could not record the failure of ${job.id}: ${msg(recordErr)}`)));
        return;
      }
      if (a.over) return;
      finish(a);
      track((async () => {
        if (await completeJob(job.id, owner(job), value ?? null)) log(`done ${job.type} ${job.id}`);
        else lostBefore(job, 'its answer was recorded');
      })().catch((recordErr) => log(`could not record the answer of ${job.id}: ${msg(recordErr)}`)));
    })();
  };

  const laneLoop = async (lane: Lane) => {
    while (!stopping) {
      const busy = count((a) => a.def.policy.lane === lane);
      if (busy >= opts.lanes[lane] || freeMb() < (opts.minFreeMb ?? 0)) { await sleep(pollMs); continue; }
      const types = Object.entries(opts.registry)
        .filter(([type, d]) => d.policy.lane === lane && (d.policy.maxConcurrent === undefined || count((a) => a.job.type === type) < d.policy.maxConcurrent))
        .map(([type]) => type);
      let job: JobRow | null = null;
      try {
        job = await claimJob({ queue: opts.queue, workerId, types, leaseMs });
      } catch (err) {
        log(`claim failed: ${msg(err)}`);
      }
      if (!job) { await sleep(pollMs); continue; }
      if (stopping) { await releaseJob(job.id, owner(job)).catch(() => {}); break; }
      start(job);
    }
  };

  const heartbeat = setInterval(() => {
    for (const a of [...active.values()]) {
      void renewLease(a.job.id, owner(a.job), leaseMs).then(async (held) => {
        if (held || a.over) return;
        // Another worker reaped it (this one looked dead): stop here; that worker owns the job now.
        finish(a);
        a.controller.abort('lease lost');
        await opts.browsers?.closeJob(owner(a.job));
        log(`lost the lease on ${a.job.type} ${a.job.id}; stopped it here`);
      }).catch(() => { /* a database blip is not a lost lease */ });
    }
  }, Math.max(250, Math.floor(leaseMs / 4)));

  const stuckCheck = setInterval(() => {
    for (const a of [...active.values()]) {
      if (a.over || Date.now() - a.lastProgress < a.def.policy.stuckMs) continue;
      finish(a);
      a.controller.abort('stuck');
      track((async () => {
        await opts.browsers?.closeJob(owner(a.job)).catch(() => {});
        const recorded = a.def.policy.retryOnStuck && a.job.attempts < a.job.maxAttempts
          ? await retryJob(a.job.id, owner(a.job), 'stuck', backoff(a.job.attempts))
          : await failJobTerminal(a.job.id, { owner: owner(a.job) }, { kind: 'unavailable', message: 'stalled' }, runSentenceFor(a.job.type));
        if (recorded) log(`stuck ${a.job.type} ${a.job.id}: no progress for ${a.def.policy.stuckMs} ms`);
        else lostBefore(a.job, 'it was stopped as stuck');
      })().catch((err) => log(`could not stop ${a.job.id}: ${msg(err)}`)));
    }
  }, opts.stuckCheckMs ?? 5000);

  let reaps = 0;
  const reap = async () => {
    try {
      const r = await reapJobs(opts.queue, { retryBaseMs: retryBase });
      for (const id of r.retried) log(`reaped ${id}: its worker stopped answering; retrying`);
      for (const id of r.failed) log(`reaped ${id}: its worker stopped answering; no attempts left`);
      for (const id of r.expired) log(`expired ${id}: not started in time`);
      if (reaps++ % 240 === 0) await purgeJobs(opts.queue);
    } catch (err) {
      log(`reap failed: ${msg(err)}`);
    }
  };
  track(reap());
  const reaper = setInterval(() => track(reap()), opts.reapEveryMs ?? 15_000);

  const loops = (['interactive', 'background', 'runs'] as Lane[]).filter((l) => opts.lanes[l] > 0).map((l) => laneLoop(l));

  return {
    workerId,
    active: () => active.size,
    async stop(graceMs = 25_000) {
      stopping = true;
      const deadline = Date.now() + graceMs;
      while (active.size > 0 && Date.now() < deadline) await sleep(50);
      // The rest: stopped here, their browsers closed and their handlers given a moment to unwind, and
      // only then given back — so no browser of this worker still works a job another worker has claimed.
      const left = [...active.values()];
      for (const a of left) { finish(a); a.controller.abort('shutdown'); }
      await Promise.all(left.map((a) => opts.browsers?.closeJob(owner(a.job)).catch(() => {})));
      let unwind: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([Promise.allSettled(left.map((a) => a.settled)), new Promise((r) => { unwind = setTimeout(r, UNWIND_MS); })]);
      clearTimeout(unwind);
      for (const a of left) {
        await releaseJob(a.job.id, owner(a.job)).catch(() => {});
        log(`gave back ${a.job.type} ${a.job.id} (shutdown)`);
      }
      clearInterval(heartbeat); clearInterval(stuckCheck); clearInterval(reaper);
      await Promise.all(loops);
      await Promise.allSettled([...settling]);
      await opts.browsers?.closeAll().catch(() => {});
    },
  };
}
