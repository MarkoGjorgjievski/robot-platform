import { describe, it, expect } from 'vitest';
import { progressLabel, isRunActive, runControls, type RunCounts } from './run-progress';

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

  it('hides Extract when there is nothing pending to extract', () => {
    expect(runControls('completed', counts({ done: 8 })).showExtract).toBe(false);
    expect(runControls('extracting', counts({ done: 8 })).showExtract).toBe(false);
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
