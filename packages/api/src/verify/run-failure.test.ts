import { describe, it, expect } from 'vitest';
import { VERIFY_STALL_MS } from '@robot/scraper';
import { runFailure } from './run-failure.js';

const NOW = Date.parse('2026-10-20T12:00:00Z');
const at = (msAgo: number) => new Date(NOW - msAgo);

describe('runFailure (spec 2026-10-20 §3.3)', () => {
  it('a clean completed row did not fail', () => expect(runFailure({ startedAt: at(60_000), completedAt: at(1000), errorMessage: null }, NOW)).toBeNull());
  it('a completed row with an error stopped', () => expect(runFailure({ startedAt: at(60_000), completedAt: at(1000), errorMessage: 'Request timed out.' }, NOW)).toBe('stopped'));
  it("a row closed as 'stalled' stalled", () => expect(runFailure({ startedAt: at(60_000), completedAt: at(1000), errorMessage: 'stalled' }, NOW)).toBe('stalled'));
  it('an in-flight row inside the window is still running', () => expect(runFailure({ startedAt: at(VERIFY_STALL_MS - 1000), completedAt: null, errorMessage: null }, NOW)).toBeNull());
  it('an in-flight row past the window stalled', () => expect(runFailure({ startedAt: at(VERIFY_STALL_MS + 1000), completedAt: null, errorMessage: null }, NOW)).toBe('stalled'));
});
