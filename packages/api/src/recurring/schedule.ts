// packages/api/src/recurring/schedule.ts
// A website's schedule (spec 2026-10-24 §3.1): ISO weekdays, a 24-hour wall time, an IANA time zone. Pure, and
// Intl only (no library): a wall time in a spring-forward gap runs at the first instant after the gap; one that
// happens twice (fall-back) runs once, at its first occurrence.
import { z } from 'zod';

export type Schedule = { days: number[]; time: string; timeZone: string };
export type SkipReason = 'paused' | 'not_certified' | 'not_confirmed' | 'busy';
/** `sources.schedule_last`: what the last sweep did with the website. */
export type ScheduleLast = { at: string; outcome: 'started' | 'skipped'; reason?: SkipReason; runId?: string };
/** The `input_label` of a run a schedule started (beside 'probe' and 'backfill'). */
export const SCHEDULED_LABEL = 'scheduled';

export const TIME_ZONE_MESSAGE = 'Choose a time zone from the list.';
const NOT_A_SCHEDULE = 'That schedule could not be saved.';
const NO_DAY = 'Choose at least one day.';
const DAY_RANGE = 'Choose days from Monday to Sunday.';
const TIME_MESSAGE = 'Use a time like 06:00.';
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const scheduleSchema = z.object({
  days: z.array(z.number({ invalid_type_error: DAY_RANGE }).int(DAY_RANGE).min(1, DAY_RANGE).max(7, DAY_RANGE), { required_error: NO_DAY, invalid_type_error: NO_DAY })
    .min(1, NO_DAY)
    .refine((d) => new Set(d).size === d.length, 'Choose each day once.'),
  time: z.string({ required_error: TIME_MESSAGE, invalid_type_error: TIME_MESSAGE }).regex(TIME, TIME_MESSAGE),
  timeZone: z.string({ required_error: TIME_ZONE_MESSAGE, invalid_type_error: TIME_ZONE_MESSAGE })
    .min(1, TIME_ZONE_MESSAGE).max(100, TIME_ZONE_MESSAGE).refine(isTimeZone, TIME_ZONE_MESSAGE),
}, { required_error: NOT_A_SCHEDULE, invalid_type_error: NOT_A_SCHEDULE });

/** The customer's schedule, or the one sentence that says what is wrong with it (shown as is). */
export function parseSchedule(raw: unknown): { ok: true; schedule: Schedule } | { ok: false; message: string } {
  const r = scheduleSchema.safeParse(raw);
  if (!r.success) return { ok: false, message: r.error.issues[0]?.message ?? NOT_A_SCHEDULE };
  const timeZone = new Intl.DateTimeFormat('en-US', { timeZone: r.data.timeZone }).resolvedOptions().timeZone;
  return { ok: true, schedule: { days: [...r.data.days].sort((a, b) => a - b), time: r.data.time, timeZone } };
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

type Wall = { y: number; mo: number; d: number; h: number; mi: number; s: number };
function wallAt(t: number, timeZone: string): Wall {
  const parts = formatter(timeZone).formatToParts(new Date(t));
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { y: get('year'), mo: get('month'), d: get('day'), h: get('hour') % 24, mi: get('minute'), s: get('second') };
}

/** The zone's offset at instant `t`, in ms (its wall clock read as UTC, minus the instant), to the second. */
function offsetAt(t: number, timeZone: string): number {
  const w = wallAt(t, timeZone);
  return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) - Math.floor(t / 1000) * 1000;
}

const DAY_MS = 86_400_000;

/** The instant the zone's clocks read y-mo-d h:mi; in a gap, the first instant after it; read twice, the first. */
function instantOf(y: number, mo: number, d: number, h: number, mi: number, timeZone: string): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const before = offsetAt(guess - DAY_MS, timeZone);
  const after = offsetAt(guess + DAY_MS, timeZone);
  const hits = [...new Set([before, after])]
    .map((o) => guess - o)
    .filter((t) => { const w = wallAt(t, timeZone); return w.y === y && w.mo === mo && w.d === d && w.h === h && w.mi === mi; });
  if (hits.length > 0) return Math.min(...hits);
  // A gap: the transition lies between the two readings; find its first instant on the new offset.
  let lo = guess - Math.max(before, after);
  let hi = guess - Math.min(before, after);
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (offsetAt(mid, timeZone) === after) hi = mid; else lo = mid;
  }
  return hi;
}

/** The first instant strictly after `after` whose wall clock in `timeZone` is a listed day at `time` (spec §3.1). */
export function nextRunAt(schedule: Schedule, after: Date): Date {
  const [hh, mm] = schedule.time.split(':').map(Number) as [number, number];
  const from = after.getTime();
  const start = wallAt(from, schedule.timeZone);
  // Today and the next eight local days cover every weekday, today's included once its time has passed.
  for (let i = 0; i <= 8; i++) {
    const day = new Date(Date.UTC(start.y, start.mo - 1, start.d + i));
    const iso = ((day.getUTCDay() + 6) % 7) + 1;
    if (!schedule.days.includes(iso)) continue;
    const t = instantOf(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hh, mm, schedule.timeZone);
    if (t > from) return new Date(t);
  }
  throw new Error(`nextRunAt: no day in ${JSON.stringify(schedule.days)}`);
}
