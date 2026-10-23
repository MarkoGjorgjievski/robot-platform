// packages/db/src/schema.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, orgs, projects, datasets, sources, runs, runItems, sourceVerifications, captures, jevReadings, users, memberships, sessions, driftChecks, coverageChecks, fieldHolds, valueRefreshes, jobs } from './index.js';

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

describe('jev readings', () => {
  let jevOrgId: string | null = null;
  afterEach(async () => {
    if (jevOrgId) await db.delete(orgs).where(eq(orgs.id, jevOrgId));
    jevOrgId = null;
  });

  async function makeSource() {
    const { orgId: seededOrgId, source } = await seedSource();
    jevOrgId = seededOrgId;
    return source.id;
  }

  it('stores a Jev reading per capture, unique on the capture', async () => {
    const sourceId = await makeSource(); // the helper the file's earlier tests use to insert a source
    const [cap] = await db.insert(captures).values({ sourceId, url: 'https://s.example/p/1' }).returning({ id: captures.id });
    const [r] = await db.insert(jevReadings).values({ sourceId, captureId: cap!.id, url: 'https://s.example/p/1', status: 'running' }).returning();
    expect(r!.status).toBe('running');
    await expect(db.insert(jevReadings).values({ sourceId, captureId: cap!.id, url: 'https://s.example/p/1', status: 'running' })).rejects.toThrow();
    const [v] = await db.insert(sourceVerifications).values({ sourceId, definitionHash: 'x', verifyAgreement: { asked: 1, agreed: 1, pages: {} } }).returning();
    expect(v!.verifyAgreement).toEqual({ asked: 1, agreed: 1, pages: {} });
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

describe('websites change (spec 2026-10-21 §4)', () => {
  let changeOrgId: string | null = null;
  afterEach(async () => {
    if (changeOrgId) await db.delete(orgs).where(eq(orgs.id, changeOrgId));
    changeOrgId = null;
  });

  it('stores one hold per website and field, with its hashes', async () => {
    const { orgId: seeded, source } = await seedSource();
    changeOrgId = seeded;
    const result = { key: 'price', cells: {}, certified: [], weakEvidence: false, aiCalled: false, incomplete: false };
    const [h] = await db.insert(fieldHolds).values({ sourceId: source.id, fieldKey: 'price', result, verifiedAt: new Date(), fieldHashes: ['a', 'b'] }).returning();
    expect(h!.fieldHashes).toEqual(['a', 'b']);
    expect(h!.failedVerificationId).toBeNull();
    await expect(db.insert(fieldHolds).values({ sourceId: source.id, fieldKey: 'price', result, verifiedAt: new Date() })).rejects.toThrow();
  });

  it('stores a value refresh, a check trigger defaulting to run, and a next check time', async () => {
    const { orgId: seeded, source } = await seedSource();
    changeOrgId = seeded;
    const [c] = await db.insert(driftChecks).values({ sourceId: source.id }).returning();
    expect(c!.trigger).toBe('run');
    const pages = { 'https://s.example/p/1': { was: '1.00', now: '1.10', path: { source: 'json-ld', path: 'offers.price', transform: 'identity' } } };
    const [r] = await db.insert(valueRefreshes).values({ sourceId: source.id, fieldKey: 'price', driftCheckId: c!.id, pages, fromHash: 'x', toHash: 'y' }).returning();
    expect(r!.pages).toEqual(pages);
    expect(r!.verificationId).toBeNull();
    const at = new Date('2026-10-24T00:00:00Z');
    await db.update(sources).set({ nextCheckAt: at }).where(eq(sources.id, source.id));
    const [s] = await db.select().from(sources).where(eq(sources.id, source.id));
    expect(s!.nextCheckAt?.toISOString()).toBe(at.toISOString());
  });
});

describe('jobs (2026-10-23)', () => {
  const queue = `schema-test-${Date.now()}`;
  afterEach(async () => { await db.delete(jobs).where(eq(jobs.queue, queue)); });

  it('stores a job with its defaults', async () => {
    const [row] = await db.insert(jobs).values({ queue, type: 'verify', payload: { a: 1 } }).returning();
    expect(row).toMatchObject({ queue, type: 'verify', status: 'queued', priority: 10, attempts: 0, maxAttempts: 1, key: null, lockedBy: null, result: null });
    expect(row!.runAfter).toBeInstanceOf(Date);
  });

  it('allows one queued or running job per key, and a new one once it finished', async () => {
    await db.insert(jobs).values({ queue, type: 'verify', key: 'verify:x' });
    await expect(db.insert(jobs).values({ queue, type: 'verify', key: 'verify:x' })).rejects.toThrow();
    await db.update(jobs).set({ status: 'done' }).where(eq(jobs.queue, queue));
    await expect(db.insert(jobs).values({ queue, type: 'verify', key: 'verify:x' })).resolves.toBeDefined();
    // Jobs without a key never collide.
    await db.insert(jobs).values({ queue, type: 'verify' });
    await db.insert(jobs).values({ queue, type: 'verify' });
  });

  it('every status-row table carries a nullable job_id', async () => {
    const { orgId: seededOrgId, source } = await seedSource();
    orgId = seededOrgId;
    const jobId = '00000000-0000-4000-8000-000000000001';
    const [v] = await db.insert(sourceVerifications).values({ sourceId: source.id, definitionHash: 'h', jobId }).returning();
    const [d] = await db.insert(driftChecks).values({ sourceId: source.id, jobId }).returning();
    const [cc] = await db.insert(coverageChecks).values({ sourceId: source.id, jobId }).returning();
    const [c] = await db.insert(captures).values({ sourceId: source.id, url: 'https://x.test/', jobId }).returning();
    const [r] = await db.insert(runs).values({ sourceId: source.id, jobId }).returning();
    expect([v!.jobId, d!.jobId, c!.jobId, r!.jobId]).toEqual([jobId, jobId, jobId, jobId]);
    expect(cc!.jobId).toBe(jobId);
    const [none] = await db.insert(runs).values({ sourceId: source.id }).returning();
    expect(none!.jobId).toBeNull();
  });
});
