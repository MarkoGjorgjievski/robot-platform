// packages/api/src/crawl/queue-variant-pages.test.ts
// queueVariantGroup (variants plan 3, Task 4) against the real database: a
// links-method product's other variant pages join its run as one group, within
// the run's item cap, or not at all.

import { describe, it, expect, afterEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db, runs, runItems, sources, orgs, projects, datasets } from '@robot/db';
import { queueVariantGroup } from './queue-variant-pages.js';
import type { ClaimedItem } from './claim-item.js';

const SLUG = 'test-queue-variant-pages';
let orgId: string | null = null;

async function seedRun(existingUrls: string[]) {
  const [org] = await db.insert(orgs).values({ name: SLUG, slug: SLUG }).returning();
  orgId = org!.id;
  const [project] = await db.insert(projects).values({ orgId: org!.id, name: SLUG, slug: SLUG }).returning();
  const [dataset] = await db.insert(datasets).values({ projectId: project!.id, name: SLUG, slug: SLUG, schema: [] }).returning();
  const [source] = await db.insert(sources).values({ datasetId: dataset!.id, name: SLUG, slug: SLUG, country: 'US' }).returning();
  const [run] = await db.insert(runs).values({ sourceId: source!.id, status: 'extracting' }).returning();
  if (existingUrls.length) {
    await db.insert(runItems).values(existingUrls.map((url, i) => ({
      runId: run!.id, kind: 'detail', url, inputIndex: i, status: 'done',
    })));
  }
  return { runId: run!.id, sourceId: source!.id };
}

const FROM: ClaimedItem = {
  id: 'x', url: 'https://shop.example/p/a', inputIndex: 3, inputValues: { category: 'shoes' },
  listingValues: { listing_price: 10 }, pageNumber: 1, attempts: 1, targetFields: null,
};

const detailItems = (runId: string) =>
  db.select().from(runItems).where(and(eq(runItems.runId, runId), eq(runItems.kind, 'detail')));
const summaryOf = async (runId: string) =>
  (await db.select({ s: runs.variantSummary }).from(runs).where(eq(runs.id, runId)))[0]!.s as Record<string, unknown> | null;

afterEach(async () => {
  if (orgId) await db.delete(orgs).where(eq(orgs.id, orgId));
  orgId = null;
});

describe('queueVariantGroup', () => {
  it('queues the missing URLs as pending detail items with variant_of, and skips URLs already in the run', async () => {
    const { runId, sourceId } = await seedRun(['https://shop.example/p/a', 'https://shop.example/p/b']);

    const out = await queueVariantGroup(db, {
      runId, sourceId, productKey: 'https://shop.example/p/a',
      urls: ['https://shop.example/p/b', 'https://shop.example/p/c', 'https://shop.example/p/d'],
      from: FROM, cap: 50,
    });

    expect(out).toEqual({ queued: 2, skippedForBudget: 0 });
    const items = await detailItems(runId);
    const queued = items.filter((i) => i.variantOf !== null).sort((x, y) => x.url.localeCompare(y.url));
    expect(queued.map((i) => i.url)).toEqual(['https://shop.example/p/c', 'https://shop.example/p/d']);
    for (const i of queued) {
      expect(i).toMatchObject({
        kind: 'detail', status: 'pending', variantOf: 'https://shop.example/p/a',
        inputIndex: 3, inputValues: { category: 'shoes' },
      });
    }
    // The already-present member was not touched.
    expect(items.find((i) => i.url === 'https://shop.example/p/b')!.variantOf).toBeNull();
    expect(await summaryOf(runId)).toBeNull();
  });

  // Review Focus 3: the budget ends in the middle of a links group.
  it('queues nothing when the whole group does not fit the cap, and tallies the skipped pages on the run', async () => {
    const { runId, sourceId } = await seedRun(['https://shop.example/p/a', 'https://shop.example/p/x']);

    const out = await queueVariantGroup(db, {
      runId, sourceId, productKey: 'https://shop.example/p/a',
      urls: ['https://shop.example/p/c', 'https://shop.example/p/d'],
      from: FROM, cap: 3, // 2 present + 2 missing = 4 > 3
    });

    expect(out).toEqual({ queued: 0, skippedForBudget: 2 });
    expect((await detailItems(runId)).map((i) => i.url).sort()).toEqual(['https://shop.example/p/a', 'https://shop.example/p/x']);
    expect(await summaryOf(runId)).toEqual({ variantsSkippedForBudget: 2 });

    // A second skipped group adds to the tally, keeping whatever else the summary holds.
    await db.update(runs).set({ variantSummary: { variantsSkippedForBudget: 2, other: 'kept' } }).where(eq(runs.id, runId));
    await queueVariantGroup(db, {
      runId, sourceId, productKey: 'https://shop.example/p/x',
      urls: ['https://shop.example/p/y', 'https://shop.example/p/z'], from: FROM, cap: 3,
    });
    expect(await summaryOf(runId)).toEqual({ variantsSkippedForBudget: 4, other: 'kept' });
  });

  it('queues a group exactly at the cap', async () => {
    const { runId, sourceId } = await seedRun(['https://shop.example/p/a']);
    const out = await queueVariantGroup(db, {
      runId, sourceId, productKey: 'https://shop.example/p/a',
      urls: ['https://shop.example/p/b', 'https://shop.example/p/c'], from: FROM, cap: 3,
    });
    expect(out).toEqual({ queued: 2, skippedForBudget: 0 });
  });

  it('queues a group once, however many times it is asked (also concurrently)', async () => {
    const { runId, sourceId } = await seedRun(['https://shop.example/p/a']);
    const args = {
      runId, sourceId, productKey: 'https://shop.example/p/a',
      urls: ['https://shop.example/p/b', 'https://shop.example/p/c'], from: FROM, cap: 50,
    };

    const first = await queueVariantGroup(db, args);
    const second = await queueVariantGroup(db, args);
    const [third, fourth] = await Promise.all([queueVariantGroup(db, args), queueVariantGroup(db, args)]);

    expect(first).toEqual({ queued: 2, skippedForBudget: 0 });
    expect(second).toEqual({ queued: 0, skippedForBudget: 0 });
    expect(third).toEqual({ queued: 0, skippedForBudget: 0 });
    expect(fourth).toEqual({ queued: 0, skippedForBudget: 0 });
    expect(await detailItems(runId)).toHaveLength(3);
  });

  it('does nothing for an empty group', async () => {
    const { runId, sourceId } = await seedRun(['https://shop.example/p/a']);
    expect(await queueVariantGroup(db, {
      runId, sourceId, productKey: 'https://shop.example/p/a', urls: [], from: FROM, cap: 1,
    })).toEqual({ queued: 0, skippedForBudget: 0 });
    expect(await summaryOf(runId)).toBeNull();
  });
});
