// Per-host backoff (spec 2026-10-09 §A3): a challenge or refusal from a host
// makes the next acquire on that host wait 2 min, doubling per further
// challenge up to 8; an ok clears it. The clock is injected so this runs instantly.
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { acquireDomainLock, backoffRemainingMs, reportVerdict, BACKOFF_FIRST_MS, BACKOFF_MAX_MS, _setClockForTests, _resetBackoffForTests } from './domain-lock.js';

let t = 0; const waits: number[] = [];
_setClockForTests(() => t, async (ms) => { waits.push(ms); t += ms; });
afterEach(() => { _resetBackoffForTests(); waits.length = 0; t = 0; });
afterAll(() => { _setClockForTests(() => Date.now(), (ms) => new Promise<void>((r) => setTimeout(r, ms))); });

describe('backoff after a challenge or refusal', () => {
  it('starts at 2 minutes, doubles per further challenge, caps at 8', () => {
    reportVerdict('shop.example', 'challenge');
    expect(backoffRemainingMs('shop.example')).toBe(BACKOFF_FIRST_MS);
    reportVerdict('shop.example', 'refused');
    expect(backoffRemainingMs('shop.example')).toBe(BACKOFF_FIRST_MS * 2);
    reportVerdict('shop.example', 'challenge'); reportVerdict('shop.example', 'challenge');
    expect(backoffRemainingMs('shop.example')).toBe(BACKOFF_MAX_MS);
  });
  it('an ok clears it; other kinds leave it alone', () => {
    reportVerdict('shop.example', 'challenge');
    reportVerdict('shop.example', 'not-found');
    reportVerdict('shop.example', 'timeout');
    expect(backoffRemainingMs('shop.example')).toBe(BACKOFF_FIRST_MS);
    reportVerdict('shop.example', 'ok');
    expect(backoffRemainingMs('shop.example')).toBe(0);
  });
  it('is per host', () => {
    reportVerdict('shop.example', 'challenge');
    expect(backoffRemainingMs('other.example')).toBe(0);
  });
  it('acquireDomainLock waits out the backoff instead of failing, then runs', async () => {
    reportVerdict('shop.example', 'challenge');
    const release = await acquireDomainLock('shop.example');
    expect(waits).toContain(BACKOFF_FIRST_MS);
    release();
    expect(backoffRemainingMs('shop.example')).toBe(0);
  });
  it('a challenge after a waited acquire still doubles (strikes survive the wait)', async () => {
    reportVerdict('shop.example', 'challenge');
    (await acquireDomainLock('shop.example'))();
    reportVerdict('shop.example', 'challenge');
    expect(backoffRemainingMs('shop.example')).toBe(BACKOFF_FIRST_MS * 2);
  });
  it('time passing shrinks the remaining wait', () => {
    reportVerdict('shop.example', 'challenge');
    t += 90_000;
    expect(backoffRemainingMs('shop.example')).toBe(BACKOFF_FIRST_MS - 90_000);
  });
});
