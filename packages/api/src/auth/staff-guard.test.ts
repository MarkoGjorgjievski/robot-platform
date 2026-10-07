import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db, memberships, projects, sessions, staffActions } from '@robot/db';
import { appRouter } from '../routers/index.js';
import { createCallerFactory } from '../trpc.js';
import { loadSession } from './session.js';
import { enterAsStaff, signedInCaller, type SignedIn } from '../test-helpers/identity.js';
import { createProjectWithSource } from '../test-helpers/customer-source.js';
import { STAFF_BLOCKED_MESSAGE, STAFF_DENY_LIST, STAFF_SESSION_ENDED_MESSAGE, isStaffBlocked } from './staff-guard.js';

const procedures = (appRouter as unknown as { _def: { procedures: Record<string, { _def: { type: string } }> } })._def.procedures;

async function reload(who: SignedIn): Promise<SignedIn> {
  const session = (await loadSession(db, who.session.token))!;
  return { ...who, session, caller: createCallerFactory(appRouter)({ db, session }) };
}

describe('deny-list (spec 2026-10-07 §2.3)', () => {
  it('every listed path is a real mutation', () => {
    for (const path of STAFF_DENY_LIST) {
      expect(procedures[path], path).toBeDefined();
      expect(procedures[path]!._def.type, path).toBe('mutation');
    }
  });

  it('every orgs.* mutation is listed', () => {
    const orgMutations = Object.entries(procedures).filter(([p, v]) => p.startsWith('orgs.') && v._def.type === 'mutation').map(([p]) => p);
    for (const p of orgMutations) expect(isStaffBlocked(p), p).toBe(true);
  });
});

describe('entering and leaving (spec 2026-10-07 §2.2)', () => {
  let staff: SignedIn;
  let customer: SignedIn;
  let sourceId: string;
  const saved = process.env.OPS_EMAILS;

  beforeAll(async () => {
    staff = await signedInCaller('staff-guard-op');
    customer = await signedInCaller('staff-guard-cust');
    process.env.OPS_EMAILS = staff.user.email;
    staff = await reload(staff);
    ({ sourceId } = await createProjectWithSource(customer.caller, { tag: 'staff-guard-cust', fields: [{ name: 'Title', type: 'text' }] }));
  });
  afterAll(async () => {
    process.env.OPS_EMAILS = saved;
    await customer.cleanup();
    await staff.cleanup();
  });

  it('a non-operator cannot enter', async () => {
    await expect(customer.caller.ops.enterOrg({ sourceId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('enter → inside the customer org, logged; deny-listed calls are FORBIDDEN; leave → back, logged', async () => {
    const r = await staff.caller.ops.enterOrg({ sourceId });
    expect(r.path).toMatch(/^\/projects\/[^/]+\/sites\/[^/]+$/);
    expect(r.orgName).toBe(customer.org.name);
    const inside = await reload(staff);
    expect(inside.session.org.id).toBe(customer.org.id);

    await expect(inside.caller.sources.delete({ sourceId })).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'Not available while working as staff' });
    await expect(inside.caller.orgs.rename({ name: 'Hijacked' })).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'Not available while working as staff' });
    await expect(inside.caller.orgs.create({ name: 'Side org' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(inside.caller.auth.switchOrg({ orgId: staff.org.id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // Own-account changes stay allowed.
    await expect(inside.caller.auth.setTheme({ theme: 'dark' })).resolves.toEqual({ theme: 'dark' });

    await inside.caller.ops.leaveOrg();
    const back = await reload(staff);
    expect(back.session.org.id).toBe(staff.org.id);
    expect(back.session.staff).toBeNull();

    const log = await db.select().from(staffActions).where(eq(staffActions.orgId, customer.org.id)).orderBy(staffActions.at);
    expect(log.map((l) => l.summary)).toEqual(['Started working as staff', 'Stopped working as staff']);
    expect(log[0]).toMatchObject({ userId: staff.user.id, actorEmail: staff.user.email, action: 'ops.enterOrg', sourceId });
  });

  it('a deny-listed procedure works again for the same user outside staff mode', async () => {
    const back = await reload(staff);
    await expect(back.caller.orgs.rename({ name: 'Own renamed' })).resolves.toEqual({ name: 'Own renamed' });
  });

  it('a real member who enters as staff is still blocked', async () => {
    await db.insert(memberships).values({ userId: staff.user.id, orgId: customer.org.id, role: 'admin' });
    try {
      await staff.caller.ops.enterOrg({ sourceId });
      const inside = await reload(staff);
      await expect(inside.caller.orgs.rename({ name: 'Nope' })).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'Not available while working as staff' });
      await inside.caller.ops.leaveOrg();
    } finally {
      await db.delete(memberships).where(and(eq(memberships.userId, staff.user.id), eq(memberships.orgId, customer.org.id)));
    }
  });

  it('signing out inside staff mode is logged', async () => {
    const other = await signedInCaller('staff-guard-op2');
    process.env.OPS_EMAILS = `${staff.user.email},${other.user.email}`;
    try {
      const op = await reload(other);
      await op.caller.ops.enterOrg({ sourceId });
      const inside = await reload(other);
      await inside.caller.auth.signOut();
      const last = await db.select().from(staffActions).where(and(eq(staffActions.orgId, customer.org.id), eq(staffActions.userId, other.user.id)));
      expect(last.map((l) => l.summary)).toContain('Stopped working as staff (signed out)');
    } finally {
      process.env.OPS_EMAILS = staff.user.email;
      await other.cleanup();
    }
  });

  it('leaving an expired staff session logs the expiry', async () => {
    await staff.caller.ops.enterOrg({ sourceId });
    await db.update(sessions).set({ staffEnteredAt: new Date(Date.now() - 9 * 3600_000) }).where(eq(sessions.token, staff.session.token));
    const expired = await reload(staff);
    expect(expired.session.staffExpired).toEqual({ orgId: customer.org.id, orgName: customer.org.name });
    await expired.caller.ops.leaveOrg();
    const row = await db.query.sessions.findFirst({ where: eq(sessions.token, staff.session.token) });
    expect(row!.staffOrgId).toBeNull();
    const log = await db.select().from(staffActions).where(eq(staffActions.orgId, customer.org.id));
    expect(log.map((l) => l.summary)).toContain('Staff session ended after 8 hours');
  });
});

describe('every deny-listed path is refused in staff mode (spec 2026-10-07 §2.3)', () => {
  let op: SignedIn;
  let customer: SignedIn;
  let inside: SignedIn;
  const saved = process.env.OPS_EMAILS;

  beforeAll(async () => {
    op = await signedInCaller('staff-deny-op');
    customer = await signedInCaller('staff-deny-cust');
    process.env.OPS_EMAILS = op.user.email;
    inside = await enterAsStaff(op, customer.org.id);
    expect(inside.session.staff).not.toBeNull();
  });
  afterAll(async () => {
    process.env.OPS_EMAILS = saved;
    await customer.cleanup();
    await op.cleanup();
  });

  // The guard runs before input parsing, so `{}` reaches it for every path.
  it.each(STAFF_DENY_LIST)('%s', async (path) => {
    const call = path.split('.').reduce<any>((node, key) => node[key], inside.caller) as (input: unknown) => Promise<unknown>;
    await expect(call({})).rejects.toMatchObject({ code: 'FORBIDDEN', message: STAFF_BLOCKED_MESSAGE });
  });
});

describe('an expired staff session cannot change anything (final review, 2026-10-07)', () => {
  let op: SignedIn;
  let customer: SignedIn;
  let sourceId: string;
  const saved = process.env.OPS_EMAILS;

  beforeAll(async () => {
    op = await signedInCaller('staff-exp-op');
    customer = await signedInCaller('staff-exp-cust');
    process.env.OPS_EMAILS = op.user.email;
    ({ sourceId } = await createProjectWithSource(customer.caller, { tag: 'staff-exp-cust', fields: [{ name: 'Title', type: 'text' }] }));
  });
  afterAll(async () => {
    process.env.OPS_EMAILS = saved;
    await customer.cleanup();
    await op.cleanup();
  });

  it('mutations are refused with "Your staff session ended", except leaving and own-account ones', async () => {
    const expired = await enterAsStaff(op, customer.org.id, new Date(Date.now() - 9 * 3600_000));
    expect(expired.session.staffExpired).not.toBeNull();
    expect(STAFF_SESSION_ENDED_MESSAGE).toBe('Your staff session ended');

    await expect(expired.caller.projects.create({ name: 'Stray project' })).rejects.toMatchObject({ code: 'FORBIDDEN', message: STAFF_SESSION_ENDED_MESSAGE });
    await expect(expired.caller.sources.rename({ sourceId, name: 'Stray rename' })).rejects.toMatchObject({ code: 'FORBIDDEN', message: STAFF_SESSION_ENDED_MESSAGE });
    // Queries still answer, so the app can see the expiry and land in ops.
    await expect(expired.caller.auth.me()).resolves.toBeDefined();
    await expect(expired.caller.auth.setTheme({ theme: 'dark' })).resolves.toEqual({ theme: 'dark' });
    await expect(expired.caller.ops.leaveOrg()).resolves.toEqual({ ok: true });

    const own = await db.query.projects.findMany({ where: eq(projects.orgId, op.org.id) });
    expect(own.map((p) => p.name)).not.toContain('Stray project');
  });

  it('a session that is neither staff nor expired is unaffected', async () => {
    await expect(customer.caller.sources.rename({ sourceId, name: 'Renamed by owner' })).resolves.toBeDefined();
  });
});

describe('the log of one visit (final review, 2026-10-07)', () => {
  let op: SignedIn;
  let a: SignedIn;
  let b: SignedIn;
  const siteA = { projectId: '', sourceId: '' };
  const siteB = { projectId: '', sourceId: '' };
  const saved = process.env.OPS_EMAILS;

  const rows = (userId: string) => db.select().from(staffActions).where(eq(staffActions.userId, userId)).orderBy(staffActions.at);

  beforeAll(async () => {
    op = await signedInCaller('staff-visit-op');
    a = await signedInCaller('staff-visit-a');
    b = await signedInCaller('staff-visit-b');
    process.env.OPS_EMAILS = op.user.email;
    op = await reload(op);
    ({ projectId: siteA.projectId, sourceId: siteA.sourceId } = await createProjectWithSource(a.caller, { tag: 'staff-visit-a', fields: [{ name: 'Title', type: 'text' }] }));
    ({ projectId: siteB.projectId, sourceId: siteB.sourceId } = await createProjectWithSource(b.caller, { tag: 'staff-visit-b', fields: [{ name: 'Title', type: 'text' }] }));
  });
  afterAll(async () => {
    process.env.OPS_EMAILS = saved;
    await a.cleanup();
    await b.cleanup();
    await op.cleanup();
  });

  it('re-entering the same org writes no second "Started" row and keeps the 8 hours where they were', async () => {
    await op.caller.ops.enterOrg({ sourceId: siteA.sourceId });
    const inside = await reload(op);
    const enteredAt = inside.session.staff!.enteredAt;
    const again = await inside.caller.ops.enterOrg({ sourceId: siteA.sourceId });
    expect(again.path).toMatch(/^\/projects\/[^/]+\/sites\/[^/]+$/);
    const still = await reload(op);
    expect(still.session.staff).toEqual({ orgId: a.org.id, enteredAt });
    expect((await rows(op.user.id)).map((r) => r.summary)).toEqual(['Started working as staff']);
  });

  it('"Stopped" rows carry the website and project the visit started on', async () => {
    // Moving from A to B closes A's visit; leaving closes B's; signing out closes a third.
    const inA = await reload(op);
    await inA.caller.ops.enterOrg({ sourceId: siteB.sourceId });
    await (await reload(op)).caller.ops.leaveOrg();
    await op.caller.ops.enterOrg({ sourceId: siteA.sourceId });
    await (await reload(op)).caller.auth.signOut();

    const log = (await rows(op.user.id)).map((r) => ({ orgId: r.orgId, summary: r.summary, sourceId: r.sourceId, projectId: r.projectId }));
    expect(log).toEqual([
      { orgId: a.org.id, summary: 'Started working as staff', ...siteA },
      { orgId: a.org.id, summary: 'Stopped working as staff', ...siteA },
      { orgId: b.org.id, summary: 'Started working as staff', ...siteB },
      { orgId: b.org.id, summary: 'Stopped working as staff', ...siteB },
      { orgId: a.org.id, summary: 'Started working as staff', ...siteA },
      { orgId: a.org.id, summary: 'Stopped working as staff (signed out)', ...siteA },
    ]);
  });
});
