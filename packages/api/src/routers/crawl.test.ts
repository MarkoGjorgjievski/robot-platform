import { describe, it, expect, afterEach, vi } from 'vitest';
import { TRPCError } from '@trpc/server';
import { ZodError } from 'zod';
import { eq } from 'drizzle-orm';
import { db, sources, orgs, projects, inputSets, runs, runItems } from '@robot/db';
import type { PlanRunOutcome } from '@robot/scraper';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from './index.js';

// planRun needs a real browser and (for anything interesting) an API key, so the
// router's OWN behaviour — run status, what it persists, what it returns — can
// only be exercised with the planner stubbed. The browser is stubbed too so
// nothing launches Chromium.
const { planRunMock } = vi.hoisted(() => ({ planRunMock: vi.fn() }));

vi.mock('@robot/scraper', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@robot/scraper')>();
  return { ...actual, planRun: planRunMock };
});

vi.mock('@robot/browser', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@robot/browser')>();
  class StubBrowser {
    async launch(): Promise<void> {}
    async close(): Promise<void> {}
  }
  return { ...actual, PlaywrightBrowser: StubBrowser };
});

const createCaller = createCallerFactory(appRouter);
const caller = createCaller({ db });

const CRAWL_TEST_SLUG_PREFIX = 'test-crawl-';

afterEach(async () => {
  await db.delete(sources).where(eq(sources.slug, `${CRAWL_TEST_SLUG_PREFIX}no-inputset`));
});

describe('crawlRouter.plan', () => {
  it('rejects a missing sourceId', async () => {
    try {
      await caller.crawl.plan({} as never);
      throw new Error('should have thrown');
    } catch (err) {
      if (!(err instanceof TRPCError)) throw new Error(`expected TRPCError, got ${err}`);
      if (!(err.cause instanceof ZodError)) throw new Error(`expected ZodError cause, got ${err.cause}`);
    }
  });

  it('rejects a non-uuid sourceId', async () => {
    try {
      await caller.crawl.plan({ sourceId: 'not-a-uuid' });
      throw new Error('should have thrown');
    } catch (err) {
      if (!(err instanceof TRPCError)) throw new Error(`expected TRPCError, got ${err}`);
    }
  });

  it('reports a source that does not exist rather than creating an orphan run', async () => {
    await expect(
      caller.crawl.plan({ sourceId: '00000000-0000-0000-0000-000000000000' }),
    ).rejects.toThrow(/not found/i);
  });

  it('rejects a source with no InputSet to plan from', async () => {
    // isSandbox: true satisfies the sources_non_sandbox_requires_dataset CHECK
    // without needing a project/dataset chain — inputSetId is left null, which
    // is exactly the precondition this test exercises.
    const [source] = await db.insert(sources).values({
      name: 'crawl test source (no input set)',
      slug: `${CRAWL_TEST_SLUG_PREFIX}no-inputset`,
      country: 'us',
      isSandbox: true,
    }).returning({ id: sources.id });

    try {
      await caller.crawl.plan({ sourceId: source.id });
      throw new Error('should have thrown');
    } catch (err) {
      if (!(err instanceof TRPCError)) throw new Error(`expected TRPCError, got ${err}`);
      expect(err.code).toBe('PRECONDITION_FAILED');
    }
  });
});

// ─── I5 / I6: what plan() persists ───────────────────────────────────────────

const OUTCOME_BASE: PlanRunOutcome = {
  items: [],
  warnings: [],
  errors: [],
  cacheWarm: false,
  inputs: [],
};

/** org → project → InputSet → sandbox Source, torn down by the returned cleanup. */
async function makePlannableSource() {
  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const [org] = await db.insert(orgs).values({ name: `crawl test ${stamp}`, slug: `crawl-test-${stamp}` }).returning({ id: orgs.id });
  const [project] = await db.insert(projects).values({ orgId: org!.id, name: 'crawl test', slug: `crawl-test-${stamp}` }).returning({ id: projects.id });
  const [inputSet] = await db.insert(inputSets).values({
    projectId: project!.id,
    type: 'category',
    name: 'crawl test inputs',
    columns: [{ name: 'slug', primary: true }],
    rows: [{ slug: 'a' }, { slug: 'b' }],
  }).returning({ id: inputSets.id });
  const [source] = await db.insert(sources).values({
    name: 'crawl test source',
    slug: `${CRAWL_TEST_SLUG_PREFIX}${stamp}`,
    country: 'us',
    isSandbox: true,
    listingMode: 'listing_to_detail',
    inputStrategy: 'category',
    urlTemplate: 'https://example.com/c/{slug}',
    inputSetId: inputSet!.id,
  }).returning({ id: sources.id });

  return {
    sourceId: source!.id,
    // Deleting the source cascades its runs, which cascade their run_items.
    cleanup: async () => {
      await db.delete(sources).where(eq(sources.id, source!.id));
      await db.delete(projects).where(eq(projects.id, project!.id));
      await db.delete(orgs).where(eq(orgs.id, org!.id));
    },
  };
}

describe('crawlRouter.plan persistence', () => {
  afterEach(() => { planRunMock.mockReset(); });

  it('marks a run that planned work `planned`, records its warnings, and returns the per-input breakdown', async () => {
    const fixture = await makePlannableSource();
    try {
      planRunMock.mockResolvedValue({
        ...OUTCOME_BASE,
        items: [
          { kind: 'listing', url: 'https://example.com/c/a', inputIndex: 0, inputValues: { slug: 'a' }, listingValues: {}, pageNumber: 1 },
          { kind: 'detail', url: 'https://example.com/p/1', inputIndex: 0, inputValues: { slug: 'a' }, listingValues: {}, pageNumber: 1 },
        ],
        warnings: ['budget reached: 1 items; 1 input(s) not planned'],
        errors: [{ inputIndex: 1, message: 'listing capture failed: navigation timeout' }],
        inputs: [
          { inputIndex: 0, itemCount: 1, status: 'planned' },
          { inputIndex: 1, itemCount: 0, status: 'error' },
        ],
      } satisfies PlanRunOutcome);

      const result = await caller.crawl.plan({ sourceId: fixture.sourceId });
      expect(result.status).toBe('planned');
      expect(result.itemCount).toBe(1);
      expect(result.inputs).toEqual([
        { inputIndex: 0, itemCount: 1, status: 'planned' },
        { inputIndex: 1, itemCount: 0, status: 'error' },
      ]);

      const run = await db.query.runs.findFirst({ where: eq(runs.id, result.runId) });
      expect(run?.status).toBe('planned');
      // Persisted, not just returned over HTTP: Plan B's crawl.status polls the DB.
      expect(run?.logs).toContain('budget reached: 1 items; 1 input(s) not planned');
      expect(run?.logs).toContain('input 1: listing capture failed: navigation timeout');
      // A run that planned work is not an error, so the field the dashboard
      // renders as a red banner stays empty.
      expect(run?.errorMessage).toBeNull();
    } finally {
      await fixture.cleanup();
    }
  });

  it('marks a run `failed` when every input errored and nothing was planned', async () => {
    const fixture = await makePlannableSource();
    try {
      planRunMock.mockResolvedValue({
        ...OUTCOME_BASE,
        errors: [
          { inputIndex: 0, message: 'listing capture failed: blocked' },
          { inputIndex: 1, message: 'listing capture failed: blocked' },
        ],
        inputs: [
          { inputIndex: 0, itemCount: 0, status: 'error' },
          { inputIndex: 1, itemCount: 0, status: 'error' },
        ],
      } satisfies PlanRunOutcome);

      const result = await caller.crawl.plan({ sourceId: fixture.sourceId });
      expect(result.status).toBe('failed');
      expect(result.itemCount).toBe(0);

      const run = await db.query.runs.findFirst({ where: eq(runs.id, result.runId) });
      expect(run?.status).toBe('failed');
      expect(run?.logs).toContain('input 0: listing capture failed: blocked');
      expect(run?.logs).toContain('input 1: listing capture failed: blocked');
      expect(run?.errorMessage).toBe('planning failed for all 2 input(s)');
    } finally {
      await fixture.cleanup();
    }
  });

  it('stays `planned` when some inputs errored but work was planned anyway', async () => {
    const fixture = await makePlannableSource();
    try {
      planRunMock.mockResolvedValue({
        ...OUTCOME_BASE,
        items: [
          { kind: 'detail', url: 'https://example.com/p/1', inputIndex: 0, inputValues: {}, listingValues: {}, pageNumber: 1 },
        ],
        errors: [{ inputIndex: 1, message: 'listing capture failed: blocked' }],
        inputs: [
          { inputIndex: 0, itemCount: 1, status: 'planned' },
          { inputIndex: 1, itemCount: 0, status: 'error' },
        ],
      } satisfies PlanRunOutcome);

      const result = await caller.crawl.plan({ sourceId: fixture.sourceId });
      expect(result.status).toBe('planned');
      const run = await db.query.runs.findFirst({ where: eq(runs.id, result.runId) });
      expect(run?.status).toBe('planned');
    } finally {
      await fixture.cleanup();
    }
  });

  it('inserts listing items already `done` and detail items `pending`', async () => {
    const fixture = await makePlannableSource();
    try {
      planRunMock.mockResolvedValue({
        ...OUTCOME_BASE,
        items: [
          { kind: 'listing', url: 'https://example.com/c/a', inputIndex: 0, inputValues: {}, listingValues: {}, pageNumber: 1 },
          { kind: 'listing', url: 'https://example.com/c/a?page=2', inputIndex: 0, inputValues: {}, listingValues: {}, pageNumber: 2 },
          { kind: 'detail', url: 'https://example.com/p/1', inputIndex: 0, inputValues: {}, listingValues: {}, pageNumber: 1 },
        ],
        inputs: [{ inputIndex: 0, itemCount: 1, status: 'planned' }],
      } satisfies PlanRunOutcome);

      const result = await caller.crawl.plan({ sourceId: fixture.sourceId });
      const items = await db.query.runItems.findMany({ where: eq(runItems.runId, result.runId) });

      const listing = items.filter((i) => i.kind === 'listing');
      const detail = items.filter((i) => i.kind === 'detail');
      expect(listing).toHaveLength(2);
      expect(detail).toHaveLength(1);
      // The listing page really WAS fetched and processed during planning, so
      // `done` is the truthful state — and phase 2 only ever claims `detail`.
      for (const item of listing) {
        expect(item.status).toBe('done');
        expect(item.completedAt).toBeInstanceOf(Date);
      }
      expect(detail[0]?.status).toBe('pending');
      expect(detail[0]?.completedAt).toBeNull();
    } finally {
      await fixture.cleanup();
    }
  });
});

describe('crawlRouter.items', () => {
  it('rejects a non-uuid runId', async () => {
    await expect(caller.crawl.items({ runId: 'nope' })).rejects.toThrow();
  });

  it('returns an empty work list for a run that has none', async () => {
    const result = await caller.crawl.items({ runId: '00000000-0000-0000-0000-000000000000' });
    // `running` is in the shape too, matching crawl.status — a reader that
    // reports per-status counts has to account for every status an item can
    // hold, or its numbers stop summing to the total it prints beside them.
    expect(result).toEqual({ items: [], counts: { listing: 0, detail: 0, pending: 0, running: 0, done: 0, failed: 0 } });
  });
});
