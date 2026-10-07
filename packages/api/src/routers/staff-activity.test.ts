import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, runs, staffActions } from '@robot/db';
import { signedInCaller, type SignedIn } from '../test-helpers/identity.js';
import { createProjectWithSource } from '../test-helpers/customer-source.js';
import { recordStaffAction } from '../auth/staff-actions.js';

describe('staff activity (spec 2026-10-07 §2.4)', () => {
  let staff: SignedIn; let customer: SignedIn; let other: SignedIn;
  let sourceId: string; let projectId: string; let runId: string;
  const saved = process.env.OPS_EMAILS;

  beforeAll(async () => {
    staff = await signedInCaller('activity-op');
    customer = await signedInCaller('activity-cust');
    other = await signedInCaller('activity-other');
    process.env.OPS_EMAILS = staff.user.email;
    ({ sourceId, projectId } = await createProjectWithSource(customer.caller, {
      tag: 'activity',
      fields: [{ name: 'Price', type: 'money' }],
    }));
    const [run] = await db.insert(runs).values({ sourceId, status: 'completed', costUsd: '1.2400' }).returning({ id: runs.id });
    runId = run!.id;
    const base = { orgId: customer.org.id, userId: staff.user.id, actorEmail: staff.user.email };
    for (let n = 0; n < 23; n++) await recordStaffAction(db, { ...base, action: 'sources.update', summary: `Change ${n}`, projectId, sourceId });
    await recordStaffAction(db, { ...base, action: 'crawl.execute', summary: 'Ran an extraction on Nike', projectId, sourceId, runId });
    await recordStaffAction(db, { orgId: other.org.id, userId: staff.user.id, actorEmail: staff.user.email, action: 'sources.update', summary: 'Elsewhere' });
  });
  afterAll(async () => {
    if (saved === undefined) delete process.env.OPS_EMAILS; else process.env.OPS_EMAILS = saved;
    await other.cleanup(); await customer.cleanup(); await staff.cleanup();
  });

  it('the customer sees their own entries, newest first, 20 per page, with run cost read now', async () => {
    const p0 = await customer.caller.orgs.staffActivity({ page: 0 });
    expect(p0.total).toBe(24);
    expect(p0.entries).toHaveLength(20);
    expect(p0.entries[0]).toMatchObject({ summary: 'Ran an extraction on Nike', run: { id: runId, costUsd: 1.24 }, actor: { email: staff.user.email } });
    expect(p0.entries.every((e) => e.org.id === customer.org.id)).toBe(true);
    const p1 = await customer.caller.orgs.staffActivity({ page: 1 });
    expect(p1.entries).toHaveLength(4);
  });

  it('cost is read at view time, not stored', async () => {
    await db.update(runs).set({ costUsd: '2.5000' }).where(eq(runs.id, runId));
    const p0 = await customer.caller.orgs.staffActivity({ page: 0 });
    expect(p0.entries[0]!.run!.costUsd).toBe(2.5);
  });

  it('another org sees only its own entries', async () => {
    const r = await other.caller.orgs.staffActivity({ page: 0 });
    expect(r.entries.map((e) => e.summary)).toEqual(['Elsewhere']);
  });

  it('ops filters by customer and staff member and by website', async () => {
    const all = await staff.caller.ops.staffActivity({ userId: staff.user.id });
    expect(all.total).toBeGreaterThanOrEqual(25);
    const byOrg = await staff.caller.ops.staffActivity({ orgId: customer.org.id });
    expect(byOrg.total).toBe(24);
    const bySite = await staff.caller.ops.staffActivity({ sourceId, pageSize: 10 });
    expect(bySite.entries).toHaveLength(10);
    const filters = await staff.caller.ops.staffActivityFilters();
    expect(filters.customers.map((c) => c.id)).toEqual(expect.arrayContaining([customer.org.id, other.org.id]));
    expect(filters.staff.map((s) => s.email)).toContain(staff.user.email);
  });

  it('a non-operator cannot read ops.staffActivity', async () => {
    await expect(customer.caller.ops.staffActivity({})).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('a deleted staff user keeps their entries with the email', async () => {
    const gone = await signedInCaller('activity-gone');
    await recordStaffAction(db, { orgId: customer.org.id, userId: gone.user.id, actorEmail: gone.user.email, action: 'sources.update', summary: 'By someone gone' });
    await gone.cleanup();
    const r = await customer.caller.orgs.staffActivity({ page: 0 });
    expect(r.entries[0]).toMatchObject({ summary: 'By someone gone', actor: { name: null, email: gone.user.email } });
    await db.delete(staffActions).where(eq(staffActions.summary, 'By someone gone')); // keep the counts above stable on re-run
  });
});
