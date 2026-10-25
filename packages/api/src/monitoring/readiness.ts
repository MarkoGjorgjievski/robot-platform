// GET /readyz's checks (spec 2026-10-25 monitoring §2.1): db (SELECT 1 within 2 s), migrations (applied ≥ bundled),
// worker (a beat on this queue within 2 minutes), queue (no backlog nobody is taking). Names and booleans only (§3.3).
// A database that does not answer fails every check without reading the others.
import { sql } from 'drizzle-orm';
import { db, migrationCount } from '@robot/db';
import { DEAD_WORKER_MS } from './heartbeat.js';
import { findBacklog } from './attention.js';

export const READY_TIMEOUT_MS = 2000;
export type ReadinessChecks = { db: boolean; migrations: boolean; worker: boolean; queue: boolean };
export type Readiness = { ok: boolean; checks: ReadinessChecks };

function within<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([p, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms); })])
    .finally(() => clearTimeout(timer));
}

export async function readiness(opts: { queue: string; ping?: () => Promise<unknown>; expectedMigrations?: () => number; timeoutMs?: number }): Promise<Readiness> {
  const ms = opts.timeoutMs ?? READY_TIMEOUT_MS;
  const checks: ReadinessChecks = { db: false, migrations: false, worker: false, queue: false };
  try {
    await within(Promise.resolve().then(() => (opts.ping ?? (() => db.execute(sql`SELECT 1`)))()), ms);
    checks.db = true;
  } catch {
    return { ok: false, checks };
  }
  const [m, w, q] = await Promise.allSettled([
    within(db.execute(sql`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`), ms),
    within(db.execute(sql`SELECT 1 FROM workers WHERE queue = ${opts.queue}
      AND beat_at > now() - make_interval(secs => ${DEAD_WORKER_MS / 1000}) LIMIT 1`), ms),
    within(findBacklog(opts.queue, { limit: 1 }), ms),
  ]);
  checks.migrations = m.status === 'fulfilled' && Number((m.value as unknown as Array<{ n: number }>)[0]?.n ?? 0) >= (opts.expectedMigrations ?? migrationCount)();
  checks.worker = w.status === 'fulfilled' && (w.value as unknown as unknown[]).length > 0;
  checks.queue = q.status === 'fulfilled' && q.value.length === 0;
  return { ok: checks.db && checks.migrations && checks.worker && checks.queue, checks };
}
