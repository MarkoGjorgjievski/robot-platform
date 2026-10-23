// The one place that limits browsers (spec 2026-10-23 §4.3): at most `max` Chromium processes in the
// worker, interactive jobs served before background before runs, none started while free memory is
// under `minFreeMb` (at most `memoryWaitMs`, then it launches anyway), each tracked by its job so a
// stopped job's browsers — or all of them, at shutdown — can be closed.
import os from 'node:os';
import type { IBrowser } from '@robot/browser';
import type { BrowserGate } from '../browser-session.js';
import { currentJob } from './context.js';

export type WorkerBrowserGate = BrowserGate & { open(): number; /** Closes the browsers of one hold of a job (`JobContext.claim`), not of a later claim of it. */ closeJob(claim: string): Promise<void>; closeAll(): Promise<void> };

const RANK = { interactive: 0, background: 1, runs: 2 } as const;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createBrowserGate(opts: { max: number; minFreeMb?: number; freeMb?: () => number; memoryWaitMs?: number; pollMs?: number }): WorkerBrowserGate {
  let inUse = 0;
  let seq = 0;
  const waiters: Array<{ rank: number; seq: number; wake: () => void }> = [];
  const open = new Map<IBrowser, string | null>();
  const freeMb = opts.freeMb ?? (() => os.freemem() / 1_048_576);
  const pump = () => {
    waiters.sort((a, b) => a.rank - b.rank || a.seq - b.seq);
    while (inUse < opts.max && waiters.length > 0) { inUse++; waiters.shift()!.wake(); }
  };
  const release = () => { inUse--; pump(); };
  return {
    async acquire() {
      const job = currentJob();
      await new Promise<void>((wake) => { waiters.push({ rank: RANK[job?.lane ?? 'background'], seq: seq++, wake }); pump(); });
      if (job?.signal.aborted) { release(); throw new Error('The job was stopped before its browser started.'); }
      const until = Date.now() + (opts.memoryWaitMs ?? 120_000);
      while (freeMb() < (opts.minFreeMb ?? 0) && Date.now() < until && !job?.signal.aborted) await sleep(opts.pollMs ?? 1000);
      if (job?.signal.aborted) { release(); throw new Error('The job was stopped before its browser started.'); }
      let released = false;
      return () => { if (!released) { released = true; release(); } };
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
