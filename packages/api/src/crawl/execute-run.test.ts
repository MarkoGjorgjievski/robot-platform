// packages/api/src/crawl/execute-run.test.ts
import { describe, it, expect } from 'vitest';
import { executeRun, type ExecuteDeps } from './execute-run.js';
import type { ClaimedItem } from './claim-item.js';

const item = (id: string): ClaimedItem => ({
  id, url: `https://example.com/p/${id}`, inputIndex: 0,
  inputValues: {}, listingValues: {}, pageNumber: 1, attempts: 1,
});

function harness(overrides: Partial<ExecuteDeps> = {}, queue: ClaimedItem[] = []) {
  const done: string[] = [];
  const failed: Array<{ id: string; message: string }> = [];
  let finalRowCount = -1;
  const deps: ExecuteDeps = {
    claim: async () => queue.shift() ?? null,
    extractItem: async (i) => ({ row: { title: `row ${i.id}` }, extractionId: `x-${i.id}` }),
    onDone: async (id) => { done.push(id); },
    onFailed: async (id, message) => { failed.push({ id, message }); },
    isCancelled: async () => false,
    finalise: async (rowCount) => { finalRowCount = rowCount; return 'completed'; },
    ...overrides,
  };
  return { deps, done, failed, rowCount: () => finalRowCount };
}

describe('executeRun', () => {
  it('works through every pending item', async () => {
    const h = harness({}, [item('1'), item('2'), item('3')]);
    const outcome = await executeRun('run-1', h.deps);
    expect(h.done).toEqual(['1', '2', '3']);
    expect(outcome.extracted).toBe(3);
  });

  it('keeps going when one item throws, and records why', async () => {
    // Anti-bot blocks one page in a run of hundreds. Losing the other 299 to it
    // would be the worst possible failure mode.
    const h = harness({
      extractItem: async (i) => {
        if (i.id === '2') throw new Error('blocked: captcha');
        return { row: { title: i.id }, extractionId: null };
      },
    }, [item('1'), item('2'), item('3')]);

    const outcome = await executeRun('run-1', h.deps);
    expect(h.done).toEqual(['1', '3']);
    expect(h.failed).toEqual([{ id: '2', message: 'blocked: captcha' }]);
    expect(outcome.extracted).toBe(2);
    expect(outcome.failed).toBe(1);
  });

  it('stops between items when the run is cancelled, leaving the rest pending', async () => {
    let seen = 0;
    const h = harness({
      isCancelled: async () => seen >= 2,
      extractItem: async () => { seen++; return { row: {}, extractionId: null }; },
    }, [item('1'), item('2'), item('3'), item('4')]);

    const outcome = await executeRun('run-1', h.deps);
    expect(outcome.cancelled).toBe(true);
    expect(h.done).toEqual(['1', '2']);
  });

  it('checks for cancellation before doing any work at all', async () => {
    let claimCalls = 0;
    const h = harness({
      isCancelled: async () => true,
      claim: async () => { claimCalls++; return null; },
    }, [item('1')]);
    const outcome = await executeRun('run-1', h.deps);
    expect(outcome.cancelled).toBe(true);
    expect(h.done).toEqual([]);
    // Finding 3: a cancelled-before-start run must never even ask for work.
    expect(claimCalls).toBe(0);
  });

  it('finalises with the number of rows actually extracted', async () => {
    const h = harness({}, [item('1'), item('2')]);
    await executeRun('run-1', h.deps);
    expect(h.rowCount()).toBe(2);
  });

  it('finalises even when every item failed', async () => {
    const h = harness({
      extractItem: async () => { throw new Error('nope'); },
    }, [item('1'), item('2')]);
    const outcome = await executeRun('run-1', h.deps);
    expect(outcome.failed).toBe(2);
    expect(h.rowCount()).toBe(0);
  });

  it('does nothing gracefully when the queue is already empty', async () => {
    const h = harness({}, []);
    const outcome = await executeRun('run-1', h.deps);
    expect(outcome).toMatchObject({ extracted: 0, failed: 0, cancelled: false });
  });

  it('surfaces a failure whose error is not an Error object', async () => {
    const h = harness({
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      extractItem: async () => { throw 'plain string'; },
    }, [item('1')]);
    await executeRun('run-1', h.deps);
    expect(h.failed[0]?.message).toContain('plain string');
  });

  // --- Fix round 1: recording-path failures must never kill the loop or skip finalise. ---

  it('keeps going when onFailed itself throws, and counts a recording failure', async () => {
    const attempted: string[] = [];
    const h = harness({
      extractItem: async (i) => {
        if (i.id === '2') throw new Error('blocked: captcha');
        return { row: { title: i.id }, extractionId: null };
      },
      onFailed: async (id) => {
        attempted.push(id);
        throw new Error('db blip while recording failure');
      },
    }, [item('1'), item('2'), item('3')]);

    const outcome = await executeRun('run-1', h.deps);
    // Item 2's genuine extraction failure couldn't even be recorded — the loop
    // must still reach items 1 and 3.
    expect(h.done).toEqual(['1', '3']);
    expect(attempted).toEqual(['2']);
    expect(outcome.extracted).toBe(2);
    expect(outcome.failed).toBe(0);
    expect(outcome.recordingFailures).toBe(1);
    expect(h.rowCount()).toBe(2);
  });

  it('counts an onDone failure as a recording failure, not an extraction failure', async () => {
    const attempted: string[] = [];
    const h = harness({
      onDone: async (id) => {
        attempted.push(id);
        throw new Error('write conflict');
      },
    }, [item('1'), item('2')]);

    const outcome = await executeRun('run-1', h.deps);
    expect(attempted).toEqual(['1', '2']);
    // Genuinely scraped rows that failed to be marked done are not the same
    // thing as a blocked page — they must not inflate `failed`.
    expect(outcome.extracted).toBe(0);
    expect(outcome.failed).toBe(0);
    expect(outcome.recordingFailures).toBe(2);
    expect(h.rowCount()).toBe(0);
  });

  it('exits the loop and still finalises when claim throws', async () => {
    const h = harness({
      claim: async () => { throw new Error('pool exhausted'); },
    }, [item('1')]);

    const outcome = await executeRun('run-1', h.deps);
    expect(h.done).toEqual([]);
    expect(outcome.extracted).toBe(0);
    expect(outcome.failed).toBe(0);
    // finalise must still run: crawl.status, the dashboard and the export all
    // read the run row, and an un-finalised run is invisible to every reader.
    expect(h.rowCount()).toBe(0);
    expect(outcome.status).toBe('completed');
  });

  it('keeps going when isCancelled itself throws, treating it as not cancelled', async () => {
    const h = harness({
      isCancelled: async () => { throw new Error('flaky cancel check'); },
    }, [item('1'), item('2')]);

    const outcome = await executeRun('run-1', h.deps);
    // A broken cancel check must never stop a working run.
    expect(h.done).toEqual(['1', '2']);
    expect(outcome.cancelled).toBe(false);
    expect(outcome.extracted).toBe(2);
  });
});
