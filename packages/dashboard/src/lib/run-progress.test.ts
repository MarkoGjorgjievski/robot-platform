import { describe, it, expect } from 'vitest';
import {
  progressLabel, isRunActive, runControls, extractButtonLabel, extractButtonTitle,
  requeueNotice, STALE_RECLAIM_MINUTES, type RunCounts,
} from './run-progress';

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

  // Finding 1 (final-review-findings.md): a probe run's own page must not
  // offer "Extract N pending" — a full, unconfirmed extraction of everything
  // the probe enumerated — or a Stop meant for the confirm gate, not this
  // panel. The confirm gate (Yes/No) is the only actionable control there.
  describe('probeUnconfirmed', () => {
    it('hides every control, no matter the status or counts', () => {
      expect(runControls('extracting', counts({ pending: 27, done: 3 }), { probeUnconfirmed: true }))
        .toEqual({ showExtract: false, showRetry: false, showStop: false });
      expect(runControls('partial', counts({ pending: 27, done: 3 }), { probeUnconfirmed: true }))
        .toEqual({ showExtract: false, showRetry: false, showStop: false });
      expect(runControls('cancelling', counts({ pending: 27, failed: 3 }), { probeUnconfirmed: true }))
        .toEqual({ showExtract: false, showRetry: false, showStop: false });
    });

    it('leaves a normal run unaffected when the flag is false or omitted', () => {
      expect(runControls('extracting', counts({ pending: 3, done: 5 }), { probeUnconfirmed: false }).showExtract).toBe(true);
      expect(runControls('extracting', counts({ pending: 3, done: 5 })).showExtract).toBe(true);
    });
  });

  // repair-engine task 10: a backfill run's staged repair-sweep
  // (repair-sweep.ts) can finalise the run terminal ('partial') with items
  // still `pending` — `runRepairSweep`'s own honest stop when the sample
  // shows the repair doesn't take. Those leftover pending items are the
  // failed repair's remainder, not "not yet extracted" — re-clicking a raw
  // Extract would just walk the same broken cached path again. The honest
  // next step is back through the parent run's backfillPreview, so Extract
  // must not appear at all once such a run has gone terminal.
  describe('backfill', () => {
    it('hides Extract on a terminal backfill run with pending items left over (the repair_failed shape)', () => {
      const controls = runControls('partial', counts({ pending: 5, done: 3 }), { backfill: true });
      expect(controls.showExtract).toBe(false);
    });

    it('still offers Retry on that same run, if anything actually failed', () => {
      const controls = runControls('partial', counts({ pending: 5, done: 2, failed: 1 }), { backfill: true });
      expect(controls.showExtract).toBe(false);
      expect(controls.showRetry).toBe(true);
    });

    it('keeps Stop available on a backfill run while it is active', () => {
      expect(runControls('extracting', counts({ pending: 5 }), { backfill: true }).showStop).toBe(true);
      expect(runControls('cancelling', counts({ pending: 5 }), { backfill: true }).showStop).toBe(true);
    });

    it('still offers Extract on an ACTIVE backfill run — the terminal-only rule does not apply while a loop may still be running', () => {
      expect(runControls('extracting', counts({ pending: 5, done: 3 }), { backfill: true }).showExtract).toBe(true);
    });

    it('still offers Extract to rescue a stalled item, even on a backfill run, while active', () => {
      expect(runControls('extracting', counts({ pending: 0, running: 1, done: 7 }), { backfill: true }).showExtract).toBe(true);
    });

    it('behaves exactly like a normal run once a backfill run is terminal with nothing pending', () => {
      const controls = runControls('completed', counts({ done: 8 }), { backfill: true });
      expect(controls).toEqual({ showExtract: false, showRetry: false, showStop: false });
    });

    it('leaves a normal (non-backfill) run unaffected when the flag is false or omitted', () => {
      expect(runControls('partial', counts({ pending: 5, done: 3 }), { backfill: false }).showExtract).toBe(true);
      expect(runControls('partial', counts({ pending: 5, done: 3 })).showExtract).toBe(true);
    });
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

// N3: "Resume N stalled" appears the moment an item is `running`, but the
// reclaim behind it only acts once that item is past the staleness threshold.
// Inside that window the click launched a chromium, claimed nothing, finalised
// straight back to `extracting` and said nothing — while the tooltip claimed it
// had "reclaimed any item abandoned mid-extraction". Both halves of that lie
// get fixed: the tooltip states the threshold, and the outcome is reported.
describe('extractButtonTitle', () => {
  const counts = (over: Partial<RunCounts> = {}): RunCounts =>
    ({ pending: 0, running: 0, done: 0, failed: 0, listing: 1, detail: 8, ...over });

  it('states the threshold instead of promising an immediate reclaim', () => {
    const title = extractButtonTitle('extracting', counts({ pending: 0, running: 1, done: 7 }));
    expect(title).toContain(`${STALE_RECLAIM_MINUTES} minutes`);
    // The old copy promised the click would "reclaim any item abandoned
    // mid-extraction" — unconditionally, which is what made it a lie.
    expect(title).not.toMatch(/reclaim any item/i);
  });

  it('describes finishing, not extracting, when nothing is left to do', () => {
    expect(extractButtonTitle('extracting', counts({ done: 8 }))).toMatch(/final status|finish/i);
  });

  it('says re-entry is safe on a run that may still have a loop behind it', () => {
    expect(extractButtonTitle('extracting', counts({ pending: 3 }))).toMatch(/already-claimed/i);
  });

  it('describes a plain first extract on an inactive run', () => {
    expect(extractButtonTitle('planned', counts({ pending: 8 }))).toMatch(/every pending URL/i);
  });
});

describe('requeueNotice', () => {
  const counts = (over: Partial<RunCounts> = {}): RunCounts =>
    ({ pending: 0, running: 0, done: 0, failed: 0, listing: 1, detail: 8, ...over });

  it('reports what was actually reclaimed', () => {
    expect(requeueNotice(2, counts({ pending: 2, done: 6 }))).toBe('Reclaimed 2 stalled items.');
    expect(requeueNotice(1, counts({ pending: 1, done: 7 }))).toBe('Reclaimed 1 stalled item.');
  });

  it('explains the silence when a stalled item was too young to reclaim', () => {
    // The whole point: the operator clicked "Resume 1 stalled", a browser
    // launched, and nothing on screen changed. Saying why beats saying nothing.
    const notice = requeueNotice(0, counts({ running: 1, done: 7 }));
    expect(notice).toContain(`${STALE_RECLAIM_MINUTES} minutes`);
    expect(notice).toMatch(/nothing|no item/i);
  });

  it('stays quiet on an ordinary extract, where there was nothing to reclaim', () => {
    expect(requeueNotice(0, counts({ pending: 5 }))).toBeNull();
    expect(requeueNotice(0, counts({ done: 8 }))).toBeNull();
  });
});
