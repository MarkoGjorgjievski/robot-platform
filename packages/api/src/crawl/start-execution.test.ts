// packages/api/src/crawl/start-execution.test.ts
// `startExecution` itself hard-wires a real browser session and every other
// collaborator inline, so it is not unit-testable directly. `buildOnDone` is
// the one piece of decision logic it adds for the repair engine — pulled out
// so it can be exercised against stubbed
// `markItemDone`/`markItemFailed`/`mergeBackfillResult` without a browser,
// an API key, or a database.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, orgs, projects, datasets, sources } from '@robot/db';
import { HARD_ITEM_CEILING, type VariantRunPlan } from '@robot/scraper';
import type { ClaimedItem } from './claim-item.js';
import type { ExecuteDeps } from './execute-run.js';
import type { Certification } from '../verify/current-certification.js';

// Task 2 (variants plan 3): `startExecution` loads the run's variant plan
// once, off the same certification, and must thread it through to
// `extractItem` as `deps.variantPlan`. Every collaborator `startExecution`
// hard-wires (the browser session, `executeRun`, `extractItem`, the
// certification/plan loaders) is mocked here so the wiring is checked
// without a browser, an API key, or a real run row — `executeRun` itself is
// mocked too, and its captured `extractItem` closure is invoked directly to
// see what it passes through.
const { executeRunMock, extractItemMock, loadCurrentCertificationMock, loadVariantRunPlanMock } = vi.hoisted(() => ({
  // Typed with real parameters (even though unused) so `.mock.calls[0][1]` carries the
  // `ExecuteDeps` type below, instead of inferring a zero-arg signature from `() => ...`.
  executeRunMock: vi.fn(async (_runId: string, _deps: import('./execute-run.js').ExecuteDeps, _opts?: { limit?: number }) =>
    ({ extracted: 0, failed: 0, recordingFailures: 0, cancelled: false, limitReached: false, status: 'completed' })),
  extractItemMock: vi.fn(async (..._args: unknown[]) => ({ row: {}, extractionId: null, targetFields: null })),
  loadCurrentCertificationMock: vi.fn(async (..._args: unknown[]) => null as import('../verify/current-certification.js').Certification | null),
  loadVariantRunPlanMock: vi.fn(async (..._args: unknown[]) => null as import('@robot/scraper').VariantRunPlan | null),
}));

vi.mock('./execute-run.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./execute-run.js')>();
  return { ...actual, executeRun: executeRunMock };
});
vi.mock('./extract-item.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./extract-item.js')>();
  return { ...actual, extractItem: extractItemMock };
});
vi.mock('../verify/current-certification.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../verify/current-certification.js')>();
  return { ...actual, loadCurrentCertification: loadCurrentCertificationMock };
});
vi.mock('./variant-run-plan.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./variant-run-plan.js')>();
  return { ...actual, loadVariantRunPlan: loadVariantRunPlanMock };
});
vi.mock('../browser-session.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../browser-session.js')>();
  return { ...actual, withBrowserSession: vi.fn(async (fn: (browser: unknown) => Promise<unknown>) => fn({} as never)) };
});

const { buildOnDone, buildFinalise, startExecution } = await import('./start-execution.js');

const dummyItem: ClaimedItem = {
  id: 'item-1', url: 'https://example.com/p/1', inputIndex: 0, inputValues: {}, listingValues: {}, pageNumber: null, attempts: 0, targetFields: null,
};

describe('buildOnDone', () => {
  it('calls only markItemDone when mergeToParent is not set', async () => {
    const markItemDone = vi.fn(async () => {});
    const markItemFailed = vi.fn(async () => {});
    const mergeBackfillResult = vi.fn(async () => {});
    const onDone = buildOnDone({} as never, undefined, { markItemDone, markItemFailed, mergeBackfillResult });

    await onDone('item-1', 'ext-1', { title: 'x' }, ['title']);

    expect(markItemDone).toHaveBeenCalledWith({}, 'item-1', 'ext-1');
    expect(mergeBackfillResult).not.toHaveBeenCalled();
    expect(markItemFailed).not.toHaveBeenCalled();
  });

  it('calls only markItemDone when mergeToParent is explicitly false', async () => {
    const markItemDone = vi.fn(async () => {});
    const markItemFailed = vi.fn(async () => {});
    const mergeBackfillResult = vi.fn(async () => {});
    const onDone = buildOnDone({} as never, false, { markItemDone, markItemFailed, mergeBackfillResult });

    await onDone('item-1', 'ext-1', { title: 'x' }, ['title']);

    expect(markItemDone).toHaveBeenCalledWith({}, 'item-1', 'ext-1');
    expect(mergeBackfillResult).not.toHaveBeenCalled();
    expect(markItemFailed).not.toHaveBeenCalled();
  });

  it('merges before marking done when mergeToParent is set, with the extractionId threaded through', async () => {
    const markItemDone = vi.fn(async () => {});
    const markItemFailed = vi.fn(async () => {});
    const mergeBackfillResult = vi.fn(async () => {});
    const onDone = buildOnDone({} as never, true, { markItemDone, markItemFailed, mergeBackfillResult });

    await onDone('item-1', 'ext-1', { title: 'x' }, ['title']);

    expect(mergeBackfillResult).toHaveBeenCalledWith({}, 'item-1', 'ext-1', { title: 'x' }, ['title']);
    expect(markItemDone).toHaveBeenCalledWith({}, 'item-1', 'ext-1');
    expect(markItemFailed).not.toHaveBeenCalled();
  });

  // R4 (fix round 2): merge and markDone are not atomic. Ordering must put the
  // merge first, so a crash between the two never leaves an item durably
  // `done` with its merge unlanded.
  it('runs mergeBackfillResult before markItemDone, not concurrently or reversed', async () => {
    const order: string[] = [];
    const markItemDone = vi.fn(async () => { order.push('markItemDone'); });
    const markItemFailed = vi.fn(async () => {});
    const mergeBackfillResult = vi.fn(async () => { order.push('mergeBackfillResult'); });
    const onDone = buildOnDone({} as never, true, { markItemDone, markItemFailed, mergeBackfillResult });

    await onDone('item-1', 'ext-1', { title: 'x' }, ['title']);

    expect(order).toEqual(['mergeBackfillResult', 'markItemDone']);
  });

  // Final review M4: the run's variant plan reaches the merge, so a repair can
  // clear `_variant_partial` on the rows it completed.
  it('threads the run\'s variant plan into mergeBackfillResult when there is one', async () => {
    const markItemDone = vi.fn(async () => {});
    const markItemFailed = vi.fn(async () => {});
    const mergeBackfillResult = vi.fn(async () => {});
    const variantPlan = { method: 'list' as const, entryPaths: {}, fromProduct: [], axes: [], fields: [] };
    const onDone = buildOnDone({} as never, true, { markItemDone, markItemFailed, mergeBackfillResult, variantPlan });

    await onDone('item-1', 'ext-1', { title: 'x' }, ['title']);

    expect(mergeBackfillResult).toHaveBeenCalledWith({}, 'item-1', 'ext-1', { title: 'x' }, ['title'], expect.objectContaining({ method: 'list' }));
  });

  it('defaults targetFields to [] for mergeBackfillResult when the item carried no focus', async () => {
    const markItemDone = vi.fn(async () => {});
    const markItemFailed = vi.fn(async () => {});
    const mergeBackfillResult = vi.fn(async () => {});
    const onDone = buildOnDone({} as never, true, { markItemDone, markItemFailed, mergeBackfillResult });

    await onDone('item-1', 'ext-1', { title: 'x' }, null);

    expect(mergeBackfillResult).toHaveBeenCalledWith({}, 'item-1', 'ext-1', { title: 'x' }, []);
  });

  // R4 (fix round 2, the High this test was written to close): a merge
  // failure must never leave the item marked done — that would report a
  // repair as successful having changed nothing on the parent it exists to
  // fix. Instead the item is marked failed, honestly, and becomes retryable
  // through the existing retryFailed flow.
  it('marks the item failed — never done — when the merge itself throws', async () => {
    const markItemDone = vi.fn(async () => {});
    const markItemFailed = vi.fn(async () => {});
    const mergeBackfillResult = vi.fn(async () => { throw new Error('constraint violation'); });
    const onDone = buildOnDone({} as never, true, { markItemDone, markItemFailed, mergeBackfillResult });

    await onDone('item-1', 'ext-1', { title: 'x' }, ['title']);

    expect(markItemFailed).toHaveBeenCalledWith({}, 'item-1', 'merge failed: constraint violation');
    expect(markItemDone).not.toHaveBeenCalled();
  });

  it('stringifies a non-Error merge rejection into the failure message rather than throwing', async () => {
    const markItemDone = vi.fn(async () => {});
    const markItemFailed = vi.fn(async () => {});
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    const mergeBackfillResult = vi.fn(async () => { throw 'plain string'; });
    const onDone = buildOnDone({} as never, true, { markItemDone, markItemFailed, mergeBackfillResult });

    await onDone('item-1', 'ext-1', { title: 'x' }, ['title']);

    expect(markItemFailed).toHaveBeenCalledWith({}, 'item-1', 'merge failed: plain string');
    expect(markItemDone).not.toHaveBeenCalled();
  });
});

// Fix round 1: drift bookkeeping must never change a run's status.
// `buildFinalise` mirrors `buildOnDone` above — pulled out of `startExecution`
// so it's testable against stubbed `finaliseRun`/`flagDrift` without a
// browser or a real database.
describe('buildFinalise', () => {
  const certification: Certification = {
    verificationId: 'v',
    completedAt: new Date(),
    paths: { price: [], sku: [] },
    concepts: { price: 'price', sku: 'sku' },
    hostname: 'shop.example.com',
  };

  it('calls only finaliseRun and returns its status when certification is null', async () => {
    const finaliseRunStub = vi.fn(async () => 'completed' as const);
    const flagDrift = vi.fn(async () => ({ keys: [] as string[], emptyShare: {} as Record<string, number> }));
    const finalise = buildFinalise({} as never, 'run-1', 'source-1', null, { finaliseRun: finaliseRunStub, flagDrift });

    const status = await finalise(10, false, false);

    expect(finaliseRunStub).toHaveBeenCalledWith({}, 'run-1', false, false);
    expect(flagDrift).not.toHaveBeenCalled();
    expect(status).toBe('completed');
  });

  it('flags drift with the certified keys once finaliseRun settles to a terminal status', async () => {
    const finaliseRunStub = vi.fn(async () => 'completed' as const);
    const flagDrift = vi.fn(async () => ({ keys: [] as string[], emptyShare: {} as Record<string, number> }));
    const finalise = buildFinalise({} as never, 'run-1', 'source-1', certification, { finaliseRun: finaliseRunStub, flagDrift });

    const status = await finalise(10, false, false);

    expect(flagDrift).toHaveBeenCalledOnce();
    expect(flagDrift).toHaveBeenCalledWith({}, 'run-1', 'source-1', ['price', 'sku']);
    expect(status).toBe('completed');
  });

  it('does not flag drift while the run is still extracting', async () => {
    const finaliseRunStub = vi.fn(async () => 'extracting' as const);
    const flagDrift = vi.fn(async () => ({ keys: [] as string[], emptyShare: {} as Record<string, number> }));
    const finalise = buildFinalise({} as never, 'run-1', 'source-1', certification, { finaliseRun: finaliseRunStub, flagDrift });

    const status = await finalise(10, false, false);

    expect(flagDrift).not.toHaveBeenCalled();
    expect(status).toBe('extracting');
  });

  it('swallows a flagDrift failure and still resolves to finaliseRun\'s status', async () => {
    const finaliseRunStub = vi.fn(async () => 'completed' as const);
    const flagDrift = vi.fn(async () => { throw new Error('boom'); });
    const finalise = buildFinalise({} as never, 'run-1', 'source-1', certification, { finaliseRun: finaliseRunStub, flagDrift });

    await expect(finalise(10, false, false)).resolves.toBe('completed');
  });

  // Drift repair Task 2 (spec D3): the repair check runs automatically when a run flags drift.
  it('starts a drift check with the run and each drifted field\'s empty share when drift is flagged', async () => {
    const finaliseRunStub = vi.fn(async () => 'completed' as const);
    const flagDrift = vi.fn(async () => ({ keys: ['price'], emptyShare: { price: 0.4 } }));
    const startDriftCheck = vi.fn(async () => ({ checkId: 'c', status: 'started' as const }));
    const finalise = buildFinalise({} as never, 'run-1', 'source-1', certification, { finaliseRun: finaliseRunStub, flagDrift, startDriftCheck });

    await expect(finalise(10, false, false)).resolves.toBe('completed');
    expect(startDriftCheck).toHaveBeenCalledOnce();
    expect(startDriftCheck).toHaveBeenCalledWith('source-1', 'run-1', { emptyShare: { price: 0.4 } });
  });

  it('starts no drift check when nothing drifted', async () => {
    const finaliseRunStub = vi.fn(async () => 'completed' as const);
    const flagDrift = vi.fn(async () => ({ keys: [] as string[], emptyShare: {} as Record<string, number> }));
    const startDriftCheck = vi.fn(async () => ({ checkId: 'c', status: 'started' as const }));
    const finalise = buildFinalise({} as never, 'run-1', 'source-1', certification, { finaliseRun: finaliseRunStub, flagDrift, startDriftCheck });

    await finalise(10, false, false);
    expect(startDriftCheck).not.toHaveBeenCalled();
  });

  it('a drift check that fails to start never changes the run\'s status', async () => {
    const finaliseRunStub = vi.fn(async () => 'partial' as const);
    const flagDrift = vi.fn(async () => ({ keys: ['price'], emptyShare: { price: 1 } }));
    const startDriftCheck = vi.fn(async () => { throw new Error('db down'); });
    const finalise = buildFinalise({} as never, 'run-1', 'source-1', certification, { finaliseRun: finaliseRunStub, flagDrift, startDriftCheck });

    await expect(finalise(10, false, false)).resolves.toBe('partial');
  });
});

describe('startExecution — variant plan wiring', () => {
  afterEach(() => {
    executeRunMock.mockClear();
    extractItemMock.mockClear();
    loadCurrentCertificationMock.mockReset();
    loadVariantRunPlanMock.mockReset();
  });

  // Real (non-existent) UUIDs: a certified Source makes startExecution also read
  // `schemaDefinition` straight off the `sources` table, which rejects a non-uuid id
  // before this wiring is even reached.
  const RUN_ID = '00000000-0000-0000-0000-00000000a001';
  const SOURCE_ID = '00000000-0000-0000-0000-00000000a002';

  it('loads the plan off the loaded certification and passes it to extractItem', async () => {
    const cert: Certification = { verificationId: 'v', completedAt: new Date(), paths: {}, concepts: {}, hostname: 'shop.example.com' };
    const plan: VariantRunPlan = { method: 'list', entryPaths: {}, fromProduct: [], axes: [], fields: [] };
    loadCurrentCertificationMock.mockResolvedValueOnce(cert);
    loadVariantRunPlanMock.mockResolvedValueOnce(plan);

    await startExecution(RUN_ID, SOURCE_ID, []);

    expect(loadVariantRunPlanMock).toHaveBeenCalledWith(db, SOURCE_ID, cert);
    expect(executeRunMock).toHaveBeenCalledTimes(1);
    const execDeps = executeRunMock.mock.calls[0]![1] as ExecuteDeps;
    await execDeps.extractItem(dummyItem);
    expect(extractItemMock).toHaveBeenCalledWith(db, dummyItem, expect.objectContaining({ variantPlan: plan }));
  });

  it('passes a null variant plan through unchanged when the certification carries none', async () => {
    loadCurrentCertificationMock.mockResolvedValueOnce(null);
    loadVariantRunPlanMock.mockResolvedValueOnce(null);

    await startExecution(RUN_ID, SOURCE_ID, []);

    const execDeps = executeRunMock.mock.calls[0]![1] as ExecuteDeps;
    await execDeps.extractItem(dummyItem);
    expect(extractItemMock).toHaveBeenCalledWith(db, dummyItem, expect.objectContaining({ variantPlan: null }));
  });

  // Budget option 1 (Marko, 2026-10-05): links-method variant pages are queued
  // against HARD_ITEM_CEILING, not the source's item budget — the website's
  // item budget counts products only; a product's variant pages ride along.
  it('passes HARD_ITEM_CEILING as the item cap to extractItem, not the source budget', async () => {
    const SLUG = 'test-start-execution-item-cap';
    const [org] = await db.insert(orgs).values({ name: SLUG, slug: SLUG }).returning();
    try {
      const [project] = await db.insert(projects).values({ orgId: org!.id, name: SLUG, slug: SLUG }).returning();
      const [dataset] = await db.insert(datasets).values({ projectId: project!.id, name: SLUG, slug: SLUG, schema: [] }).returning();
      const [source] = await db.insert(sources).values({ datasetId: dataset!.id, name: SLUG, slug: SLUG, country: 'US', budget: { max_items: 7 } }).returning();
      const cert: Certification = { verificationId: 'v', completedAt: new Date(), paths: {}, concepts: {}, hostname: 'shop.example.com' };
      loadCurrentCertificationMock.mockResolvedValueOnce(cert);
      loadVariantRunPlanMock.mockResolvedValueOnce({ method: 'links', collector: '//a/@href', entryPaths: {}, fromProduct: [], axes: [], fields: [] });

      await startExecution(RUN_ID, source!.id, []);

      const execDeps = executeRunMock.mock.calls[0]![1] as ExecuteDeps;
      await execDeps.extractItem(dummyItem);
      expect(extractItemMock).toHaveBeenCalledWith(db, dummyItem, expect.objectContaining({ itemCap: HARD_ITEM_CEILING }));
    } finally {
      await db.delete(orgs).where(eq(orgs.id, org!.id));
    }
  });
});
