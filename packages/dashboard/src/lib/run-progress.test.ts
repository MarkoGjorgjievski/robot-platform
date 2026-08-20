import { describe, it, expect } from 'vitest';
import { progressLabel, isRunActive } from './run-progress';

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
