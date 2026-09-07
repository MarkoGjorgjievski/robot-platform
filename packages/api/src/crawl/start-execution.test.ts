// packages/api/src/crawl/start-execution.test.ts
// `startExecution` itself hard-wires a real browser session and every other
// collaborator inline, so it is not unit-testable directly. `buildOnDone` is
// the one piece of decision logic it adds for the repair engine — pulled out
// so it can be exercised against stubbed
// `markItemDone`/`markItemFailed`/`mergeBackfillResult` without a browser,
// an API key, or a database.
import { describe, it, expect, vi } from 'vitest';
import { buildOnDone, buildFinalise } from './start-execution.js';
import type { Certification } from '../verify/current-certification.js';

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
    const flagDrift = vi.fn(async () => []);
    const finalise = buildFinalise({} as never, 'run-1', 'source-1', null, { finaliseRun: finaliseRunStub, flagDrift });

    const status = await finalise(10, false, false);

    expect(finaliseRunStub).toHaveBeenCalledWith({}, 'run-1', false, false);
    expect(flagDrift).not.toHaveBeenCalled();
    expect(status).toBe('completed');
  });

  it('flags drift with the certified keys once finaliseRun settles to a terminal status', async () => {
    const finaliseRunStub = vi.fn(async () => 'completed' as const);
    const flagDrift = vi.fn(async () => []);
    const finalise = buildFinalise({} as never, 'run-1', 'source-1', certification, { finaliseRun: finaliseRunStub, flagDrift });

    const status = await finalise(10, false, false);

    expect(flagDrift).toHaveBeenCalledOnce();
    expect(flagDrift).toHaveBeenCalledWith({}, 'run-1', 'source-1', ['price', 'sku']);
    expect(status).toBe('completed');
  });

  it('does not flag drift while the run is still extracting', async () => {
    const finaliseRunStub = vi.fn(async () => 'extracting' as const);
    const flagDrift = vi.fn(async () => []);
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
});
