// Failed runs and the account messages through their real paths (spec 2026-10-24 email §3.1, §3.3, §4): setRole and
// remove queue theirs in their own transactions; ops.enterOrg emails the owners and admins, never the operator; a
// failed run reaches the owners and admins as they are now, once per person.
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { and, eq, like } from 'drizzle-orm';
import { db, emailMessages, memberships, runs } from '@robot/db';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from './index.js';
import { loadSession } from '../auth/session.js';
import { signedInCaller, type SignedIn } from '../test-helpers/identity.js';
import { createProjectWithSource } from '../test-helpers/customer-source.js';
import { notifyRunFailed } from '../email/run-failed.js';
import { deliverClosedRuns } from '../jobs/rows.js';

const owner = await signedInCaller('email-account-owner');
const site = await createProjectWithSource(owner.caller, { tag: 'email-account', fields: [{ name: 'Price', type: 'money' }] });
const people: SignedIn[] = [];
afterAll(async () => {
  await site.cleanup();
  for (const p of people) await p.cleanup();
  await owner.cleanup();
});

/** Someone else, joined to the owner's org with `role` (a membership row: there are no invitations yet). */
async function joined(tag: string, role: 'admin' | 'member') {
  const p = await signedInCaller(`email-account-${tag}`);
  people.push(p);
  const [m] = await db.insert(memberships).values({ userId: p.user.id, orgId: owner.org.id, role }).returning();
  return { ...p, membershipId: m!.id };
}
const mail = (kind: string) => db.select().from(emailMessages).where(and(eq(emailMessages.orgId, owner.org.id), eq(emailMessages.kind, kind)));
const runMail = (runId: string) => db.select().from(emailMessages).where(like(emailMessages.dedupeKey, `run-failed:${runId}:%`));

describe('orgs.members.setRole (spec §3.1)', () => {
  it('tells that member their new role, once per change; the same role again sends nothing', async () => {
    const m = await joined('role', 'member');
    await owner.caller.orgs.members.setRole({ userId: m.user.id, role: 'admin' });
    const mine = async () => (await mail('role-changed')).filter((r) => r.userId === m.user.id);
    const rows = await mine();
    expect(rows.map((r) => [r.toAddress, r.subject])).toEqual([[m.user.email, `Your role in ${owner.org.name} changed`]]);
    expect(rows[0]!.text).toContain(`You are now an admin of ${owner.org.name}.`);
    expect(rows[0]!.dedupeKey).toMatch(new RegExp(`^role-changed:${m.membershipId}:admin:\\d+:${m.user.id}$`));
    await owner.caller.orgs.members.setRole({ userId: m.user.id, role: 'admin' });
    expect(await mine()).toHaveLength(1);
    await owner.caller.orgs.members.setRole({ userId: m.user.id, role: 'member' });
    expect(await mine()).toHaveLength(2);
  });

  it('T6: two changes to the same new role at once send one email', async () => {
    for (let i = 0; i < 3; i++) {
      const m = await joined(`role-race-${i}`, 'member');
      await Promise.all([1, 2].map(() => owner.caller.orgs.members.setRole({ userId: m.user.id, role: 'admin' })));
      expect((await mail('role-changed')).filter((r) => r.userId === m.user.id)).toHaveLength(1);
    }
  });
});

describe('orgs.members.remove (spec §3.1, §4.1)', () => {
  it('sends the one removal message to the former member; removing them again is refused and sends nothing', async () => {
    const m = await joined('removed', 'member');
    await owner.caller.orgs.members.remove({ userId: m.user.id });
    expect(await db.query.memberships.findFirst({ where: and(eq(memberships.userId, m.user.id), eq(memberships.orgId, owner.org.id)) })).toBeUndefined();
    const theirs = async () => (await mail('removed')).filter((r) => r.toAddress === m.user.email);
    const rows = await theirs();
    expect(rows.map((r) => [r.subject, r.userId])).toEqual([[`You were removed from ${owner.org.name}`, m.user.id]]);
    expect(rows[0]!.text).toContain('Sign in: http://localhost:3000/login');
    await expect(owner.caller.orgs.members.remove({ userId: m.user.id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await theirs()).toHaveLength(1);
  });
});

describe('failed runs (spec §3.1)', () => {
  it('RF4: after a removal and a demotion, a failed run emails only the owners and admins left', async () => {
    const stays = await joined('stays', 'admin');
    const demoted = await joined('demoted', 'admin');
    const gone = await joined('gone', 'admin');
    await owner.caller.orgs.members.setRole({ userId: demoted.user.id, role: 'member' });
    await owner.caller.orgs.members.remove({ userId: gone.user.id });
    const [run] = await db.insert(runs).values({ sourceId: site.sourceId, status: 'failed' }).returning();
    await notifyRunFailed(db, run!.id);
    const to = (await runMail(run!.id)).map((r) => r.toAddress);
    expect(to).toEqual(expect.arrayContaining([owner.user.email, stays.user.email]));
    expect(to).not.toContain(demoted.user.email);
    expect(to).not.toContain(gone.user.email);
  });

  it('RF5: a failed run reported by two paths emails each person once', async () => {
    const [run] = await db.insert(runs).values({ sourceId: site.sourceId, status: 'failed', errorMessage: 'This run stopped before it finished. Extract again to pick up where it left off.' }).returning();
    await notifyRunFailed(db, run!.id);
    await deliverClosedRuns(db, [run!.id]);
    const rows = await runMail(run!.id);
    expect(rows.filter((r) => r.userId === owner.user.id)).toHaveLength(1);
    expect(new Set(rows.map((r) => r.userId)).size).toBe(rows.length);
    expect(rows[0]!.text).toContain('This run stopped before it finished.');
  });

  it('a cancelled or partial run closed by the job layer emails nobody', async () => {
    const [cancelled] = await db.insert(runs).values({ sourceId: site.sourceId, status: 'cancelled' }).returning();
    const [partial] = await db.insert(runs).values({ sourceId: site.sourceId, status: 'partial' }).returning();
    await deliverClosedRuns(db, [cancelled!.id, partial!.id]);
    expect(await runMail(cancelled!.id)).toEqual([]);
    expect(await runMail(partial!.id)).toEqual([]);
  });
});

describe('ops.enterOrg (spec §3.1, §4.5)', () => {
  const saved = process.env.OPS_EMAILS;
  let op: SignedIn;
  beforeAll(async () => {
    op = await signedInCaller('email-account-op');
    people.push(op);
    process.env.OPS_EMAILS = op.user.email;
  });
  afterAll(() => {
    if (saved === undefined) delete process.env.OPS_EMAILS;
    else process.env.OPS_EMAILS = saved;
  });
  /** The operator's caller on their session as it is now (enterOrg moves it). */
  const opNow = async () => createCallerFactory(appRouter)({ db, session: (await loadSession(db, op.session.token))! });

  it('tells the owners and admins our team is working there, never the operator or a member; entering again sends nothing', async () => {
    const admin = await joined('staff-admin', 'admin');
    const plain = await joined('staff-member', 'member');
    await (await opNow()).ops.enterOrg({ sourceId: site.sourceId });
    const rows = await mail('staff-access');
    const to = rows.map((r) => r.toAddress);
    expect(to).toEqual(expect.arrayContaining([owner.user.email, admin.user.email]));
    expect(to).not.toContain(plain.user.email);
    expect(to).not.toContain(op.user.email);
    expect(rows[0]!.subject).toBe('Our team is working in your organisation');
    expect(rows[0]!.text).toContain('Website: Site email-account');
    await (await opNow()).ops.enterOrg({ sourceId: site.sourceId });
    expect(await mail('staff-access')).toHaveLength(rows.length);
    // Leaving and coming back is a new visit.
    await (await opNow()).ops.leaveOrg();
    await (await opNow()).ops.enterOrg({ sourceId: site.sourceId });
    expect((await mail('staff-access')).length).toBeGreaterThan(rows.length);
  });
});
