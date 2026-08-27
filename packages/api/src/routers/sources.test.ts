import { describe, it, expect, afterEach, vi } from 'vitest';
import { TRPCError } from '@trpc/server';
import { ZodError } from 'zod';
import { eq, and } from 'drizzle-orm';
import { db, sources, inputSets, datasets, projects, orgs } from '@robot/db';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from './index.js';
import { getOrCreateScratchDataset, insertScratchDatasetIfAbsent } from './sources.js';

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

/** Isolated org + project, torn down by the returned cleanup — used to
 *  exercise Scratch-dataset resolution without touching the real seeded
 *  Scratch project/dataset (`getOrCreateScratchDataset` only needs a
 *  projectId; it doesn't care whether that project is actually "scratch"). */
async function makeThrowawayProject() {
  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const [org] = await db.insert(orgs)
    .values({ name: `sources test ${stamp}`, slug: `sources-test-${stamp}` })
    .returning({ id: orgs.id });
  const [project] = await db.insert(projects)
    .values({ orgId: org!.id, name: 'sources test', slug: `sources-test-${stamp}` })
    .returning({ id: projects.id });
  return {
    projectId: project!.id,
    // Deleting the project cascades any datasets created under it.
    cleanup: async () => {
      await db.delete(projects).where(eq(projects.id, project!.id));
      await db.delete(orgs).where(eq(orgs.id, org!.id));
    },
  };
}

afterEach(() => {
  runAnalysisMock.mockReset();
  planSourceMock.mockReset();
});

describe('getOrCreateScratchDataset conflict-safety', () => {
  it('reuses a dataset that already exists at (project, "scratch") rather than erroring', async () => {
    const { projectId, cleanup } = await makeThrowawayProject();
    try {
      const [preExisting] = await db.insert(datasets).values({
        projectId,
        name: 'Scratch',
        slug: 'scratch',
        schema: [],
      }).returning({ id: datasets.id });

      const result = await getOrCreateScratchDataset(db, projectId);
      expect(result).toBe(preExisting!.id);

      const rows = await db.select().from(datasets)
        .where(and(eq(datasets.projectId, projectId), eq(datasets.slug, 'scratch')));
      expect(rows).toHaveLength(1);
    } finally {
      await cleanup();
    }
  });

  it('two concurrent calls racing before the dataset exists both resolve to the same row, never throw', async () => {
    const { projectId, cleanup } = await makeThrowawayProject();
    try {
      // Both calls are issued back-to-back with no await between them, so
      // both fire their `findFirst` lookup before either has inserted
      // anything — this is the race `onConflictDoNothing` + fallback
      // `findFirst` exists to survive. (The driver may still serialize the
      // two inserts rather than genuinely interleaving them, so this alone
      // isn't guaranteed to hit the conflict branch every run — the
      // deterministic case below exercises that branch directly.)
      const [a, b] = await Promise.all([
        getOrCreateScratchDataset(db, projectId),
        getOrCreateScratchDataset(db, projectId),
      ]);
      expect(a).toBe(b);

      const rows = await db.select().from(datasets)
        .where(and(eq(datasets.projectId, projectId), eq(datasets.slug, 'scratch')));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.id).toBe(a);
    } finally {
      await cleanup();
    }
  });

  it('insertScratchDatasetIfAbsent: deterministically exercises the conflict branch — insert loses to a pre-existing row and falls back to findFirst instead of throwing', async () => {
    const { projectId, cleanup } = await makeThrowawayProject();
    try {
      // Insert the conflicting row directly (bypassing getOrCreateScratchDataset's
      // own findFirst guard entirely), so the call below has no way to see it
      // except via the ON CONFLICT DO NOTHING path itself.
      const [preExisting] = await db.insert(datasets).values({
        projectId,
        name: 'Scratch',
        slug: 'scratch',
        schema: [],
      }).returning({ id: datasets.id });

      const result = await insertScratchDatasetIfAbsent(db, projectId);
      expect(result).toBe(preExisting!.id);

      const rows = await db.select().from(datasets)
        .where(and(eq(datasets.projectId, projectId), eq(datasets.slug, 'scratch')));
      expect(rows).toHaveLength(1);
    } finally {
      await cleanup();
    }
  });
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

describe('sources.listByProject', () => {
  it('includes confirmedAt (null until confirm) and urlCount (InputSet row count)', async () => {
    const created = await caller.sources.quickCreate({
      mode: 'listing',
      urls: [
        'https://test-qc-list-a.example.com/c/1',
        'https://test-qc-list-b.example.com/c/2',
      ],
    });
    try {
      const sourceRow = await db.query.sources.findFirst({
        where: eq(sources.id, created.sourceId),
        with: { dataset: { with: { project: { with: { org: true } } } } },
      });
      const orgSlug = sourceRow!.dataset!.project!.org!.slug;
      const projectSlug = sourceRow!.dataset!.project!.slug;

      const before = await caller.sources.listByProject({ orgSlug, projectSlug });
      const beforeRow = before.find((s) => s.id === created.sourceId);
      expect(beforeRow).toBeDefined();
      expect(beforeRow!.confirmedAt).toBeNull();
      expect(beforeRow!.urlCount).toBe(2);
      expect(beforeRow!.listingMode).toBe('listing_to_detail');
      expect(beforeRow!.selectorsJson).toBeNull();

      planSourceMock.mockResolvedValue({
        runId: '22222222-2222-2222-2222-222222222222',
        status: 'planned', itemCount: 2, listingPages: 0,
        warnings: [], errors: [], inputs: [], cacheWarm: false,
      });
      await caller.sources.confirm({ sourceId: created.sourceId });

      const after = await caller.sources.listByProject({ orgSlug, projectSlug });
      const afterRow = after.find((s) => s.id === created.sourceId);
      expect(afterRow!.confirmedAt).toBeInstanceOf(Date);
    } finally {
      await cleanupSource(created.sourceId);
    }
  });
});

describe('sources.delete', () => {
  it('deletes an UNCONFIRMED Source and its own InputSet', async () => {
    const created = await caller.sources.quickCreate({
      mode: 'detail',
      urls: ['https://test-qc-delete.example.com/p/1'],
    });
    const inputSetId = (await db.query.sources.findFirst({
      where: eq(sources.id, created.sourceId),
      columns: { inputSetId: true },
    }))!.inputSetId!;

    const result = await caller.sources.delete({ sourceId: created.sourceId });
    expect(result).toEqual({ deleted: true });

    const source = await db.query.sources.findFirst({ where: eq(sources.id, created.sourceId) });
    expect(source).toBeUndefined();
    const inputSet = await db.query.inputSets.findFirst({ where: eq(inputSets.id, inputSetId) });
    expect(inputSet).toBeUndefined();
  });

  it('refuses to delete a CONFIRMED Source (ruling R5) — throws PRECONDITION_FAILED and leaves it in place', async () => {
    const created = await caller.sources.quickCreate({
      mode: 'detail',
      urls: ['https://test-qc-delete-confirmed.example.com/p/1'],
    });
    try {
      planSourceMock.mockResolvedValue({
        runId: '33333333-3333-3333-3333-333333333333',
        status: 'planned', itemCount: 1, listingPages: 0,
        warnings: [], errors: [], inputs: [], cacheWarm: false,
      });
      await caller.sources.confirm({ sourceId: created.sourceId });

      await expect(
        caller.sources.delete({ sourceId: created.sourceId }),
      ).rejects.toThrow(/confirmed sources cannot be deleted/i);

      const source = await db.query.sources.findFirst({ where: eq(sources.id, created.sourceId) });
      expect(source).toBeDefined();
      expect(source!.confirmedAt).toBeInstanceOf(Date);
    } finally {
      await cleanupSource(created.sourceId);
    }
  });

  it('throws NOT_FOUND for an unknown sourceId', async () => {
    await expect(
      caller.sources.delete({ sourceId: '00000000-0000-0000-0000-000000000000' }),
    ).rejects.toThrow(/not found/i);
  });

  it('rejects a non-uuid sourceId', async () => {
    try {
      await caller.sources.delete({ sourceId: 'not-a-uuid' });
      throw new Error('should have thrown');
    } catch (err) {
      expectZodValidationError(err);
    }
  });
});

describe('appRouter shape', () => {
  it('exposes quickCreate/analyze/confirm/delete on sources', () => {
    expect(typeof caller.sources.quickCreate).toBe('function');
    expect(typeof caller.sources.analyze).toBe('function');
    expect(typeof caller.sources.confirm).toBe('function');
    expect(typeof caller.sources.delete).toBe('function');
  });
});
