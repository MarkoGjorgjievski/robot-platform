// packages/db/src/schema.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { readdirSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { db, orgs, projects, datasets, sources, runs, runItems, sourceVerifications, captures, jevReadings, users, memberships, sessions, driftChecks, coverageChecks, fieldHolds, valueRefreshes, jobs, runFiles, webhookDeliveries, emailMessages, workers, migrationCount } from './index.js';

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

describe('recurring extraction columns (spec 2026-10-24)', () => {
  it('a website keeps its schedule, next run, last outcome and webhook', async () => {
    const schedule = { days: [1], time: '06:00', timeZone: 'Europe/Berlin' };
    const next = new Date('2026-10-26T05:00:00Z');
    const { orgId: seeded, source } = await seedSource({
      schedule, nextRunAt: next, scheduleLast: { at: '2026-10-19T04:00:00.000Z', outcome: 'skipped', reason: 'busy' },
      webhookUrl: 'https://hooks.example.com/robot', webhookSecret: 'ab'.repeat(32),
    });
    orgId = seeded;
    const [row] = await db.select().from(sources).where(eq(sources.id, source.id));
    expect(row!.schedule).toEqual(schedule);
    expect(row!.nextRunAt!.toISOString()).toBe(next.toISOString());
    expect(row!.scheduleLast).toMatchObject({ outcome: 'skipped', reason: 'busy' });
    expect(row!.webhookUrl).toBe('https://hooks.example.com/robot');
    expect(row!.webhookSecret).toHaveLength(64);
  });

  it('a website without them reads null everywhere', async () => {
    const { orgId: seeded, source } = await seedSource();
    orgId = seeded;
    const [row] = await db.select().from(sources).where(eq(sources.id, source.id));
    expect([row!.schedule, row!.nextRunAt, row!.scheduleLast, row!.webhookUrl, row!.webhookSecret]).toEqual([null, null, null, null, null]);
  });

  it('a run keeps one file per format, its bytes intact, replaced on conflict', async () => {
    const { orgId: seeded, source } = await seedSource();
    orgId = seeded;
    const [run] = await db.insert(runs).values({ sourceId: source.id, status: 'completed' }).returning();
    const first = Buffer.from([0xef, 0xbb, 0xbf, 0x61, 0x0d, 0x0a]);
    await db.insert(runFiles).values({ runId: run!.id, format: 'csv', filename: 'a.csv', bytes: first, rows: 1 });
    await expect(db.insert(runFiles).values({ runId: run!.id, format: 'csv', filename: 'b.csv', bytes: first, rows: 1 })).rejects.toThrow();
    const second = Buffer.from([0x00, 0xff, 0x10]);
    await db.insert(runFiles).values({ runId: run!.id, format: 'csv', filename: 'b.csv', bytes: second, rows: 2 })
      .onConflictDoUpdate({ target: [runFiles.runId, runFiles.format], set: { filename: 'b.csv', bytes: second, rows: 2 } });
    const rows = await db.select().from(runFiles).where(eq(runFiles.runId, run!.id));
    expect(rows).toHaveLength(1);
    expect(Buffer.isBuffer(rows[0]!.bytes)).toBe(true);
    expect(rows[0]!.bytes.equals(second)).toBe(true);
    expect(rows[0]).toMatchObject({ format: 'csv', filename: 'b.csv', rows: 2 });
  });

  it('a webhook attempt is one row, and files and attempts go with their run', async () => {
    const { orgId: seeded, source } = await seedSource();
    orgId = seeded;
    const [run] = await db.insert(runs).values({ sourceId: source.id, status: 'completed' }).returning();
    const deliveryId = '7d4f2b1a-3333-4333-8333-333333333333';
    await db.insert(webhookDeliveries).values([
      { runId: run!.id, deliveryId, attempt: 1, ok: false, statusCode: 500, error: 'answered 500' },
      { runId: run!.id, deliveryId, attempt: 2, ok: true, statusCode: 200, error: null },
    ]);
    await db.insert(runFiles).values({ runId: run!.id, format: 'json', filename: 'a.json', bytes: Buffer.from('{}'), rows: 0 });
    const attempts = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.runId, run!.id));
    expect(attempts.map((a) => [a.attempt, a.ok, a.statusCode])).toEqual(expect.arrayContaining([[1, false, 500], [2, true, 200]]));
    await db.delete(runs).where(eq(runs.id, run!.id));
    expect(await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.runId, run!.id))).toEqual([]);
    expect(await db.select().from(runFiles).where(eq(runFiles.runId, run!.id))).toEqual([]);
  });
});

describe('email (spec 2026-10-24 email §3.2–§3.3)', () => {
  it('a user keeps both email preferences, on by default; a website keeps when it turned to attention', async () => {
    const [user] = await db.insert(users).values({ email: `email-prefs-${Date.now()}@example.com`, name: 'Prefs', avatarColour: '#3ddc84' }).returning();
    try {
      expect([user!.emailAttention, user!.emailFailedRuns]).toEqual([true, true]);
      const [off] = await db.update(users).set({ emailAttention: false }).where(eq(users.id, user!.id)).returning();
      expect([off!.emailAttention, off!.emailFailedRuns]).toEqual([false, true]);
    } finally {
      await db.delete(users).where(eq(users.id, user!.id));
    }
    const since = new Date('2026-10-24T09:00:00.123Z');
    const { orgId: seeded, source } = await seedSource({ attentionSince: since });
    orgId = seeded;
    expect(source.attentionSince!.toISOString()).toBe(since.toISOString());
    const [cleared] = await db.update(sources).set({ attentionSince: null }).where(eq(sources.id, source.id)).returning();
    expect(cleared!.attentionSince).toBeNull();
  });

  it('a message is one row per dedupe key, queued with no attempts; it goes with its org and stays when its user goes', async () => {
    const { orgId: seeded } = await seedSource();
    orgId = seeded;
    const [user] = await db.insert(users).values({ email: `email-row-${Date.now()}@example.com`, name: 'Row', avatarColour: '#3ddc84' }).returning();
    const row = {
      orgId: seeded, userId: user!.id, kind: 'attention', dedupeKey: `attention:test:${Date.now()}:${user!.id}`,
      toAddress: user!.email, subject: 'Lamp shop needs your attention', text: 'Price needs you.\n', html: '<p>Price needs you.</p>',
    };
    const [m] = await db.insert(emailMessages).values(row).returning();
    expect(m).toMatchObject({ status: 'queued', attempts: 0, error: null, sentAt: null });
    await expect(db.insert(emailMessages).values(row)).rejects.toThrow();
    expect(await db.insert(emailMessages).values(row).onConflictDoNothing({ target: emailMessages.dedupeKey }).returning()).toEqual([]);
    await db.delete(users).where(eq(users.id, user!.id));
    expect((await db.query.emailMessages.findFirst({ where: eq(emailMessages.id, m!.id) }))!.userId).toBeNull();
    await db.delete(orgs).where(eq(orgs.id, seeded));
    orgId = null;
    expect(await db.query.emailMessages.findFirst({ where: eq(emailMessages.id, m!.id) })).toBeUndefined();
  });
});

describe('metering (spec 2026-10-24 metering §2.2)', () => {
  it('an org has no AI limit of its own by default, keeps one to the cent, and refuses a negative one', async () => {
    const [org] = await db.insert(orgs).values({ name: SLUG, slug: `${SLUG}-cap` }).returning();
    orgId = org!.id;
    expect(org!.aiCapUsd).toBeNull();
    const [set] = await db.update(orgs).set({ aiCapUsd: '40.50' }).where(eq(orgs.id, org!.id)).returning();
    expect(set!.aiCapUsd).toBe('40.50');
    const [zero] = await db.update(orgs).set({ aiCapUsd: '0' }).where(eq(orgs.id, org!.id)).returning();
    expect(zero!.aiCapUsd).toBe('0.00');
    await expect(db.update(orgs).set({ aiCapUsd: '-1' }).where(eq(orgs.id, org!.id))).rejects.toThrow();
    const [cleared] = await db.update(orgs).set({ aiCapUsd: null }).where(eq(orgs.id, org!.id)).returning();
    expect(cleared!.aiCapUsd).toBeNull();
  });
});

describe('proxy columns (spec 2026-10-24 proxy §2.1)', () => {
  it('a website has no proxy and no country unless given, keeps both, and refuses a country longer than two letters', async () => {
    const { orgId: seeded, source } = await seedSource({ country: null });
    orgId = seeded;
    expect(source.proxyUrl).toBeNull();
    expect(source.country).toBeNull();
    const [set] = await db.update(sources).set({ proxyUrl: 'http://u-country-{country}:p@proxy.test:7000', country: 'de' })
      .where(eq(sources.id, source.id)).returning();
    expect(set).toMatchObject({ proxyUrl: 'http://u-country-{country}:p@proxy.test:7000', country: 'de' });
    await expect(db.update(sources).set({ country: 'deu' }).where(eq(sources.id, source.id))).rejects.toThrow();
    const [cleared] = await db.update(sources).set({ proxyUrl: null, country: null }).where(eq(sources.id, source.id)).returning();
    expect(cleared).toMatchObject({ proxyUrl: null, country: null });
  });
});

describe('monitoring (spec 2026-10-25 monitoring §2.1, §2.3)', () => {
  const queue = `schema-test-mon-${Date.now()}`;
  afterEach(async () => {
    await db.delete(workers).where(eq(workers.queue, queue));
    await db.delete(jobs).where(eq(jobs.queue, queue));
  });

  it('a worker row keeps its queue, version, browsers, lanes and switches; one row per id', async () => {
    const id = `host:1:${queue}`;
    const [w] = await db.insert(workers).values({
      id, queue, startedAt: new Date(), version: 'abc1234', browsers: { inUse: 1, max: 3 },
      lanes: { interactive: 1, background: 0, runs: 0 }, websiteChecks: true, recurringRuns: false,
    }).returning();
    expect(w).toMatchObject({ id, queue, version: 'abc1234', browsers: { inUse: 1, max: 3 }, lanes: { interactive: 1, background: 0, runs: 0 }, websiteChecks: true, recurringRuns: false });
    expect(w!.beatAt).toBeInstanceOf(Date);
    await expect(db.insert(workers).values({ id, queue, startedAt: new Date() })).rejects.toThrow();
    const [bare] = await db.insert(workers).values({ id: `${id}-bare`, queue, startedAt: new Date() }).returning();
    expect(bare).toMatchObject({ version: null, browsers: {}, lanes: {}, websiteChecks: false, recurringRuns: false });
  });

  it('a job has no progress until it is claimed', async () => {
    const [j] = await db.insert(jobs).values({ queue, type: 'verify' }).returning();
    expect(j!.progressAt).toBeNull();
  });

  it('the bundled migration count is the journal’s: one entry per .sql file', () => {
    const files = readdirSync(new URL('../drizzle', import.meta.url)).filter((f) => f.endsWith('.sql'));
    expect(migrationCount()).toBe(files.length);
    expect(migrationCount()).toBeGreaterThanOrEqual(26);
  });
});

describe('turned away (spec 2026-10-28 §3.3, migration 0026)', () => {
  it('a website reads no fallback until one is kept; the time round-trips', async () => {
    const { orgId: seeded, source } = await seedSource();
    orgId = seeded;
    const [row] = await db.select().from(sources).where(eq(sources.id, source.id));
    expect(row!.fallbackProxyAt).toBeNull();
    const at = new Date('2026-10-28T09:00:00.123Z');
    await db.update(sources).set({ fallbackProxyAt: at }).where(eq(sources.id, source.id));
    const [kept] = await db.select().from(sources).where(eq(sources.id, source.id));
    expect(kept!.fallbackProxyAt!.toISOString()).toBe(at.toISOString());
    expect(migrationCount()).toBeGreaterThanOrEqual(27);
  });
});
