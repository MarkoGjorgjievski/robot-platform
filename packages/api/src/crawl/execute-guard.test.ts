// packages/api/src/crawl/execute-guard.test.ts
import { describe, expect, it } from 'vitest';
import { canExecute } from './execute-guard.js';
import { rollUpStatus } from './roll-up-run.js';

describe('canExecute', () => {
  it('refuses a run that failed planning and has nothing to run, with its reason', () => {
    expect(canExecute({ status: 'failed', errorMessage: "otto.de asked for a human check (CAPTCHA). Wait a few minutes and try again; pasting product pages won't help, they are behind the same check." }, 0))
      .toEqual({ ok: false, message: "This run failed while planning: otto.de asked for a human check (CAPTCHA). Wait a few minutes and try again; pasting product pages won't help, they are behind the same check." });
  });
  it('lets planned, extracting (resume) and partial runs through, and a failed run that still has items (retry)', () => {
    expect(canExecute({ status: 'planned', errorMessage: null }, 10)).toEqual({ ok: true });
    expect(canExecute({ status: 'extracting', errorMessage: null }, 3)).toEqual({ ok: true });
    expect(canExecute({ status: 'partial', errorMessage: null }, 0)).toEqual({ ok: true });
    expect(canExecute({ status: 'failed', errorMessage: 'x' }, 5)).toEqual({ ok: true });
  });
});

describe('rollUpStatus with nothing to roll up', () => {
  it('zero items and an error stays failed; zero items and no error is completed (an empty but honest run)', () => {
    expect(rollUpStatus({ pending: 0, running: 0, done: 0, failed: 0 }, false, false, true)).toBe('failed');
    expect(rollUpStatus({ pending: 0, running: 0, done: 0, failed: 0 }, false, false, false)).toBe('completed');
  });
});
