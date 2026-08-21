// packages/api/src/crawl/claim-item.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { db, runs, runItems, sources, orgs, projects, datasets } from '@robot/db';
import { eq } from 'drizzle-orm';
import { claimNextItem } from './claim-item.js';

const SLUG = 'test-claim-item';

async function seedRun(items: Array<{ kind: 'listing' | 'detail'; url: string; status?: string }>) {
  const [org] = await db.insert(orgs).values({ name: SLUG, slug: SLUG }).returning();
  const [project] = await db.insert(projects).values({ orgId: org!.id, name: SLUG, slug: SLUG }).returning();
  const [dataset] = await db.insert(datasets).values({ projectId: project!.id, name: SLUG, slug: SLUG, schema: [] }).returning();
  const [source] = await db.insert(sources).values({
    datasetId: dataset!.id, name: SLUG, slug: SLUG, country: 'US', isSandbox: false,
  }).returning();
  const [run] = await db.insert(runs).values({ sourceId: source!.id, status: 'planned' }).returning();
  await db.insert(runItems).values(items.map((i, index) => ({
    runId: run!.id, kind: i.kind, url: i.url, inputIndex: index,
    status: i.status ?? 'pending',
  })));
  return { runId: run!.id, orgId: org!.id };
}

let orgId: string | null = null;
afterEach(async () => {
  if (orgId) await db.delete(orgs).where(eq(orgs.id, orgId));
  orgId = null;
});

describe('claimNextItem', () => {
  it('claims a pending detail item and marks it running', async () => {
    const seeded = await seedRun([{ kind: 'detail', url: 'https://example.com/p/1' }]);
    orgId = seeded.orgId;

    const claimed = await claimNextItem(db, seeded.runId);
    expect(claimed?.url).toBe('https://example.com/p/1');

    const [row] = await db.select().from(runItems).where(eq(runItems.id, claimed!.id));
    expect(row!.status).toBe('running');
    expect(row!.attempts).toBe(1);
    expect(row!.startedAt).toBeInstanceOf(Date);
  });

  it('never claims a listing item — those were done at plan time', async () => {
    const seeded = await seedRun([{ kind: 'listing', url: 'https://example.com/c/1', status: 'done' }]);
    orgId = seeded.orgId;
    expect(await claimNextItem(db, seeded.runId)).toBeNull();
  });

  it('never re-claims an item that already failed', async () => {
    const seeded = await seedRun([{ kind: 'detail', url: 'https://example.com/p/1', status: 'failed' }]);
    orgId = seeded.orgId;
    expect(await claimNextItem(db, seeded.runId)).toBeNull();
  });

  it('returns null when the queue is empty', async () => {
    const seeded = await seedRun([{ kind: 'detail', url: 'https://example.com/p/1', status: 'done' }]);
    orgId = seeded.orgId;
    expect(await claimNextItem(db, seeded.runId)).toBeNull();
  });

  it('hands the same item to only one caller when two claim at once', async () => {
    const seeded = await seedRun([{ kind: 'detail', url: 'https://example.com/p/1' }]);
    orgId = seeded.orgId;

    const [a, b] = await Promise.all([
      claimNextItem(db, seeded.runId),
      claimNextItem(db, seeded.runId),
    ]);
    const claimedIds = [a?.id, b?.id].filter(Boolean);
    expect(claimedIds).toHaveLength(1);
  });

  it('carries the values the row needs for its output row', async () => {
    const seeded = await seedRun([{ kind: 'detail', url: 'https://example.com/p/1' }]);
    orgId = seeded.orgId;
    await db.update(runItems)
      .set({ inputValues: { slug: 'shelves' }, listingValues: { category_name: 'Shelves' }, pageNumber: 2 })
      .where(eq(runItems.runId, seeded.runId));

    const claimed = await claimNextItem(db, seeded.runId);
    expect(claimed?.inputValues).toEqual({ slug: 'shelves' });
    expect(claimed?.listingValues).toEqual({ category_name: 'Shelves' });
    expect(claimed?.pageNumber).toBe(2);
  });
});
