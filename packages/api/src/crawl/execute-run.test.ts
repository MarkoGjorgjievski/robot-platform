// packages/api/src/crawl/execute-run.test.ts
import { describe, it, expect } from 'vitest';
import { executeRun, type ExecuteDeps } from './execute-run.js';
import { rollUpStatus } from './roll-up-run.js';
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
    // The stub answers with what production answers. `finaliseRun` reads the
    // item counts out of the DB and hands them to `rollUpStatus`; this harness
    // holds the same counts in memory (the queue is what is still pending), so
    // it calls the same function rather than inventing a status.
    //
    // It used to hard-code 'completed'. That is how the "claim throws" test
    // below came to assert a *green* outcome for a path that in production
    // leaves the run at 'extracting' with nothing running it — the stuck-run
    // state the dashboard could not act on. A stub that disagrees with
    // production doesn't test production; it describes a system nobody ships.
    finalise: async (rowCount, cancelled) => {
      finalRowCount = rowCount;
      return rollUpStatus(
        { pending: queue.length, running: 0, done: done.length, failed: failed.length },
        cancelled,
      );
    },
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
    // ...but what it writes is NOT a green terminal status. The item is still
    // pending and no cancel was requested, so `rollUpStatus` returns
    // 'extracting' — a run that looks live with nothing running it. This test
    // asserted 'completed' for nine tasks and three review rounds, purely
    // because the harness hard-coded that answer, and that false green is what
    // hid the dashboard trap: `isRunActive('extracting')` is true, so the Run
    // detail page offered Stop and nothing else, polled every 3s forever, and
    // the documented "call execute again" recovery was unreachable from the UI.
    expect(outcome.status).toBe('extracting');
    expect(outcome.status).not.toBe('completed');
  });

  // --- Finding 1: cancelling with pending work must settle to a status the
  // dashboard treats as inactive, not silently revert to 'extracting'. ---

  it('passes its own cancelled outcome to finalise, not re-derived from isCancelled', async () => {
    let seen = 0;
    let finaliseArgs: [number, boolean] | null = null;
    const h = harness({
      isCancelled: async () => seen >= 1,
      extractItem: async () => { seen++; return { row: {}, extractionId: null }; },
      finalise: async (rowCount, cancelled) => {
        finaliseArgs = [rowCount, cancelled];
        return cancelled ? 'cancelled' : 'completed';
      },
    }, [item('1'), item('2'), item('3')]);

    const outcome = await executeRun('run-1', h.deps);
    expect(outcome.cancelled).toBe(true);
    expect(finaliseArgs).toEqual([1, true]);
    expect(outcome.status).toBe('cancelled');
  });

  it('a cancelled run with remaining pending items ends at a status isRunActive treats as settled', async () => {
    // Dashboard contract (packages/dashboard/src/lib/run-progress.ts,
    // isRunActive): only 'extracting' and 'cancelling' are "active" — those are
    // the only statuses that keep the 3s poll going. If a cancel with pending
    // work left the run at either of those, Stop would never actually stop the
    // UI from polling forever. This is executeRun's half of that guarantee:
    // it must hand finalise a `cancelled` flag it can act on, not leave the
    // rollup stuck inferring 'extracting' from pending > 0 alone.
    const h = harness({
      isCancelled: async () => true,
      finalise: async (_rowCount, cancelled) => (cancelled ? 'cancelled' : 'extracting'),
    }, [item('1'), item('2')]);

    const outcome = await executeRun('run-1', h.deps);
    expect(outcome.cancelled).toBe(true);
    expect(h.done).toEqual([]); // pending work really is left unclaimed
    expect(['extracting', 'cancelling']).not.toContain(outcome.status);
    expect(outcome.status).toBe('cancelled');
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
