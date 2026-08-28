// packages/api/src/crawl/start-execution.test.ts
// `startExecution` itself hard-wires a real browser session and every other
// collaborator inline, so it is not unit-testable directly. `buildOnDone` is
// the one piece of decision logic it adds for the repair engine — pulled out
// so it can be exercised against stubbed `markItemDone`/`mergeBackfillResult`
// without a browser, an API key, or a database.
import { describe, it, expect, vi } from 'vitest';
import { buildOnDone } from './start-execution.js';

describe('buildOnDone', () => {
  it('calls only markItemDone when mergeToParent is not set', async () => {
    const markItemDone = vi.fn(async () => {});
    const mergeBackfillResult = vi.fn(async () => {});
    const onDone = buildOnDone({} as never, undefined, { markItemDone, mergeBackfillResult });

    await onDone('item-1', 'ext-1', { title: 'x' }, ['title']);

    expect(markItemDone).toHaveBeenCalledWith({}, 'item-1', 'ext-1');
    expect(mergeBackfillResult).not.toHaveBeenCalled();
  });

  it('calls only markItemDone when mergeToParent is explicitly false', async () => {
    const markItemDone = vi.fn(async () => {});
    const mergeBackfillResult = vi.fn(async () => {});
    const onDone = buildOnDone({} as never, false, { markItemDone, mergeBackfillResult });

    await onDone('item-1', 'ext-1', { title: 'x' }, ['title']);

    expect(markItemDone).toHaveBeenCalledWith({}, 'item-1', 'ext-1');
    expect(mergeBackfillResult).not.toHaveBeenCalled();
  });

  it('calls both markItemDone and mergeBackfillResult when mergeToParent is set', async () => {
    const markItemDone = vi.fn(async () => {});
    const mergeBackfillResult = vi.fn(async () => {});
    const onDone = buildOnDone({} as never, true, { markItemDone, mergeBackfillResult });

    await onDone('item-1', 'ext-1', { title: 'x' }, ['title']);

    expect(markItemDone).toHaveBeenCalledWith({}, 'item-1', 'ext-1');
    expect(mergeBackfillResult).toHaveBeenCalledWith({}, 'item-1', { title: 'x' }, ['title']);
  });

  it('defaults targetFields to [] for mergeBackfillResult when the item carried no focus', async () => {
    const markItemDone = vi.fn(async () => {});
    const mergeBackfillResult = vi.fn(async () => {});
    const onDone = buildOnDone({} as never, true, { markItemDone, mergeBackfillResult });

    await onDone('item-1', 'ext-1', { title: 'x' }, null);

    expect(mergeBackfillResult).toHaveBeenCalledWith({}, 'item-1', { title: 'x' }, []);
  });

  it('runs markItemDone before mergeBackfillResult, not concurrently', async () => {
    const order: string[] = [];
    const markItemDone = vi.fn(async () => { order.push('markItemDone'); });
    const mergeBackfillResult = vi.fn(async () => { order.push('mergeBackfillResult'); });
    const onDone = buildOnDone({} as never, true, { markItemDone, mergeBackfillResult });

    await onDone('item-1', 'ext-1', { title: 'x' }, ['title']);

    expect(order).toEqual(['markItemDone', 'mergeBackfillResult']);
  });
});
