import { describe, it, expect, afterEach } from 'vitest';
import { TRPCError } from '@trpc/server';
import { ZodError } from 'zod';
import { eq } from 'drizzle-orm';
import { db, runs, sources, orgs, projects, datasets, captures, extractions } from '@robot/db';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from './index.js';
import { loadRunExport } from '../export/load-run-export.js';

const createCaller = createCallerFactory(appRouter);
const caller = createCaller({ db, session: null });

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

/** For the confirm-gate coverage below: a probe run carrying `logs`, on an unconfirmed Source. */
async function seedProbeRun(logs: string | null) {
  const sourceId = await seedSource();
  const [run] = await db.insert(runs).values({
    sourceId, status: 'planned', inputLabel: 'probe', logs,
  }).returning();
  return run!.id;
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

/** Single-page shape: one extraction whose `data` array holds every row. */
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

    it('caps the returned data at VIEW_ROW_CAP but reports the true row total (single-page shape)', async () => {
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

  // mvp-simplification task 10: the probe confirm gate reads `run.logs` (via
  // `parseRunLog`) and `source.confirmedAt` from THIS query — neither was
  // selected before, and a gate that can't see them can't decide whether to
  // show itself or summarise anything.
  describe('getWithDetails — probe confirm gate fields', () => {
    it('exposes run.logs and run.inputLabel and source.confirmedAt (null, unconfirmed)', async () => {
      const runId = await seedProbeRun('warning: budget reached: 40 items\nerror: input 0: dead link');

      const result = await caller.runs.getWithDetails({ id: runId });
      expect(result?.run.inputLabel).toBe('probe');
      expect(result?.run.logs).toBe('warning: budget reached: 40 items\nerror: input 0: dead link');
      expect(result?.source?.confirmedAt).toBeNull();
    });

    it('exposes source.confirmedAt once the Source is confirmed', async () => {
      const runId = await seedProbeRun(null);
      const run = await db.query.runs.findFirst({ where: eq(runs.id, runId), columns: { sourceId: true } });
      await db.update(sources).set({ confirmedAt: new Date() }).where(eq(sources.id, run!.sourceId!));

      const result = await caller.runs.getWithDetails({ id: runId });
      expect(result?.run.logs).toBeNull();
      expect(result?.source?.confirmedAt).toBeInstanceOf(Date);
    });
  });

  // The view caps at VIEW_ROW_CAP because a browser table does not need 5,000
  // rows. The export is deliberately uncapped, because a customer's CSV is the
  // deliverable and a short one is a wrong one. That contrast is the whole
  // design, and until now nothing would have failed if someone had "tidied" the
  // cap into `loadRunExport` — the largest export fixture was 3 rows. Same
  // seeded run, both readers, so the two properties are asserted against each
  // other rather than in isolation.
  // Task 10 (repair-engine): the backfill run page needs `parentRunId` and
  // `targetFields` to render its "Backfill of run <short-id> · fields: ..."
  // breadcrumb, and the PARENT's page needs `backfillRuns` to render the
  // reverse "Backfilled by run <short-id>" line — both derived from columns
  // Task 1 already added to the `runs` table, just never surfaced here.
  describe('getWithDetails — backfill linkage', () => {
    it('exposes parentRunId and targetFields as null on an ordinary run', async () => {
      const runId = await seedRunWithSingleExtraction([{ title: 'Only' }]);

      const result = await caller.runs.getWithDetails({ id: runId });
      expect(result?.run.parentRunId).toBeNull();
      expect(result?.run.targetFields).toBeNull();
      expect(result?.backfillRuns).toEqual([]);
    });

    it('exposes a backfill run\'s parentRunId and targetFields', async () => {
      const parentRunId = await seedRunWithSingleExtraction([{ title: 'Parent' }]);
      const parentRun = await db.query.runs.findFirst({ where: eq(runs.id, parentRunId), columns: { sourceId: true } });
      const [backfillRun] = await db.insert(runs).values({
        sourceId: parentRun!.sourceId, status: 'completed', inputLabel: 'backfill',
        parentRunId, targetFields: ['title', 'isbn'],
      }).returning();

      const result = await caller.runs.getWithDetails({ id: backfillRun!.id });
      expect(result?.run.parentRunId).toBe(parentRunId);
      expect(result?.run.targetFields).toEqual(['title', 'isbn']);
    });

    it('exposes backfillRuns on the PARENT\'s own page — id and status only', async () => {
      const parentRunId = await seedRunWithSingleExtraction([{ title: 'Parent' }]);
      const parentRun = await db.query.runs.findFirst({ where: eq(runs.id, parentRunId), columns: { sourceId: true } });
      const [backfillRun] = await db.insert(runs).values({
        sourceId: parentRun!.sourceId, status: 'completed', inputLabel: 'backfill',
        parentRunId, targetFields: ['title'],
      }).returning();

      const result = await caller.runs.getWithDetails({ id: parentRunId });
      expect(result?.backfillRuns).toEqual([{ id: backfillRun!.id, status: 'completed' }]);
    });
  });

  describe('the view caps, the export does not', () => {
    it('exports all 505 rows of a run the view shows 500 of', async () => {
      const runId = await seedRunWithManySingleRowExtractions(505);

      const view = await caller.runs.getWithDetails({ id: runId });
      expect(view?.extraction?.data).toHaveLength(500);
      expect(view?.extraction?.rowCount).toBe(505);

      const exported = await loadRunExport(db, runId);
      expect(exported?.rows).toHaveLength(505);
      // Not just the count: every seeded row is actually present, so a cap
      // applied at the extraction level rather than the row level fails too.
      const titles = new Set(exported?.rows.map((r) => r.title));
      expect(titles.size).toBe(505);
      expect(titles.has('Row 0')).toBe(true);
      expect(titles.has('Row 504')).toBe(true);
    });
  });
});
