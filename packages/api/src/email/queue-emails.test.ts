// queueEmails (spec 2026-10-24 email §3.2–§3.3, §4): one row per recipient with its dedupe key and one email job each,
// in one transaction; nobody outside the org; never twice; and a failure inside a caller's transaction never fails it.
import { describe, it, expect, afterAll, vi } from 'vitest';
import { and, DrizzleQueryError, eq, inArray, like } from 'drizzle-orm';
import { db, emailMessages, memberships, orgs, runs, users } from '@robot/db';
import { signedInCaller, enterAsStaff } from '../test-helpers/identity.js';
import { createProjectWithSource } from '../test-helpers/customer-source.js';
import { jobsOf } from '../test-helpers/jobs.js';
import { JOB_POLICIES } from '../jobs/types.js';
import { dedupeKey, emailJobKey, queueEmails, queueEmailsSafely, type EmailEvent } from './queue-emails.js';

const owner = await signedInCaller('email-queue');
const site = await createProjectWithSource(owner.caller, { tag: 'email-queue', fields: [{ name: 'Price', type: 'money' }] });
const extra: string[] = [];
afterAll(async () => {
  await site.cleanup();
  if (extra.length) await db.delete(users).where(inArray(users.id, extra));
  await owner.cleanup();
});

let n = 0;
/** Another person in the owner's org (no invitations yet: a membership row, as orgs.test.ts does). */
async function member(role: 'admin' | 'member', prefs: { emailAttention?: boolean; emailFailedRuns?: boolean } = {}) {
  const [u] = await db.insert(users).values({ email: `email-queue-${role}-${Date.now()}-${++n}@example.com`, name: `${role} ${n}`, avatarColour: '#3ddc84', ...prefs }).returning();
  extra.push(u!.id);
  const [m] = await db.insert(memberships).values({ userId: u!.id, orgId: owner.org.id, role }).returning();
  return { ...u!, membershipId: m!.id };
}
const rowsWhere = (prefix: string) => db.select().from(emailMessages).where(like(emailMessages.dedupeKey, `${prefix}%`));
const attention = (since: Date): EmailEvent => ({ kind: 'attention', sourceId: site.sourceId, since, attention: { fields: [site.keys.Price!], goneProducts: [], heldSince: null }, runnable: true });

describe('dedupeKey (spec §3.2)', () => {
  it('one key per recipient per event', () => {
    const at = new Date('2026-10-24T10:00:00.000Z');
    expect(dedupeKey({ kind: 'attention', sourceId: 's', since: at, attention: { fields: [], goneProducts: [], heldSince: null }, runnable: true }, 'u')).toBe(`attention:s:${at.getTime()}:u`);
    expect(dedupeKey({ kind: 'run-failed', runId: 'r' }, 'u')).toBe('run-failed:r:u');
    expect(dedupeKey({ kind: 'staff-access', staffActionId: 'a', orgId: 'o', actorUserId: 'x', sourceId: null }, 'u')).toBe('staff-access:a:u');
    expect(dedupeKey({ kind: 'role-changed', membershipId: 'm', orgId: 'o', userId: 'u', role: 'admin', at }, 'u')).toBe(`role-changed:m:admin:${at.getTime()}:u`);
    expect(dedupeKey({ kind: 'removed', orgId: 'o', userId: 'u', at }, 'u')).toBe(`removed:o:u:${at.getTime()}`);
    expect(emailJobKey('m1')).toBe('email:m1');
  });
});

describe('queueEmails', () => {
  it('attention: one row and one job per owner or admin who keeps it on; members and quiet admins get none; never twice', async () => {
    const admin = await member('admin');
    const quiet = await member('admin', { emailAttention: false });
    const plain = await member('member');
    const since = new Date();
    const { queued } = await queueEmails(db, attention(since), { env: { PUBLIC_APP_URL: 'https://app.example.com' } });
    expect(queued).toHaveLength(2);
    const rows = await rowsWhere(`attention:${site.sourceId}:${since.getTime()}:`);
    expect(rows.map((r) => r.toAddress).sort()).toEqual([admin.email, owner.user.email].sort());
    expect(rows.map((r) => r.userId)).not.toContain(quiet.id);
    expect(rows.map((r) => r.userId)).not.toContain(plain.id);
    for (const r of rows) {
      expect(r).toMatchObject({ orgId: owner.org.id, kind: 'attention', status: 'queued', attempts: 0, subject: 'Site email-queue needs your attention' });
      expect(r.text).toContain('Price needs you — runs go on as before.');
      expect(r.text).toContain(`Open the website: https://app.example.com/projects/${site.projectSlug}/sites/${site.sourceSlug}`);
      expect(r.html).toContain('<p');
    }
    const jobs = await jobsOf('email');
    expect(jobs.map((j) => j.key).sort()).toEqual(rows.map((r) => emailJobKey(r.id)).sort());
    expect(jobs[0]).toMatchObject({ priority: 25, maxAttempts: 5, payload: { messageId: expect.any(String) } });
    expect(JOB_POLICIES.email).toMatchObject({ lane: 'background', priority: 25, maxAttempts: 5, startWithinMs: null });
    // The same event again: every key is taken, nothing is queued.
    expect((await queueEmails(db, attention(since))).queued).toEqual([]);
    expect(await jobsOf('email')).toHaveLength(2);
    // A later turn to attention is a new event.
    expect((await queueEmails(db, attention(new Date(since.getTime() + 1)))).queued).toHaveLength(2);
  });

  it('run-failed: a failed run emails who keeps failed runs on; a completed run or a sample emails nobody', async () => {
    const [failed] = await db.insert(runs).values({ sourceId: site.sourceId, status: 'failed', errorMessage: "That page doesn't exist on shop.example.com (404). Check the address." }).returning();
    const [done] = await db.insert(runs).values({ sourceId: site.sourceId, status: 'completed' }).returning();
    const [sample] = await db.insert(runs).values({ sourceId: site.sourceId, status: 'failed', inputLabel: 'probe' }).returning();
    expect((await queueEmails(db, { kind: 'run-failed', runId: failed!.id })).queued.length).toBeGreaterThanOrEqual(1);
    const rows = await rowsWhere(`run-failed:${failed!.id}:`);
    const mine = rows.find((r) => r.userId === owner.user.id)!;
    expect(mine.subject).toBe('A run of Site email-queue failed');
    expect(mine.text).toContain("That page doesn't exist. Check the address.");
    expect(mine.text).not.toContain('shop.example.com');
    expect(mine.text).toContain(`/runs/${failed!.id}`);
    expect((await queueEmails(db, { kind: 'run-failed', runId: done!.id })).queued).toEqual([]);
    expect((await queueEmails(db, { kind: 'run-failed', runId: sample!.id })).queued).toEqual([]);
  });

  it('preferences: an owner who turned failed-run emails off gets none', async () => {
    await db.update(users).set({ emailFailedRuns: false }).where(eq(users.id, owner.user.id));
    try {
      const [failed] = await db.insert(runs).values({ sourceId: site.sourceId, status: 'failed' }).returning();
      await queueEmails(db, { kind: 'run-failed', runId: failed!.id });
      expect((await rowsWhere(`run-failed:${failed!.id}:`)).map((r) => r.userId)).not.toContain(owner.user.id);
    } finally {
      await db.update(users).set({ emailFailedRuns: true }).where(eq(users.id, owner.user.id));
    }
  });

  it('staff-access: the owners and admins, never the operator who entered — not even one who is a member here, nor a staff session (§4.5)', async () => {
    const operator = await member('admin');
    const op = await signedInCaller('email-queue-op');
    try {
      await enterAsStaff(op, owner.org.id);
      const staffActionId = '6c0f6c3e-2222-4222-8222-222222222222';
      await queueEmails(db, { kind: 'staff-access', staffActionId, orgId: owner.org.id, actorUserId: operator.id, sourceId: site.sourceId });
      const rows = await rowsWhere(`staff-access:${staffActionId}:`);
      expect(rows.map((r) => r.userId)).toContain(owner.user.id);
      expect(rows.map((r) => r.userId)).not.toContain(operator.id);
      expect(rows.map((r) => r.userId)).not.toContain(op.user.id);
      expect(rows[0]!.subject).toBe('Our team is working in your organisation');
      expect(rows[0]!.text).toContain('Website: Site email-queue');
    } finally { await op.cleanup(); }
  });

  it('role-changed and removed go to that one member only; nobody outside the org ever gets one (§4.1)', async () => {
    const m = await member('member');
    const at = new Date();
    await queueEmails(db, { kind: 'role-changed', membershipId: m.membershipId, orgId: owner.org.id, userId: m.id, role: 'admin', at });
    expect((await rowsWhere(`role-changed:${m.membershipId}:`)).map((r) => [r.toAddress, r.subject])).toEqual([[m.email, `Your role in ${owner.org.name} changed`]]);
    await queueEmails(db, { kind: 'removed', orgId: owner.org.id, userId: m.id, at });
    const removed = await rowsWhere(`removed:${owner.org.id}:${m.id}:`);
    expect(removed.map((r) => [r.toAddress, r.subject, r.userId])).toEqual([[m.email, `You were removed from ${owner.org.name}`, m.id]]);
    expect(removed[0]!.text).toContain('Sign in: http://localhost:3000/login');
    // Not a member (any more, or ever): nothing.
    await db.delete(memberships).where(and(eq(memberships.userId, m.id), eq(memberships.orgId, owner.org.id)));
    expect((await queueEmails(db, { kind: 'removed', orgId: owner.org.id, userId: m.id, at: new Date(at.getTime() + 1) })).queued).toEqual([]);
    const stranger = await signedInCaller('email-queue-stranger');
    try {
      expect((await queueEmails(db, { kind: 'role-changed', membershipId: m.membershipId, orgId: owner.org.id, userId: stranger.user.id, role: 'admin', at })).queued).toEqual([]);
    } finally { await stranger.cleanup(); }
  });

  it('§4.3: a failure inside a caller’s transaction is logged and undone alone; the caller’s own writes commit', async () => {
    const name = `Kept ${Date.now()}`;
    await db.transaction(async (tx) => {
      await tx.update(orgs).set({ name }).where(eq(orgs.id, owner.org.id));
      // Not a uuid: Postgres refuses inside the savepoint.
      expect(await queueEmailsSafely(tx, { kind: 'removed', orgId: 'not-a-uuid', userId: owner.user.id, at: new Date() })).toBe(0);
    });
    expect((await db.query.orgs.findFirst({ where: eq(orgs.id, owner.org.id) }))!.name).toBe(name);
  });

  it('T3: a queueing failure logs one line — the message and the Postgres code — never the query or its values', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(await queueEmailsSafely(db, { kind: 'removed', orgId: 'not-a-uuid', userId: owner.user.id, at: new Date() })).toBe(0);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0]).toHaveLength(1);
      const line = spy.mock.calls[0]![0] as string;
      expect(line).toMatch(/^\[email\] removed emails could not be queued: .*invalid input syntax.* \(22P02\)$/);
      expect(line).not.toMatch(/Failed query|params:|select/i);

      spy.mockClear();
      const pgError = Object.assign(new Error('duplicate key value violates unique constraint "email_messages_dedupe_key_idx"'), { code: '23505' });
      const failing = { transaction: async () => { throw new DrizzleQueryError('insert into email_messages values ($1, $2)', ['ana@example.com', '<p>Lamp shop</p>'], pgError); } };
      expect(await queueEmailsSafely(failing as never, { kind: 'removed', orgId: owner.org.id, userId: owner.user.id, at: new Date() })).toBe(0);
      expect(spy.mock.calls).toEqual([['[email] removed emails could not be queued: duplicate key value violates unique constraint "email_messages_dedupe_key_idx" (23505)']]);
    } finally { spy.mockRestore(); }
  });
});
