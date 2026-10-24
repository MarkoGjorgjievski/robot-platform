// Spec 2026-10-24 §3.1: the next run of a weekly schedule, in its own time zone, across DST — pure.
import { describe, it, expect } from 'vitest';
import { isTimeZone, nextRunAt, parseSchedule, TIME_ZONE_MESSAGE, type Schedule } from './schedule.js';

const s = (days: number[], time: string, timeZone: string): Schedule => ({ days, time, timeZone });
const next = (sch: Schedule, after: string) => nextRunAt(sch, new Date(after)).toISOString();

describe('nextRunAt — days and zones', () => {
  it('the next listed day at the time, in the zone (Saturday 24 October 2026 to Monday)', () => {
    // Berlin is CET (+1) from 25 October; Kolkata +5:30 all year; New York EDT (-4) until 1 November.
    expect(next(s([1], '06:00', 'Europe/Berlin'), '2026-10-24T12:00:00Z')).toBe('2026-10-26T05:00:00.000Z');
    expect(next(s([1], '06:00', 'Asia/Kolkata'), '2026-10-24T12:00:00Z')).toBe('2026-10-26T00:30:00.000Z');
    expect(next(s([1], '06:00', 'America/New_York'), '2026-10-24T12:00:00Z')).toBe('2026-10-26T10:00:00.000Z');
  });
  it('today while the time is still ahead; strictly after, so the instant itself is next week', () => {
    // Saturday 24 October 12:00 in Berlin (CEST, +2) is 10:00Z.
    expect(next(s([6], '12:00', 'Europe/Berlin'), '2026-10-24T09:59:00Z')).toBe('2026-10-24T10:00:00.000Z');
    expect(next(s([6], '12:00', 'Europe/Berlin'), '2026-10-24T10:00:00Z')).toBe('2026-10-31T11:00:00.000Z');
  });
  it('weekdays from a Friday evening is Monday; every day past today’s time is tomorrow', () => {
    expect(next(s([1, 2, 3, 4, 5], '06:00', 'Europe/Berlin'), '2026-10-23T18:00:00Z')).toBe('2026-10-26T05:00:00.000Z');
    expect(next(s([1, 2, 3, 4, 5, 6, 7], '06:00', 'Europe/Berlin'), '2026-10-24T05:00:00Z')).toBe('2026-10-25T05:00:00.000Z');
  });
  it('a worker down for a week: one next time, from now', () => {
    // Wednesday 4 November → Monday 9 November 06:00 IST.
    expect(next(s([1], '06:00', 'Asia/Kolkata'), '2026-11-04T00:00:00Z')).toBe('2026-11-09T00:30:00.000Z');
  });
});

describe('nextRunAt — DST', () => {
  it('Berlin spring-forward gap: 02:30 on Sunday 29 March runs at 03:00 CEST, the first instant after the gap', () => {
    expect(next(s([7], '02:30', 'Europe/Berlin'), '2026-03-28T12:00:00Z')).toBe('2026-03-29T01:00:00.000Z');
  });
  it('Berlin fall-back overlap: 02:30 on Sunday 25 October runs once, at the first (CEST) one', () => {
    expect(next(s([7], '02:30', 'Europe/Berlin'), '2026-10-24T12:00:00Z')).toBe('2026-10-25T00:30:00.000Z');
    // Between the two 02:30s it is not due again that night: next Sunday, 02:30 CET.
    expect(next(s([7], '02:30', 'Europe/Berlin'), '2026-10-25T01:00:00Z')).toBe('2026-11-01T01:30:00.000Z');
  });
  it('New York: 02:30 on 8 March runs at 03:00 EDT; 01:30 on 1 November at the first (EDT) one', () => {
    expect(next(s([7], '02:30', 'America/New_York'), '2026-03-07T12:00:00Z')).toBe('2026-03-08T07:00:00.000Z');
    expect(next(s([7], '01:30', 'America/New_York'), '2026-10-31T12:00:00Z')).toBe('2026-11-01T05:30:00.000Z');
  });
  it('Lord Howe’s 30-minute shift: the gap on 4 October, the overlap on 5 April', () => {
    // +10:30 → +11 at 02:00 local on 4 October 2026 (15:30Z on the 3rd): 02:15 does not exist that night.
    expect(next(s([7], '02:15', 'Australia/Lord_Howe'), '2026-10-03T00:00:00Z')).toBe('2026-10-03T15:30:00.000Z');
    // +11 → +10:30 at 02:00 local on 5 April 2026 (15:00Z on the 4th): 01:45 happens twice; the first is +11.
    expect(next(s([7], '01:45', 'Australia/Lord_Howe'), '2026-04-04T00:00:00Z')).toBe('2026-04-04T14:45:00.000Z');
  });
  it('Kolkata has no DST: the same UTC time across Europe’s change', () => {
    expect(next(s([7], '06:00', 'Asia/Kolkata'), '2026-03-28T12:00:00Z')).toBe('2026-03-29T00:30:00.000Z');
    expect(next(s([7], '06:00', 'Asia/Kolkata'), '2026-03-29T12:00:00Z')).toBe('2026-04-05T00:30:00.000Z');
  });
});

describe('parseSchedule', () => {
  it('accepts a schedule, its days sorted', () => {
    expect(parseSchedule({ days: [5, 1], time: '06:00', timeZone: 'Europe/Berlin' }))
      .toEqual({ ok: true, schedule: { days: [1, 5], time: '06:00', timeZone: 'Europe/Berlin' } });
  });
  it.each([
    [{ days: [], time: '06:00', timeZone: 'UTC' }, 'Choose at least one day.'],
    [{ days: [1, 1], time: '06:00', timeZone: 'UTC' }, 'Choose each day once.'],
    [{ days: [0], time: '06:00', timeZone: 'UTC' }, 'Choose days from Monday to Sunday.'],
    [{ days: [8], time: '06:00', timeZone: 'UTC' }, 'Choose days from Monday to Sunday.'],
    [{ days: [1.5], time: '06:00', timeZone: 'UTC' }, 'Choose days from Monday to Sunday.'],
    [{ days: [1], time: '6:00', timeZone: 'UTC' }, 'Use a time like 06:00.'],
    [{ days: [1], time: '24:00', timeZone: 'UTC' }, 'Use a time like 06:00.'],
    [{ days: [1], time: '06:60', timeZone: 'UTC' }, 'Use a time like 06:00.'],
    [{ days: [1], time: '06:00', timeZone: 'Mars/Olympus_Mons' }, TIME_ZONE_MESSAGE],
    [{ days: [1], time: '06:00', timeZone: '' }, TIME_ZONE_MESSAGE],
    [null, 'That schedule could not be saved.'],
    ['every monday', 'That schedule could not be saved.'],
  ])('refuses %j with one sentence', (raw, message) => {
    expect(parseSchedule(raw)).toEqual({ ok: false, message });
  });
  it('isTimeZone is what Intl accepts', () => {
    expect(isTimeZone('Europe/Berlin')).toBe(true);
    expect(isTimeZone('Australia/Lord_Howe')).toBe(true);
    expect(isTimeZone('Europe/Atlantis')).toBe(false);
  });
});
