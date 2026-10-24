// packages/api/src/recurring/sweep.ts
// The schedule sweep (spec 2026-10-24 §3.2): every minute the worker claims due websites one at a time
// (`FOR UPDATE SKIP LOCKED`, so two workers never start the same run), moves `next_run_at` on from now (a worker
// that was down fires each website once), records the outcome in `schedule_last` and — when the website may run —
// writes a `planning` run labelled `scheduled` and its `scheduled-run` job, all in one transaction. A refusal is
// recorded and waits for the next scheduled time. `only` restricts a sweep to those websites: every test passes it.
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { db, runs, sources, type Database } from '@robot/db';
import { requireCertification } from '../crawl/require-certification.js';
import { enqueue } from '../jobs/enqueue.js';
import type { DbOrTx } from '../jobs/queue.js';
import { nextRunAt, parseSchedule, SCHEDULED_LABEL, type ScheduleLast, type SkipReason } from './schedule.js';

/** At most this many websites per sweep. */
export const RECURRING_SWEEP_LIMIT = 6;
const SWEEP_EVERY_MS = 60_000;
const FIRST_SWEEP_MS = 10_000;
/** A run in these states is still going: the schedule waits for its next time. */
const GOING = ['planning', 'extracting', 'cancelling'];

export type SweepOutcome = ScheduleLast & { sourceId: string };

/** On unless `RECURRING_RUNS` is `off`. */
export function recurringRunsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.RECURRING_RUNS ?? '').trim().toLowerCase() !== 'off';
}

/** The first rule a claimed website breaks (spec §3.2's table, in its order), or null when it may run. */
async function skipReason(tx: DbOrTx, s: { id: string; isActive: boolean; listingMode: string | null; confirmedAt: Date | null }): Promise<SkipReason | null> {
  if (!s.isActive) return 'paused';
  try {
    await requireCertification(tx as unknown as Database, s.id);
  } catch (err) {
    if (err instanceof TRPCError) return 'not_certified';
    throw err;
  }
  if (s.listingMode === 'listing_to_detail' && !s.confirmedAt) return 'not_confirmed';
  const going = await tx.query.runs.findFirst({ where: and(eq(runs.sourceId, s.id), inArray(runs.status, GOING)), columns: { id: true } });
  return going ? 'busy' : null;
}

/** One due website: claimed, moved on, its outcome recorded, and its run started when it may run. Null: none due. */
export async function sweepOne(opts: { only?: string[] } = {}): Promise<SweepOutcome | null> {
  if (opts.only && opts.only.length === 0) return null;
  const only = opts.only ? sql`AND id IN (${sql.join(opts.only.map((id) => sql`${id}::uuid`), sql`, `)})` : sql``;
  return db.transaction(async (tx) => {
    const picked = (await tx.execute(sql`
      SELECT id FROM sources
       WHERE schedule IS NOT NULL AND next_run_at IS NOT NULL AND next_run_at <= now() ${only}
       ORDER BY next_run_at ASC, id
       LIMIT 1
       FOR UPDATE SKIP LOCKED`)) as unknown as Array<{ id: string }>;
    if (!picked[0]) return null;
    const id = String(picked[0].id);
    const s = (await tx.query.sources.findFirst({
      where: eq(sources.id, id),
      columns: { id: true, schedule: true, isActive: true, listingMode: true, confirmedAt: true },
    }))!;
    const at = new Date();
    const parsed = parseSchedule(s.schedule);
    if (!parsed.ok) {
      // A stored schedule that no longer reads never fires again, rather than once a minute.
      await tx.update(sources).set({ nextRunAt: null }).where(eq(sources.id, id));
      return { sourceId: id, at: at.toISOString(), outcome: 'skipped' };
    }
    const reason = await skipReason(tx, s);
    let last: ScheduleLast;
    if (reason) {
      last = { at: at.toISOString(), outcome: 'skipped', reason };
    } else {
      const runId = randomUUID();
      const jobId = await enqueue(tx, 'scheduled-run', { sourceId: id, runId }, { key: `scheduled-run:${runId}` });
      await tx.insert(runs).values({ id: runId, sourceId: id, status: 'planning', startedAt: at, inputLabel: SCHEDULED_LABEL, jobId });
      last = { at: at.toISOString(), outcome: 'started', runId };
    }
    await tx.update(sources).set({ nextRunAt: nextRunAt(parsed.schedule, at), scheduleLast: last }).where(eq(sources.id, id));
    return { sourceId: id, ...last };
  });
}

/** One sweep: due websites one at a time, at most `limit`. */
export async function sweepDueSchedules(opts: { limit?: number; only?: string[] } = {}): Promise<SweepOutcome[]> {
  const out: SweepOutcome[] = [];
  for (let i = 0; i < (opts.limit ?? RECURRING_SWEEP_LIMIT); i++) {
    const one = await sweepOne(opts.only ? { only: opts.only } : {});
    if (!one) break;
    out.push(one);
  }
  return out;
}

/** The worker's timer: a first sweep after `firstDelayMs`, then one every `intervalMs`; never two at once; off sets none. */
export function startRecurringRuns(opts: { enabled: boolean; intervalMs?: number; firstDelayMs?: number; sweep?: () => Promise<unknown> }): () => void {
  if (!opts.enabled) return () => {};
  const sweep = opts.sweep ?? (() => sweepDueSchedules());
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await sweep(); } catch (err) { console.error('[recurring] sweep failed:', err); } finally { running = false; }
  };
  let interval: ReturnType<typeof setInterval> | null = null;
  const first = setTimeout(() => {
    void tick();
    interval = setInterval(() => void tick(), opts.intervalMs ?? SWEEP_EVERY_MS);
    interval.unref?.();
  }, opts.firstDelayMs ?? FIRST_SWEEP_MS);
  first.unref?.();
  return () => { clearTimeout(first); if (interval) clearInterval(interval); };
}
