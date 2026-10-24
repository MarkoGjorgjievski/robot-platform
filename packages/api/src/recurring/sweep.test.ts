// Spec 2026-10-24 §3.2, §4.1–4.3. DB-backed against the shared dev database: every sweep passes `only` (a bare
// sweep would claim real websites), and a website is made due right before the sweep that claims it.
import { describe, it, expect, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db, runs, sources } from '@robot/db';
import type { CertifiedPath } from '@robot/scraper';
import { signedInCaller } from '../test-helpers/identity.js';
import { createProjectWithSource } from '../test-helpers/customer-source.js';
import { seedPassingVerification } from '../test-helpers/seed-coverage-check.js';
import { jobsOf } from '../test-helpers/jobs.js';
import { JOB_POLICIES } from '../jobs/types.js';
import { recurringRunsEnabled, sweepDueSchedules } from './sweep.js';
import { SCHEDULED_LABEL } from './schedule.js';

const me = await signedInCaller('recurring-sweep');
afterAll(async () => { await me.cleanup(); });
const LD: CertifiedPath = { source: 'json-ld', path: 'offers.price', transform: 'identity' };
const EVERY_DAY = { days: [1, 2, 3, 4, 5, 6, 7], time: '06:00', timeZone: 'Europe/Berlin' };

/** A website (certified unless told otherwise) with a schedule, due `agoMs` ago. */
async function scheduled(tag: string, opts: { certified?: boolean; agoMs?: number; patch?: Partial<typeof sources.$inferInsert> } = {}) {
  const host = `test-recurring-${tag}.example.com`;
  const urls = [1, 2, 3].map((n) => `https://${host}/p/${n}`);
  const f = await createProjectWithSource(me.caller, {
    tag: `recurring-${tag}`, urls, fields: [{ name: 'Price', type: 'money' }],
    expected: { Price: Object.fromEntries(urls.map((u, i) => [u, `${i + 1}.00`])) },
  });
  if (opts.certified !== false) await seedPassingVerification(f.sourceId, { [f.keys.Price!]: [LD] });
  await db.update(sources).set({ schedule: EVERY_DAY, nextRunAt: new Date(Date.now() - (opts.agoMs ?? 1000)), ...opts.patch }).where(eq(sources.id, f.sourceId));
  return f;
}
const sourceRow = async (id: string) => (await db.query.sources.findFirst({ where: eq(sources.id, id), columns: { nextRunAt: true, scheduleLast: true } }))!;
const scheduledRuns = (sourceId: string) => db.query.runs.findMany({ where: and(eq(runs.sourceId, sourceId), eq(runs.inputLabel, SCHEDULED_LABEL)) });

describe('sweepDueSchedules', () => {
  it('starts a due certified website: a planning run labelled scheduled, its scheduled-run job, the next time from now', async () => {
    const f = await scheduled('start');
    try {
      const [out, ...rest] = await sweepDueSchedules({ only: [f.sourceId] });
      expect(rest).toEqual([]);
      expect(out).toMatchObject({ sourceId: f.sourceId, outcome: 'started', runId: expect.any(String) });
      const [run] = await scheduledRuns(f.sourceId);
      expect(run).toMatchObject({ id: out!.runId, status: 'planning', inputLabel: 'scheduled' });
      const job = (await jobsOf('scheduled-run')).find((j) => j.key === `scheduled-run:${run!.id}`)!;
      expect(job).toMatchObject({ payload: { sourceId: f.sourceId, runId: run!.id }, priority: 20, maxAttempts: 1, expiresAt: null, status: 'queued' });
      expect(run!.jobId).toBe(job.id);
      const src = await sourceRow(f.sourceId);
      expect(src.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
      expect(src.nextRunAt!.getTime()).toBeLessThan(Date.now() + 2 * 86_400_000);
      expect(src.scheduleLast).toMatchObject({ outcome: 'started', runId: run!.id });
      expect(JOB_POLICIES['scheduled-run']).toMatchObject({ lane: 'background', priority: 20, maxAttempts: 1, startWithinMs: null });
    } finally { await f.cleanup(); }
  });

  it('leaves a website that is not due yet, and one whose schedule was turned off', async () => {
    const later = await scheduled('later', { agoMs: -3_600_000 });
    const off = await scheduled('off', { patch: { schedule: null } });
    try {
      expect(await sweepDueSchedules({ only: [later.sourceId, off.sourceId] })).toEqual([]);
      expect(await scheduledRuns(later.sourceId)).toEqual([]);
      expect(await scheduledRuns(off.sourceId)).toEqual([]);
    } finally { await later.cleanup(); await off.cleanup(); }
  });

  it.each([
    ['paused', { patch: { isActive: false } }],
    ['not_certified', { certified: false }],
    ['not_confirmed', { patch: { listingMode: 'listing_to_detail', confirmedAt: null } }],
  ] as const)('skips %s: recorded, no run, not retried before the next time', async (reason, opts) => {
    const f = await scheduled(`skip-${reason}`, opts as Parameters<typeof scheduled>[1]);
    try {
      expect(await sweepDueSchedules({ only: [f.sourceId] })).toEqual([{ sourceId: f.sourceId, at: expect.any(String), outcome: 'skipped', reason }]);
      expect(await scheduledRuns(f.sourceId)).toEqual([]);
      const src = await sourceRow(f.sourceId);
      expect(src.scheduleLast).toMatchObject({ outcome: 'skipped', reason });
      expect(src.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
      expect(await sweepDueSchedules({ only: [f.sourceId] })).toEqual([]);
    } finally { await f.cleanup(); }
  });

  it.each(['planning', 'extracting', 'cancelling'])('skips busy while a run is %s', async (status) => {
    const f = await scheduled(`busy-${status}`);
    try {
      await db.insert(runs).values({ sourceId: f.sourceId, status });
      expect(await sweepDueSchedules({ only: [f.sourceId] })).toEqual([{ sourceId: f.sourceId, at: expect.any(String), outcome: 'skipped', reason: 'busy' }]);
      expect(await scheduledRuns(f.sourceId)).toEqual([]);
    } finally { await f.cleanup(); }
  });

  it('a product-URL website needs no confirmation', async () => {
    const f = await scheduled('detail', { patch: { listingMode: 'detail', confirmedAt: null } });
    try {
      expect((await sweepDueSchedules({ only: [f.sourceId] }))[0]).toMatchObject({ outcome: 'started' });
    } finally { await f.cleanup(); }
  });

  it('two sweeps at once start one run (§4.2)', async () => {
    const f = await scheduled('race');
    try {
      const [a, b] = await Promise.all([sweepDueSchedules({ only: [f.sourceId] }), sweepDueSchedules({ only: [f.sourceId] })]);
      expect([...a, ...b]).toHaveLength(1);
      expect(await scheduledRuns(f.sourceId)).toHaveLength(1);
    } finally { await f.cleanup(); }
  });

  it('a worker down for a week fires once, and the next time is from now (§4.3)', async () => {
    const f = await scheduled('week', { agoMs: 7 * 86_400_000 });
    try {
      expect(await sweepDueSchedules({ only: [f.sourceId] })).toHaveLength(1);
      expect(await sweepDueSchedules({ only: [f.sourceId] })).toEqual([]);
      expect(await scheduledRuns(f.sourceId)).toHaveLength(1);
      expect((await sourceRow(f.sourceId)).nextRunAt!.getTime()).toBeGreaterThan(Date.now());
    } finally { await f.cleanup(); }
  });

  it('at most the limit per sweep, the most overdue first', async () => {
    const a = await scheduled('limit-a', { agoMs: 120_000 });
    const b = await scheduled('limit-b', { agoMs: 60_000 });
    try {
      const first = await sweepDueSchedules({ only: [a.sourceId, b.sourceId], limit: 1 });
      expect(first.map((o) => o.sourceId)).toEqual([a.sourceId]);
      expect((await sweepDueSchedules({ only: [a.sourceId, b.sourceId] })).map((o) => o.sourceId)).toEqual([b.sourceId]);
    } finally { await a.cleanup(); await b.cleanup(); }
  });

  it('an empty only claims nothing', async () => {
    expect(await sweepDueSchedules({ only: [] })).toEqual([]);
  });

  it('RECURRING_RUNS: on unless off', () => {
    expect(recurringRunsEnabled({})).toBe(true);
    expect(recurringRunsEnabled({ RECURRING_RUNS: 'on' })).toBe(true);
    expect(recurringRunsEnabled({ RECURRING_RUNS: 'off' })).toBe(false);
    expect(recurringRunsEnabled({ RECURRING_RUNS: ' OFF ' })).toBe(false);
  });
});
