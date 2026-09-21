// packages/api/src/routers/crawl-backfill-preview.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, runs, runItems, extractions, captures, sources, sourceVerifications, orgs, projects, datasets } from '@robot/db';
import { fieldHash, type CertifiedPath, type SchemaDefinitionField, type VerificationSet } from '@robot/scraper';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from './index.js';
import { createProjectWithSource } from '../test-helpers/customer-source.js';
import { sourceDefinitionHash } from '../verify/current-certification.js';

const caller = createCallerFactory(appRouter)({ db, session: null });
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
  it('groups a run\'s empty cells by field and listing, counting only items that were actually extracted, and says an unverified website is not certified', async () => {
    const { runId } = await seedRunWithGapItems();
    const out = await caller.crawl.misses({ runId });
    expect(out.certified).toBe(false);
    // M6: a legacy source (no schemaDefinition/verificationSet at all — this
    // seed never calls sources.updateBinding) has no proof pages to add to.
    expect(out.proofSheet).toBe(false);
    // item2 (`failed`, no row — never extracted) contributes nothing and is
    // excluded from `total`: only item1's row is counted, so `isbn` (null on
    // that row) is the only reported miss, and `total` is 1, not 2.
    expect(out.fields.map((f) => [f.name, f.count, f.total])).toEqual([['isbn', 1, 1]]);
    expect(out.fields[0]!.groups).toEqual([{ listingUrl: null, count: 1, urls: ['https://example.com/p/1'] }]);
  });
  it('a product found on a listing groups under that listing', async () => {
    const { runId, sourceId } = await seedRunWithGapItems();
    // Must carry a real row (capture + extraction) — an item with no row is
    // never extracted and takes no part in misses at all.
    const [capture3] = await db.insert(captures).values({
      sourceId, runId, url: 'https://example.com/p/3',
    }).returning();
    const [extraction3] = await db.insert(extractions).values({
      sourceId, captureId: capture3!.id, runId,
      data: [{ title: null, isbn: '999', _url: 'https://example.com/p/3', _page_number: 1 }],
    }).returning();
    await db.insert(runItems).values({
      runId, kind: 'detail', url: 'https://example.com/p/3', inputIndex: 0,
      inputValues: { url: 'https://example.com/cat/a' }, status: 'done', extractionId: extraction3!.id,
    });
    const title = (await caller.crawl.misses({ runId })).fields.find((f) => f.name === 'title')!;
    expect(title.groups).toEqual(expect.arrayContaining([{ listingUrl: 'https://example.com/cat/a', count: 1, urls: ['https://example.com/p/3'] }]));
  });
  it('a clean run has no misses', async () => {
    const { runId } = await seedRunWithNoGaps();
    expect((await caller.crawl.misses({ runId })).fields).toEqual([]);
  });
  it('items never extracted (pending/running/failed) are not misses and are excluded from total — the capped-run case', async () => {
    const { runId } = await seedRunWithGapItems();
    // item2 (failed, no row) is already row-less; add two more row-less
    // items (pending) to model a run capped mid-extraction. None of the
    // three should appear anywhere in the result.
    await db.insert(runItems).values([
      { runId, kind: 'detail', url: 'https://example.com/p/4', inputIndex: 0, status: 'pending' },
      { runId, kind: 'detail', url: 'https://example.com/p/5', inputIndex: 0, status: 'pending' },
    ]);
    const out = await caller.crawl.misses({ runId });
    // Still only item1's row is counted: isbn is the one miss, total 1.
    expect(out.fields.map((f) => [f.name, f.count, f.total])).toEqual([['isbn', 1, 1]]);
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

/**
 * A CUSTOMER-SCHEMA website with a current certification (loadCurrentCertification's
 * exact requirement, verify/current-certification.ts): a schemaDefinition +
 * verificationSet (via createProjectWithSource's updateBinding call) and a
 * completed, error-free source_verifications row whose one field's result
 * carries a fieldHash matching the field as it stands now, a non-empty
 * `certified` array, and cells that are all 'pass'. Mirrors
 * current-certification.test.ts's `makeSchemaSource` + `currentPriceVerification`.
 * Own cleanup (createProjectWithSource's), independent of this file's
 * orgId-keyed afterEach.
 */
async function seedCertifiedRunWithGap() {
  const urls = [
    'https://test-cert-crawlmisses.example.com/p/1',
    'https://test-cert-crawlmisses.example.com/p/2',
    'https://test-cert-crawlmisses.example.com/p/3',
  ];
  const f = await createProjectWithSource(caller, {
    tag: 'cert-crawlmisses',
    urls,
    fields: [{ name: 'Price', type: 'money', description: 'x' }],
    expected: { Price: { [urls[0]!]: '1.00', [urls[1]!]: '2.00', [urls[2]!]: '3.00' } },
  });
  const source = await db.query.sources.findFirst({ where: eq(sources.id, f.sourceId) });
  const fields = source!.schemaDefinition as SchemaDefinitionField[];
  const set = source!.verificationSet as VerificationSet;
  const priceKey = f.keys.Price!;
  const certifiedPaths: CertifiedPath[] = [{ source: 'api', path: 'item.price', transform: 'identity' }];
  const cells = Object.fromEntries(urls.map((u) => [u, { status: 'pass', found: '1', path: certifiedPaths[0] }]));

  await db.insert(sourceVerifications).values({
    sourceId: f.sourceId,
    definitionHash: sourceDefinitionHash(source!)!,
    completedAt: new Date(),
    allPassed: true,
    results: {
      [priceKey]: {
        key: priceKey, cells, certified: certifiedPaths, weakEvidence: false, aiCalled: false, incomplete: false,
        fieldHash: fieldHash(fields[0]!, set),
      },
    },
  });

  // A completed run with a gap: both items were extracted (both have a real
  // row) — one fills `price`, the other's row is missing it. `misses` (fix
  // round 2: a row-less item is excluded entirely) needs a genuine gap among
  // EXTRACTED items, not a failed/row-less one, to still prove its point.
  const [run] = await db.insert(runs).values({ sourceId: f.sourceId, status: 'completed' }).returning();
  const [capture1] = await db.insert(captures).values({ sourceId: f.sourceId, runId: run!.id, url: urls[0]! }).returning();
  const [extraction1] = await db.insert(extractions).values({
    sourceId: f.sourceId, captureId: capture1!.id, runId: run!.id,
    data: [{ [priceKey]: '1.00', _url: urls[0], _page_number: 1 }],
  }).returning();
  await db.insert(runItems).values({
    runId: run!.id, kind: 'detail', url: urls[0]!, inputIndex: 0, status: 'done', extractionId: extraction1!.id,
  });
  const [capture2] = await db.insert(captures).values({ sourceId: f.sourceId, runId: run!.id, url: urls[1]! }).returning();
  const [extraction2] = await db.insert(extractions).values({
    sourceId: f.sourceId, captureId: capture2!.id, runId: run!.id,
    data: [{ [priceKey]: null, _url: urls[1], _page_number: 1 }],
  }).returning();
  await db.insert(runItems).values({
    runId: run!.id, kind: 'detail', url: urls[1]!, inputIndex: 0, status: 'done', extractionId: extraction2!.id,
  });

  return { runId: run!.id, priceKey, cleanup: f.cleanup };
}

/**
 * M6: a schema-bound website (schemaDefinition + verificationSet, via
 * `updateBinding`, same as `seedCertifiedRunWithGap`) that has never been
 * verified — no `source_verifications` row at all, so `loadCurrentCertification`
 * finds nothing current. This is the "stale or absent" half of proofSheet:
 * true, certified: false — the schema exists and has proof pages to add to,
 * but nothing currently certifies it.
 */
async function seedSchemaSourceWithoutCurrentVerification() {
  const urls = [
    'https://test-cert-crawlmisses-stale.example.com/p/1',
    'https://test-cert-crawlmisses-stale.example.com/p/2',
    'https://test-cert-crawlmisses-stale.example.com/p/3',
  ];
  const f = await createProjectWithSource(caller, {
    tag: 'cert-crawlmisses-stale',
    urls,
    fields: [{ name: 'Price', type: 'money', description: 'x' }],
    expected: { Price: { [urls[0]!]: '1.00', [urls[1]!]: '2.00', [urls[2]!]: '3.00' } },
  });
  const [run] = await db.insert(runs).values({ sourceId: f.sourceId, status: 'completed' }).returning();
  const [capture1] = await db.insert(captures).values({ sourceId: f.sourceId, runId: run!.id, url: urls[0]! }).returning();
  const [extraction1] = await db.insert(extractions).values({
    sourceId: f.sourceId, captureId: capture1!.id, runId: run!.id,
    data: [{ [f.keys.Price!]: null, _url: urls[0], _page_number: 1 }],
  }).returning();
  await db.insert(runItems).values({
    runId: run!.id, kind: 'detail', url: urls[0]!, inputIndex: 0, status: 'done', extractionId: extraction1!.id,
  });
  return { runId: run!.id, cleanup: f.cleanup };
}

describe('crawl.misses and crawl.backfillPreview on a certified website', () => {
  it('crawl.misses reports certified: true and still groups the run\'s misses', async () => {
    const { runId, priceKey, cleanup } = await seedCertifiedRunWithGap();
    try {
      const out = await caller.crawl.misses({ runId });
      expect(out.certified).toBe(true);
      // M6: proofSheet is true right alongside certified here — a certified
      // website obviously has a schema + verification set to add pages to.
      expect(out.proofSheet).toBe(true);
      const priceMisses = out.fields.find((fld) => fld.name === priceKey);
      expect(priceMisses).toBeDefined();
      expect(priceMisses!.count).toBe(1);
      expect(priceMisses!.total).toBe(2);
    } finally {
      await cleanup();
    }
  });

  it('crawl.misses reports proofSheet: true, certified: false when the schema exists but nothing currently verifies it', async () => {
    const { runId, cleanup } = await seedSchemaSourceWithoutCurrentVerification();
    try {
      const out = await caller.crawl.misses({ runId });
      expect(out.certified).toBe(false);
      expect(out.proofSheet).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it('crawl.backfillPreview reports certified: true and prices the repair at $0, while still counting the gap page', async () => {
    const { runId, cleanup } = await seedCertifiedRunWithGap();
    try {
      const p = await caller.crawl.backfillPreview({ runId });
      expect(p.certified).toBe(true);
      expect(p.estCostUsd).toBe(0);
      expect(p.pages).toBeGreaterThan(0);
    } finally {
      await cleanup();
    }
  });
});
