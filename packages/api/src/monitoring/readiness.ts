// GET /readyz's checks (spec 2026-10-25 monitoring §2.1): db (SELECT 1 within 2 s), migrations (applied ≥ bundled),
// worker (a beat on this queue within 2 minutes), queue (no backlog nobody is taking). Names and booleans only (§3.3).
// A database that does not answer fails every check without reading the others; an unreadable migration journal fails
// only `migrations`. The api-server reuses an answer for 2 s (cachedReadiness).
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
  let bundled: number | null = null;
  try { bundled = (opts.expectedMigrations ?? migrationCount)(); } catch { /* an unreadable journal fails migrations only */ }
  checks.migrations = bundled !== null && m.status === 'fulfilled' && Number((m.value as unknown as Array<{ n: number }>)[0]?.n ?? 0) >= bundled;
  checks.worker = w.status === 'fulfilled' && (w.value as unknown as unknown[]).length > 0;
  checks.queue = q.status === 'fulfilled' && q.value.length === 0;
  return { ok: checks.db && checks.migrations && checks.worker && checks.queue, checks };
}

/** How long one readiness answer is reused: /readyz is anonymous, so a burst of calls costs one check. */
export const READY_CACHE_MS = 2000;

/**
 * `check` at most once per `ttlMs` (from when it answered); callers while it runs share that one call. A check that
 * throws is not kept, so the next caller checks again.
 */
export function cachedReadiness(check: () => Promise<Readiness>, opts: { ttlMs?: number; now?: () => number } = {}): () => Promise<Readiness> {
  const ttl = opts.ttlMs ?? READY_CACHE_MS;
  const now = opts.now ?? Date.now;
  let kept: { at: number; value: Readiness } | null = null;
  let inFlight: Promise<Readiness> | null = null;
  return () => {
    if (kept && now() - kept.at < ttl) return Promise.resolve(kept.value);
    if (inFlight) return inFlight;
    inFlight = Promise.resolve().then(check).then(
      (value) => { kept = { at: now(), value }; inFlight = null; return value; },
      (err: unknown) => { inFlight = null; throw err; },
    );
    return inFlight;
  };
}
