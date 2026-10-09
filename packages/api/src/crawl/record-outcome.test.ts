// packages/api/src/crawl/record-outcome.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, runs, runItems, sources, orgs, projects, datasets } from '@robot/db';
import { failPendingForWall, markItemDone, markItemFailed } from './record-outcome.js';

const SLUG = 'test-record-outcome';
let orgId: string | null = null;

async function seedItem() {
  const [org] = await db.insert(orgs).values({ name: SLUG, slug: SLUG }).returning();
  orgId = org!.id;
  const [project] = await db.insert(projects).values({ orgId: org!.id, name: SLUG, slug: SLUG }).returning();
  const [dataset] = await db.insert(datasets).values({ projectId: project!.id, name: SLUG, slug: SLUG, schema: [] }).returning();
  const [source] = await db.insert(sources).values({ datasetId: dataset!.id, name: SLUG, slug: SLUG, country: 'US' }).returning();
  const [run] = await db.insert(runs).values({ sourceId: source!.id, status: 'extracting' }).returning();
  const [item] = await db.insert(runItems).values({
    runId: run!.id, kind: 'detail', url: 'https://example.com/p/1', inputIndex: 0, status: 'running',
  }).returning();
  return { itemId: item!.id, runId: run!.id };
}

afterEach(async () => {
  if (orgId) await db.delete(orgs).where(eq(orgs.id, orgId));
  orgId = null;
});

describe('markItemDone', () => {
  it('records success with its extraction and a completion time', async () => {
    const { itemId } = await seedItem();
    await markItemDone(db, itemId, null);
    const [row] = await db.select().from(runItems).where(eq(runItems.id, itemId));
    expect(row!.status).toBe('done');
    expect(row!.completedAt).toBeInstanceOf(Date);
    expect(row!.error).toBeNull();
  });
});

describe('markItemFailed', () => {
  it('records the failure reason, because a bare failed status explains nothing', async () => {
    const { itemId } = await seedItem();
    await markItemFailed(db, itemId, 'navigation timeout after 30000ms');
    const [row] = await db.select().from(runItems).where(eq(runItems.id, itemId));
    expect(row!.status).toBe('failed');
    expect(row!.error).toBe('navigation timeout after 30000ms');
    expect(row!.completedAt).toBeInstanceOf(Date);
  });

  it('truncates a huge error rather than storing a stack dump', async () => {
    const { itemId } = await seedItem();
    await markItemFailed(db, itemId, 'x'.repeat(5000));
    const [row] = await db.select().from(runItems).where(eq(runItems.id, itemId));
    expect(row!.error!.length).toBeLessThanOrEqual(1000);
  });
});

describe('failPendingForWall (review C2)', () => {
  it('fails every pending detail item "Not tried: <sentence>" and makes the sentence the run reason', async () => {
    const { itemId, runId } = await seedItem();
    await db.insert(runItems).values([
      { runId, kind: 'detail', url: 'https://example.com/p/2', inputIndex: 0, status: 'pending' },
      { runId, kind: 'detail', url: 'https://example.com/p/3', inputIndex: 0, status: 'done' },
    ]);
    const sentence = "example.com refused the browser (HTTP 403, Cloudflare). We can't read this website from here yet.";
    await failPendingForWall(db, runId, sentence);
    const rows = await db.select().from(runItems).where(eq(runItems.runId, runId));
    const byUrl = Object.fromEntries(rows.map((r) => [r.url, r]));
    expect(byUrl['https://example.com/p/2']).toMatchObject({ status: 'failed', error: `Not tried: ${sentence}` });
    expect(byUrl['https://example.com/p/3']!.status).toBe('done');
    expect(rows.find((r) => r.id === itemId)!.status).toBe('running');
    const [run] = await db.select().from(runs).where(eq(runs.id, runId));
    expect(run!.errorMessage).toBe(sentence);
  });
});
