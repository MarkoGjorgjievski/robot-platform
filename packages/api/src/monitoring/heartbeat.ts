// The worker heartbeat (spec 2026-10-25 monitoring §2.1): the row in `workers`, upserted at start and every 30 s on
// the database's clock, deleted on a clean stop; a beat older than 2 minutes is a dead worker; every beat purges rows
// older than a day. Best-effort (§3.2): a failed beat is one warn line per streak and never touches a job.
import { sql } from 'drizzle-orm';
import { db } from '@robot/db';
import type { Lane } from '../jobs/types.js';
import { createLog, type Log } from './log.js';

export const HEARTBEAT_MS = 30_000;
export const DEAD_WORKER_MS = 120_000;
export const WORKER_ROW_TTL_MS = 86_400_000;

export type WorkerState = { browsers: { inUse: number; max: number }; lanes: Record<Lane, number>; websiteChecks: boolean; recurringRuns: boolean };
export type HeartbeatRow = { id: string; queue: string; startedAt: Date; version: string } & WorkerState;
export type Heartbeat = { lastBeatAt(): number | null; beat(): Promise<boolean>; stop(): Promise<void> };

export async function writeBeat(row: HeartbeatRow): Promise<void> {
  await db.execute(sql`INSERT INTO workers (id, queue, started_at, beat_at, version, browsers, lanes, website_checks, recurring_runs)
    VALUES (${row.id}, ${row.queue}, ${row.startedAt.toISOString()}::timestamptz, now(), ${row.version},
            ${JSON.stringify(row.browsers)}::jsonb, ${JSON.stringify(row.lanes)}::jsonb, ${row.websiteChecks}, ${row.recurringRuns})
    ON CONFLICT (id) DO UPDATE SET beat_at = now(), queue = EXCLUDED.queue, version = EXCLUDED.version, browsers = EXCLUDED.browsers,
      lanes = EXCLUDED.lanes, website_checks = EXCLUDED.website_checks, recurring_runs = EXCLUDED.recurring_runs`);
  await db.execute(sql`DELETE FROM workers WHERE beat_at < now() - make_interval(secs => ${WORKER_ROW_TTL_MS / 1000})`);
}

export async function removeWorkerRow(id: string): Promise<void> {
  await db.execute(sql`DELETE FROM workers WHERE id = ${id}`);
}

export function startHeartbeat(opts: {
  workerId: string; queue: string; version: string; state: () => WorkerState; everyMs?: number; log?: Log;
  write?: (row: HeartbeatRow) => Promise<void>; remove?: (id: string) => Promise<void>;
}): Heartbeat {
  const log = opts.log ?? createLog('heartbeat');
  const write = opts.write ?? writeBeat;
  const startedAt = new Date();
  let last: number | null = null;
  let failing = false;
  let stopped = false;
  let inFlight: Promise<boolean> | null = null;
  const beat = (): Promise<boolean> => {
    if (stopped) return Promise.resolve(false);
    if (inFlight) return inFlight;
    // Cleared once settled, by identity: a state() that throws settles before the promise is even assigned.
    const p = (async () => {
      try {
        await write({ id: opts.workerId, queue: opts.queue, startedAt, version: opts.version, ...opts.state() });
        last = Date.now();
        if (failing) { failing = false; log.info('beating again', { workerId: opts.workerId }); }
        return true;
      } catch (err) {
        if (!failing) { failing = true; log.warn('heartbeat failed; trying again every beat', { workerId: opts.workerId, error: err }); }
        return false;
      }
    })();
    inFlight = p;
    void p.finally(() => { if (inFlight === p) inFlight = null; });
    return p;
  };
  void beat();
  const timer = setInterval(() => void beat(), opts.everyMs ?? HEARTBEAT_MS);
  timer.unref?.();
  return {
    lastBeatAt: () => last,
    beat,
    async stop() {
      stopped = true;
      clearInterval(timer);
      await inFlight?.catch(() => false);
      await (opts.remove ?? removeWorkerRow)(opts.workerId)
        .catch((err: unknown) => log.warn('could not remove the worker row', { workerId: opts.workerId, error: err }));
    },
  };
}
