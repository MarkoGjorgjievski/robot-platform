import { describe, expect, it } from 'vitest';
import { RUN_DOT_STATES, runDotLabel, runDotState } from './run-dot-view';

describe('runDotState', () => {
  it('is idle when there is no run at all', () => {
    expect(runDotState(null)).toBe('idle');
    expect(runDotState(undefined)).toBe('idle');
  });

  it('maps the terminal engine statuses', () => {
    expect(runDotState({ status: 'completed' })).toBe('done');
    expect(runDotState({ status: 'done' })).toBe('done');
    expect(runDotState({ status: 'failed' })).toBe('failed');
    expect(runDotState({ status: 'partial' })).toBe('partial');
  });

  it('maps everything that means work is in flight to running', () => {
    for (const status of ['running', 'planned', 'planning', 'executing', 'extracting', 'pending', 'cancelling']) {
      expect(runDotState({ status })).toBe('running');
    }
  });

  it('is idle for a cancelled run: stopped is not a result', () => {
    expect(runDotState({ status: 'cancelled' })).toBe('idle');
  });

  it('is idle for an unknown status rather than guessing', () => {
    expect(runDotState({ status: 'hamster' })).toBe('idle');
    expect(runDotState({ status: '' })).toBe('idle');
  });

  it('ignores case and surrounding space', () => {
    expect(runDotState({ status: ' Completed ' })).toBe('done');
  });

  // The pulse is a promise that something is moving. A row that says
  // "extracting" but carries a completedAt is a run whose loop is gone (see
  // run-progress.ts in @robot/dashboard for how that happens); pulsing there
  // would be a lie the customer cannot clear.
  it('does not pulse for a running-family status that already completed', () => {
    expect(runDotState({ status: 'extracting', completedAt: new Date('2026-09-20T10:00:00Z') })).toBe('idle');
    expect(runDotState({ status: 'extracting', completedAt: null })).toBe('running');
  });

  it('leaves a terminal status alone whether or not completedAt is set', () => {
    expect(runDotState({ status: 'completed', completedAt: new Date('2026-09-20T10:00:00Z') })).toBe('done');
    expect(runDotState({ status: 'failed', completedAt: null })).toBe('failed');
  });
});

describe('runDotLabel', () => {
  it('is the state word, capitalised, for every state', () => {
    expect(runDotLabel('idle')).toBe('Idle');
    expect(runDotLabel('running')).toBe('Running');
    expect(runDotLabel('done')).toBe('Done');
    expect(runDotLabel('failed')).toBe('Failed');
    expect(runDotLabel('partial')).toBe('Partial');
  });

  it('covers every state the dot can be in', () => {
    for (const state of RUN_DOT_STATES) {
      expect(runDotLabel(state)).toMatch(/^[A-Z][a-z]+$/);
    }
  });
});
