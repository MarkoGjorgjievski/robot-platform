// The monthly AI limit, set and read (spec 2026-10-24 metering §2.2, §2.4): staff set it — an operator in their own
// org, or staff in staff mode, logged in staff words; a customer is refused and reads no amount. Ops reads every org.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, orgs, runs, staffActions } from '@robot/db';
import { enterAsStaff, signedInCaller, type SignedIn } from '../test-helpers/identity.js';
import { createProjectWithSource } from '../test-helpers/customer-source.js';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from './index.js';
import { groupOf } from '../isolation/rate-limit.js';
import { monthKeyOf, usageByOrg } from '../metering/org-usage.js';

// Tags hold no "AI" or "limit": the RF4 assertion scans the customer's whole answer, actor names included.
let op: SignedIn;
let customer: SignedIn;
let staff: SignedIn;
const saved = { ops: process.env.OPS_EMAILS, cap: process.env.ORG_AI_CAP_USD };
const capOf = async (orgId: string) => (await db.query.orgs.findFirst({ where: eq(orgs.id, orgId), columns: { aiCapUsd: true } }))!.aiCapUsd;
const logOf = async (orgId: string) => db.select().from(staffActions).where(eq(staffActions.orgId, orgId)).orderBy(staffActions.at);
const anon = () => createCallerFactory(appRouter)({ db, session: null });

beforeAll(async () => {
  op = await signedInCaller('capset-op');
  customer = await signedInCaller('capset-cust');
  process.env.OPS_EMAILS = op.user.email;
  delete process.env.ORG_AI_CAP_USD;
  staff = await enterAsStaff(op, customer.org.id);
});
afterEach(async () => {
  for (const o of [op.org.id, customer.org.id]) await db.update(orgs).set({ aiCapUsd: null }).where(eq(orgs.id, o));
});
afterAll(async () => {
  if (saved.ops === undefined) delete process.env.OPS_EMAILS; else process.env.OPS_EMAILS = saved.ops;
  if (saved.cap === undefined) delete process.env.ORG_AI_CAP_USD; else process.env.ORG_AI_CAP_USD = saved.cap;
  await customer?.cleanup();
  await op?.cleanup();
});

describe('orgs.setAiCap (spec §2.2)', () => {
  it('an operator sets their own org’s limit and resets it; nothing is logged outside staff mode', async () => {
    const own = await signedInCaller('capset-op'); // the operator's own session, in their own org
    try {
      process.env.OPS_EMAILS = `${op.user.email},${own.user.email}`;
      expect(await own.caller.orgs.setAiCap({ capUsd: 40 })).toEqual({ capUsd: 40 });
      expect(await capOf(own.org.id)).toBe('40.00');
      expect(await own.caller.orgs.setAiCap({ capUsd: null })).toEqual({ capUsd: null });
      expect(await capOf(own.org.id)).toBeNull();
      expect(await logOf(own.org.id)).toEqual([]);
    } finally {
      process.env.OPS_EMAILS = op.user.email;
      await own.cleanup();
    }
  });

  it('staff in staff mode set a customer’s limit, logged in staff words', async () => {
    expect(await staff.caller.orgs.setAiCap({ capUsd: 40 })).toEqual({ capUsd: 40 });
    expect(await capOf(customer.org.id)).toBe('40.00');
    await staff.caller.orgs.setAiCap({ capUsd: null });
    const sentences = (await logOf(customer.org.id)).filter((r) => r.action === 'orgs.setAiCap').map((r) => r.summary);
    expect(sentences).toEqual(['Set the monthly AI limit to $40', 'Reset the monthly AI limit to the default']);
  });

  it('a customer is refused, and the limit is unchanged; no session is UNAUTHORIZED', async () => {
    await expect(customer.caller.orgs.setAiCap({ capUsd: 1000 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await capOf(customer.org.id)).toBeNull();
    await expect(anon().orgs.setAiCap({ capUsd: 1 })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('RF5: the server keeps cents and refuses a negative or absurd limit', async () => {
    expect(await staff.caller.orgs.setAiCap({ capUsd: 40.555 })).toEqual({ capUsd: 40.56 });
    expect(await capOf(customer.org.id)).toBe('40.56');
    for (const capUsd of [-1, 1e12, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(staff.caller.orgs.setAiCap({ capUsd })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    }
    expect(await capOf(customer.org.id)).toBe('40.56');
    await staff.caller.orgs.setAiCap({ capUsd: 40.5 });
    const last = (await logOf(customer.org.id)).filter((r) => r.action === 'orgs.setAiCap').map((r) => r.summary);
    expect(last.slice(-2)).toEqual(['Set the monthly AI limit to $40.56', 'Set the monthly AI limit to $40.50']);
  });

  it('RF4: the customer reads that a setting changed, never the amount, the limit or a procedure name; staff read it all', async () => {
    await staff.caller.orgs.setAiCap({ capUsd: 40 });
    const mine = await customer.caller.orgs.staffActivity({ page: 0 });
    expect(mine.entries.map((e) => e.summary)).toContain('Changed a setting of this organisation');
    expect(JSON.stringify(mine)).not.toMatch(/\$\s?\d|\bAI\b|setAiCap|limit/i);
    for (const e of mine.entries) expect(e).not.toHaveProperty('action');
    const ops = await op.caller.ops.staffActivity({ orgId: customer.org.id });
    expect(ops.entries.map((e) => e.summary)).toContain('Set the monthly AI limit to $40');
  });

  it('is not deny-listed for staff, and both new procedures count in the session rate group', () => {
    expect(groupOf('orgs.setAiCap')).toBe('session');
    expect(groupOf('ops.orgs')).toBe('session');
  });
});

describe('ops.orgs (spec §2.4)', () => {
  it('one row per org: websites, this month’s pages, runs and AI spend, the limit and % used, highest first', async () => {
    const over = await signedInCaller('ops-orgs-over');
    const under = await signedInCaller('ops-orgs-under');
    try {
      const a = await createProjectWithSource(over.caller, { tag: 'ops-orgs-over', fields: [{ name: 'Title', type: 'text' }] });
      const b = await createProjectWithSource(under.caller, { tag: 'ops-orgs-under', fields: [{ name: 'Title', type: 'text' }] });
      await db.insert(runs).values({ sourceId: a.sourceId, status: 'completed', inputLabel: 'list', costUsd: '30.0000' });
      await db.insert(runs).values({ sourceId: b.sourceId, status: 'completed', inputLabel: 'probe', costUsd: '10.0000' });
      await db.update(orgs).set({ aiCapUsd: '40.00' }).where(eq(orgs.id, under.org.id));

      const { rows } = await op.caller.ops.orgs({});
      const iOver = rows.findIndex((r) => r.org.id === over.org.id);
      const iUnder = rows.findIndex((r) => r.org.id === under.org.id);
      // RF3: ops shows an org past its limit at 120 %, nothing left, the badge's flag set.
      expect(rows[iOver]).toMatchObject({ org: { name: over.org.name }, websites: 1, pages: 0, runs: 1, aiUsd: 30, jevUsd: 0, capUsd: 25, capIsDefault: true, ownCapUsd: null, defaultCapUsd: 25, percentUsed: 120, reached: true, remainingUsd: 0 });
      expect(rows[iUnder]).toMatchObject({ websites: 1, runs: 0, aiUsd: 10, capUsd: 40, capIsDefault: false, ownCapUsd: 40, percentUsed: 25, reached: false, remainingUsd: 30 });
      expect(iOver).toBeLessThan(iUnder);
      // The unscoped path ops.orgs takes for every org (Task 2 review): each org in its own bucket, the same as scoped.
      const month = monthKeyOf(new Date());
      const all = await usageByOrg(db, month);
      const scoped = await usageByOrg(db, month, [over.org.id, under.org.id]);
      expect(all.get(over.org.id)).toEqual(scoped.get(over.org.id));
      expect(all.get(under.org.id)).toEqual(scoped.get(under.org.id));
      expect(all.get(over.org.id)).toMatchObject({ runs: 1, aiUsd: 30 });

      expect((await op.caller.ops.orgs({ orgId: under.org.id })).rows.map((r) => r.org.id)).toEqual([under.org.id]);
      expect((await op.caller.ops.orgs({ month: '2000-01', orgId: over.org.id })).rows[0]).toMatchObject({ aiUsd: 0, runs: 0, percentUsed: 0, reached: false });
      await a.cleanup();
      await b.cleanup();
    } finally {
      await over.cleanup();
      await under.cleanup();
    }
  });

  it('is FORBIDDEN to a customer and UNAUTHORIZED signed out', async () => {
    await expect(customer.caller.ops.orgs({})).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(anon().ops.orgs({})).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
