import { describe, it, expect, afterEach, vi, afterAll } from 'vitest';
import { TRPCError } from '@trpc/server';
import { ZodError } from 'zod';
import { eq } from 'drizzle-orm';
import { db, sources, projects, datasets, inputSets, runs, runItems } from '@robot/db';
import type { PlanRunOutcome } from '@robot/scraper';
import { verdictSentence } from '@robot/browser';
import { PROBE_BUDGET } from '../crawl/probe.js';
import { signedInCaller } from '../test-helpers/identity.js';

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

// A throwaway signed-in identity: every customer procedure needs a session
// and works in its org only, so nothing here touches the seeded `default` org.
const me = await signedInCaller('crawl');
const caller = me.caller;
afterAll(async () => { await me.cleanup(); });

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
    // inputSetId is left null, which is exactly the precondition this test
    // exercises. The source sits in a dataset of the caller's org: a website
    // outside it is NOT_FOUND before any precondition is looked at.
    const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const [project] = await db.insert(projects).values({ orgId: me.session.org.id, name: 'x', slug: `crawl-noinput-${stamp}` }).returning({ id: projects.id });
    const [dataset] = await db.insert(datasets).values({ projectId: project!.id, name: 'x', slug: `crawl-noinput-${stamp}`, schema: [] }).returning({ id: datasets.id });
    const [source] = await db.insert(sources).values({
      datasetId: dataset!.id,
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

// ─── Task 13: the certification gate ────────────────────────────────────────

describe('crawlRouter.plan — certification gate', () => {
  it('refuses a full plan (probe: false) on a customer Source with no current certification', async () => {
    const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const org = me.session.org; // the signed-in caller's org: procedures only see their own
    const [project] = await db.insert(projects).values({ orgId: org!.id, name: 'x', slug: `crawl-cert-${stamp}` }).returning({ id: projects.id });
    const [dataset] = await db.insert(datasets).values({ projectId: project!.id, name: 'x', slug: `crawl-cert-${stamp}`, schema: [] }).returning({ id: datasets.id });
    const [source] = await db.insert(sources).values({
      datasetId: dataset!.id, name: 'x', slug: `crawl-cert-${stamp}`, country: 'us',
      schemaDefinition: [{ key: 'price', name: 'Price', type: 'money', description: 'x', concept: 'price' }],
    }).returning({ id: sources.id });
    try {
      await expect(caller.crawl.plan({ sourceId: source!.id, probe: false }))
        .rejects.toThrow(/Verify the schema before extracting/);
    } finally {
      await db.delete(sources).where(eq(sources.id, source!.id));
      await db.delete(projects).where(eq(projects.id, project!.id));
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
async function makePlannableSource(rows: Array<Record<string, unknown>> = [{ slug: 'a' }, { slug: 'b' }]) {
  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const org = me.session.org; // the signed-in caller's org: procedures only see their own
  const [project] = await db.insert(projects).values({ orgId: org!.id, name: 'crawl test', slug: `crawl-test-${stamp}` }).returning({ id: projects.id });
  const [inputSet] = await db.insert(inputSets).values({
    projectId: project!.id,
    type: 'category',
    name: 'crawl test inputs',
    columns: [{ name: 'slug', primary: true }],
    rows,
  }).returning({ id: inputSets.id });
  const [dataset] = await db.insert(datasets).values({ projectId: project!.id, name: 'crawl test', slug: `crawl-test-${stamp}`, schema: [] }).returning({ id: datasets.id });
  const [source] = await db.insert(sources).values({
    datasetId: dataset!.id,
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
      // What planRun now writes for a walled listing: the verdict's one
      // sentence, nothing in front of it (review I3, 2026-10-09).
      const refused = verdictSentence({ kind: 'refused', status: 403, vendor: 'cloudflare' }, 'https://example.com/c/a');
      planRunMock.mockResolvedValue({
        ...OUTCOME_BASE,
        errors: [
          { inputIndex: 0, message: refused },
          { inputIndex: 1, message: refused },
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
      expect(run?.logs).toContain(`input 0: ${refused}`);
      expect(run?.logs).toContain(`input 1: ${refused}`);
      // The first input's own reason, exactly the sentence the listing bar
      // shows, not a count (spec 2026-10-09 §A2).
      expect(run?.errorMessage).toBe("example.com refused the browser (HTTP 403, Cloudflare). We can't read this website from here yet.");
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

  it('probe: true slices to the first input row, substitutes PROBE_BUDGET, and labels the run `probe`', async () => {
    const fixture = await makePlannableSource([{ slug: 'a' }, { slug: 'b' }, { slug: 'c' }]);
    try {
      planRunMock.mockResolvedValue({
        ...OUTCOME_BASE,
        items: [
          { kind: 'detail', url: 'https://example.com/p/1', inputIndex: 0, inputValues: { slug: 'a' }, listingValues: {}, pageNumber: 1 },
        ],
        inputs: [{ inputIndex: 0, itemCount: 1, status: 'planned' }],
      } satisfies PlanRunOutcome);

      const result = await caller.crawl.plan({ sourceId: fixture.sourceId, probe: true });
      expect(result.status).toBe('planned');

      expect(planRunMock).toHaveBeenCalledTimes(1);
      const call = planRunMock.mock.calls[0]![0] as { source: { budget: unknown }; inputSet: { rows: unknown[] } };
      expect(call.inputSet.rows).toEqual([{ slug: 'a' }]);
      expect(call.source.budget).toEqual(PROBE_BUDGET);

      const run = await db.query.runs.findFirst({ where: eq(runs.id, result.runId) });
      expect(run?.inputLabel).toBe('probe');
    } finally {
      await fixture.cleanup();
    }
  });

  it('probe absent: plans every row against the source\'s own budget (regression lock)', async () => {
    const fixture = await makePlannableSource([{ slug: 'a' }, { slug: 'b' }, { slug: 'c' }]);
    try {
      planRunMock.mockResolvedValue({
        ...OUTCOME_BASE,
        items: [
          { kind: 'detail', url: 'https://example.com/p/1', inputIndex: 0, inputValues: { slug: 'a' }, listingValues: {}, pageNumber: 1 },
        ],
        inputs: [{ inputIndex: 0, itemCount: 1, status: 'planned' }],
      } satisfies PlanRunOutcome);

      const result = await caller.crawl.plan({ sourceId: fixture.sourceId });
      expect(result.status).toBe('planned');

      expect(planRunMock).toHaveBeenCalledTimes(1);
      const call = planRunMock.mock.calls[0]![0] as { source: { budget: unknown }; inputSet: { rows: unknown[] } };
      expect(call.inputSet.rows).toEqual([{ slug: 'a' }, { slug: 'b' }, { slug: 'c' }]);
      // The default `sources.budget` is `{}` — not PROBE_BUDGET — confirming
      // the source's own budget passed through untouched.
      expect(call.source.budget).toEqual({});

      const run = await db.query.runs.findFirst({ where: eq(runs.id, result.runId) });
      expect(run?.inputLabel).not.toBe('probe');
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
    const fixture = await makePlannableSource();
    const [run] = await db.insert(runs).values({ sourceId: fixture.sourceId, status: 'completed' }).returning({ id: runs.id });
    try {
      const result = await caller.crawl.items({ runId: run!.id });
      // `running` is in the shape too, matching crawl.status — a reader that
      // reports per-status counts has to account for every status an item can
      // hold, or its numbers stop summing to the total it prints beside them.
      expect(result).toEqual({ items: [], counts: { listing: 0, detail: 0, pending: 0, running: 0, done: 0, failed: 0 } });
    } finally { await fixture.cleanup(); }
  });

  it('is NOT_FOUND for a run id that does not exist', async () => {
    await expect(caller.crawl.items({ runId: '00000000-0000-0000-0000-000000000000' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  // Task 10 (repair-engine): the run page wires ResultsTable's absent-cell
  // rendering ("not on page") off this field — without it there is no way
  // to tell a confirmed-absent field apart from one that simply hasn't been
  // extracted yet.
  it('returns each item\'s absentFields', async () => {
    const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const org = me.session.org; // the signed-in caller's org: procedures only see their own
    const [project] = await db.insert(projects).values({ orgId: org!.id, name: 'x', slug: `crawl-items-${stamp}` }).returning({ id: projects.id });
    const [dataset] = await db.insert(datasets).values({ projectId: project!.id, name: 'x', slug: `crawl-items-${stamp}`, schema: [] }).returning({ id: datasets.id });
    const [source] = await db.insert(sources).values({
      datasetId: dataset!.id,
      name: 'crawl items test source', slug: `crawl-items-src-${stamp}`, country: 'us', isSandbox: true,
    }).returning({ id: sources.id });
    const [run] = await db.insert(runs).values({ sourceId: source!.id, status: 'completed' }).returning({ id: runs.id });
    await db.insert(runItems).values({
      runId: run!.id, kind: 'detail', url: 'https://example.com/p/1', status: 'done',
      absentFields: ['isbn'],
    });

    try {
      const result = await caller.crawl.items({ runId: run!.id });
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.absentFields).toEqual(['isbn']);
    } finally {
      await db.delete(sources).where(eq(sources.id, source!.id));
      await db.delete(projects).where(eq(projects.id, project!.id));
    }
  });
});
