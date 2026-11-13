import { describe, expect, it } from 'vitest';
import { dateTime, utcDateTime } from './when';

// Built from local parts, so the test reads the same in any time zone.
const at = new Date(2026, 10, 13, 20, 5);

describe('dateTime', () => {
  it('reads day, month, year and 24-hour time', () => {
    expect(dateTime(at)).toBe('13 Nov 2026, 20:05');
    expect(dateTime(at.toISOString())).toBe('13 Nov 2026, 20:05');
  });
  it('short drops this year, keeps another', () => {
    expect(dateTime(at, { short: true, now: new Date(2026, 11, 1) })).toBe('13 Nov, 20:05');
    expect(dateTime(at, { short: true, now: new Date(2027, 0, 1) })).toBe('13 Nov 2026, 20:05');
  });
  it('nothing for a missing or unreadable date', () => {
    expect(dateTime(null)).toBeNull();
    expect(dateTime('nope')).toBeNull();
    expect(utcDateTime(undefined)).toBeNull();
  });
  it('the tooltip is UTC', () => {
    expect(utcDateTime('2026-11-13T19:32:10.000Z')).toBe('2026-11-13 19:32 UTC');
  });
});
