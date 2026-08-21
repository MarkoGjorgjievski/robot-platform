// packages/api/src/crawl-execute-outcome.test.ts
//
// `crawl-execute.ts` is a CLI script with no function boundary around its
// top-level statements (it runs the crawl in its own process via top-level
// await), so it can't be unit-tested directly. This pure function carries the
// one piece of decision logic worth testing in isolation: what the script
// should say and exit with, given how the poll loop ended.

import { describe, it, expect } from 'vitest';
import { describeCrawlExecuteOutcome } from './crawl-execute-outcome.js';

describe('describeCrawlExecuteOutcome', () => {
  it('exits non-zero and says the run may still be in progress when the poll cap is hit', () => {
    const outcome = describeCrawlExecuteOutcome('extracting', true);
    expect(outcome.exitCode).not.toBe(0);
    expect(outcome.message).toMatch(/still|progress|running/i);
    expect(outcome.message).toContain('extracting');
  });

  it('exits non-zero for a failed run, even when the poll cap was not hit', () => {
    const outcome = describeCrawlExecuteOutcome('failed', false);
    expect(outcome.exitCode).not.toBe(0);
  });

  it('exits zero for a completed run', () => {
    const outcome = describeCrawlExecuteOutcome('completed', false);
    expect(outcome.exitCode).toBe(0);
  });

  it('exits zero for a cancelled run', () => {
    const outcome = describeCrawlExecuteOutcome('cancelled', false);
    expect(outcome.exitCode).toBe(0);
  });
});
