import { describe, expect, it } from 'vitest';
import { SOMETHING_WENT_WRONG, TOO_MANY_REQUESTS_TEXT, mutationErrorText } from './mutation-error';

const err = (message: string, code?: string) => ({ message, data: code ? { code } : null });

describe('mutationErrorText (spec 2026-10-21)', () => {
  it('shows a refusal the api words for customers', () => {
    for (const code of ['PRECONDITION_FAILED', 'BAD_REQUEST', 'FORBIDDEN']) {
      expect(mutationErrorText(err('This run is already running.', code))).toBe('This run is already running.');
    }
  });

  it('a worded refusal that carries a capture verdict reads in customer words', () => {
    expect(mutationErrorText(err("This run failed while planning: scan.co.uk refused the browser (HTTP 403, Cloudflare). We can't read this website from here yet.", 'PRECONDITION_FAILED')))
      .toBe("This run failed while planning: This website turned us away, so we can't read it yet.");
  });

  it('a server error, a network failure or no code at all reads as the generic sentence', () => {
    expect(mutationErrorText(err('Cannot read properties of undefined (reading \'id\')', 'INTERNAL_SERVER_ERROR'))).toBe(SOMETHING_WENT_WRONG);
    expect(mutationErrorText(err('Failed to fetch'))).toBe(SOMETHING_WENT_WRONG);
    expect(SOMETHING_WENT_WRONG).toBe('Something went wrong. Try again.');
  });

  it('a rate-limited call reads the rate-limit sentence, for a customer and for staff (spec 2026-10-24 tenant isolation §2.4)', () => {
    expect(TOO_MANY_REQUESTS_TEXT).toBe('Too many requests. Wait a minute and try again.');
    expect(mutationErrorText(err('Too many requests. Wait a minute and try again.', 'TOO_MANY_REQUESTS'))).toBe(TOO_MANY_REQUESTS_TEXT);
    expect(mutationErrorText(err('anything at all', 'TOO_MANY_REQUESTS'))).toBe(TOO_MANY_REQUESTS_TEXT);
    expect(mutationErrorText(err('anything at all', 'TOO_MANY_REQUESTS'), true)).toBe(TOO_MANY_REQUESTS_TEXT);
  });

  it('a worded refusal holding library text, a host or an id reads as the generic sentence', () => {
    expect(mutationErrorText(err('[\n  {\n    "code": "invalid_type"\n  }\n]', 'BAD_REQUEST'))).toBe(SOMETHING_WENT_WRONG);
    expect(mutationErrorText(err('connect ECONNREFUSED 127.0.0.1:5432', 'PRECONDITION_FAILED'))).toBe(SOMETHING_WENT_WRONG);
    expect(mutationErrorText(err('Run 3f2b6c1e-9a0d-4e8b-b1c2-0d9e8f7a6b5c not found', 'FORBIDDEN'))).toBe(SOMETHING_WENT_WRONG);
    expect(mutationErrorText(err('fetch failed for shop.example', 'BAD_REQUEST'))).toBe(SOMETHING_WENT_WRONG);
  });

  it('staff read the message as sent', () => {
    expect(mutationErrorText(err('connect ECONNREFUSED 127.0.0.1:5432', 'INTERNAL_SERVER_ERROR'), true)).toBe('connect ECONNREFUSED 127.0.0.1:5432');
  });

  it('accepts an error with no data', () => {
    expect(mutationErrorText({ message: 'x' })).toBe(SOMETHING_WENT_WRONG);
  });
});
