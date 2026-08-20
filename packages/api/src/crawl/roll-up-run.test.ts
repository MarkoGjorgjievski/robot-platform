// packages/api/src/crawl/roll-up-run.test.ts
import { describe, it, expect } from 'vitest';
import { rollUpStatus } from './roll-up-run.js';

describe('rollUpStatus', () => {
  it('is completed when every item succeeded', () => {
    expect(rollUpStatus({ pending: 0, done: 12, failed: 0 })).toBe('completed');
  });

  it('is partial when some failed — the normal outcome at scale', () => {
    // Spec §1.2: "480 of 500 succeeded" is what a real run looks like, and the
    // old binary completed/failed could not say it.
    expect(rollUpStatus({ pending: 0, done: 480, failed: 20 })).toBe('partial');
  });

  it('is failed only when nothing succeeded at all', () => {
    expect(rollUpStatus({ pending: 0, done: 0, failed: 8 })).toBe('failed');
  });

  it('stays extracting while work remains', () => {
    expect(rollUpStatus({ pending: 3, done: 5, failed: 1 })).toBe('extracting');
  });

  it('treats a run with no items at all as completed rather than failed', () => {
    // A detail-mode source whose InputSet was empty planned nothing. That is an
    // empty result, not an error.
    expect(rollUpStatus({ pending: 0, done: 0, failed: 0 })).toBe('completed');
  });
});
