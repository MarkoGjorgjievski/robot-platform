// Spec 2026-10-24 §3.3–§3.4, §4.5: which settled runs deliver; the job writes three files and posts one signed body
// to a local receiver; failed attempts are recorded and retried with one delivery id; nothing touches the run.
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import { db, jobs, runs, runFiles, sources, webhookDeliveries } from '@robot/db';
import { signedInCaller } from '../test-helpers/identity.js';
import { createProjectWithSource } from '../test-helpers/customer-source.js';
import { seedUnshownRun } from '../test-helpers/seed-unshown-run.js';
import { jobsOf, withJobRunner, JOB_TEST_MS } from '../test-helpers/jobs.js';
import { JOB_POLICIES, RUN_STOPPED } from '../jobs/types.js';
import { enqueueJob, jobQueueName, reapJobs } from '../jobs/queue.js';
import { loadRunExport } from '../export/load-run-export.js';
import { renderRunExport } from '../export/render-run-export.js';
import { bodySignature, checkFileSignature } from './signing.js';
import { loadRunDelivery, RUN_DELIVERY_ATTEMPTS } from './delivery-state.js';
import { deliverable, deliverRun, enqueueRunDelivery, WebhookNotDelivered } from './run-delivery.js';

const me = await signedInCaller('run-delivery');
const receiver = { status: 200, hits: [] as Array<{ headers: IncomingMessage['headers']; body: string }> };
const server = createServer((req, res) => {
  let body = '';
  req.setEncoding('utf8');
  req.on('data', (c: string) => { body += c; });
  req.on('end', () => { receiver.hits.push({ headers: req.headers, body }); res.writeHead(receiver.status).end(); });
});
let hookUrl = '';
beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  hookUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); await me.cleanup(); });
beforeEach(() => { receiver.status = 200; receiver.hits = []; });

const DELIVERY = '7d4f2b1a-3333-4333-8333-333333333333';
const NOW_MS = Date.parse('2026-10-24T10:00:00Z');
const ENV = { WEBHOOK_ALLOW_PRIVATE: 'on', PUBLIC_API_URL: 'http://api.test' };

/** A website (optionally with a webhook to the local receiver, or a schedule) and a completed run of two rows. */
async function websiteWithRun(tag: string, opts: { webhook?: boolean; schedule?: boolean } = {}) {
  const f = await createProjectWithSource(me.caller, { tag: `delivery-${tag}`, fields: [{ name: 'Price', type: 'money' }] });
  if (opts.webhook) {
    vi.stubEnv('WEBHOOK_ALLOW_PRIVATE', 'on');
    try { await me.caller.sources.update({ id: f.sourceId, webhookUrl: hookUrl }); } finally { vi.unstubAllEnvs(); }
  }
  if (opts.schedule) await me.caller.sources.update({ id: f.sourceId, schedule: { days: [1], time: '06:00', timeZone: 'UTC' } });
  const key = f.keys.Price!;
  const runId = await seedUnshownRun(f.sourceId, { items: [
    { url: `https://test-delivery-${tag}.example.com/p/1`, row: { [key]: '9.99' } },
    { url: `https://test-delivery-${tag}.example.com/p/2`, row: { [key]: '19.99' } },
  ] });
  return { ...f, runId };
}
const secretOf = async (sourceId: string) => (await db.query.sources.findFirst({ where: eq(sources.id, sourceId), columns: { webhookSecret: true } }))!.webhookSecret!;

describe('deliverable (§3.3)', () => {
  it.each([
    ['completed', 0, true], ['partial', 3, true], ['failed', 1, true], ['failed', 0, false], ['failed', null, false],
    ['cancelled', 2, true], ['cancelled', 0, false], ['extracting', 5, false], ['planned', 5, false],
  ] as const)('%s with %s rows → %s', (status, rows, want) => expect(deliverable(status, rows)).toBe(want));
});

describe('enqueueRunDelivery', () => {
  it('nothing for a website with neither a schedule nor a webhook', async () => {
    const f = await websiteWithRun('none');
    try { expect(await enqueueRunDelivery(db, f.runId)).toBeNull(); } finally { await f.cleanup(); }
  });
  it('one job per run (key run-delivery:<runId>) for a webhook or a schedule', async () => {
    const hooked = await websiteWithRun('hooked', { webhook: true });
    const timed = await websiteWithRun('timed', { schedule: true });
    try {
      const id = await enqueueRunDelivery(db, hooked.runId);
      expect(await enqueueRunDelivery(db, hooked.runId)).toBe(id);
      const job = (await jobsOf('run-delivery')).find((j) => j.id === id)!;
      expect(job).toMatchObject({ key: `run-delivery:${hooked.runId}`, priority: 15, maxAttempts: RUN_DELIVERY_ATTEMPTS, payload: { runId: hooked.runId, deliveryId: expect.any(String) } });
      expect(await enqueueRunDelivery(db, timed.runId)).not.toBeNull();
      expect(JOB_POLICIES['run-delivery']).toMatchObject({ lane: 'background', priority: 15, maxAttempts: 5, startWithinMs: null });
    } finally { await hooked.cleanup(); await timed.cleanup(); }
  });
  it('RF4: a backfill delivers its parent; a sample and a failed run with no rows deliver nothing', async () => {
    const f = await websiteWithRun('lineage', { webhook: true });
    try {
      const [child] = await db.insert(runs).values({ sourceId: f.sourceId, status: 'completed', inputLabel: 'backfill', parentRunId: f.runId, resultCount: 1 }).returning({ id: runs.id });
      const jobId = await enqueueRunDelivery(db, child!.id);
      expect((await jobsOf('run-delivery')).find((j) => j.id === jobId)!.payload).toMatchObject({ runId: f.runId });
      const [sample] = await db.insert(runs).values({ sourceId: f.sourceId, status: 'partial', inputLabel: 'probe', resultCount: 5 }).returning({ id: runs.id });
      expect(await enqueueRunDelivery(db, sample!.id)).toBeNull();
      const [empty] = await db.insert(runs).values({ sourceId: f.sourceId, status: 'failed', resultCount: 0 }).returning({ id: runs.id });
      expect(await enqueueRunDelivery(db, empty!.id)).toBeNull();
    } finally { await f.cleanup(); }
  });
});

describe('deliverRun', () => {
  it('writes the three files and posts one signed body whose links check back', async () => {
    const f = await websiteWithRun('post', { webhook: true });
    try {
      expect(await deliverRun({ runId: f.runId, deliveryId: DELIVERY }, { attempt: 1 }, { env: ENV, now: () => NOW_MS })).toEqual({ files: true, delivered: true });
      const files = await db.select().from(runFiles).where(eq(runFiles.runId, f.runId));
      expect(files.map((x) => x.format).sort()).toEqual(['csv', 'json', 'xlsx']);
      expect(files.every((x) => x.rows === 2)).toBe(true);
      const live = (await loadRunExport(db, f.runId))!;
      for (const format of ['csv', 'json'] as const) {
        expect(files.find((x) => x.format === format)!.bytes.equals((await renderRunExport(live, format)).bytes)).toBe(true);
      }
      expect(receiver.hits).toHaveLength(1);
      const hit = receiver.hits[0]!;
      const secret = await secretOf(f.sourceId);
      expect(hit.headers['x-robot-signature']).toBe(bodySignature(secret, hit.body));
      expect(hit.headers).toMatchObject({ 'content-type': 'application/json', 'user-agent': 'robot-platform-webhook/1', 'x-robot-event': 'run.finished', 'x-robot-delivery': DELIVERY });
      const body = JSON.parse(hit.body);
      expect(Object.keys(body).sort()).toEqual(['completedAt', 'deliveryId', 'event', 'failedItems', 'files', 'filesExpireAt', 'project', 'rows', 'runId', 'scheduled', 'startedAt', 'status', 'website'].sort());
      expect(body).toMatchObject({ event: 'run.finished', deliveryId: DELIVERY, runId: f.runId, status: 'completed', scheduled: false, website: { id: f.sourceId }, project: { id: f.projectId }, rows: 2, failedItems: 0 });
      const expires = Math.floor(NOW_MS / 1000) + 7 * 86_400;
      expect(body.filesExpireAt).toBe(new Date(expires * 1000).toISOString());
      for (const format of ['csv', 'json', 'xlsx'] as const) {
        const link = new URL(body.files[format]);
        expect(`${link.origin}${link.pathname}`).toBe(`http://api.test/export/runs/${f.runId}.${format}`);
        expect(link.searchParams.get('expires')).toBe(String(expires));
        expect(checkFileSignature({ secret, runId: f.runId, format, expires: link.searchParams.get('expires')!, sig: link.searchParams.get('sig')!, nowS: Math.floor(NOW_MS / 1000) })).toBe(true);
      }
      expect(await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.runId, f.runId)))
        .toMatchObject([{ deliveryId: DELIVERY, attempt: 1, ok: true, statusCode: 200, error: null }]);
    } finally { await f.cleanup(); }
  });

  it('says scheduled for a run the schedule started', async () => {
    const f = await websiteWithRun('scheduled', { webhook: true });
    try {
      await db.update(runs).set({ inputLabel: 'scheduled' }).where(eq(runs.id, f.runId));
      await deliverRun({ runId: f.runId, deliveryId: DELIVERY }, { attempt: 1 }, { env: ENV });
      expect(JSON.parse(receiver.hits[0]!.body).scheduled).toBe(true);
    } finally { await f.cleanup(); }
  });

  it('a schedule without a webhook writes the files and posts nothing; writing again replaces them', async () => {
    const f = await websiteWithRun('files-only', { schedule: true });
    try {
      expect(await deliverRun({ runId: f.runId, deliveryId: DELIVERY }, { attempt: 1 }, { env: ENV })).toEqual({ files: true, delivered: null });
      await deliverRun({ runId: f.runId, deliveryId: DELIVERY }, { attempt: 1 }, { env: ENV });
      expect(await db.select().from(runFiles).where(eq(runFiles.runId, f.runId))).toHaveLength(3);
      expect(receiver.hits).toHaveLength(0);
      expect(await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.runId, f.runId))).toEqual([]);
    } finally { await f.cleanup(); }
  });

  it('refuses a private address without the flag: a failed attempt, the receiver never reached', async () => {
    const f = await websiteWithRun('private', { webhook: true });
    try {
      await expect(deliverRun({ runId: f.runId, deliveryId: DELIVERY }, { attempt: 1 }, { env: {} })).rejects.toBeInstanceOf(WebhookNotDelivered);
      expect(receiver.hits).toHaveLength(0);
      const [attempt] = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.runId, f.runId));
      expect(attempt).toMatchObject({ attempt: 1, ok: false, statusCode: null });
      expect(attempt!.error).toMatch(/private/);
    } finally { await f.cleanup(); }
  });

  it('a run that is gone ends quietly', async () => {
    expect(await deliverRun({ runId: randomUUID(), deliveryId: DELIVERY }, { attempt: 1 }, { env: ENV })).toEqual({ files: false, delivered: null });
  });

  it('retries on a 500 with one delivery id, five attempts, then gives up — the run untouched (§4.5)', async () => {
    receiver.status = 500;
    const f = await websiteWithRun('retry', { webhook: true });
    vi.stubEnv('WEBHOOK_ALLOW_PRIVATE', 'on');
    try {
      const jobId = (await enqueueRunDelivery(db, f.runId))!;
      // Until the job ends for good (runQueuedJobs would stop at the first backoff: a retry waiting out its delay is not due).
      await withJobRunner(async () => {
        const until = Date.now() + 30_000;
        while ((await db.query.jobs.findFirst({ where: eq(jobs.id, jobId), columns: { status: true } }))!.status !== 'failed') {
          if (Date.now() > until) throw new Error('the delivery job never failed');
          await new Promise((r) => setTimeout(r, 25));
        }
      }, { registry: { 'run-delivery': { policy: JOB_POLICIES['run-delivery'], run: (p, ctx) => deliverRun(p, ctx) } } });
      expect(receiver.hits).toHaveLength(5);
      expect(new Set(receiver.hits.map((h) => h.headers['x-robot-delivery'])).size).toBe(1);
      const attempts = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.runId, f.runId)).orderBy(asc(webhookDeliveries.attempt));
      expect(attempts.map((a) => [a.attempt, a.ok, a.statusCode])).toEqual([1, 2, 3, 4, 5].map((n) => [n, false, 500]));
      expect((await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) }))!.status).toBe('failed');
      expect(await db.query.runs.findFirst({ where: eq(runs.id, f.runId), columns: { status: true, resultCount: true } })).toEqual({ status: 'completed', resultCount: 2 });
      expect(await loadRunDelivery(db, f.runId, false)).toMatchObject({ state: 'failed' });
    } finally { vi.unstubAllEnvs(); await f.cleanup(); }
  }, JOB_TEST_MS);
});

describe('a delivery that stops for good before its fifth attempt', () => {
  it('reads "trying again" only while its job is still queued or running, then failed', async () => {
    receiver.status = 503;
    const f = await websiteWithRun('stopped', { webhook: true });
    try {
      const jobId = (await enqueueRunDelivery(db, f.runId))!;
      const { deliveryId } = (await jobsOf('run-delivery')).find((j) => j.id === jobId)!.payload as { deliveryId: string };
      await expect(deliverRun({ runId: f.runId, deliveryId }, { attempt: 2 }, { env: ENV })).rejects.toBeInstanceOf(WebhookNotDelivered);
      expect(await loadRunDelivery(db, f.runId, false)).toMatchObject({ state: 'retrying' });
      // Failed terminally (or reaped with no attempts left) at attempt 2: no later attempt will come.
      await db.update(jobs).set({ status: 'failed', finishedAt: new Date() }).where(eq(jobs.id, jobId));
      expect(await loadRunDelivery(db, f.runId, false)).toMatchObject({ state: 'failed' });
      // Purged a week later: still failed, never "trying again".
      await db.delete(jobs).where(eq(jobs.id, jobId));
      expect(await loadRunDelivery(db, f.runId, true)).toMatchObject({ state: 'failed', statusCode: 503 });
    } finally { await f.cleanup(); }
  });
});

describe('a run closed by the job layer delivers like a finalised one (final review I1)', () => {
  /** Stamps `runId` with a `run` job on this file's queue whose worker died on its last attempt (its lease lapsed). */
  async function deadRunJob(runId: string): Promise<string> {
    const { id } = await enqueueJob(db, { type: 'run', payload: { runId }, key: `run:${runId}`, maxAttempts: 3 });
    await db.update(jobs).set({ status: 'running', attempts: 3, lockedBy: 'gone#00000000', lockedUntil: new Date(Date.now() - 60_000) }).where(eq(jobs.id, id));
    await db.update(runs).set({ status: 'extracting', resultCount: 0, completedAt: null, jobId: id }).where(eq(runs.id, runId));
    return id;
  }
  const deliveryJob = async (runId: string) => (await jobsOf('run-delivery')).find((j) => j.key === `run-delivery:${runId}` && j.status === 'queued');
  const dropDeliveryJobs = (runId: string) => db.delete(jobs).where(eq(jobs.key, `run-delivery:${runId}`));

  it('a reaped run with rows is recounted and gets its delivery', async () => {
    const f = await websiteWithRun('reaped', { webhook: true });
    try {
      const jobId = await deadRunJob(f.runId);
      expect((await reapJobs(jobQueueName(), { retryBaseMs: 30_000 })).failed).toContain(jobId);
      expect(await db.query.runs.findFirst({ where: eq(runs.id, f.runId), columns: { status: true, resultCount: true, errorMessage: true } }))
        .toEqual({ status: 'failed', resultCount: 2, errorMessage: RUN_STOPPED });
      expect(await deliveryJob(f.runId)).toMatchObject({ payload: { runId: f.runId, deliveryId: expect.any(String) } });
    } finally { await dropDeliveryJobs(f.runId); await f.cleanup(); }
  });

  it('a reaped run with no rows delivers nothing', async () => {
    const f = await websiteWithRun('reaped-empty', { webhook: true });
    try {
      const [empty] = await db.insert(runs).values({ sourceId: f.sourceId, status: 'extracting' }).returning({ id: runs.id });
      const jobId = await deadRunJob(empty!.id);
      expect((await reapJobs(jobQueueName(), { retryBaseMs: 30_000 })).failed).toContain(jobId);
      expect(await db.query.runs.findFirst({ where: eq(runs.id, empty!.id), columns: { status: true, resultCount: true } })).toEqual({ status: 'failed', resultCount: 0 });
      expect(await deliveryJob(empty!.id)).toBeUndefined();
    } finally { await f.cleanup(); }
  });
});

describe('deliverRun re-checks the run when the job runs (task 6 review M3)', () => {
  it.each([['extracting', 2], ['failed', 0]] as const)('a run that is %s with %s rows by then finishes without files or a post', async (status, resultCount) => {
    const f = await websiteWithRun(`recheck-${status}`, { webhook: true });
    try {
      await db.update(runs).set({ status, resultCount }).where(eq(runs.id, f.runId));
      expect(await deliverRun({ runId: f.runId, deliveryId: DELIVERY }, { attempt: 1 }, { env: ENV })).toEqual({ files: false, delivered: null });
      expect(receiver.hits).toHaveLength(0);
      expect(await db.select().from(runFiles).where(eq(runFiles.runId, f.runId))).toEqual([]);
      expect(await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.runId, f.runId))).toEqual([]);
    } finally { await f.cleanup(); }
  });
});
