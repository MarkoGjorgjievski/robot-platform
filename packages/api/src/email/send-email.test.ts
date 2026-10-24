// The email job (spec 2026-10-24 email §3.3, §6) against the in-process SMTP sink: sent; a temporary failure retried
// with the job backoff; failed after five; mail off is skipped; a silent server ends at the limit; never sent twice.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, emailMessages, memberships, users } from '@robot/db';
import { signedInCaller } from '../test-helpers/identity.js';
import { startSmtpSink, type SmtpSink } from '../test-helpers/smtp-sink.js';
import { jobsOf, runQueuedJobs, JOB_TEST_MS } from '../test-helpers/jobs.js';
import { jobRegistry } from '../jobs/handlers.js';
import { JOB_POLICIES, type JobPayloads } from '../jobs/types.js';
import type { JobContext } from '../jobs/context.js';
import { enqueue } from '../jobs/enqueue.js';
import { DEFAULT_MAIL_FROM, mailFrom, mailOn, smtpUrl } from './config.js';
import { SEND_TIMEOUT_MS, smtpOptions } from './smtp.js';
import { EMAIL_ATTEMPTS, sendEmailJob } from './send-email.js';
import { emailJobKey } from './queue-emails.js';

const me = await signedInCaller('send-email');
let sink: SmtpSink;
beforeAll(async () => { sink = await startSmtpSink(); });
afterAll(async () => { await sink.close(); await me.cleanup(); });
beforeEach(() => { sink.messages = []; sink.failNext = 0; sink.silent = false; });

let n = 0;
async function message() {
  const [row] = await db.insert(emailMessages).values({
    orgId: me.org.id, userId: me.user.id, kind: 'attention', dedupeKey: `test-send:${Date.now()}:${++n}`, toAddress: me.user.email,
    subject: 'Lamp shop needs your attention', text: 'Price needs you.\n', html: '<p>Price needs you.</p>',
  }).returning();
  return row!;
}
const rowOf = async (id: string) => (await db.query.emailMessages.findFirst({ where: eq(emailMessages.id, id) }))!;
const on = () => ({ SMTP_URL: sink.url });

describe('mail configuration (spec §3.3, §6)', () => {
  it('SMTP_URL empty or unset is mail off; MAIL_FROM has its default', () => {
    expect(smtpUrl({})).toBeNull();
    expect(smtpUrl({ SMTP_URL: '  ' })).toBeNull();
    expect(mailOn({ SMTP_URL: '' })).toBe(false);
    expect(smtpUrl({ SMTP_URL: ' smtp://127.0.0.1:1025 ' })).toBe('smtp://127.0.0.1:1025');
    expect(mailOn({ SMTP_URL: 'smtp://127.0.0.1:1025' })).toBe(true);
    expect(DEFAULT_MAIL_FROM).toBe('"Robot Platform" <no-reply@localhost>');
    expect(mailFrom({})).toBe(DEFAULT_MAIL_FROM);
    expect(mailFrom({ MAIL_FROM: ' Shop <hello@shop.test> ' })).toBe('Shop <hello@shop.test>');
  });
  it('a provider is configuration only, with the 15 s limits; anything but smtp(s) is refused', () => {
    expect(SEND_TIMEOUT_MS).toBe(15_000);
    expect(smtpOptions('smtps://apikey:s3cret@smtp.sendgrid.net:465')).toEqual({
      url: 'smtps://apikey:s3cret@smtp.sendgrid.net:465', connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 15_000,
    });
    expect(() => smtpOptions('http://smtp.example.com')).toThrow('SMTP_URL must start with smtp:// or smtps://');
  });
});

describe('sendEmailJob', () => {
  it('sends the row to the server, from MAIL_FROM, and marks it sent', async () => {
    const m = await message();
    expect(await sendEmailJob({ messageId: m.id }, { attempt: 1 }, { env: on() })).toEqual({ status: 'sent' });
    expect(sink.messages).toHaveLength(1);
    const got = sink.messages[0]!;
    expect(got.from).toBe('no-reply@localhost');
    expect(got.to).toEqual([me.user.email]);
    expect(got.data).toContain('Subject: Lamp shop needs your attention');
    // nodemailer writes the display name without the quotes it does not need.
    expect(got.data).toContain('From: Robot Platform <no-reply@localhost>');
    expect(await rowOf(m.id)).toMatchObject({ status: 'sent', attempts: 1, error: null, sentAt: expect.any(Date) });
  });

  it('mail off: the row is skipped and nothing is sent', async () => {
    const m = await message();
    expect(await sendEmailJob({ messageId: m.id }, { attempt: 1 }, { env: { SMTP_URL: '' } })).toEqual({ status: 'skipped' });
    expect(sink.messages).toHaveLength(0);
    expect(await rowOf(m.id)).toMatchObject({ status: 'skipped', attempts: 0, sentAt: null });
  });

  it('RF3: a retry after a send never sends again', async () => {
    const m = await message();
    await sendEmailJob({ messageId: m.id }, { attempt: 1 }, { env: on() });
    expect(await sendEmailJob({ messageId: m.id }, { attempt: 2 }, { env: on() })).toEqual({ status: 'none' });
    expect(sink.messages).toHaveLength(1);
  });

  it('a row that is gone (its organisation deleted) is nothing to send', async () => {
    expect(await sendEmailJob({ messageId: randomUUID() }, { attempt: 1 }, { env: on() })).toEqual({ status: 'none' });
  });

  it('an earlier failed attempt keeps the row queued for the retry, with the server’s answer', async () => {
    const m = await message();
    sink.failNext = 1;
    await expect(sendEmailJob({ messageId: m.id }, { attempt: 2 }, { env: on() })).rejects.toThrow(/451/);
    expect(await rowOf(m.id)).toMatchObject({ status: 'queued', attempts: 2, error: expect.stringMatching(/451/) });
  });

  it('after the fifth failed attempt the row is failed', async () => {
    const m = await message();
    sink.failNext = 1;
    await expect(sendEmailJob({ messageId: m.id }, { attempt: EMAIL_ATTEMPTS }, { env: on() })).rejects.toThrow(/451/);
    expect(await rowOf(m.id)).toMatchObject({ status: 'failed', attempts: 5, error: expect.stringMatching(/451/) });
    expect(EMAIL_ATTEMPTS).toBe(JOB_POLICIES.email.maxAttempts);
  });

  it('RF3: a mail server that never answers fails the attempt at the limit, and the row waits for the retry', async () => {
    const m = await message();
    sink.silent = true;
    const started = Date.now();
    await expect(sendEmailJob({ messageId: m.id }, { attempt: 1 }, { env: on(), timeoutMs: 300 })).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(await rowOf(m.id)).toMatchObject({ status: 'queued', attempts: 1, error: expect.any(String) });
    expect(sink.messages).toHaveLength(0);
  });

  it('a temporary failure is retried with the job backoff, then sent — one message per job', async () => {
    const m = await message();
    sink.failNext = 2;
    await enqueue(db, 'email', { messageId: m.id }, { key: emailJobKey(m.id) });
    const base = jobRegistry();
    const registry = { ...base, email: { ...base.email!, run: (p: JobPayloads['email'], ctx: JobContext) => sendEmailJob(p, ctx, { env: on() }) } };
    // runQueuedJobs stops when nothing is due, and a retry waits out its (test-short) backoff: drain until it settles.
    const until = Date.now() + 20_000;
    do { await runQueuedJobs({ registry }); } while ((await jobsOf('email'))[0]!.status === 'queued' && Date.now() < until);
    expect(sink.messages).toHaveLength(1);
    expect(await rowOf(m.id)).toMatchObject({ status: 'sent', attempts: 3, error: null });
    expect((await jobsOf('email'))[0]).toMatchObject({ status: 'done', attempts: 3 });
  }, JOB_TEST_MS);

  it('never stores or throws the credentials in SMTP_URL', async () => {
    const m = await message();
    const url = 'smtps://apikey:s3cret@smtp.provider.test:465';
    const send = async () => { throw new Error(`cannot reach ${url} (user apikey:s3cret)`); };
    const err = await sendEmailJob({ messageId: m.id }, { attempt: 1 }, { env: { SMTP_URL: url }, send }).catch((e: unknown) => e as Error);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toContain('s3cret');
    const row = await rowOf(m.id);
    expect(row.error).not.toContain('s3cret');
    expect(row.error).toContain('smtps://***@smtp.provider.test:465');
  });

  it('the registry runs it on the background lane, priority 25, five attempts, with no status row', () => {
    expect(JOB_POLICIES.email).toMatchObject({ lane: 'background', priority: 25, maxAttempts: 5, startWithinMs: null });
    expect(jobRegistry().email!.subject!({ messageId: 'x' })).toBeNull();
  });
});

describe('M3: at send time the recipient must still be one (spec §4.1)', () => {
  const extra: string[] = [];
  afterAll(async () => { for (const id of extra) await db.delete(users).where(eq(users.id, id)); });

  /** Another person in my org, with `role` and preferences, and one queued `kind` message to them. */
  async function to(kind: string, role: 'owner' | 'admin' | 'member' | null, prefs: { emailAttention?: boolean; emailFailedRuns?: boolean } = {}) {
    const email = `send-check-${Date.now()}-${++n}@example.com`;
    const [u] = await db.insert(users).values({ email, name: 'Ana', avatarColour: '#123456', ...prefs }).returning();
    extra.push(u!.id);
    if (role) await db.insert(memberships).values({ userId: u!.id, orgId: me.org.id, role });
    const [row] = await db.insert(emailMessages).values({
      orgId: me.org.id, userId: u!.id, kind, dedupeKey: `test-send-check:${Date.now()}:${++n}`, toAddress: email,
      subject: 'S', text: 'T\n', html: '<p>T</p>',
    }).returning();
    return row!;
  }
  const send = (id: string) => sendEmailJob({ messageId: id }, { attempt: 1 }, { env: on() });
  async function skipped(id: string, reason: RegExp) {
    expect(await send(id)).toEqual({ status: 'skipped' });
    expect(await rowOf(id)).toMatchObject({ status: 'skipped', sentAt: null, error: expect.stringMatching(reason) });
  }

  it('attention and run-failed go only to an owner or admin who still keeps that kind on', async () => {
    for (const kind of ['attention', 'run-failed']) {
      expect(await send((await to(kind, 'admin')).id)).toEqual({ status: 'sent' });
      await skipped((await to(kind, 'member')).id, /no longer an owner or admin/);
      await skipped((await to(kind, null)).id, /no longer a member/);
    }
    await skipped((await to('attention', 'owner', { emailAttention: false })).id, /turned these emails off/);
    await skipped((await to('run-failed', 'owner', { emailFailedRuns: false })).id, /turned these emails off/);
    expect(sink.messages).toHaveLength(2);
  });

  it('staff-access goes to an owner or admin whatever their preferences', async () => {
    expect(await send((await to('staff-access', 'owner', { emailAttention: false, emailFailedRuns: false })).id)).toEqual({ status: 'sent' });
    await skipped((await to('staff-access', 'member')).id, /no longer an owner or admin/);
    expect(sink.messages).toHaveLength(1);
  });

  it('role-changed goes to anyone still a member; removed always goes', async () => {
    expect(await send((await to('role-changed', 'member')).id)).toEqual({ status: 'sent' });
    await skipped((await to('role-changed', null)).id, /no longer a member/);
    expect(await send((await to('removed', null)).id)).toEqual({ status: 'sent' });
    expect(sink.messages).toHaveLength(2);
  });

  it('a recipient whose account is gone gets nothing', async () => {
    const m = await to('attention', 'owner');
    await db.delete(users).where(eq(users.id, m.userId!));
    await skipped(m.id, /no longer a member/);
    expect(sink.messages).toHaveLength(0);
  });
});
