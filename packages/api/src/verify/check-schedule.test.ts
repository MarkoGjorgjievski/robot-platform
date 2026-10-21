import { describe, it, expect } from 'vitest';
import { nextCheckAt, websiteCheckDays } from './check-schedule.js';

describe('the check schedule (spec 2026-10-21 §3.3)', () => {
  it('is three days unless WEBSITE_CHECK_DAYS says otherwise', () => {
    expect(websiteCheckDays({})).toBe(3);
    expect(websiteCheckDays({ WEBSITE_CHECK_DAYS: '5' })).toBe(5);
    expect(websiteCheckDays({ WEBSITE_CHECK_DAYS: 'soon' })).toBe(3);
    expect(websiteCheckDays({ WEBSITE_CHECK_DAYS: '0' })).toBe(3);
  });
  it('adds the days to the moment given', () => {
    expect(nextCheckAt(new Date('2026-10-21T10:00:00Z'), 3).toISOString()).toBe('2026-10-24T10:00:00.000Z');
  });
});
