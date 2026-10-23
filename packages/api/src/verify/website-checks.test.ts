// Spec 2026-10-21 §3.3. DB-backed against the shared dev database: every claim
// here passes `only` (Review Focus 2) — a bare claim would pick up real websites.
import { describe, it, expect, afterAll, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, coverageChecks, driftChecks, sources, sourceVerifications } from '@robot/db';
import { fieldHash, type CertifiedPath, type SchemaDefinitionField, type VerificationSet } from '@robot/scraper';
import { createProjectWithSource } from '../test-helpers/customer-source.js';
import { signedInCaller } from '../test-helpers/identity.js';
import { jobsOf, jobContext } from '../test-helpers/jobs.js';
import { closeJobRows } from '../jobs/rows.js';
import { RUN_STOPPED } from '../jobs/types.js';
import { enqueueJob } from '../jobs/queue.js';
import { runInJob } from '../jobs/context.js';
import { claimDueWebsite, checkWebsite, enqueueDueWebsiteChecks, runDueWebsiteChecks, startWebsiteChecks, websiteChecksEnabled } from './website-checks.js';

const me = await signedInCaller('website-checks');
afterAll(async () => { await me.cleanup(); });
const LD: CertifiedPath = { source: 'json-ld', path: 'offers.price', transform: 'identity' };

// The brief's fixture called `updateBinding` after `expected: { Price: {} }`, which the binding rejects (an
// expected value is required per page) and keyed the field `price` (keys are generated): the expected values
// go into the one `createProjectWithSource` call, and the field's real key is used.
async function certified(tag: string, opts: { listing?: boolean } = {}) {
  const host = `test-checks-${tag}.example.com`;
  const urls = [1, 2, 3].map((n) => `https://${host}/p/${n}`);
  const f = await createProjectWithSource(me.caller, {
    tag: `checks-${tag}`, urls, fields: [{ name: 'Price', type: 'money' }],
    expected: { Price: Object.fromEntries(urls.map((u, i) => [u, `${i + 1}.00`])) },
    ...(opts.listing ? { listingUrl: `https://${host}/c` } : {}),
  });
  const src = (await db.query.sources.findFirst({ where: eq(sources.id, f.sourceId) }))!;
  const field = (src.schemaDefinition as SchemaDefinitionField[])[0]!;
  const hash = fieldHash(field, src.verificationSet as VerificationSet);
  const cells = Object.fromEntries(f.urls.map((u) => [u, { status: 'pass', found: 'x', path: LD }]));
  await db.insert(sourceVerifications).values({ sourceId: f.sourceId, definitionHash: 'x', completedAt: new Date(), allPassed: true, results: { [field.key]: { key: field.key, cells, certified: [LD], weakEvidence: false, aiCalled: false, incomplete: false, fieldHash: hash } } });
  return { ...f, key: field.key };
}

// Every page "could not be read": the check runs end to end with no browser and learns nothing.
const capture = vi.fn(async (_s: string, urls: string[]) => Object.fromEntries(urls.map((u) => [u, { notChecked: 'The page could not be read.' }])));

describe('claimDueWebsite', () => {
  it('Review Focus 2: claims only the websites it is given, once, and moves their next check on', async () => {
    const a = await certified('claim');
    try {
      const [first, second] = await Promise.all([claimDueWebsite({ only: [a.sourceId] }), claimDueWebsite({ only: [a.sourceId] })]);
      expect([first, second].filter(Boolean)).toEqual([a.sourceId]);
      expect(await claimDueWebsite({ only: [a.sourceId] })).toBeNull();
      const src = await db.query.sources.findFirst({ where: eq(sources.id, a.sourceId), columns: { nextCheckAt: true } });
      expect(src!.nextCheckAt!.getTime()).toBeGreaterThan(Date.now() + 2.9 * 86_400_000);
    } finally { await a.cleanup(); }
  });
  it('never claims a website with no completed Verify', async () => {
    const f = await createProjectWithSource(me.caller, { tag: 'checks-never', fields: [{ name: 'Price', type: 'money' }] });
    try { expect(await claimDueWebsite({ only: [f.sourceId] })).toBeNull(); } finally { await f.cleanup(); }
  });
  it('an empty `only` claims nothing', async () => {
    expect(await claimDueWebsite({ only: [] })).toBeNull();
  });
});

describe('checkWebsite', () => {
  it('runs the scheduled check on every certified field, then the coverage check', async () => {
    const a = await certified('run', { listing: true });
    try {
      const listing = vi.fn(async () => ({ productUrls: [], verdictMessage: null }));
      expect(await checkWebsite(a.sourceId, { capture, coverage: { listing } })).toBe('checked');
      const check = await db.query.driftChecks.findFirst({ where: eq(driftChecks.sourceId, a.sourceId) });
      expect(check).toMatchObject({ trigger: 'schedule', status: 'done' });
      expect((check!.results as { keys?: string[] }).keys).toEqual([a.key]);
      expect(listing).toHaveBeenCalled();
      expect(await db.query.coverageChecks.findFirst({ where: eq(coverageChecks.sourceId, a.sourceId) })).toMatchObject({ status: 'done' });
    } finally { await a.cleanup(); }
  });
  it('skips a website with a Verify in flight, and tries again within the hour', async () => {
    const a = await certified('busy');
    try {
      await db.insert(sourceVerifications).values({ sourceId: a.sourceId, definitionHash: 'x' });
      expect(await checkWebsite(a.sourceId, { capture })).toBe('skipped');
      expect(capture).not.toHaveBeenCalledWith(a.sourceId, expect.anything());
      expect(await db.query.driftChecks.findFirst({ where: eq(driftChecks.sourceId, a.sourceId) })).toBeUndefined();
      const src = await db.query.sources.findFirst({ where: eq(sources.id, a.sourceId), columns: { nextCheckAt: true } });
      expect(src!.nextCheckAt!.getTime()).toBeLessThan(Date.now() + 2 * 3_600_000);
    } finally { await a.cleanup(); }
  });
  it('skips a website that is not certified', async () => {
    const f = await createProjectWithSource(me.caller, { tag: 'checks-uncert', fields: [{ name: 'Price', type: 'money' }] });
    try { expect(await checkWebsite(f.sourceId, { capture })).toBe('skipped'); } finally { await f.cleanup(); }
  });
});

describe('runDueWebsiteChecks', () => {
  it('checks due websites one at a time, up to the limit', async () => {
    const a = await certified('due-a');
    const b = await certified('due-b');
    try {
      let active = 0;
      let most = 0;
      const check = vi.fn(async () => {
        active++; most = Math.max(most, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        return 'checked' as const;
      });
      const out = await runDueWebsiteChecks({ limit: 1, only: [a.sourceId, b.sourceId], check });
      expect(out.checked).toHaveLength(1);
      expect(check).toHaveBeenCalledTimes(1);
      const rest = await runDueWebsiteChecks({ only: [a.sourceId, b.sourceId], check });
      expect(rest.checked).toHaveLength(1);
      expect(rest.checked[0]).not.toBe(out.checked[0]);
      expect(most).toBe(1);
    } finally { await a.cleanup(); await b.cleanup(); }
  });
});

describe('website checks through the queue (spec 2026-10-23 §4.3)', () => {
  it('the sweep enqueues one website-check job per due website it claims (only those it is given)', async () => {
    const a = await certified('enqueue');
    try {
      const ids = await enqueueDueWebsiteChecks({ only: [a.sourceId] });
      expect(ids).toEqual([a.sourceId]);
      const job = (await jobsOf('website-check')).find((j) => j.key === `website-check:${a.sourceId}`);
      expect(job).toMatchObject({ key: `website-check:${a.sourceId}`, payload: { sourceId: a.sourceId } });
      expect(await enqueueDueWebsiteChecks({ only: [a.sourceId] })).toEqual([]); // claimed: not due again
      // Nothing is checked by the sweep itself.
      expect(await db.query.driftChecks.findFirst({ where: eq(driftChecks.sourceId, a.sourceId) })).toBeUndefined();
    } finally { await a.cleanup(); }
  });

  it('rows a website check starts belong to its job, and it reports progress after the drift check', async () => {
    const a = await certified('job-rows', { listing: true });
    try {
      const jobId = (await enqueueJob(db, { type: 'website-check', payload: {} })).id;
      const listing = vi.fn(async () => ({ productUrls: [], verdictMessage: null }));
      const onPhase = vi.fn();
      const ctx = { jobId, claim: 'test-claim', type: 'website-check', lane: 'background' as const, attempt: 1, retry: false, signal: new AbortController().signal, progress: () => {} };
      expect(await runInJob(ctx, () => checkWebsite(a.sourceId, { capture, coverage: { listing }, onPhase }))).toBe('checked');
      expect(onPhase).toHaveBeenCalledTimes(1);
      expect(await db.query.driftChecks.findFirst({ where: eq(driftChecks.sourceId, a.sourceId) })).toMatchObject({ status: 'done', jobId });
      expect(await db.query.coverageChecks.findFirst({ where: eq(coverageChecks.sourceId, a.sourceId) })).toMatchObject({ status: 'done', jobId });
      // Inline inside the job: neither check is a job of its own.
      expect((await jobsOf('drift-check')).length + (await jobsOf('coverage-check')).length).toBe(0);
    } finally { await a.cleanup(); }
  });
});

describe('a stopped website check (final review I1)', () => {
  it('writes no outcome and starts no coverage check; claimed again, it closes the half-done drift row and runs to the end', async () => {
    const a = await certified('job-abort', { listing: true });
    try {
      const jobId = (await enqueueJob(db, { type: 'website-check', payload: {} })).id;
      const listing = vi.fn(async () => ({ productUrls: [], verdictMessage: null }));
      const stop = new AbortController();
      const stopped = vi.fn(async (s: string, urls: string[]) => { stop.abort('shutdown'); return capture(s, urls); });
      await runInJob(jobContext('website-check', stop, { jobId }), () => checkWebsite(a.sourceId, { capture: stopped, coverage: { listing } }));
      expect(await db.query.driftChecks.findFirst({ where: eq(driftChecks.sourceId, a.sourceId) })).toMatchObject({ status: 'running', jobId });
      expect(await db.query.coverageChecks.findFirst({ where: eq(coverageChecks.sourceId, a.sourceId) })).toBeUndefined();
      expect(listing).not.toHaveBeenCalled();
      // The re-claim: the runner closes the earlier start's rows (a website check names none), then the job runs.
      await closeJobRows(db, jobId, { runSentence: RUN_STOPPED, except: null });
      expect(await runInJob(jobContext('website-check', new AbortController(), { jobId, retry: true }), () => checkWebsite(a.sourceId, { capture, coverage: { listing } }))).toBe('checked');
      const drift = await db.query.driftChecks.findMany({ where: eq(driftChecks.sourceId, a.sourceId) });
      expect(drift.map((d) => d.status).sort()).toEqual(['done', 'failed']);
      expect(await db.query.coverageChecks.findFirst({ where: eq(coverageChecks.sourceId, a.sourceId) })).toMatchObject({ status: 'done', jobId });
    } finally { await a.cleanup(); }
  }, 60_000);
});describe('websiteChecksEnabled', () => {
  it('is off unless WEBSITE_CHECKS is `on` (controller ruling: off by default)', () => {
    expect(websiteChecksEnabled({})).toBe(false);
    expect(websiteChecksEnabled({ WEBSITE_CHECKS: '' })).toBe(false);
    expect(websiteChecksEnabled({ WEBSITE_CHECKS: 'off' })).toBe(false);
    expect(websiteChecksEnabled({ WEBSITE_CHECKS: '1' })).toBe(false);
    expect(websiteChecksEnabled({ WEBSITE_CHECKS: 'yes' })).toBe(false);
    expect(websiteChecksEnabled({ WEBSITE_CHECKS: 'on' })).toBe(true);
    expect(websiteChecksEnabled({ WEBSITE_CHECKS: ' ON ' })).toBe(true);
  });
});

describe('startWebsiteChecks', () => {
  it('WEBSITE_CHECKS unset (or anything but `on`): no timer, never sweeps', async () => {
    vi.useFakeTimers();
    try {
      const sweep = vi.fn(async () => undefined);
      startWebsiteChecks({ sweep, firstDelayMs: 10, intervalMs: 100, env: {} });
      expect(vi.getTimerCount()).toBe(0);
      startWebsiteChecks({ sweep, firstDelayMs: 10, intervalMs: 100, env: { WEBSITE_CHECKS: 'off' } });
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(sweep).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
  it('WEBSITE_CHECKS=on: a timer; sweeps after the first delay and then every interval; stop clears it', async () => {
    vi.useFakeTimers();
    try {
      const sweep = vi.fn(async () => undefined);
      const stop = startWebsiteChecks({ sweep, firstDelayMs: 10, intervalMs: 100, env: { WEBSITE_CHECKS: 'on' } });
      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(10);
      expect(sweep).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(100);
      expect(sweep).toHaveBeenCalledTimes(2);
      stop();
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(sweep).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });
  it('never runs two sweeps at once', async () => {
    vi.useFakeTimers();
    try {
      let release!: () => void;
      const slow = vi.fn(() => new Promise<void>((r) => { release = r; }));
      const stop = startWebsiteChecks({ sweep: slow, firstDelayMs: 10, intervalMs: 100, env: { WEBSITE_CHECKS: 'on' } });
      await vi.advanceTimersByTimeAsync(10 + 100 * 3);
      expect(slow).toHaveBeenCalledTimes(1);
      release();
      await vi.advanceTimersByTimeAsync(100);
      expect(slow).toHaveBeenCalledTimes(2);
      stop();
    } finally { vi.useRealTimers(); }
  });
  it('defaults: the first sweep ten minutes after start, then hourly', async () => {
    vi.useFakeTimers();
    try {
      const sweep = vi.fn(async () => undefined);
      const stop = startWebsiteChecks({ sweep, env: { WEBSITE_CHECKS: 'on' } });
      await vi.advanceTimersByTimeAsync(10 * 60_000 - 1);
      expect(sweep).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(sweep).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(60 * 60_000);
      expect(sweep).toHaveBeenCalledTimes(2);
      stop();
    } finally { vi.useRealTimers(); }
  });
});
