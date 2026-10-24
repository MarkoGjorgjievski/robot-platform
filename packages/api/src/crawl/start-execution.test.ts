// packages/api/src/crawl/start-execution.test.ts
// `startExecution` itself hard-wires a real browser session and every other
// collaborator inline, so it is not unit-testable directly. `buildOnDone` is
// the one piece of decision logic it adds for the repair engine — pulled out
// so it can be exercised against stubbed
// `markItemDone`/`markItemFailed`/`mergeBackfillResult` without a browser,
// an API key, or a database.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, orgs, projects, datasets, sources, captures, extractions, runs } from '@robot/db';
import { HARD_ITEM_CEILING, type VariantRunPlan } from '@robot/scraper';
import { CapReachedError, capLedgerOf, capJobsOpen } from '@robot/agent';
import { CAP_REACHED_MESSAGE } from '@robot/scraper/customer-copy';
import { signedInCaller } from '../test-helpers/identity.js';
import { createProjectWithSource } from '../test-helpers/customer-source.js';
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
  extractItemMock: vi.fn(async (..._args: unknown[]): Promise<{ row: Record<string, unknown>; extractionId: string | null; targetFields: string[] | null }> =>
    ({ row: {}, extractionId: null, targetFields: null })),
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

// Spec 2026-10-24 email §3.1: the executor's catch tells the owners of a failed run — spied on, the real body kept.
const { notifyRunFailedSpy } = vi.hoisted(() => ({ notifyRunFailedSpy: vi.fn() }));
vi.mock('../email/run-failed.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../email/run-failed.js')>();
  notifyRunFailedSpy.mockImplementation(actual.notifyRunFailed);
  return { notifyRunFailed: notifyRunFailedSpy };
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
    // sku passed by its default alone (spec 2026-10-13 §4): no path, so it never drifts.
    paths: { price: [{ source: 'api', path: 'item.price', transform: 'identity' }], sku: [] },
    defaults: { sku: 'SKU-0' },
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

  it('flags drift with the keys that have a certified path (the defaults ride along) once finaliseRun settles to a terminal status', async () => {
    const finaliseRunStub = vi.fn(async () => 'completed' as const);
    const flagDrift = vi.fn(async () => ({ keys: [] as string[], emptyShare: {} as Record<string, number> }));
    const finalise = buildFinalise({} as never, 'run-1', 'source-1', certification, { finaliseRun: finaliseRunStub, flagDrift });

    const status = await finalise(10, false, false);

    expect(flagDrift).toHaveBeenCalledOnce();
    expect(flagDrift).toHaveBeenCalledWith({}, 'run-1', 'source-1', ['price'], ['sku']);
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

  it('queues the run delivery once the run settles (spec 2026-10-24 §3.3), never while extracting', async () => {
    const enqueueDelivery = vi.fn(async () => 'job-1');
    const settled = buildFinalise({} as never, 'run-1', 'source-1', null, { finaliseRun: vi.fn(async () => 'partial' as const), enqueueDelivery });
    expect(await settled(3, false, true)).toBe('partial');
    expect(enqueueDelivery).toHaveBeenCalledWith({}, 'run-1');
    const going = buildFinalise({} as never, 'run-2', 'source-1', null, { finaliseRun: vi.fn(async () => 'extracting' as const), enqueueDelivery });
    await going(3, false, false);
    expect(enqueueDelivery).toHaveBeenCalledTimes(1);
  });

  it('a delivery that cannot be queued never changes the run’s status', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const finalise = buildFinalise({} as never, 'run-1', 'source-1', null, {
      finaliseRun: vi.fn(async () => 'completed' as const),
      enqueueDelivery: vi.fn(async () => { throw new Error('db down'); }),
    });
    expect(await finalise(3, false, false)).toBe('completed');
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });
  it('a failed run tells its owners and admins (spec 2026-10-24 email §3.1); any other status does not', async () => {
    const notifyFailed = vi.fn(async () => 1);
    const finalise = (status: 'failed' | 'completed' | 'partial' | 'cancelled' | 'extracting') =>
      buildFinalise({} as never, 'run-1', 'source-1', null, { finaliseRun: vi.fn(async () => status), enqueueDelivery: vi.fn(async () => null), notifyFailed });
    expect(await finalise('failed')(0, false, false)).toBe('failed');
    expect(notifyFailed).toHaveBeenCalledWith({}, 'run-1');
    for (const s of ['completed', 'partial', 'cancelled', 'extracting'] as const) await finalise(s)(0, false, false);
    expect(notifyFailed).toHaveBeenCalledTimes(1);
  });

  it('a notice that cannot be queued never changes the run’s status', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const finalise = buildFinalise({} as never, 'run-1', 'source-1', null, {
      finaliseRun: vi.fn(async () => 'failed' as const), enqueueDelivery: vi.fn(async () => null), notifyFailed: vi.fn(async () => { throw new Error('db down'); }),
    });
    expect(await finalise(0, false, false)).toBe('failed');
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
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

  // Final review I1: a website with variants runs today's capture throughout; one without starts lean.
  it('a certified run with a variant plan gets a lean state that is full from the start (variants); without one, lean', async () => {
    const cert: Certification = { verificationId: 'v', completedAt: new Date(), paths: {}, concepts: {}, hostname: 'shop.example.com' };
    const plan: VariantRunPlan = { method: 'links', collector: '//a/@href', entryPaths: {}, fromProduct: [], axes: [], fields: [] };
    loadCurrentCertificationMock.mockResolvedValueOnce(cert);
    loadVariantRunPlanMock.mockResolvedValueOnce(plan);
    await startExecution(RUN_ID, SOURCE_ID, []);
    await (executeRunMock.mock.calls[0]![1] as ExecuteDeps).extractItem(dummyItem);
    expect(extractItemMock).toHaveBeenLastCalledWith(db, dummyItem, expect.objectContaining({ lean: expect.objectContaining({ mode: 'full', why: 'variants' }) }));

    loadCurrentCertificationMock.mockResolvedValueOnce(cert);
    loadVariantRunPlanMock.mockResolvedValueOnce(null);
    await startExecution(RUN_ID, SOURCE_ID, []);
    await (executeRunMock.mock.calls[1]![1] as ExecuteDeps).extractItem(dummyItem);
    expect(extractItemMock).toHaveBeenLastCalledWith(db, dummyItem, expect.objectContaining({ lean: expect.objectContaining({ mode: 'lean', why: null }) }));
  });

  it('logs the run\'s lean summary even when the loop throws', async () => {
    const cert: Certification = { verificationId: 'v', completedAt: new Date(), paths: {}, concepts: {}, hostname: 'shop.example.com' };
    loadCurrentCertificationMock.mockResolvedValueOnce(cert);
    loadVariantRunPlanMock.mockResolvedValueOnce(null);
    executeRunMock.mockImplementationOnce(async () => { throw new Error('boom'); });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await startExecution(RUN_ID, SOURCE_ID, []);
      expect(log).toHaveBeenCalledWith(`[crawl] run ${RUN_ID}: lean 0, lean+full 0 (check 0, miss 0, unshown 0, verdict 0), full 0`);
    } finally {
      log.mockRestore();
      err.mockRestore();
    }
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

describe('startExecution — inside a run job (spec 2026-10-23 §4.4)', () => {
  afterEach(() => {
    executeRunMock.mockReset();
    executeRunMock.mockImplementation(async () => ({ extracted: 0, failed: 0, recordingFailures: 0, cancelled: false, limitReached: false, status: 'completed' }));
    loadCurrentCertificationMock.mockReset();
    loadVariantRunPlanMock.mockReset();
  });
  const RUN_ID = '00000000-0000-0000-0000-00000000a003';
  const SOURCE_ID = '00000000-0000-0000-0000-00000000a004';
  const NO_ITEM = '00000000-0000-0000-0000-00000000a005';

  it('reports progress after each recorded item and hands the loop the abort', async () => {
    const onItem = vi.fn();
    let stop = false;
    await startExecution(RUN_ID, SOURCE_ID, [], undefined, { hooks: { onItem, aborted: () => stop } });
    const execDeps = executeRunMock.mock.calls[0]![1] as ExecuteDeps;
    await execDeps.onDone(NO_ITEM, null, {}, null);
    await execDeps.onFailed(NO_ITEM, 'blocked');
    expect(onItem).toHaveBeenCalledTimes(2);
    expect(execDeps.aborted!()).toBe(false);
    stop = true;
    expect(execDeps.aborted!()).toBe(true);
  });

  it('final review I2: two runs at once each record only their own model calls', async () => {
    const { recordUsage } = await import('@robot/agent');
    const [a] = await db.insert(runs).values({ status: 'extracting', inputLabel: 'cost-conc-a' }).returning({ id: runs.id });
    const [b] = await db.insert(runs).values({ status: 'extracting', inputLabel: 'cost-conc-b' }).returning({ id: runs.id });
    const tick = () => new Promise((r) => setTimeout(r, 5));
    try {
      // A's loop makes one model call, B's three, interleaved; each bills $0.06 (10k in, 2k out on claude-sonnet-5).
      executeRunMock.mockImplementation(async (runId: unknown) => {
        for (let i = 0; i < (runId === a!.id ? 1 : 3); i++) { await tick(); recordUsage('claude-sonnet-5', { input_tokens: 10_000, output_tokens: 2_000 }); }
        await tick();
        return { extracted: 0, failed: 0, recordingFailures: 0, cancelled: false, limitReached: false, status: 'completed' };
      });
      await Promise.all([startExecution(a!.id, SOURCE_ID, []), startExecution(b!.id, SOURCE_ID, [])]);
      const cost = async (id: string) => (await db.query.runs.findFirst({ where: eq(runs.id, id), columns: { costUsd: true } }))!.costUsd;
      expect(await cost(a!.id)).toBe('0.0600');
      expect(await cost(b!.id)).toBe('0.1800');
    } finally { await db.delete(runs).where(eq(runs.id, a!.id)); await db.delete(runs).where(eq(runs.id, b!.id)); }
  });

  it('without hooks the loop has no abort', async () => {
    await startExecution(RUN_ID, SOURCE_ID, []);
    expect((executeRunMock.mock.calls[0]![1] as ExecuteDeps).aborted).toBeUndefined();
  });

  it('an execution that throws after its attempt was stopped leaves the run for the retry, not failed', async () => {
    const { createTestSource, deleteTestSource } = await import('../test-helpers/source.js');
    const { runs } = await import('@robot/db');
    const sourceId = await createTestSource({ schema: [] });
    try {
      const [run] = await db.insert(runs).values({ sourceId, status: 'extracting' }).returning();
      executeRunMock.mockImplementationOnce(async () => { throw new Error('Target page, context or browser has been closed'); });
      await startExecution(run!.id, sourceId, [], undefined, { hooks: { aborted: () => true } });
      expect((await db.query.runs.findFirst({ where: eq(runs.id, run!.id) }))!.status).toBe('extracting');

      executeRunMock.mockImplementationOnce(async () => { throw new Error('boom'); });
      await startExecution(run!.id, sourceId, [], undefined, { hooks: { aborted: () => false } });
      expect((await db.query.runs.findFirst({ where: eq(runs.id, run!.id) }))!.status).toBe('failed');
    } finally {
      await deleteTestSource(sourceId);
    }
  });

  it('an execution that throws closes the run failed with its rows counted, and a run with rows gets its delivery (final review I1)', async () => {
    const { createTestSource, deleteTestSource } = await import('../test-helpers/source.js');
    const { seedUnshownRun } = await import('../test-helpers/seed-unshown-run.js');
    const { jobsOf } = await import('../test-helpers/jobs.js');
    const { runs, jobs } = await import('@robot/db');
    const sourceId = await createTestSource({ schema: [] });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    let runId = '';
    try {
      await db.update(sources).set({ schedule: { days: [1], time: '06:00', timeZone: 'UTC' } }).where(eq(sources.id, sourceId));
      runId = await seedUnshownRun(sourceId, { items: [
        { url: 'https://test-throw.example.com/p/1', row: { price: '1.00' } },
        { url: 'https://test-throw.example.com/p/2', row: { price: '2.00' } },
      ] });
      await db.update(runs).set({ status: 'extracting', resultCount: 0, completedAt: null }).where(eq(runs.id, runId));
      executeRunMock.mockImplementationOnce(async () => { throw new Error('boom'); });
      await startExecution(runId, sourceId, [], undefined, { hooks: { aborted: () => false } });
      expect(await db.query.runs.findFirst({ where: eq(runs.id, runId), columns: { status: true, resultCount: true } })).toEqual({ status: 'failed', resultCount: 2 });
      expect((await jobsOf('run-delivery')).find((j) => j.key === `run-delivery:${runId}`)).toMatchObject({ status: 'queued', payload: { runId } });
      expect(notifyRunFailedSpy).toHaveBeenCalledWith(db, runId);

    } finally {
      errors.mockRestore();
      if (runId) await db.delete(jobs).where(eq(jobs.key, `run-delivery:${runId}`));
      await deleteTestSource(sourceId);
    }
  });
});

describe('startExecution — the monthly limit on a legacy website (spec 2026-10-24 metering §2.3)', () => {
  afterEach(() => {
    executeRunMock.mockClear();
    extractItemMock.mockReset();
    extractItemMock.mockImplementation(async () => ({ row: {}, extractionId: null, targetFields: null }));
    loadCurrentCertificationMock.mockReset();
    loadVariantRunPlanMock.mockReset();
  });

  /** A legacy website of a throwaway org at its limit, with one run, one capture and one kept extraction. */
  async function cappedSite(tag: string) {
    const me = await signedInCaller(tag);
    const site = await createProjectWithSource(me.caller, { tag, fields: [{ name: 'Title', type: 'text' }] });
    await db.update(orgs).set({ aiCapUsd: '0.00' }).where(eq(orgs.id, me.org.id));
    const [run] = await db.insert(runs).values({ sourceId: site.sourceId, status: 'extracting' }).returning({ id: runs.id });
    const [cap] = await db.insert(captures).values({ sourceId: site.sourceId, runId: run!.id, url: site.urls[0]! }).returning({ id: captures.id });
    const [ext] = await db.insert(extractions).values({ sourceId: site.sourceId, captureId: cap!.id, runId: run!.id, data: [{ title: 'x' }], rowCount: 1 }).returning({ id: extractions.id });
    return { site, runId: run!.id, extractionId: ext!.id, cleanup: async () => { await site.cleanup(); await me.cleanup(); } };
  }
  const extractionExists = async (id: string) => (await db.query.extractions.findFirst({ where: eq(extractions.id, id) })) !== undefined;

  it('an item whose model call the limit refused fails with the sentence and keeps no row; the breaker is wired', async () => {
    const t = await cappedSite('start-exec-cap');
    try {
      // The legacy chain swallows a failed model step and returns what it read mechanically.
      extractItemMock.mockImplementation(async (_db: unknown, _item: unknown, deps: unknown) => {
        await (deps as { agent: { generateSelectors: () => Promise<unknown> } }).agent.generateSelectors().catch(() => undefined);
        return { row: { title: 'x' }, extractionId: t.extractionId, targetFields: null };
      });

      await startExecution(t.runId, t.site.sourceId, []);
      const deps = executeRunMock.mock.calls[0]![1] as ExecuteDeps;
      await expect(deps.extractItem(dummyItem)).rejects.toThrow(CAP_REACHED_MESSAGE);
      expect(await extractionExists(t.extractionId)).toBe(false);
      await expect(deps.extractItem(dummyItem)).rejects.toBeInstanceOf(CapReachedError);
      expect(deps.stopForCap).toBeTypeOf('function');
      // The run's slot is released once its cost is recorded.
      expect(capJobsOpen()).toBe(0);
    } finally {
      await t.cleanup();
    }
  });

  it('a refusal that escapes the chain fails the item with the sentence, not the internal text', async () => {
    const t = await cappedSite('start-exec-cap-throw');
    try {
      extractItemMock.mockImplementation(async (_db: unknown, _item: unknown, deps: unknown) => {
        await (deps as { agent: { generateSelectors: () => Promise<unknown> } }).agent.generateSelectors();
        return { row: {}, extractionId: null, targetFields: null };
      });
      await startExecution(t.runId, t.site.sourceId, []);
      const deps = executeRunMock.mock.calls[0]![1] as ExecuteDeps;
      await expect(deps.extractItem(dummyItem)).rejects.toThrow(CAP_REACHED_MESSAGE);
    } finally {
      await t.cleanup();
    }
  });

  it('only the catalogue enrichment refused: the page needed no AI, so the item and its row are kept (spec §3.2)', async () => {
    const t = await cappedSite('start-exec-cap-catalogue');
    try {
      // The chain read every field mechanically; the optional catalogue discovery after it was refused and swallowed.
      extractItemMock.mockImplementation(async (_db: unknown, _item: unknown, deps: unknown) => {
        const reserve = (deps as { reserveAiCall?: () => void }).reserveAiCall!;
        expect(() => reserve()).toThrow(CapReachedError);
        return { row: { title: 'x' }, extractionId: t.extractionId, targetFields: null };
      });
      await startExecution(t.runId, t.site.sourceId, []);
      const deps = executeRunMock.mock.calls[0]![1] as ExecuteDeps;
      await expect(deps.extractItem(dummyItem)).resolves.toMatchObject({ extractionId: t.extractionId });
      expect(await extractionExists(t.extractionId)).toBe(true);
    } finally {
      await t.cleanup();
    }
  });

  it('a certified website is untouched: its agent is not limited and nothing is reserved', async () => {
    const t = await cappedSite('start-exec-cap-certified');
    try {
      const cert: Certification = { verificationId: 'v', completedAt: new Date(), paths: {}, concepts: {}, hostname: 'shop.example.com' };
      loadCurrentCertificationMock.mockResolvedValueOnce(cert);
      loadVariantRunPlanMock.mockResolvedValueOnce(null);
      extractItemMock.mockResolvedValue({ row: { title: 'x' }, extractionId: t.extractionId, targetFields: null });
      await startExecution(t.runId, t.site.sourceId, []);
      const deps = executeRunMock.mock.calls[0]![1] as ExecuteDeps;
      await expect(deps.extractItem(dummyItem)).resolves.toMatchObject({ extractionId: t.extractionId });
      const passed = extractItemMock.mock.calls[0]![2] as { agent: object; reserveAiCall?: unknown };
      expect(capLedgerOf(passed.agent)).toBeUndefined();
      expect(passed.reserveAiCall).toBeUndefined();
      expect(await extractionExists(t.extractionId)).toBe(true);
    } finally {
      await t.cleanup();
    }
  });

  it('an item that makes no model call is untouched: no refusal, no row deleted', async () => {
    extractItemMock.mockResolvedValue({ row: {}, extractionId: null, targetFields: null });
    await startExecution('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000a002', []);
    const deps = executeRunMock.mock.calls[0]![1] as ExecuteDeps;
    await expect(deps.extractItem(dummyItem)).resolves.toEqual({ row: {}, extractionId: null, targetFields: null });
  });
});
