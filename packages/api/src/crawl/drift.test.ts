// packages/api/src/crawl/drift.test.ts
// driftedKeys is pure arithmetic over rows; flagDrift wires that arithmetic
// to a real run's persisted extractions and writes both the run's and the
// Source's driftedFields.
import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, orgs, projects, datasets, sources, runs, captures, extractions } from '@robot/db';
import { driftedKeys, flagDrift } from './drift.js';

describe('driftedKeys', () => {
  it('returns [] under DRIFT_MIN_ROWS (5) rows, no matter how bad the miss rate', () => {
    const rows = Array.from({ length: 4 }, () => ({ price: null }));
    expect(driftedKeys(rows, ['price'])).toEqual([]);
  });

  it('flags a key whose null/empty share is >= DRIFT_MISS_SHARE (0.2) at 10 rows', () => {
    const rows = [
      ...Array.from({ length: 3 }, () => ({ price: null, name: 'Widget' })),
      ...Array.from({ length: 7 }, () => ({ price: 9.99, name: 'Widget' })),
    ];
    expect(driftedKeys(rows, ['price', 'name'])).toEqual(['price']);
  });

  it('treats undefined and empty string the same as null', () => {
    const rows = [
      ...Array.from({ length: 3 }, () => ({ price: '' })),
      ...Array.from({ length: 7 }, () => ({ price: 9.99 })),
    ];
    expect(driftedKeys(rows, ['price'])).toEqual(['price']);
  });

  it('leaves a key alone once its miss share drops below the threshold', () => {
    const rows = [
      ...Array.from({ length: 1 }, () => ({ price: null })),
      ...Array.from({ length: 9 }, () => ({ price: 9.99 })),
    ];
    expect(driftedKeys(rows, ['price'])).toEqual([]);
  });
});

const SLUG = 'test-drift';
let orgId: string | null = null;

afterEach(async () => {
  if (orgId) await db.delete(orgs).where(eq(orgs.id, orgId));
  orgId = null;
});

async function seedRunWithRows(rows: Array<Record<string, unknown>>) {
  const [org] = await db.insert(orgs).values({ name: SLUG, slug: SLUG }).returning();
  orgId = org!.id;
  const [project] = await db.insert(projects).values({ orgId: org!.id, name: SLUG, slug: SLUG }).returning();
  const [dataset] = await db.insert(datasets).values({ projectId: project!.id, name: SLUG, slug: SLUG, schema: [] }).returning();
  const [source] = await db.insert(sources).values({ datasetId: dataset!.id, name: SLUG, slug: SLUG, country: 'US' }).returning();
  const [run] = await db.insert(runs).values({ sourceId: source!.id, status: 'completed' }).returning();
  for (const [i, row] of rows.entries()) {
    const [capture] = await db.insert(captures).values({
      sourceId: source!.id, runId: run!.id, url: `https://example.com/p/${i}`,
    }).returning({ id: captures.id });
    await db.insert(extractions).values({
      sourceId: source!.id, captureId: capture!.id, runId: run!.id, data: [row], rowCount: 1,
    });
  }
  return { runId: run!.id, sourceId: source!.id };
}

describe('flagDrift', () => {
  it('writes the run\'s and the Source\'s driftedFields from the run\'s real extractions', async () => {
    const rows = [
      ...Array.from({ length: 3 }, () => ({ price: null, name: 'Widget' })),
      ...Array.from({ length: 7 }, () => ({ price: 9.99, name: 'Widget' })),
    ];
    const { runId, sourceId } = await seedRunWithRows(rows);

    const drifted = await flagDrift(db, runId, sourceId, ['price', 'name']);
    expect(drifted).toEqual(['price']);

    const [run] = await db.select().from(runs).where(eq(runs.id, runId));
    expect(run!.driftedFields).toEqual(['price']);
    const [source] = await db.select().from(sources).where(eq(sources.id, sourceId));
    expect(source!.driftedFields).toEqual(['price']);
  });

  it('writes an empty array on the run and null on the Source when nothing drifted', async () => {
    const rows = Array.from({ length: 6 }, () => ({ price: 9.99 }));
    const { runId, sourceId } = await seedRunWithRows(rows);

    const drifted = await flagDrift(db, runId, sourceId, ['price']);
    expect(drifted).toEqual([]);

    const [run] = await db.select().from(runs).where(eq(runs.id, runId));
    expect(run!.driftedFields).toEqual([]);
    const [source] = await db.select().from(sources).where(eq(sources.id, sourceId));
    expect(source!.driftedFields).toBeNull();
  });
});
