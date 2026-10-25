// The stuck-job watchdog (spec 2026-10-25 monitoring §2.3): every 60 s each worker reads what needs attention on its
// queue and warns once per job and kind per hour (in memory). It only logs (§3.2).
import { createLog, type Log } from './log.js';
import { findAttention, type AttentionItem } from './attention.js';

export const WATCH_EVERY_MS = 60_000;
export const WARN_AGAIN_MS = 3_600_000;

const minutes = (ms: number) => Math.max(1, Math.round(ms / 60_000));

function sentence(i: AttentionItem): string {
  switch (i.kind) {
    case 'backlog': return `backlog: ${i.type} ${i.jobId} due ${minutes(i.ageMs)} min ago and nobody is taking it`;
    case 'silent': return `silent: ${i.type} ${i.jobId} running with no progress for ${Math.round(i.ageMs / 1000)} s`;
    case 'dead-worker': return `dead worker: ${i.type} ${i.jobId} is running under ${i.workerId}, which last beat ${minutes(i.ageMs)} min ago`;
  }
}

export async function watchJobs(queue: string, opts: {
  log: Log; seen: Map<string, number>; now?: () => number; find?: (queue: string) => Promise<AttentionItem[]>;
}): Promise<AttentionItem[]> {
  const now = (opts.now ?? Date.now)();
  for (const [key, at] of opts.seen) if (now - at >= WARN_AGAIN_MS) opts.seen.delete(key);
  const warned: AttentionItem[] = [];
  for (const i of await (opts.find ?? findAttention)(queue)) {
    const key = `${i.kind}:${i.jobId}`;
    if (opts.seen.has(key)) continue;
    opts.seen.set(key, now);
    warned.push(i);
    opts.log.warn(sentence(i), {
      kind: i.kind, jobId: i.jobId, type: i.type, lane: i.lane, ageMs: i.ageMs, workerId: i.workerId,
      sourceId: i.sourceId, runId: i.runId, lastError: i.lastError,
    });
  }
  return warned;
}

export function startWatchdog(opts: { queue: string; everyMs?: number; log?: Log; find?: (queue: string) => Promise<AttentionItem[]> }): () => void {
  const log = opts.log ?? createLog('watchdog');
  const seen = new Map<string, number>();
  let running = false;
  // A database outage is one warn line, then one line when the queue reads again — not one a minute.
  let down = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await watchJobs(opts.queue, { log, seen, ...(opts.find ? { find: opts.find } : {}) });
      if (down) { down = false; log.info('the watchdog reads the queue again'); }
    } catch (err) {
      if (!down) { down = true; log.warn('the watchdog could not read the queue', { error: err }); }
    } finally { running = false; }
  };
  const timer = setInterval(() => void tick(), opts.everyMs ?? WATCH_EVERY_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}
