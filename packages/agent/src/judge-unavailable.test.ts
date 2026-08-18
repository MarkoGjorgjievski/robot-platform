// Distinguishing "this field could not be judged" from "the judge cannot run".
//
// On 2026-08-18 a dogfood run exhausted its API credit partway through. Every
// remaining judge call returned 400 invalid_request_error, each was folded into
// the verdict counts as 'error', and the run wrote a report whose later sites were
// entirely unjudged — visible only as an aggregate line reading
// "Judge failed to return a verdict: 12". It looked like a measurement.
//
// isJudgeUnavailable identifies failures that will recur on every subsequent call,
// so the run can abort instead of issuing hundreds of doomed requests.

import { describe, it, expect } from 'vitest';
import { isJudgeUnavailable, JudgeUnavailableError } from './judge.js';

/** Shape of an Anthropic SDK error: an Error carrying an HTTP `status`. */
function apiError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

describe('isJudgeUnavailable', () => {
  it('recognises the exhausted-credit 400 that ended the 2026-08-18 run', () => {
    expect(isJudgeUnavailable(apiError(400,
      '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}',
    ))).toBe(true);
  });

  it('recognises auth failures by status', () => {
    expect(isJudgeUnavailable(apiError(401, 'unauthorized'))).toBe(true);
    expect(isJudgeUnavailable(apiError(403, 'forbidden'))).toBe(true);
  });

  it('does NOT claim transient failures are fatal — those are per-field errors', () => {
    expect(isJudgeUnavailable(apiError(429, 'rate limit exceeded'))).toBe(false);
    expect(isJudgeUnavailable(apiError(500, 'internal server error'))).toBe(false);
    expect(isJudgeUnavailable(apiError(529, 'overloaded'))).toBe(false);
  });

  it('does NOT treat an ordinary bad request as fatal', () => {
    expect(isJudgeUnavailable(apiError(400, 'messages.0.content: invalid image'))).toBe(false);
  });

  it('handles non-Error values without throwing', () => {
    expect(isJudgeUnavailable(null)).toBe(false);
    expect(isJudgeUnavailable('boom')).toBe(false);
    expect(isJudgeUnavailable(undefined)).toBe(false);
  });
});

describe('JudgeUnavailableError', () => {
  it('is identifiable with instanceof so the runner can abort on it', () => {
    const e = new JudgeUnavailableError('credit balance is too low');
    expect(e).toBeInstanceOf(JudgeUnavailableError);
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('JudgeUnavailableError');
  });
});
