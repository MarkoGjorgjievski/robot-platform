// packages/api/src/verify/website-checks.ts
// The scheduled website check (spec 2026-10-21 §3.3): every hour the worker's
// timer claims up to six websites whose `next_check_at` has passed and
// enqueues a `website-check` job for each (spec 2026-10-23 §4.3); the
// api-server has no timer. The job (`checkWebsite`) re-reads the website's
// proof pages (the drift check, trigger `schedule`, every certified field) and
// then samples its listing (the coverage check), both inline, so their rows
// belong to that job. Free: page loads and code only, within the worker's
// browser gate — no Jev, no model. The claim is `FOR UPDATE SKIP LOCKED`, so
// two sweeps on one database never claim the same website twice.
//
// Off by default (controller ruling 2026-10-21): the timer starts only with
// `WEBSITE_CHECKS=on`, so a dev worker never loads pages on its own.
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, runs, sources } from '@robot/db';
import type { VerificationSet } from '@robot/scraper';
import { loadCertificationState, runnableOf } from './current-certification.js';
import { resolveInFlightVerification } from './in-flight.js';
import { runDriftCheck, startDriftCheck, type CaptureProofPagesFn } from './run-drift-check.js';
import { runCoverageCheck, startCoverageCheck, type CoverageDeps } from './run-coverage-check.js';
import { websiteCheckDays } from './check-schedule.js';
import { enqueue } from '../jobs/enqueue.js';
import type { DbOrTx } from '../jobs/queue.js';
import { jobStopped } from '../jobs/context.js';
import { createLog } from '../monitoring/log.js';

const log = createLog('website-checks');

const HOUR_MS = 60 * 60 * 1000;
/** At most this many websites per sweep. */
export const SWEEP_LIMIT = 6;
const FIRST_SWEEP_MS = 10 * 60 * 1000;
/** A run in these states is working on the website: the check waits for it. */
const RUN_BUSY = ['extracting', 'cancelling'];

/** The timer runs only when `WEBSITE_CHECKS` is `on`; unset or anything else is off. */
export function websiteChecksEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.WEBSITE_CHECKS ?? '').trim().toLowerCase() === 'on';
}

/**
 * Claims one due website and moves its `next_check_at` on by the check interval, atomically. Due: never
 * checked or past its time, with a completed clean Verify. `only` restricts the claim to those websites —
 * every test passes it (the test database is Marko's).
 */
export async function claimDueWebsite(opts: { only?: string[]; days?: number; tx?: DbOrTx } = {}): Promise<string | null> {
  if (opts.only && opts.only.length === 0) return null;
  const seconds = Math.round((opts.days ?? websiteCheckDays()) * 86_400);
  const only = opts.only ? sql`AND s.id IN (${sql.join(opts.only.map((id) => sql`${id}::uuid`), sql`, `)})` : sql``;
  const result = await (opts.tx ?? db).execute(sql`
    UPDATE sources SET next_check_at = now() + make_interval(secs => ${seconds})
     WHERE id = (
       SELECT s.id FROM sources s
        WHERE s.schema_definition IS NOT NULL AND s.verification_set IS NOT NULL
          AND (s.next_check_at IS NULL OR s.next_check_at <= now())
          AND EXISTS (SELECT 1 FROM source_verifications v WHERE v.source_id = s.id AND v.completed_at IS NOT NULL AND v.error_message IS NULL)
          ${only}
        ORDER BY s.next_check_at ASC NULLS FIRST, s.id
        LIMIT 1
        FOR UPDATE SKIP LOCKED
     )
    RETURNING id
  `);
  // postgres-js via drizzle returns the row list itself (claim-item.ts's note).
  const row = (result as unknown as Array<{ id: string }>)[0];
  return row ? String(row.id) : null;
}

async function retryWithinTheHour(sourceId: string): Promise<'skipped'> {
  await db.update(sources).set({ nextCheckAt: new Date(Date.now() + HOUR_MS) }).where(eq(sources.id, sourceId));
  return 'skipped';
}

/**
 * One website's scheduled check: the proof pages, then (with a listing page) the listing sample, both awaited.
 * Not certified: skipped, and the claim's three days stand. Busy (a Verify in flight, a run extracting, a
 * check running): skipped, and tried again within the hour. `onPhase` is called when the drift check is done
 * (the job's progress, so its stuck limit counts each phase on its own).
 */
export async function checkWebsite(sourceId: string, deps: { capture?: CaptureProofPagesFn; coverage?: CoverageDeps; onPhase?: () => void } = {}): Promise<'checked' | 'skipped'> {
  const state = await loadCertificationState(db, sourceId);
  if (!runnableOf(state) || !state.cert) return 'skipped';
  if (await resolveInFlightVerification(db, sourceId)) return retryWithinTheHour(sourceId);
  const extracting = await db.query.runs.findFirst({ where: and(eq(runs.sourceId, sourceId), inArray(runs.status, RUN_BUSY)), columns: { id: true } });
  if (extracting) return retryWithinTheHour(sourceId);
  const keys = Object.keys(state.cert.paths).filter((k) => state.cert!.paths[k]!.length > 0);
  if (keys.length === 0) return 'skipped';
  const started = await startDriftCheck(sourceId, null, { trigger: 'schedule', keys, fire: false });
  if (started.status === 'in-progress') return retryWithinTheHour(sourceId);
  await runDriftCheck(started.checkId, deps.capture ? { capture: deps.capture } : {});
  // Stopped (stuck, lease lost, shutdown): no coverage check is started on a closed browser (final review I1).
  if (jobStopped()) return 'skipped';
  deps.onPhase?.();
  const source = await db.query.sources.findFirst({ where: eq(sources.id, sourceId), columns: { verificationSet: true } });
  if ((source?.verificationSet as VerificationSet | null)?.listing_url) {
    const coverage = await startCoverageCheck(sourceId, null, { fire: false });
    if (coverage.status === 'started') await runCoverageCheck(coverage.checkId, deps.coverage ?? {});
  }
  return 'checked';
}

/**
 * The worker's sweep (spec 2026-10-23 §4.3): claims at most `limit` due websites and enqueues one
 * `website-check` job each — the job runs `checkWebsite`. `only` as in `claimDueWebsite` (tests pass it).
 */
export async function enqueueDueWebsiteChecks(opts: { limit?: number; only?: string[] } = {}): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < (opts.limit ?? SWEEP_LIMIT); i++) {
    // The claim and its job in one transaction: an enqueue that fails leaves the website due for the next sweep.
    const id = await db.transaction(async (tx) => {
      const claimed = await claimDueWebsite({ ...(opts.only ? { only: opts.only } : {}), tx });
      if (claimed) await enqueue(tx, 'website-check', { sourceId: claimed }, { key: `website-check:${claimed}` });
      return claimed;
    });
    if (!id) break;
    out.push(id);
  }
  return out;
}

/** One sweep, inline (scripts and tests): claim and check due websites one at a time, at most `limit`. Never throws. */
export async function runDueWebsiteChecks(opts: { limit?: number; only?: string[]; check?: typeof checkWebsite } = {}): Promise<{ checked: string[]; skipped: string[] }> {
  const out = { checked: [] as string[], skipped: [] as string[] };
  const check = opts.check ?? checkWebsite;
  for (let i = 0; i < (opts.limit ?? SWEEP_LIMIT); i++) {
    let id: string | null = null;
    try {
      id = await claimDueWebsite(opts.only ? { only: opts.only } : {});
      if (!id) break;
      if ((await check(id)) === 'checked') out.checked.push(id);
      else out.skipped.push(id);
    } catch (err) {
      log.error(`${id ?? 'claim'} failed`, { sourceId: id, error: err });
      if (!id) break;
      out.skipped.push(id);
    }
  }
  return out;
}

/**
 * The worker's timer (the sweep enqueues by default): with `WEBSITE_CHECKS=on`, a first sweep after `firstDelayMs` (ten minutes), then one
 * every `intervalMs` (an hour); never two at once. Off, it sets no timer at all. Returns a stop function.
 */
export function startWebsiteChecks(opts: { intervalMs?: number; firstDelayMs?: number; env?: Record<string, string | undefined>; sweep?: () => Promise<unknown> } = {}): () => void {
  if (!websiteChecksEnabled(opts.env)) return () => {};
  const sweep = opts.sweep ?? (() => enqueueDueWebsiteChecks());
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const queued = await sweep();
      if (Array.isArray(queued) && queued.length > 0) log.info(`queued ${queued.length} website check(s)`, { count: queued.length });
    } catch (err) { log.error('sweep failed', { error: err }); } finally { running = false; }
  };
  let interval: ReturnType<typeof setInterval> | null = null;
  const first = setTimeout(() => {
    void tick();
    interval = setInterval(() => void tick(), opts.intervalMs ?? HOUR_MS);
    interval.unref?.();
  }, opts.firstDelayMs ?? FIRST_SWEEP_MS);
  first.unref?.();
  return () => { clearTimeout(first); if (interval) clearInterval(interval); };
}
