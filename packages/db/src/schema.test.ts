// packages/db/src/schema.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, orgs, projects, datasets, sources, runs, runItems, sourceVerifications, users, memberships, sessions } from './index.js';

const SLUG = 'test-repair-engine-columns';

let orgId: string | null = null;
afterEach(async () => {
  if (orgId) await db.delete(orgs).where(eq(orgs.id, orgId));
  orgId = null;
});

async function seedSource(overrides: Partial<typeof sources.$inferInsert> = {}) {
  const [org] = await db.insert(orgs).values({ name: SLUG, slug: SLUG }).returning();
  const [project] = await db.insert(projects).values({ orgId: org!.id, name: SLUG, slug: SLUG }).returning();
  const [dataset] = await db.insert(datasets).values({ projectId: project!.id, name: SLUG, slug: SLUG, schema: [] }).returning();
  const [source] = await db.insert(sources).values({
    datasetId: dataset!.id, name: SLUG, slug: SLUG, country: 'US', isSandbox: false, ...overrides,
  }).returning();
  return { orgId: org!.id, source: source! };
}

describe('repair-engine columns', () => {
  it('links a repair run to the run it backfills via parent_run_id', async () => {
    const { orgId: seededOrgId, source } = await seedSource();
    orgId = seededOrgId;

    const [parentRun] = await db.insert(runs).values({ sourceId: source.id, status: 'done' }).returning();
    const [childRun] = await db.insert(runs).values({
      sourceId: source.id, status: 'pending', parentRunId: parentRun!.id, targetFields: ['title'],
    }).returning();

    const [row] = await db.select().from(runs).where(eq(runs.id, childRun!.id));
    expect(row!.parentRunId).toBe(parentRun!.id);
    expect(row!.targetFields).toEqual(['title']);
  });

  it('records which fields a run item targets and which came back absent', async () => {
    const { orgId: seededOrgId, source } = await seedSource();
    orgId = seededOrgId;

    const [run] = await db.insert(runs).values({ sourceId: source.id, status: 'pending' }).returning();
    const [item] = await db.insert(runItems).values({
      runId: run!.id, kind: 'detail', url: 'https://example.com/p/1',
      targetFields: ['title'], absentFields: [],
    }).returning();

    const [row] = await db.select().from(runItems).where(eq(runItems.id, item!.id));
    expect(row!.targetFields).toEqual(['title']);
    expect(row!.absentFields).toEqual([]);
  });

  it('records the fields a source was asked to backfill', async () => {
    const requestedFields = [{ name: 'isbn', hint: 'near the publisher line' }];
    const { orgId: seededOrgId, source } = await seedSource({ requestedFields });

    orgId = seededOrgId;

    const [row] = await db.select().from(sources).where(eq(sources.id, source.id));
    expect(row!.requestedFields).toEqual(requestedFields);
  });
});

describe('schema verification columns', () => {
  it('source_verifications exposes the verification columns', () => {
    const cols = Object.keys(sourceVerifications);
    for (const c of ['id', 'sourceId', 'startedAt', 'completedAt', 'definitionHash', 'captures', 'results', 'allPassed', 'aiCalls', 'costUsd']) {
      expect(cols).toContain(c);
    }
  });

  it('sources and runs carry the schema-verification columns', () => {
    expect(Object.keys(sources)).toEqual(expect.arrayContaining(['schemaDefinition', 'verificationSet', 'driftedFields']));
    expect(Object.keys(runs)).toContain('driftedFields');
  });
});

describe('identity', () => {
  it('a user, a membership and a session round-trip; the pair (user, org) is unique', async () => {
    const [org] = await db.insert(orgs).values({ name: `Id ${Date.now()}`, slug: `id-${Date.now()}` }).returning();
    const [user] = await db.insert(users).values({ email: `id-${Date.now()}@example.com`, name: 'Id', avatarColour: '#3ddc84' }).returning();
    try {
      await db.insert(memberships).values({ userId: user!.id, orgId: org!.id, role: 'owner' });
      await expect(db.insert(memberships).values({ userId: user!.id, orgId: org!.id, role: 'member' })).rejects.toThrow();
      const [s] = await db.insert(sessions).values({ token: 'tok-' + Date.now(), userId: user!.id, orgId: org!.id, expiresAt: new Date(Date.now() + 1000) }).returning();
      expect(s!.userId).toBe(user!.id);
      await db.update(orgs).set({ personal: true, ownerUserId: user!.id }).where(eq(orgs.id, org!.id));
      expect((await db.query.orgs.findFirst({ where: eq(orgs.id, org!.id) }))!.personal).toBe(true);
    } finally {
      await db.delete(users).where(eq(users.id, user!.id));
      await db.delete(orgs).where(eq(orgs.id, org!.id));
    }
  });
});
