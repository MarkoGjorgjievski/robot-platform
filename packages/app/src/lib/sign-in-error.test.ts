import { describe, expect, it } from 'vitest';
import { signInErrorMessage } from './sign-in-error';

describe('signInErrorMessage', () => {
  it('turns a Zod issue array into a sentence about the field', () => {
    const zod = JSON.stringify([
      { validation: 'email', code: 'invalid_string', message: 'Invalid email', path: ['email'] },
    ]);
    expect(signInErrorMessage(new Error(zod))).toBe('Enter a valid email address.');
  });

  it('names the password when that is the failing field', () => {
    const zod = JSON.stringify([
      { code: 'too_small', minimum: 1, message: 'String must contain at least 1 character(s)', path: ['password'] },
    ]);
    expect(signInErrorMessage(new Error(zod))).toBe('Enter your password.');
  });

  it('falls back to a generic sentence for an unrecognised issue array', () => {
    expect(signInErrorMessage(new Error(JSON.stringify([{ path: ['whatever'] }])))).toBe(
      'Check the details you entered.'
    );
  });

  it('explains a dead api-server rather than echoing "Failed to fetch"', () => {
    expect(signInErrorMessage(new TypeError('Failed to fetch'))).toBe(
      'Cannot reach the server. Check that the api-server is running.'
    );
  });

  it('passes a real server message through', () => {
    expect(signInErrorMessage(new Error('This account has no organisation'))).toBe(
      'This account has no organisation'
    );
  });

  it('never returns an empty string', () => {
    expect(signInErrorMessage(new Error(''))).toBe('Could not sign in.');
    expect(signInErrorMessage(undefined)).toBe('Could not sign in.');
  });

  it('leaves a message that merely starts with a bracket alone', () => {
    expect(signInErrorMessage(new Error('[unparseable'))).toBe('[unparseable');
  });

  it('a rate-limited sign-in reads the rate-limit sentence (spec 2026-10-24 tenant isolation §2.4)', () => {
    const limited = Object.assign(new Error('Too many requests. Wait a minute and try again.'), { data: { code: 'TOO_MANY_REQUESTS', httpStatus: 429 } });
    expect(signInErrorMessage(limited)).toBe('Too many requests. Wait a minute and try again.');
    const odd = Object.assign(new Error('rate limited by something'), { data: { code: 'TOO_MANY_REQUESTS' } });
    expect(signInErrorMessage(odd)).toBe('Too many requests. Wait a minute and try again.');
  });
});
