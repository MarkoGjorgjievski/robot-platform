// packages/api/src/crawl/backfill.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, runs, runItems, sources, orgs, projects, datasets } from '@robot/db';
import {
  classifyFields, deriveBackfillItems, planBackfillRun, DEAD_FIELD_FILL_THRESHOLD, REPAIR_SAMPLE_COUNT,
  type BackfillItemPlan,
} from './backfill.js';
import { claimNextItem } from './claim-item.js';
import type { FieldCoverage, ItemGap } from './coverage.js';

describe('classifyFields', () => {
  it('classifies fill exactly at the threshold as healthy', () => {
    // 1/2 = 0.5, exactly DEAD_FIELD_FILL_THRESHOLD — binding boundary: healthy.
    const fields: FieldCoverage[] = [
      { name: 'title', filled: 1, missing: 1, confirmedAbsent: 0, total: 2 },
    ];
    const result = classifyFields(fields, ['title']);
    expect(result).toEqual([{ name: 'title', fill: 0.5, classification: 'healthy' }]);
  });

  it('classifies fill just below the threshold as dead', () => {
    // 4/10 = 0.4 < 0.5
    const fields: FieldCoverage[] = [
      { name: 'isbn', filled: 4, missing: 6, confirmedAbsent: 0, total: 10 },
    ];
    const result = classifyFields(fields, ['isbn']);
    expect(result).toEqual([{ name: 'isbn', fill: 0.4, classification: 'dead' }]);
  });

  it('classifies a total-0 field as dead (fill 0)', () => {
    const fields: FieldCoverage[] = [
      { name: 'ghost', filled: 0, missing: 0, confirmedAbsent: 0, total: 0 },
    ];
    const result = classifyFields(fields, ['ghost']);
    expect(result).toEqual([{ name: 'ghost', fill: 0, classification: 'dead' }]);
  });

  it('only classifies fields named in targetNames', () => {
    const fields: FieldCoverage[] = [
      { name: 'title', filled: 2, missing: 0, confirmedAbsent: 0, total: 2 },
      { name: 'isbn', filled: 0, missing: 2, confirmedAbsent: 0, total: 2 },
    ];
    const result = classifyFields(fields, ['isbn']);
    expect(result).toEqual([{ name: 'isbn', fill: 0, classification: 'dead' }]);
  });

  it('sanity-checks the threshold constant value', () => {
    expect(DEAD_FIELD_FILL_THRESHOLD).toBe(0.5);
  });
});

describe('deriveBackfillItems', () => {
  const gapItems: ItemGap[] = [
    { itemId: 'item-1', url: 'https://example.com/p/1', missingFields: ['isbn'] },
    { itemId: 'item-2', url: 'https://example.com/p/2', missingFields: ['title', 'isbn'] },
    { itemId: 'item-3', url: 'https://example.com/p/3', missingFields: ['author'] },
  ];

  it('includes only items whose missingFields intersect targetNames, with targetFields as that intersection', () => {
    const result = deriveBackfillItems(gapItems, ['isbn']);
    expect(result).toEqual([
      { parentItemId: 'item-1', url: 'https://example.com/p/1', targetFields: ['isbn'] },
      { parentItemId: 'item-2', url: 'https://example.com/p/2', targetFields: ['isbn'] },
    ]);
  });

  it('excludes items with no intersection at all', () => {
    const result = deriveBackfillItems(gapItems, ['author']);
    expect(result).toEqual([
      { parentItemId: 'item-3', url: 'https://example.com/p/3', targetFields: ['author'] },
    ]);
  });

  it('when itemIds is provided, intersects with the selection first', () => {
    const result = deriveBackfillItems(gapItems, ['isbn'], ['item-2']);
    expect(result).toEqual([
      { parentItemId: 'item-2', url: 'https://example.com/p/2', targetFields: ['isbn'] },
    ]);
  });

  it('itemIds restricting to an item with no field intersection yields nothing', () => {
    const result = deriveBackfillItems(gapItems, ['isbn'], ['item-3']);
    expect(result).toEqual([]);
  });

  it('returns nothing when gapItems is empty', () => {
    expect(deriveBackfillItems([], ['isbn'])).toEqual([]);
  });

  it('confirmed-absent-only items never appear in gapItems, so they are excluded by composition', () => {
    // Task 2's computeCoverage never puts a field into missingFields when it is
    // confirmedAbsent for that item — so a gap item whose ONLY non-filled field
    // is confirmed-absent simply never shows up in gapItems at all. Seeded here
    // as an item with an EMPTY missingFields array (the shape computeCoverage
    // would produce if it ever did emit such an item) to prove
    // deriveBackfillItems still correctly excludes it, defense in depth.
    const gapItemsWithAbsentOnly: ItemGap[] = [
      { itemId: 'item-4', url: 'https://example.com/p/4', missingFields: [] },
    ];
    const result = deriveBackfillItems(gapItemsWithAbsentOnly, ['isbn']);
    expect(result).toEqual([]);
  });
});

// Finding 6 (minor, final-review-findings.md): the sample stage
// (repair-sweep.ts) counts ANY first REPAIR_SAMPLE_COUNT claimed items, not
// dead-target ones — a mixed-target backfill whose first 3 claims happen to
// be healthy-only gaps spuriously reports repair_failed. Fix: planBackfillRun
// gains an optional `orderFirst` predicate that inserts matching (dead-
// target) items first.
//
// claimNextItem's own ORDER BY (claim-item.ts) is `input_index, page_number
// NULLS FIRST, created_at` — input_index is the PRIMARY key, and it is
// copied verbatim from each item's own (diverse) parent inputIndex, so an
// ordering trick riding on INSERTION order/created_at alone would never
// actually change claim priority: input_index differs per item regardless
// of insert order, and even where it ties, every row in a single INSERT
// shares the exact same created_at (Postgres `now()` is transaction-time,
// not per-row) — ties are the norm here, not an edge case. Verified against
// the live claim-item.ts query before choosing this shape (per the branch's
// own constraint: fall back to inputIndex-offset ONLY for backfill items
// when created_at ties defeat pure insertion ordering). Shipped: `orderFirst`
// reassigns `input_index` to 0..n-1 in dead-first order for backfill items
// ONLY — their own run's claim ordering, never touching the parent run's
// inputIndex semantics or claim-item.ts's SQL.
describe('planBackfillRun — orderFirst (Finding 6)', () => {
  const SLUG = 'test-backfill-plan-order';
  let orgId: string | null = null;

  afterEach(async () => {
    if (orgId) await db.delete(orgs).where(eq(orgs.id, orgId));
    orgId = null;
  });

  async function seedParentWithItems(items: Array<{ inputIndex: number; url: string }>) {
    const [org] = await db.insert(orgs).values({ name: SLUG, slug: SLUG }).returning();
    orgId = org!.id;
    const [project] = await db.insert(projects).values({ orgId: org!.id, name: SLUG, slug: SLUG }).returning();
    const [dataset] = await db.insert(datasets).values({ projectId: project!.id, name: SLUG, slug: SLUG, schema: [] }).returning();
    const [source] = await db.insert(sources).values({ datasetId: dataset!.id, name: SLUG, slug: SLUG, country: 'US' }).returning();
    const [parentRun] = await db.insert(runs).values({ sourceId: source!.id, status: 'completed', completedAt: new Date() }).returning();
    const parentItems = await db.insert(runItems).values(
      items.map((it) => ({
        runId: parentRun!.id, kind: 'detail' as const, url: it.url, inputIndex: it.inputIndex, status: 'done' as const,
      })),
    ).returning();
    return { sourceId: source!.id, parentRunId: parentRun!.id, parentItems };
  }

  it('reassigns input_index to insertion order when orderFirst is given, so matching items sort first regardless of their original (diverse) parent inputIndex', async () => {
    const { sourceId, parentRunId, parentItems } = await seedParentWithItems([
      { inputIndex: 10, url: 'https://example.com/p/h10' }, // healthy
      { inputIndex: 20, url: 'https://example.com/p/d20' }, // dead
      { inputIndex: 5, url: 'https://example.com/p/h5' },  // healthy
      { inputIndex: 30, url: 'https://example.com/p/d30' }, // dead
    ]);
    const plans: BackfillItemPlan[] = parentItems.map((p) => ({ parentItemId: p.id, url: p.url, targetFields: ['isbn'] }));
    const deadUrls = new Set(['https://example.com/p/d20', 'https://example.com/p/d30']);

    const backfillRunId = await planBackfillRun(
      db, parentRunId, sourceId, plans, ['isbn'], (item) => deadUrls.has(item.url),
    );

    const backfillItems = await db.select().from(runItems).where(eq(runItems.runId, backfillRunId));
    const byUrl = new Map(backfillItems.map((it) => [it.url, it]));
    const deadIdx = [byUrl.get('https://example.com/p/d20')!.inputIndex, byUrl.get('https://example.com/p/d30')!.inputIndex];
    const healthyIdx = [byUrl.get('https://example.com/p/h10')!.inputIndex, byUrl.get('https://example.com/p/h5')!.inputIndex];
    // Original parent inputIndex order would have put d20/d30 LAST (20, 30 >
    // 10, 5) — asserting they now sort first proves reassignment happened,
    // not a coincidence of the seeded values.
    expect(Math.max(...deadIdx)).toBeLessThan(Math.min(...healthyIdx));
  });

  it('without orderFirst, keeps copying input_index verbatim from the parent item — unchanged behaviour for the plain backfill path', async () => {
    const { sourceId, parentRunId, parentItems } = await seedParentWithItems([
      { inputIndex: 7, url: 'https://example.com/p/plain' },
    ]);
    const plans: BackfillItemPlan[] = parentItems.map((p) => ({ parentItemId: p.id, url: p.url, targetFields: ['isbn'] }));

    const backfillRunId = await planBackfillRun(db, parentRunId, sourceId, plans, ['isbn']);

    const [item] = await db.select().from(runItems).where(eq(runItems.runId, backfillRunId));
    expect(item!.inputIndex).toBe(7);
  });

  // The repair-sweep sampling proof: claimNextItem (the REAL SQL, not a
  // stub) must draw the dead-target items within the first REPAIR_SAMPLE_COUNT
  // claims once planBackfillRun ordered them dead-first — even though their
  // ORIGINAL parent inputIndex (100, 200) is the HIGHEST in the set and would
  // have claimed dead-last under claim-item.ts's own ORDER BY without the fix.
  it('claimNextItem draws dead-target items within the first REPAIR_SAMPLE_COUNT claims — proves repair-sweep sampling actually reaches them', async () => {
    const { sourceId, parentRunId, parentItems } = await seedParentWithItems([
      { inputIndex: 1, url: 'https://example.com/p/h1' },
      { inputIndex: 2, url: 'https://example.com/p/h2' },
      { inputIndex: 3, url: 'https://example.com/p/h3' },
      { inputIndex: 100, url: 'https://example.com/p/d1' },
      { inputIndex: 200, url: 'https://example.com/p/d2' },
    ]);
    const plans: BackfillItemPlan[] = parentItems.map((p) => ({ parentItemId: p.id, url: p.url, targetFields: ['isbn'] }));
    const deadUrls = new Set(['https://example.com/p/d1', 'https://example.com/p/d2']);

    const backfillRunId = await planBackfillRun(
      db, parentRunId, sourceId, plans, ['isbn'], (item) => deadUrls.has(item.url),
    );

    const claimed: string[] = [];
    for (let i = 0; i < REPAIR_SAMPLE_COUNT; i++) {
      const item = await claimNextItem(db, backfillRunId);
      if (item) claimed.push(item.url);
    }

    expect(claimed).toEqual(expect.arrayContaining(['https://example.com/p/d1', 'https://example.com/p/d2']));
  });
});
