import { describe, it, expect, afterEach, vi } from 'vitest';
import { TRPCError } from '@trpc/server';
import { ZodError } from 'zod';
import { eq } from 'drizzle-orm';
import { db, sources, inputSets, datasets, projects } from '@robot/db';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from './index.js';

// `sources.analyze` routes through `scraperRouter.analyze`, which dynamically
// imports `@robot/scraper`'s `runAnalysis` and launches a real browser via
// `withBrowserSession`'s default `PlaywrightBrowser` factory. Both are
// stubbed here — exactly the crawl.test.ts pattern — so this file exercises
// ONLY sources.ts's own behaviour (pageType derivation, persistence shape),
// never a live browser or an API key.
const { runAnalysisMock } = vi.hoisted(() => ({ runAnalysisMock: vi.fn() }));
vi.mock('@robot/scraper', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@robot/scraper')>();
  return { ...actual, runAnalysis: runAnalysisMock };
});

vi.mock('@robot/browser', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@robot/browser')>();
  class StubBrowser {
    async launch(): Promise<void> {}
    async close(): Promise<void> {}
  }
  return { ...actual, PlaywrightBrowser: StubBrowser };
});

// `sources.confirm` calls the real `planSource` — stubbed here per the task
// brief ("confirm sets confirmedAt and plans full (stub planSource)") so this
// file tests confirm's OWN behaviour (confirmedAt, the args passed through),
// not planning itself — planSource has its own regression net in crawl.test.ts.
const { planSourceMock } = vi.hoisted(() => ({ planSourceMock: vi.fn() }));
vi.mock('../crawl/plan-source.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../crawl/plan-source.js')>();
  return { ...actual, planSource: planSourceMock };
});

const createCaller = createCallerFactory(appRouter);
const caller = createCaller({ db });

function expectZodValidationError(err: unknown): asserts err is TRPCError {
  if (!(err instanceof TRPCError)) throw new Error(`expected TRPCError, got ${err}`);
  if (!(err.cause instanceof ZodError)) throw new Error(`expected ZodError cause, got ${err.cause}`);
}

/** Deletes a Source created by quickCreate, plus its InputSet — never the
 *  shared Scratch project/dataset itself. */
async function cleanupSource(sourceId: string): Promise<void> {
  const source = await db.query.sources.findFirst({
    where: eq(sources.id, sourceId),
    columns: { inputSetId: true },
  });
  // Deleting the source cascades any runs (and their run_items) it owns.
  await db.delete(sources).where(eq(sources.id, sourceId));
  if (source?.inputSetId) {
    await db.delete(inputSets).where(eq(inputSets.id, source.inputSetId));
  }
}

afterEach(() => {
  runAnalysisMock.mockReset();
  planSourceMock.mockReset();
});

describe('sources.quickCreate', () => {
  describe('input validation', () => {
    it('rejects empty input', async () => {
      try {
        await caller.sources.quickCreate({} as never);
        throw new Error('should have thrown');
      } catch (err) {
        expectZodValidationError(err);
      }
    });

    it('rejects an invalid mode', async () => {
      try {
        await caller.sources.quickCreate({ mode: 'nope' as never, urls: ['https://example.com'] });
        throw new Error('should have thrown');
      } catch (err) {
        expectZodValidationError(err);
      }
    });

    it('rejects an empty urls array', async () => {
      try {
        await caller.sources.quickCreate({ mode: 'detail', urls: [] });
        throw new Error('should have thrown');
      } catch (err) {
        expectZodValidationError(err);
      }
    });

    it('rejects more than 50 urls', async () => {
      const urls = Array.from({ length: 51 }, (_, i) => `https://test-qc-toomany.example.com/p/${i}`);
      try {
        await caller.sources.quickCreate({ mode: 'detail', urls });
        throw new Error('should have thrown');
      } catch (err) {
        expectZodValidationError(err);
      }
    });

    it('rejects a non-URL string', async () => {
      try {
        await caller.sources.quickCreate({ mode: 'detail', urls: ['not-a-url'] });
        throw new Error('should have thrown');
      } catch (err) {
        expectZodValidationError(err);
      }
    });
  });

  it('creates a detail Source + one-row InputSet, attached to the Scratch project/dataset', async () => {
    const url = 'https://test-qc-detail.example.com/products/widget';
    const result = await caller.sources.quickCreate({ mode: 'detail', urls: [url] });
    try {
      expect(result.projectSlug).toBe('scratch');
      expect(result.sourceSlug).toMatch(/^test-qc-detail-example-com-/);
      expect(result.sourceId).toBeTruthy();

      const source = await db.query.sources.findFirst({ where: eq(sources.id, result.sourceId) });
      expect(source).toBeDefined();
      expect(source!.name).toBe('test-qc-detail.example.com /products/widget');
      expect(source!.slug).toBe(result.sourceSlug);
      expect(source!.listingMode).toBe('detail');
      expect(source!.inputStrategy).toBe('direct');
      expect(source!.urlTemplate).toBe(url);
      expect(source!.isSandbox).toBe(false);
      // Detail sources keep the schema default budget — quickCreate does not touch it.
      expect(source!.budget).toEqual({});

      expect(source!.datasetId).toBeTruthy();
      const dataset = await db.query.datasets.findFirst({ where: eq(datasets.id, source!.datasetId!) });
      expect(dataset).toBeDefined();
      expect(dataset!.slug).toBe('scratch');
      expect(dataset!.name).toBe('Scratch');

      const project = await db.query.projects.findFirst({ where: eq(projects.id, dataset!.projectId) });
      expect(project!.slug).toBe('scratch');

      expect(source!.inputSetId).toBeTruthy();
      const inputSet = await db.query.inputSets.findFirst({ where: eq(inputSets.id, source!.inputSetId!) });
      expect(inputSet).toBeDefined();
      expect(inputSet!.columns).toEqual([{ name: 'url', primary: true }]);
      expect(inputSet!.rows).toEqual([{ url }]);
    } finally {
      await cleanupSource(result.sourceId);
    }
  });

  it('creates a listing Source with listing defaults + one InputSet row per url', async () => {
    const urls = [
      'https://test-qc-listing.example.com/c/a',
      'https://test-qc-listing.example.com/c/b',
    ];
    const result = await caller.sources.quickCreate({ mode: 'listing', urls });
    try {
      const source = await db.query.sources.findFirst({ where: eq(sources.id, result.sourceId) });
      expect(source!.listingMode).toBe('listing_to_detail');
      expect(source!.urlTemplate).toBe(urls[0]);
      expect(source!.budget).toEqual({ max_items: 40, max_pages: 3, mode: 'first_n' });

      const inputSet = await db.query.inputSets.findFirst({ where: eq(inputSets.id, source!.inputSetId!) });
      expect(inputSet!.rows).toEqual(urls.map((url) => ({ url })));
    } finally {
      await cleanupSource(result.sourceId);
    }
  });

  it('reuses the same Scratch dataset across separate quickCreate calls', async () => {
    const a = await caller.sources.quickCreate({ mode: 'detail', urls: ['https://test-qc-reuse-a.example.com/p/1'] });
    const b = await caller.sources.quickCreate({ mode: 'detail', urls: ['https://test-qc-reuse-b.example.com/p/1'] });
    try {
      const sourceA = await db.query.sources.findFirst({ where: eq(sources.id, a.sourceId) });
      const sourceB = await db.query.sources.findFirst({ where: eq(sources.id, b.sourceId) });
      expect(sourceA!.datasetId).toBe(sourceB!.datasetId);
    } finally {
      await cleanupSource(a.sourceId);
      await cleanupSource(b.sourceId);
    }
  });
});

describe('sources.analyze', () => {
  it('derives pageType "detail" from a non-listing source, persists the sandbox-shaped payload plus listing/hints, and returns it', async () => {
    const created = await caller.sources.quickCreate({
      mode: 'detail',
      urls: ['https://test-qc-analyze-detail.example.com/p/1'],
    });
    try {
      runAnalysisMock.mockResolvedValue({
        captureId: 'cap-1',
        screenshotUrl: '/captures/cap-1.png',
        url: 'https://test-qc-analyze-detail.example.com/p/1',
        title: 'Widget',
        schema: { page_type: 'detail', description: 'x', fields: [{ name: 'title', type: 'string' }] },
        cached: false,
        liveExamples: true,
        blockedReason: undefined,
        hints: ['some detail hint'],
      });

      const result = await caller.sources.analyze({ sourceId: created.sourceId });

      expect(runAnalysisMock).toHaveBeenCalledTimes(1);
      const call = runAnalysisMock.mock.calls[0]![0] as { url: string; pageType: string };
      expect(call.pageType).toBe('detail');
      expect(call.url).toBe('https://test-qc-analyze-detail.example.com/p/1');

      const expectedPayload = {
        fields: [{ name: 'title', type: 'string' }],
        pageType: 'detail',
        cached: false,
        liveExamples: true,
        blockedReason: null,
        captureId: 'cap-1',
        screenshotUrl: '/captures/cap-1.png',
        listing: null,
        hints: ['some detail hint'],
      };
      expect(result).toEqual(expectedPayload);

      const source = await db.query.sources.findFirst({ where: eq(sources.id, created.sourceId) });
      expect(source!.selectorsJson).toEqual(expectedPayload);
    } finally {
      await cleanupSource(created.sourceId);
    }
  });

  it('derives pageType "listing" and passes listing through when listingMode is listing_to_detail', async () => {
    const created = await caller.sources.quickCreate({
      mode: 'listing',
      urls: ['https://test-qc-analyze-listing.example.com/c/a'],
    });
    try {
      runAnalysisMock.mockResolvedValue({
        captureId: null,
        screenshotUrl: null,
        url: 'https://test-qc-analyze-listing.example.com/c/a',
        title: 'Category',
        schema: { page_type: 'listing', description: 'x', fields: [] },
        cached: false,
        liveExamples: true,
        listing: { rowsFound: 5, paginationStrategy: null, sampleDetailUrls: ['https://test-qc-analyze-listing.example.com/p/1'] },
        hints: [],
      });

      const result = await caller.sources.analyze({ sourceId: created.sourceId });

      const call = runAnalysisMock.mock.calls[0]![0] as { pageType: string };
      expect(call.pageType).toBe('listing');
      expect(result.listing).toEqual({ rowsFound: 5, paginationStrategy: null, sampleDetailUrls: ['https://test-qc-analyze-listing.example.com/p/1'] });

      const source = await db.query.sources.findFirst({ where: eq(sources.id, created.sourceId) });
      expect((source!.selectorsJson as { listing: unknown }).listing).toEqual(result.listing);
    } finally {
      await cleanupSource(created.sourceId);
    }
  });

  it('throws NOT_FOUND for an unknown sourceId', async () => {
    await expect(
      caller.sources.analyze({ sourceId: '00000000-0000-0000-0000-000000000000' }),
    ).rejects.toThrow(/not found/i);
  });

  it('rejects a non-uuid sourceId', async () => {
    try {
      await caller.sources.analyze({ sourceId: 'not-a-uuid' });
      throw new Error('should have thrown');
    } catch (err) {
      expectZodValidationError(err);
    }
  });
});

describe('sources.confirm', () => {
  it('sets confirmedAt and plans at full budget (probe: false), returning { runId }', async () => {
    const created = await caller.sources.quickCreate({
      mode: 'detail',
      urls: ['https://test-qc-confirm.example.com/p/1'],
    });
    try {
      planSourceMock.mockResolvedValue({
        runId: '11111111-1111-1111-1111-111111111111',
        status: 'planned',
        itemCount: 1,
        listingPages: 0,
        warnings: [],
        errors: [],
        inputs: [],
        cacheWarm: false,
      });

      const before = await db.query.sources.findFirst({ where: eq(sources.id, created.sourceId) });
      expect(before!.confirmedAt).toBeNull();

      const result = await caller.sources.confirm({ sourceId: created.sourceId });
      expect(result).toEqual({ runId: '11111111-1111-1111-1111-111111111111' });

      expect(planSourceMock).toHaveBeenCalledTimes(1);
      const call = planSourceMock.mock.calls[0]!;
      expect(call[1]).toBe(created.sourceId);
      expect(call[2]).toEqual({ probe: false });

      const after = await db.query.sources.findFirst({ where: eq(sources.id, created.sourceId) });
      expect(after!.confirmedAt).toBeInstanceOf(Date);
    } finally {
      await cleanupSource(created.sourceId);
    }
  });

  it('throws NOT_FOUND for an unknown sourceId', async () => {
    await expect(
      caller.sources.confirm({ sourceId: '00000000-0000-0000-0000-000000000000' }),
    ).rejects.toThrow(/not found/i);
  });

  it('rejects a non-uuid sourceId', async () => {
    try {
      await caller.sources.confirm({ sourceId: 'not-a-uuid' });
      throw new Error('should have thrown');
    } catch (err) {
      expectZodValidationError(err);
    }
  });
});

describe('appRouter shape', () => {
  it('exposes quickCreate/analyze/confirm on sources', () => {
    expect(typeof caller.sources.quickCreate).toBe('function');
    expect(typeof caller.sources.analyze).toBe('function');
    expect(typeof caller.sources.confirm).toBe('function');
  });
});
