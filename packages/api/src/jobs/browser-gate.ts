// The one place that limits browsers (spec 2026-10-23 §4.3): at most `max` Chromium processes in the
// worker, interactive jobs served before background before runs, none started while free memory is
// under `minFreeMb` (at most `memoryWaitMs`, then it launches anyway), each tracked by its job so a
// stopped job's browsers — or all of them, at shutdown — can be closed.
//
// Interactive work never waits behind long jobs (final review I2): background and runs together hold at
// most `max - 1` browsers, so one is always free for a customer's capture or check (with `max` 1 there is
// nothing to keep back). A job waiting here — for a browser or for memory — is making progress: the wait
// never counts toward its stuck limit.
import os from 'node:os';
import type { IBrowser } from '@robot/browser';
import type { BrowserGate } from '../browser-session.js';
import { currentJob } from './context.js';

export type WorkerBrowserGate = BrowserGate & { open(): number; /** Closes the browsers of one hold of a job (`JobContext.claim`), not of a later claim of it. */ closeJob(claim: string): Promise<void>; closeAll(): Promise<void> };

const RANK = { interactive: 0, background: 1, runs: 2 } as const;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createBrowserGate(opts: { max: number; minFreeMb?: number; freeMb?: () => number; memoryWaitMs?: number; pollMs?: number }): WorkerBrowserGate {
  /** Browsers background and runs may hold together: all but one, kept for interactive work. */
  const longMax = opts.max > 1 ? opts.max - 1 : opts.max;
  let inUse = 0;
  let longInUse = 0;
  let seq = 0;
  const waiters: Array<{ rank: number; seq: number; wake: () => void }> = [];
  const open = new Map<IBrowser, string | null>();
  const freeMb = opts.freeMb ?? (() => os.freemem() / 1_048_576);
  const pollMs = opts.pollMs ?? 1000;
  const pump = () => {
    waiters.sort((a, b) => a.rank - b.rank || a.seq - b.seq);
    // Interactive waiters first; the first long one that may not start ends it (every one after it is long too).
    while (inUse < opts.max && waiters.length > 0) {
      const next = waiters[0]!;
      const long = next.rank > 0;
      if (long && longInUse >= longMax) break;
      waiters.shift();
      inUse++;
      if (long) longInUse++;
      next.wake();
    }
  };
  return {
    async acquire() {
      const job = currentJob();
      const rank = RANK[job?.lane ?? 'background'];
      const long = rank > 0;
      let released = false;
      const release = () => { if (released) return; released = true; inUse--; if (long) longInUse--; pump(); };
      // Waiting in the queue is progress: the job's stuck clock does not run while the gate holds it back.
      const ticking = job ? setInterval(() => job.progress(), pollMs) : undefined;
      try {
        await new Promise<void>((wake) => { waiters.push({ rank, seq: seq++, wake }); pump(); });
        if (job?.signal.aborted) { release(); throw new Error('The job was stopped before its browser started.'); }
        const until = Date.now() + (opts.memoryWaitMs ?? 120_000);
        while (freeMb() < (opts.minFreeMb ?? 0) && Date.now() < until && !job?.signal.aborted) { job?.progress(); await sleep(pollMs); }
        if (job?.signal.aborted) { release(); throw new Error('The job was stopped before its browser started.'); }
      } finally {
        clearInterval(ticking);
      }
      // Its stuck limit counts from here: the browser is its own.
      job?.progress();
      return release;
    },
    track(browser) {
      open.set(browser, currentJob()?.claim ?? null);
      return () => { open.delete(browser); };
    },
    open: () => open.size,
    async closeJob(claim) {
      await Promise.all([...open].filter(([, c]) => c === claim).map(([b]) => b.close().catch(() => {})));
    },
    async closeAll() {
      await Promise.all([...open.keys()].map((b) => b.close().catch(() => {})));
      open.clear();
    },
  };
}
