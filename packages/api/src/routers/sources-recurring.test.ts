// Spec 2026-10-24 §3.5: a website's schedule and webhook through sources.update / get / rotateWebhookSecret, and a
// run's delivery state through runs.getWithDetails — org-scoped, customer sentences, staff detail for staff only.
import { describe, it, expect, afterAll, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, runs, sources, webhookDeliveries } from '@robot/db';
import { signedInCaller } from '../test-helpers/identity.js';
import { createProjectWithSource } from '../test-helpers/customer-source.js';
import { nextRunAt } from '../recurring/schedule.js';

const me = await signedInCaller('recurring-api');
const other = await signedInCaller('recurring-api-other');
afterAll(async () => { await me.cleanup(); await other.cleanup(); });

const MONDAY = { days: [1], time: '06:00', timeZone: 'Europe/Berlin' };
const site = (tag: string) => createProjectWithSource(me.caller, { tag: `recurring-api-${tag}`, fields: [{ name: 'Price', type: 'money' }] });
const read = (projectSlug: string, sourceSlug: string) => me.caller.sources.get({ projectSlug, sourceSlug });

describe('sources.update — schedule', () => {
  it('saves a schedule, its days sorted, and its next run from now', async () => {
    const f = await site('save');
    try {
      const before = new Date();
      await me.caller.sources.update({ id: f.sourceId, schedule: { ...MONDAY, days: [5, 1] } });
      const got = await read(f.projectSlug, f.sourceSlug);
      expect(got.schedule).toEqual({ ...MONDAY, days: [1, 5] });
      expect(got.nextRunAt!.toISOString()).toBe(nextRunAt({ ...MONDAY, days: [1, 5] }, before).toISOString());
      expect(got.scheduleLast).toBeNull();
    } finally { await f.cleanup(); }
  });
  it.each([
    [{ ...MONDAY, timeZone: 'Mars/Olympus_Mons' }, 'Choose a time zone from the list.'],
    [{ ...MONDAY, days: [1, 1] }, 'Choose each day once.'],
    [{ ...MONDAY, days: [] }, 'Choose at least one day.'],
    [{ ...MONDAY, time: '6am' }, 'Use a time like 06:00.'],
  ])('refuses %j with its sentence and changes nothing', async (schedule, message) => {
    const f = await site('refuse');
    try {
      await expect(me.caller.sources.update({ id: f.sourceId, schedule })).rejects.toMatchObject({ code: 'BAD_REQUEST', message });
      expect((await read(f.projectSlug, f.sourceSlug)).schedule).toBeNull();
    } finally { await f.cleanup(); }
  });
  it('null turns it off: no schedule, no next run', async () => {
    const f = await site('off');
    try {
      await me.caller.sources.update({ id: f.sourceId, schedule: MONDAY });
      await me.caller.sources.update({ id: f.sourceId, schedule: null });
      const got = await read(f.projectSlug, f.sourceSlug);
      expect([got.schedule, got.nextRunAt]).toEqual([null, null]);
    } finally { await f.cleanup(); }
  });
});

describe('sources.update — webhook', () => {
  it('the first save makes a secret; another address keeps it; removing the address keeps it too', async () => {
    const f = await site('hook');
    try {
      await me.caller.sources.update({ id: f.sourceId, webhookUrl: 'https://hooks.example.com/robot' });
      const first = await read(f.projectSlug, f.sourceSlug);
      expect(first.webhookUrl).toBe('https://hooks.example.com/robot');
      expect(first.webhookSecret).toMatch(/^[0-9a-f]{64}$/);
      await me.caller.sources.update({ id: f.sourceId, webhookUrl: 'https://hooks.example.com/other' });
      expect((await read(f.projectSlug, f.sourceSlug)).webhookSecret).toBe(first.webhookSecret);
      await me.caller.sources.update({ id: f.sourceId, webhookUrl: null });
      const removed = await read(f.projectSlug, f.sourceSlug);
      expect(removed.webhookUrl).toBeNull();
      expect(removed.webhookSecret).toBe(first.webhookSecret);
    } finally { await f.cleanup(); }
  });
  it.each([
    ['http://127.0.0.1:9/hook', 'Use a public web address.'],
    ['http://[::ffff:10.0.0.1]/hook', 'Use a public web address.'],
    ['ftp://hooks.example.com/robot', 'Enter the full web address, starting with http or https.'],
    ['https://user:pass@hooks.example.com/robot', 'Leave the user name and password out of the address.'],
  ])('refuses %s with its sentence', async (webhookUrl, message) => {
    const f = await site('hook-refuse');
    try {
      await expect(me.caller.sources.update({ id: f.sourceId, webhookUrl })).rejects.toMatchObject({ code: 'BAD_REQUEST', message });
      const got = await read(f.projectSlug, f.sourceSlug);
      expect([got.webhookUrl, got.webhookSecret]).toEqual([null, null]);
    } finally { await f.cleanup(); }
  });
  it('WEBHOOK_ALLOW_PRIVATE=on lets a local address save', async () => {
    const f = await site('hook-private');
    vi.stubEnv('WEBHOOK_ALLOW_PRIVATE', 'on');
    try {
      await me.caller.sources.update({ id: f.sourceId, webhookUrl: 'http://127.0.0.1:9/hook' });
      expect((await read(f.projectSlug, f.sourceSlug)).webhookUrl).toBe('http://127.0.0.1:9/hook');
    } finally { vi.unstubAllEnvs(); await f.cleanup(); }
  });
  it('rotateWebhookSecret hands back a new secret and stores it', async () => {
    const f = await site('rotate');
    try {
      await me.caller.sources.update({ id: f.sourceId, webhookUrl: 'https://hooks.example.com/robot' });
      const before = (await read(f.projectSlug, f.sourceSlug)).webhookSecret;
      const { webhookSecret } = await me.caller.sources.rotateWebhookSecret({ id: f.sourceId });
      expect(webhookSecret).toMatch(/^[0-9a-f]{64}$/);
      expect(webhookSecret).not.toBe(before);
      expect((await read(f.projectSlug, f.sourceSlug)).webhookSecret).toBe(webhookSecret);
    } finally { await f.cleanup(); }
  });
  it('another organisation can neither change nor rotate it', async () => {
    const f = await site('scope');
    try {
      await expect(other.caller.sources.update({ id: f.sourceId, schedule: MONDAY })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(other.caller.sources.update({ id: f.sourceId, webhookUrl: 'https://hooks.example.com/x' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(other.caller.sources.rotateWebhookSecret({ id: f.sourceId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      const got = await read(f.projectSlug, f.sourceSlug);
      expect([got.schedule, got.webhookUrl, got.webhookSecret]).toEqual([null, null, null]);
    } finally { await f.cleanup(); }
  });
});

describe('runs.getWithDetails — delivery', () => {
  const DELIVERY = '7d4f2b1a-3333-4333-8333-333333333333';
  async function runWith(f: { sourceId: string }, attempts: Array<{ attempt: number; ok: boolean; statusCode: number | null; error: string | null }>) {
    const [run] = await db.insert(runs).values({ sourceId: f.sourceId, status: 'completed', completedAt: new Date() }).returning({ id: runs.id });
    for (const [i, a] of attempts.entries()) {
      await db.insert(webhookDeliveries).values({ runId: run!.id, deliveryId: DELIVERY, ...a, at: new Date(Date.now() - (attempts.length - i) * 1000) });
    }
    return run!.id;
  }
  it('null with no attempt; delivered, retrying and failed from the latest one; no code or error for a customer', async () => {
    const f = await site('delivery');
    try {
      expect((await me.caller.runs.getWithDetails({ id: await runWith(f, []) }))!.delivery).toBeNull();
      const delivered = (await me.caller.runs.getWithDetails({ id: await runWith(f, [{ attempt: 1, ok: false, statusCode: 500, error: 'answered 500' }, { attempt: 2, ok: true, statusCode: 200, error: null }]) }))!.delivery;
      expect(delivered).toEqual({ state: 'delivered', at: expect.any(Date) });
      const retrying = (await me.caller.runs.getWithDetails({ id: await runWith(f, [{ attempt: 2, ok: false, statusCode: 503, error: 'answered 503' }]) }))!.delivery;
      expect(retrying).toEqual({ state: 'retrying', at: expect.any(Date) });
      const failed = (await me.caller.runs.getWithDetails({ id: await runWith(f, [{ attempt: 5, ok: false, statusCode: null, error: 'no answer within 10 s' }]) }))!.delivery;
      expect(failed).toEqual({ state: 'failed', at: expect.any(Date) });
    } finally { await f.cleanup(); }
  });
  it('staff read the stored code and error', async () => {
    const f = await site('delivery-staff');
    const saved = process.env.OPS_EMAILS;
    process.env.OPS_EMAILS = me.user.email;
    try {
      const id = await runWith(f, [{ attempt: 2, ok: false, statusCode: 503, error: 'answered 503' }]);
      expect((await me.caller.runs.getWithDetails({ id }))!.delivery).toEqual({ state: 'retrying', at: expect.any(Date), statusCode: 503, error: 'answered 503' });
    } finally {
      if (saved === undefined) delete process.env.OPS_EMAILS; else process.env.OPS_EMAILS = saved;
      await f.cleanup();
    }
  });
});
