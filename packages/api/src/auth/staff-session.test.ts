import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, sessions } from '@robot/db';
import { signedInCaller, enterAsStaff, type SignedIn } from '../test-helpers/identity.js';
import { loadSession, STAFF_SESSION_MS } from './session.js';

describe('staff session (spec 2026-10-07 §2.1)', () => {
  let staff: SignedIn;
  let customer: SignedIn;
  const saved = process.env.OPS_EMAILS;

  beforeAll(async () => {
    staff = await signedInCaller('staff-session-op');
    customer = await signedInCaller('staff-session-cust');
  });
  afterEach(() => { process.env.OPS_EMAILS = staff.user.email; });
  afterAll(async () => {
    process.env.OPS_EMAILS = saved;
    await customer.cleanup();
    await staff.cleanup();
  });

  it('serves the customer org while the email is an operator and under 8 hours', async () => {
    process.env.OPS_EMAILS = staff.user.email;
    const inside = await enterAsStaff(staff, customer.org.id);
    expect(inside.session.org.id).toBe(customer.org.id);
    expect(inside.session.role).toBe('member');
    expect(inside.session.staff).toEqual({ orgId: customer.org.id, enteredAt: expect.any(Date) });
    expect(inside.session.staffExpired).toBeNull();
    const projects = await inside.caller.projects.list();
    expect(Array.isArray(projects)).toBe(true);
  });

  it('falls back to the own org when the email leaves OPS_EMAILS', async () => {
    process.env.OPS_EMAILS = staff.user.email;
    await enterAsStaff(staff, customer.org.id);
    process.env.OPS_EMAILS = '';
    const s = (await loadSession(db, staff.session.token))!;
    expect(s.org.id).toBe(staff.org.id);
    expect(s.staff).toBeNull();
    expect(s.staffExpired).toBeNull();
  });

  it('falls back after 8 hours and reports staffExpired with the customer name', async () => {
    process.env.OPS_EMAILS = staff.user.email;
    await enterAsStaff(staff, customer.org.id, new Date(Date.now() - STAFF_SESSION_MS - 1000));
    const s = (await loadSession(db, staff.session.token))!;
    expect(s.org.id).toBe(staff.org.id);
    expect(s.staff).toBeNull();
    expect(s.staffExpired).toEqual({ orgId: customer.org.id, orgName: customer.org.name });
  });

  it('falls back when the customer org is deleted', async () => {
    process.env.OPS_EMAILS = staff.user.email;
    const doomed = await signedInCaller('staff-session-doomed');
    await enterAsStaff(staff, doomed.org.id);
    await doomed.cleanup();
    const s = (await loadSession(db, staff.session.token))!;
    expect(s.org.id).toBe(staff.org.id);
    expect(s.staff).toBeNull();
    const row = await db.query.sessions.findFirst({ where: eq(sessions.token, staff.session.token) });
    expect(row!.staffOrgId).toBeNull();
  });

  it('a non-staff session is unchanged', async () => {
    const s = (await loadSession(db, customer.session.token))!;
    expect(s.org.id).toBe(customer.org.id);
    expect(s.staff).toBeNull();
    expect(s.staffExpired).toBeNull();
  });

  it('auth.me exposes staff with the customer name', async () => {
    process.env.OPS_EMAILS = staff.user.email;
    const inside = await enterAsStaff(staff, customer.org.id);
    const me = await inside.caller.auth.me();
    expect(me.staff).toEqual({ orgId: customer.org.id, orgName: customer.org.name, enteredAt: expect.any(Date) });
    expect(me.currentOrg.id).toBe(customer.org.id);
    expect(me.orgs.map((o) => o.id)).not.toContain(customer.org.id);
  });
});
