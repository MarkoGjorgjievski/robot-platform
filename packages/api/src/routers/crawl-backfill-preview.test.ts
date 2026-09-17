// packages/api/src/routers/crawl-backfill-preview.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, runs, runItems, extractions, captures, sources, orgs, projects, datasets } from '@robot/db';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from './index.js';

const caller = createCallerFactory(appRouter)({ db });
const SLUG = 'test-crawl-backfill-preview';
let orgId: string | null = null;

/**
 * Same shape as crawl-coverage.test.ts's seed (mirrored per the task-3
 * brief): one run, two detail items — one with a real extraction (`title`
 * filled, `isbn` missing), one failed with no extraction at all (both
 * fields missing). `title` fills 1/2 = 0.5 (healthy, the binding boundary);
 * `isbn` fills 0/2 (dead).
 */
async function seedRunWithGapItems() {
  const [org] = await db.insert(orgs).values({ name: SLUG, slug: SLUG }).returning();
  orgId = org!.id;
  const [project] = await db.insert(projects).values({ orgId: org!.id, name: SLUG, slug: SLUG }).returning();
  const [dataset] = await db.insert(datasets).values({
    projectId: project!.id, name: SLUG, slug: SLUG,
    schema: [{ name: 'title', type: 'string' }, { name: 'isbn', type: 'string' }],
  }).returning();
  const [source] = await db.insert(sources).values({ datasetId: dataset!.id, name: SLUG, slug: SLUG, country: 'US' }).returning();
  const [run] = await db.insert(runs).values({ sourceId: source!.id, status: 'completed' }).returning();

  const [capture] = await db.insert(captures).values({
    sourceId: source!.id, runId: run!.id, url: 'https://example.com/p/1',
  }).returning();
  const [extraction] = await db.insert(extractions).values({
    sourceId: source!.id, captureId: capture!.id, runId: run!.id,
    data: [{ title: 'A', isbn: null, _url: 'https://example.com/p/1', _page_number: 1 }],
  }).returning();

  const [item1] = await db.insert(runItems).values({
    runId: run!.id, kind: 'detail', url: 'https://example.com/p/1', inputIndex: 0,
    status: 'done', extractionId: extraction!.id,
  }).returning();
  const [item2] = await db.insert(runItems).values({
    runId: run!.id, kind: 'detail', url: 'https://example.com/p/2', inputIndex: 0,
    status: 'failed', error: 'blocked',
  }).returning();

  return { runId: run!.id, sourceId: source!.id, item1Id: item1!.id, item2Id: item2!.id };
}

/** A run whose only detail item fills every field — no gaps at all. */
async function seedRunWithNoGaps() {
  const [org] = await db.insert(orgs).values({ name: `${SLUG}-clean`, slug: `${SLUG}-clean` }).returning();
  orgId = org!.id;
  const [project] = await db.insert(projects).values({ orgId: org!.id, name: SLUG, slug: SLUG }).returning();
  const [dataset] = await db.insert(datasets).values({
    projectId: project!.id, name: SLUG, slug: SLUG,
    schema: [{ name: 'title', type: 'string' }],
  }).returning();
  const [source] = await db.insert(sources).values({ datasetId: dataset!.id, name: SLUG, slug: SLUG, country: 'US' }).returning();
  const [run] = await db.insert(runs).values({ sourceId: source!.id, status: 'completed' }).returning();

  const [capture] = await db.insert(captures).values({
    sourceId: source!.id, runId: run!.id, url: 'https://example.com/p/1',
  }).returning();
  const [extraction] = await db.insert(extractions).values({
    sourceId: source!.id, captureId: capture!.id, runId: run!.id,
    data: [{ title: 'A', _url: 'https://example.com/p/1', _page_number: 1 }],
  }).returning();
  await db.insert(runItems).values({
    runId: run!.id, kind: 'detail', url: 'https://example.com/p/1', inputIndex: 0,
    status: 'done', extractionId: extraction!.id,
  });

  return { runId: run!.id };
}

afterEach(async () => {
  if (orgId) await db.delete(orgs).where(eq(orgs.id, orgId));
  orgId = null;
});

describe('crawl.backfillPreview', () => {
  it('rejects an unknown run', async () => {
    await expect(caller.crawl.backfillPreview({ runId: '00000000-0000-0000-0000-000000000000' }))
      .rejects.toThrow(/not found/i);
  });

  it('defaults targetFields to every field with a gap, and reports pages/cost/classification', async () => {
    const { runId } = await seedRunWithGapItems();

    const result = await caller.crawl.backfillPreview({ runId });

    expect(result.pages).toBe(2);
    expect(result.estCostUsd).toBe(0.1);
    expect(result.fields).toEqual([
      { name: 'title', fill: 0.5, classification: 'healthy' },
      { name: 'isbn', fill: 0, classification: 'dead' },
    ]);
  });

  it('restricts to explicit targetFields', async () => {
    const { runId } = await seedRunWithGapItems();

    const result = await caller.crawl.backfillPreview({ runId, targetFields: ['isbn'] });

    // Only item2 is missing isbn AND title, item1 is missing isbn only — both
    // qualify since both are missing 'isbn'.
    expect(result.pages).toBe(2);
    expect(result.fields).toEqual([{ name: 'isbn', fill: 0, classification: 'dead' }]);
  });

  it('an empty targetFields array previews nothing — the checklist with every box unchecked', async () => {
    const { runId } = await seedRunWithGapItems();

    const result = await caller.crawl.backfillPreview({ runId, targetFields: [] });

    expect(result.pages).toBe(0);
    expect(result.estCostUsd).toBe(0);
    expect(result.fields).toEqual([]);
  });

  it('a run with zero gaps returns pages: 0', async () => {
    const { runId } = await seedRunWithNoGaps();

    const result = await caller.crawl.backfillPreview({ runId });

    expect(result.pages).toBe(0);
    expect(result.estCostUsd).toBe(0);
    expect(result.fields).toEqual([]);
  });
});

describe('crawl.misses', () => {
  it('groups a run\'s empty cells by field and listing, and says an unverified website is not certified', async () => {
    const { runId } = await seedRunWithGapItems();
    const out = await caller.crawl.misses({ runId });
    expect(out.certified).toBe(false);
    expect(out.fields.map((f) => [f.name, f.count, f.total])).toEqual([['title', 1, 2], ['isbn', 2, 2]]);
    expect(out.fields[0]!.groups).toEqual([{ listingUrl: null, count: 1, urls: ['https://example.com/p/2'] }]);
    expect(out.fields[1]!.groups[0]!.urls).toEqual(expect.arrayContaining(['https://example.com/p/1', 'https://example.com/p/2']));
  });
  it('a product found on a listing groups under that listing', async () => {
    const { runId } = await seedRunWithGapItems();
    await db.insert(runItems).values({
      runId, kind: 'detail', url: 'https://example.com/p/3', inputIndex: 0,
      inputValues: { url: 'https://example.com/cat/a' }, status: 'failed', error: 'blocked',
    });
    const title = (await caller.crawl.misses({ runId })).fields.find((f) => f.name === 'title')!;
    expect(title.groups).toEqual(expect.arrayContaining([{ listingUrl: 'https://example.com/cat/a', count: 1, urls: ['https://example.com/p/3'] }]));
  });
  it('a clean run has no misses', async () => {
    const { runId } = await seedRunWithNoGaps();
    expect((await caller.crawl.misses({ runId })).fields).toEqual([]);
  });
});

describe('crawl.backfillPreview on an unverified website', () => {
  it('keeps the "up to" AI estimate and reports certified: false', async () => {
    const { runId } = await seedRunWithGapItems();
    const p = await caller.crawl.backfillPreview({ runId });
    expect(p.certified).toBe(false);
    expect(p.estCostUsd).toBeGreaterThan(0);
  });
});
