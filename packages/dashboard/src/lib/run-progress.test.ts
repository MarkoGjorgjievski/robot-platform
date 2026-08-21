import { describe, it, expect } from 'vitest';
import { progressLabel, isRunActive, runControls, extractButtonLabel, type RunCounts } from './run-progress';

describe('progressLabel', () => {
  it('counts what is finished against what was planned', () => {
    expect(progressLabel({ pending: 3, running: 1, done: 6, failed: 0, listing: 1, detail: 10 }, 'extracting'))
      .toBe('6 of 10 extracted');
  });

  it('names failures, which are the reason to look', () => {
    expect(progressLabel({ pending: 0, running: 0, done: 8, failed: 2, listing: 1, detail: 10 }, 'partial'))
      .toBe('8 of 10 extracted · 2 failed');
  });

  it('says a plan is waiting when nothing has run yet', () => {
    expect(progressLabel({ pending: 10, running: 0, done: 0, failed: 0, listing: 1, detail: 10 }, 'planned'))
      .toBe('10 URLs planned, not yet extracted');
  });

  it('reports a cancelled run as stopped rather than finished', () => {
    expect(progressLabel({ pending: 4, running: 0, done: 6, failed: 0, listing: 1, detail: 10 }, 'cancelled'))
      .toBe('Stopped after 6 of 10');
  });
});

describe('isRunActive', () => {
  it('is true while work is in flight, so the UI keeps polling', () => {
    expect(isRunActive('extracting')).toBe(true);
    expect(isRunActive('cancelling')).toBe(true);
  });

  it('is false once the run has settled', () => {
    expect(isRunActive('completed')).toBe(false);
    expect(isRunActive('partial')).toBe(false);
    expect(isRunActive('planned')).toBe(false);
  });
});

describe('runControls', () => {
  const counts = (over: Partial<RunCounts> = {}): RunCounts =>
    ({ pending: 0, running: 0, done: 0, failed: 0, listing: 1, detail: 8, ...over });

  it('offers Extract on a run stuck at extracting with nothing running it', () => {
    // The trap this replaces: the page rendered Stop and NOTHING else whenever
    // isRunActive, so a run sitting at 'extracting' with no loop behind it
    // showed one button, polled every 3s forever, and the documented recovery
    // ("call execute again") was unreachable from the UI. Reachable without
    // any restart: execute-run.ts breaks its loop when claim throws, and the
    // finally then finalises a run with pending work to 'extracting'.
    expect(runControls('extracting', counts({ pending: 3, done: 5 })).showExtract).toBe(true);
  });

  it('offers Extract on a run stuck at cancelling — Stop must not be a one-way door', () => {
    // Clicking Stop on an already-stalled run writes 'cancelling', which
    // isRunActive also treats as active and which nothing alive will ever
    // finalise. If Extract vanished here, Stop would make the trap permanent.
    expect(runControls('cancelling', counts({ pending: 3, done: 5 })).showExtract).toBe(true);
  });

  it('keeps Stop available while the run is active', () => {
    expect(runControls('extracting', counts({ pending: 3 })).showStop).toBe(true);
    expect(runControls('cancelling', counts({ pending: 3 })).showStop).toBe(true);
  });

  it('hides Stop once the run has settled — there is nothing left to stop', () => {
    expect(runControls('partial', counts({ failed: 2, done: 6 })).showStop).toBe(false);
    expect(runControls('completed', counts({ done: 8 })).showStop).toBe(false);
  });

  it('hides Extract on a settled run with nothing pending — there is nothing left to do', () => {
    expect(runControls('completed', counts({ done: 8 })).showExtract).toBe(false);
    expect(runControls('partial', counts({ done: 6, failed: 2 })).showExtract).toBe(false);
    expect(runControls('cancelled', counts({ done: 3 })).showExtract).toBe(false);
  });

  it('offers Extract on an active run whose items are ALL finished', () => {
    // The last row of the trap table, and the only combination the
    // counts-based rule left stranded: pending 0, running 0, failed 0, status
    // still active. An api-server killed between the final markItemDone and
    // finaliseRun leaves exactly this — every item `done`, the run row never
    // rolled up. Keying Extract off the counts alone offered Stop and nothing
    // else here, which is the original trap verbatim: Stop writes `cancelling`
    // that no loop will ever observe. One execute settles the run instead.
    expect(runControls('extracting', counts({ pending: 0, running: 0, failed: 0, done: 8 })).showExtract).toBe(true);
    expect(runControls('cancelling', counts({ pending: 0, running: 0, failed: 0, done: 8 })).showExtract).toBe(true);
  });

  it('offers Extract when the only unfinished item is one stuck at running', () => {
    // The last-item case. An api-server restart on item 8 of 8 leaves
    // pending=0, running=1: the run is correctly non-terminal (rollUpStatus
    // counts `running`), so Stop shows — and if Extract keyed off `pending`
    // alone it would not, leaving the requeue that fixes this reachable only
    // from the CLI. A fix that closes the trap for items 1..N-1 but not item N
    // has not closed it.
    expect(runControls('extracting', counts({ pending: 0, running: 1, done: 7 })).showExtract).toBe(true);
    expect(runControls('cancelling', counts({ pending: 0, running: 1, done: 7 })).showExtract).toBe(true);
  });

  it('offers Extract for pending and running work together', () => {
    expect(runControls('extracting', counts({ pending: 2, running: 1, done: 5 })).showExtract).toBe(true);
  });

  it('offers Retry whenever something failed, active or not', () => {
    // Same reasoning as Extract: a run stuck active with only failed items left
    // must still be actionable, and re-entry is safe by design (SKIP LOCKED).
    expect(runControls('partial', counts({ failed: 2, done: 6 })).showRetry).toBe(true);
    expect(runControls('extracting', counts({ failed: 2, done: 6 })).showRetry).toBe(true);
    expect(runControls('completed', counts({ done: 8 })).showRetry).toBe(false);
  });

  it('offers a planned run its first extract', () => {
    const controls = runControls('planned', counts({ pending: 8 }));
    expect(controls).toEqual({ showExtract: true, showRetry: false, showStop: false });
  });
});

describe('extractButtonLabel', () => {
  const counts = (over: Partial<RunCounts> = {}): RunCounts =>
    ({ pending: 0, running: 0, done: 0, failed: 0, listing: 1, detail: 8, ...over });

  it('counts the pending URLs when there are any', () => {
    expect(extractButtonLabel(counts({ pending: 3, done: 5 }))).toBe('Extract 3 pending');
  });

  it('names stalled work as stalled rather than saying "Extract 0 pending"', () => {
    // `running` with nothing pending is not pending work and must not be
    // described as such — and "Extract 0 pending" on the one button that can
    // rescue the run would read as a no-op.
    expect(extractButtonLabel(counts({ pending: 0, running: 1, done: 7 }))).toBe('Resume 1 stalled');
  });

  it('leads with the pending count when there is both', () => {
    // Pending items are claimable immediately; stalled ones only after the
    // staleness threshold. The immediately-actionable number is the honest one.
    expect(extractButtonLabel(counts({ pending: 2, running: 1, done: 5 }))).toBe('Extract 2 pending');
  });

  it('says a run with no work left is being finished, not extracted', () => {
    // Extract is shown here only because the status is still active with every
    // item finished (see runControls). There is no pending work and no stalled
    // work, so both other labels would be lies: "Extract 0 pending" reads as a
    // no-op, and "Resume 0 stalled" describes work that does not exist. What
    // the click actually does is roll the run up to its terminal status.
    expect(extractButtonLabel(counts({ pending: 0, running: 0, done: 8 }))).toBe('Finish run');
    expect(extractButtonLabel(counts({ pending: 0, running: 0, done: 6, failed: 2 }))).toBe('Finish run');
  });
});
