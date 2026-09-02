// packages/db/src/schema.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, orgs, projects, datasets, sources, runs, runItems } from './index.js';

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
