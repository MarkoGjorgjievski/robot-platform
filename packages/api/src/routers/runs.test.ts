import { describe, it, expect, afterEach } from 'vitest';
import { TRPCError } from '@trpc/server';
import { ZodError } from 'zod';
import { eq } from 'drizzle-orm';
import { db, runs, sources, orgs, projects, datasets, captures, extractions } from '@robot/db';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from './index.js';

const createCaller = createCallerFactory(appRouter);
const caller = createCaller({ db });

function expectZodValidationError(err: unknown) {
  if (!(err instanceof TRPCError)) throw new Error(`expected TRPCError, got ${err}`);
  if (!(err.cause instanceof ZodError)) throw new Error(`expected ZodError cause, got ${err.cause}`);
}

// Phase 2 writes one extraction per URL, so `getWithDetails` is one of the two
// readers that must union every extraction of a run rather than reading the
// latest one. This block is the functional coverage that was missing: nothing
// here would have failed if the order, cap, row-total, or single-extraction
// back-compat shape of this reader regressed.
const SLUG = 'test-runs-getwithdetails';
let orgId: string | null = null;

async function seedSource() {
  const [org] = await db.insert(orgs).values({ name: SLUG, slug: SLUG }).returning();
  orgId = org!.id;
  const [project] = await db.insert(projects).values({ orgId: org!.id, name: SLUG, slug: SLUG }).returning();
  const [dataset] = await db.insert(datasets).values({ projectId: project!.id, name: SLUG, slug: SLUG, schema: [] }).returning();
  const [source] = await db.insert(sources).values({
    datasetId: dataset!.id, name: SLUG, slug: SLUG, country: 'US',
    selectorsJson: { fields: [{ name: 'title', type: 'string' }] },
  }).returning();
  return source!.id;
}

/** Phase 2 shape: one extraction per URL, one row of data each. */
async function seedRunWithExtractions(rows: Array<Record<string, unknown>>) {
  const sourceId = await seedSource();
  const [run] = await db.insert(runs).values({ sourceId, status: 'completed' }).returning();
  for (const row of rows) {
    const [capture] = await db.insert(captures).values({
      sourceId, runId: run!.id, url: String(row._url ?? 'https://example.com/p/x'),
    }).returning({ id: captures.id });
    await db.insert(extractions).values({
      sourceId, captureId: capture!.id, runId: run!.id, data: [row], rowCount: 1,
    });
  }
  return run!.id;
}

/** Phase 2 shape at volume: many single-row extractions, inserted in bulk. */
async function seedRunWithManySingleRowExtractions(count: number) {
  const sourceId = await seedSource();
  const [run] = await db.insert(runs).values({ sourceId, status: 'completed' }).returning();
  const captureRows = Array.from({ length: count }, (_, i) => ({
    sourceId, runId: run!.id, url: `https://example.com/p/${i}`,
  }));
  const insertedCaptures = await db.insert(captures).values(captureRows).returning({ id: captures.id });
  const extractionRows = insertedCaptures.map((c, i) => ({
    sourceId, captureId: c.id, runId: run!.id, data: [{ title: `Row ${i}` }], rowCount: 1,
  }));
  await db.insert(extractions).values(extractionRows);
  return run!.id;
}

/** Sandbox shape: one extraction whose `data` array holds every row. */
async function seedRunWithSingleExtraction(rows: Array<Record<string, unknown>>) {
  const sourceId = await seedSource();
  const [run] = await db.insert(runs).values({ sourceId, status: 'completed' }).returning();
  const [capture] = await db.insert(captures).values({
    sourceId, runId: run!.id, url: 'https://example.com/listing',
  }).returning({ id: captures.id });
  await db.insert(extractions).values({
    sourceId, captureId: capture!.id, runId: run!.id, data: rows, rowCount: rows.length,
  });
  return run!.id;
}

afterEach(async () => {
  if (orgId) await db.delete(orgs).where(eq(orgs.id, orgId));
  orgId = null;
});

describe('runsRouter', () => {
  describe('getWithDetails input validation', () => {
    it('rejects missing id', async () => {
      try {
        await caller.runs.getWithDetails({} as never);
        throw new Error('should have thrown');
      } catch (err) {
        expectZodValidationError(err);
      }
    });

    it('rejects non-uuid string', async () => {
      try {
        await caller.runs.getWithDetails({ id: 'not-a-uuid' });
        throw new Error('should have thrown');
      } catch (err) {
        expectZodValidationError(err);
      }
    });

    it('returns null for unknown run id', async () => {
      const result = await caller.runs.getWithDetails({ id: '00000000-0000-0000-0000-000000000000' });
      expect(result).toBeNull();
    });
  });

  describe('listBySource', () => {
    it('returns empty array for unknown sourceId', async () => {
      const result = await caller.runs.listBySource({ sourceId: '00000000-0000-0000-0000-000000000000' });
      expect(result).toEqual([]);
    });
  });

  describe('getWithDetails — extraction aggregation', () => {
    it('returns rows from every extraction, in extraction order', async () => {
      const runId = await seedRunWithExtractions([
        { title: 'One', _url: 'https://example.com/p/1' },
        { title: 'Two', _url: 'https://example.com/p/2' },
        { title: 'Three', _url: 'https://example.com/p/3' },
      ]);

      const result = await caller.runs.getWithDetails({ id: runId });
      expect(result?.extraction?.data.map((r: any) => r.title)).toEqual(['One', 'Two', 'Three']);
      expect(result?.extraction?.rowCount).toBe(3);
    });

    it('caps the returned data at VIEW_ROW_CAP but reports the true row total (sandbox shape)', async () => {
      const rows = Array.from({ length: 600 }, (_, i) => ({ title: `Row ${i}` }));
      const runId = await seedRunWithSingleExtraction(rows);

      const result = await caller.runs.getWithDetails({ id: runId });
      expect(result?.extraction?.data).toHaveLength(500);
      expect(result?.extraction?.rowCount).toBe(600);
    });

    it('reports the true row total even when extractions themselves exceed the cap (phase 2 shape)', async () => {
      const runId = await seedRunWithManySingleRowExtractions(505);

      const result = await caller.runs.getWithDetails({ id: runId });
      expect(result?.extraction?.data).toHaveLength(500);
      expect(result?.extraction?.rowCount).toBe(505);
    });

    it('still reads a single-extraction run exactly as before (back-compat)', async () => {
      const runId = await seedRunWithSingleExtraction([{ title: 'Only' }]);

      const result = await caller.runs.getWithDetails({ id: runId });
      expect(result?.extraction?.data).toEqual([{ title: 'Only' }]);
      expect(result?.extraction?.rowCount).toBe(1);
    });
  });
});
