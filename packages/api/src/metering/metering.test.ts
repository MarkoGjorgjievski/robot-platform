// Metering (spec 2026-10-24 metering §2.1–§2.2): what an organisation used in a month, counted from the recorded rows
// (no counter table), and its monthly AI limit. Throwaway orgs; rows inserted directly — no Verify, no run, no AI.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, captures, jevReadings, orgs, runs, sourceVerifications, sources } from '@robot/db';
import { signedInCaller, type SignedIn } from '../test-helpers/identity.js';
import { createProjectWithSource } from '../test-helpers/customer-source.js';
import { monthKeyOf, orgUsage, usageByOrg, websitesByOrg } from './org-usage.js';
import { capStateForSource, capStateOf, defaultCapUsd, effectiveCap, orgCapState, percentUsed } from './cap-state.js';

const at = (iso: string) => new Date(iso);
const MID_OCTOBER = at('2026-10-15T12:00:00Z');
let me: SignedIn;
let a: Awaited<ReturnType<typeof createProjectWithSource>>;
let b: Awaited<ReturnType<typeof createProjectWithSource>>;
const saved = { ops: process.env.OPS_EMAILS, cap: process.env.ORG_AI_CAP_USD };
const restoreEnv = () => {
  if (saved.ops === undefined) delete process.env.OPS_EMAILS; else process.env.OPS_EMAILS = saved.ops;
  if (saved.cap === undefined) delete process.env.ORG_AI_CAP_USD; else process.env.ORG_AI_CAP_USD = saved.cap;
};

beforeAll(async () => {
  me = await signedInCaller('metering');
  a = await createProjectWithSource(me.caller, { tag: 'metering-a', fields: [{ name: 'Title', type: 'text' }] });
  b = await createProjectWithSource(me.caller, { tag: 'metering-b', fields: [{ name: 'Title', type: 'text' }] });
  // October 2026 in UTC, with a row on each side of each edge.
  const caps = await db.insert(captures).values([
    { sourceId: a.sourceId, url: a.urls[0]!, createdAt: at('2026-09-30T23:59:59.999Z') },
    { sourceId: a.sourceId, url: a.urls[0]!, createdAt: at('2026-10-01T00:00:00.000Z') },
    { sourceId: b.sourceId, url: b.urls[0]!, createdAt: at('2026-10-31T23:59:59.999Z') },
    { sourceId: b.sourceId, url: b.urls[0]!, createdAt: at('2026-11-01T00:00:00.000Z') },
  ]).returning({ id: captures.id });
  await db.insert(runs).values([
    { sourceId: a.sourceId, status: 'completed', inputLabel: 'https://shop.example/list', costUsd: '0.1000', createdAt: at('2026-10-05T10:00:00Z') },
    { sourceId: a.sourceId, status: 'completed', inputLabel: null, costUsd: '0.0000', createdAt: at('2026-10-06T10:00:00Z') },
    // A sample: not a run, but its spend is the org's spend (as on Usage).
    { sourceId: b.sourceId, status: 'completed', inputLabel: 'probe', costUsd: '0.0500', createdAt: at('2026-10-07T10:00:00Z') },
    { sourceId: b.sourceId, status: 'completed', inputLabel: 'next month', costUsd: '9.0000', createdAt: at('2026-11-01T00:00:00Z') },
  ]);
  await db.insert(sourceVerifications).values([
    { sourceId: a.sourceId, definitionHash: 'metering', costUsd: '0.0300', startedAt: at('2026-10-31T23:59:59Z') },
    { sourceId: b.sourceId, definitionHash: 'metering', costUsd: '5.0000', startedAt: at('2026-09-30T23:59:59Z') },
  ]);
  await db.insert(jevReadings).values({ sourceId: a.sourceId, captureId: caps[1]!.id, url: a.urls[0]!, status: 'done', costUsd: '0.000400', createdAt: at('2026-10-02T00:00:00Z') });
}, 60_000);
afterEach(async () => {
  restoreEnv();
  await db.update(orgs).set({ aiCapUsd: null }).where(eq(orgs.id, me.org.id));
});
afterAll(async () => { await a?.cleanup(); await b?.cleanup(); await me?.cleanup(); });

describe('orgUsage (spec §2.1)', () => {
  it('counts the UTC month only: pages, runs without samples, AI spend from both tables, Jev apart', async () => {
    expect(await orgUsage(db, me.org.id, '2026-10')).toEqual({ pages: 2, runs: 2, aiUsd: 0.18, jevUsd: 0.0004 });
    expect(await orgUsage(db, me.org.id, '2026-09')).toEqual({ pages: 1, runs: 0, aiUsd: 5, jevUsd: 0 });
    expect(await orgUsage(db, me.org.id, '2026-11')).toEqual({ pages: 1, runs: 1, aiUsd: 9, jevUsd: 0 });
    expect(await orgUsage(db, me.org.id, '2026-12')).toEqual({ pages: 0, runs: 0, aiUsd: 0, jevUsd: 0 });
  });

  it('equals the sum of usage.byProject for the org (read as staff, who receive spend)', async () => {
    process.env.OPS_EMAILS = me.user.email;
    const usage = await me.caller.usage.byProject({ month: '2026-10' });
    const mine = await orgUsage(db, me.org.id, '2026-10');
    expect(usage.total).toEqual({ spendUsd: mine.aiUsd, pagesCaptured: mine.pages, runs: mine.runs });
    const sum = (k: 'spendUsd' | 'pagesCaptured' | 'runs') => Math.round(usage.projects.reduce((s, p) => s + (p[k] ?? 0), 0) * 10_000) / 10_000;
    expect([sum('spendUsd'), sum('pagesCaptured'), sum('runs')]).toEqual([mine.aiUsd, mine.pages, mine.runs]);
    expect(usage.projects.find((p) => p.id === a.projectId)).toMatchObject({ pagesCaptured: 1, runs: 2 });
    expect(usage.projects.find((p) => p.id === b.projectId)).toMatchObject({ pagesCaptured: 1, runs: 0 });
  });

  it('a customer reads the runs count too, and still no spend', async () => {
    process.env.OPS_EMAILS = '';
    const usage = await me.caller.usage.byProject({ month: '2026-10' });
    expect(usage.total).toEqual({ pagesCaptured: 2, runs: 2 });
  });

  it('usageByOrg is batched: only the orgs asked for, none for an empty list; websitesByOrg counts the websites', async () => {
    expect((await usageByOrg(db, '2026-10', [])).size).toBe(0);
    expect([...(await usageByOrg(db, '2026-10', [me.org.id])).keys()]).toEqual([me.org.id]);
    expect((await websitesByOrg(db, [me.org.id])).get(me.org.id)).toBe(2);
    expect(monthKeyOf(at('2026-10-31T23:59:59.999Z'))).toBe('2026-10');
    expect(monthKeyOf(at('2026-11-01T00:00:00.000Z'))).toBe('2026-11');
  });
});

describe('the limit (spec §2.2)', () => {
  it('the default is ORG_AI_CAP_USD, $25 unset; none is no default; an org value wins either way', () => {
    expect(defaultCapUsd({})).toBe(25);
    expect(defaultCapUsd({ ORG_AI_CAP_USD: '40' })).toBe(40);
    expect(defaultCapUsd({ ORG_AI_CAP_USD: 'none' })).toBeNull();
    expect(effectiveCap(null, {})).toEqual({ capUsd: 25, isDefault: true, ownCapUsd: null, defaultCapUsd: 25 });
    expect(effectiveCap('12.50', { ORG_AI_CAP_USD: 'none' })).toEqual({ capUsd: 12.5, isDefault: false, ownCapUsd: 12.5, defaultCapUsd: null });
    expect(effectiveCap(null, { ORG_AI_CAP_USD: 'none' })).toEqual({ capUsd: null, isDefault: true, ownCapUsd: null, defaultCapUsd: null });
  });

  it('RF2: a mistyped ORG_AI_CAP_USD never means no limit', () => {
    for (const v of ['abc', '-5', '1e999', '', '   ', '25$']) expect(defaultCapUsd({ ORG_AI_CAP_USD: v }), v).toBe(25);
    expect(defaultCapUsd({ ORG_AI_CAP_USD: ' NONE ' })).toBeNull();
    expect(defaultCapUsd({ ORG_AI_CAP_USD: ' 30 ' })).toBe(30);
    expect(defaultCapUsd({ ORG_AI_CAP_USD: '0' })).toBe(0);
  });

  it('orgCapState: the org value or the default, against the month spend; reached at equality', async () => {
    delete process.env.ORG_AI_CAP_USD;
    expect(await orgCapState(db, me.org.id, MID_OCTOBER)).toEqual({ capUsd: 25, spentUsd: 0.18, remainingUsd: 24.82, reached: false });
    await db.update(orgs).set({ aiCapUsd: '0.18' }).where(eq(orgs.id, me.org.id));
    expect(await orgCapState(db, me.org.id, MID_OCTOBER)).toEqual({ capUsd: 0.18, spentUsd: 0.18, remainingUsd: 0, reached: true });
    await db.update(orgs).set({ aiCapUsd: '0.19' }).where(eq(orgs.id, me.org.id));
    expect(await orgCapState(db, me.org.id, MID_OCTOBER)).toEqual({ capUsd: 0.19, spentUsd: 0.18, remainingUsd: 0.01, reached: false });
    await db.update(orgs).set({ aiCapUsd: null }).where(eq(orgs.id, me.org.id));
    process.env.ORG_AI_CAP_USD = 'none';
    expect(await orgCapState(db, me.org.id, MID_OCTOBER)).toEqual({ capUsd: null, spentUsd: 0.18, remainingUsd: null, reached: false });
  });

  it('RF3: a cap below the spend is reached, with nothing left and more than 100 % used; a cap of 0 allows nothing', () => {
    expect(capStateOf(10, 30)).toEqual({ capUsd: 10, spentUsd: 30, remainingUsd: 0, reached: true });
    expect(capStateOf(0, 0)).toEqual({ capUsd: 0, spentUsd: 0, remainingUsd: 0, reached: true });
    expect(percentUsed(10, 30)).toBe(300);
    expect(percentUsed(0, 0)).toBe(100);
    expect(percentUsed(40, 10)).toBe(25);
    expect(percentUsed(25, 0.18)).toBe(0.7);
    expect(percentUsed(null, 5)).toBeNull();
  });

  it('capStateForSource: the website’s org, or no limit for a website with no org', async () => {
    delete process.env.ORG_AI_CAP_USD;
    expect(await capStateForSource(db, a.sourceId, MID_OCTOBER)).toEqual({ orgId: me.org.id, capUsd: 25, spentUsd: 0.18, remainingUsd: 24.82, reached: false });
    const [loose] = await db.insert(sources).values({ name: 'metering loose', slug: `metering-loose-${Date.now()}`, country: 'US', isSandbox: true }).returning({ id: sources.id });
    try {
      expect(await capStateForSource(db, loose!.id)).toEqual({ orgId: null, capUsd: null, spentUsd: 0, remainingUsd: null, reached: false });
    } finally {
      await db.delete(sources).where(eq(sources.id, loose!.id));
    }
  });
});
