// The Settings tab's Schedule and Webhook rows, and the run page's webhook line (spec 2026-10-24 §3.6). Pure.
// A customer reads no status code, host or error text; staff (`showsMoney`) also read the stored code and error.

export type Schedule = { days: number[]; time: string; timeZone: string };
export type SkipReason = 'paused' | 'not_certified' | 'not_confirmed' | 'busy';
export type ScheduleLast = { at: string; outcome: 'started' | 'skipped'; reason?: SkipReason; runId?: string };
export type ScheduleChoice = 'off' | 'daily' | 'weekdays' | 'custom';
export type Delivery = { state: 'delivered' | 'retrying' | 'failed'; at: Date; statusCode?: number | null; error?: string | null } | null;

export const CHOICE_LABELS: Record<ScheduleChoice, string> = { off: 'Off', daily: 'Every day', weekdays: 'Weekdays', custom: 'Choose days' };
/** Index = ISO weekday − 1. */
export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
export const SKIP_SENTENCES: Record<SkipReason, string> = {
  paused: 'Skipped: the website is paused.',
  not_certified: 'Skipped: the website needs verifying first.',
  not_confirmed: 'Skipped: run Extract once by hand first.',
  busy: 'Skipped: the last run was still going.',
};
export const WEBHOOK_HELP = "We send a POST with the run's results and download links when a run finishes.";

const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7];
const WEEKDAYS = [1, 2, 3, 4, 5];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const same = (a: number[], b: number[]) => a.length === b.length && a.every((d, i) => d === b[i]);

export function choiceOf(s: Schedule | null): ScheduleChoice {
  if (!s) return 'off';
  const days = [...s.days].sort((a, b) => a - b);
  if (same(days, EVERY_DAY)) return 'daily';
  if (same(days, WEEKDAYS)) return 'weekdays';
  return 'custom';
}

export function scheduleFromForm(choice: ScheduleChoice, days: number[], time: string, timeZone: string): Schedule | null {
  if (choice === 'off') return null;
  const picked = choice === 'daily' ? EVERY_DAY : choice === 'weekdays' ? WEEKDAYS : [...new Set(days)].sort((a, b) => a - b);
  return { days: picked, time, timeZone };
}

/** Why Save is disabled (said beside it), or null. The server's own sentences say the same. */
export function scheduleFormProblem(choice: ScheduleChoice, days: number[], time: string): string | null {
  if (choice === 'off') return null;
  if (choice === 'custom' && days.length === 0) return 'Choose at least one day.';
  if (!TIME.test(time)) return 'Use a time like 06:00.';
  return null;
}

/** `timeZone` when this browser knows it, else UTC: a zone the server accepted can still be one an older browser lacks. */
function shownZone(timeZone: string): string {
  try { new Intl.DateTimeFormat('en-GB', { timeZone }); return timeZone; } catch { return 'UTC'; }
}

/** "Monday 26 October, 06:00" in `timeZone` (in UTC when this browser does not know the zone). */
export function whenLabel(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: shownZone(timeZone), weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('weekday')} ${get('day')} ${get('month')}, ${get('hour')}:${get('minute')}`;
}

export function nextRunLine(nextRunAt: Date | null, timeZone: string | null): string | null {
  if (!nextRunAt || !timeZone) return null;
  return `Next run: ${whenLabel(nextRunAt, timeZone)} (${shownZone(timeZone)})`;
}

export function lastOutcomeLine(last: ScheduleLast | null, timeZone: string): { text: string; runId: string | null } | null {
  if (!last) return null;
  if (last.outcome === 'started') return { text: `Started ${whenLabel(new Date(last.at), timeZone)}.`, runId: last.runId ?? null };
  return last.reason ? { text: SKIP_SENTENCES[last.reason], runId: null } : null;
}

export function browserTimeZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

/** Every zone Intl knows, sorted, with `current` kept even if this browser does not list it. */
export function timeZoneOptions(current: string): string[] {
  let zones: string[] = [];
  try { zones = Intl.supportedValuesOf('timeZone'); } catch { zones = []; }
  const all = new Set([...zones, 'UTC', current]);
  return [...all].sort((a, b) => a.localeCompare(b));
}

export function maskSecret(secret: string): string {
  return `${'•'.repeat(12)}${secret.slice(-4)}`;
}

/** The run page's line under the downloads, in the viewer's own time zone; null when no attempt was made. */
export function webhookLine(d: Delivery, staff: boolean, timeZone: string): string | null {
  if (!d) return null;
  const text = d.state === 'delivered' ? `Webhook delivered ${whenLabel(d.at, timeZone)}.`
    : d.state === 'retrying' ? 'Webhook not delivered yet — trying again.'
    : 'Webhook could not be delivered.';
  if (!staff || d.state === 'delivered') return text;
  return `${text} (${d.statusCode ?? 'no answer'}${d.error ? `: ${d.error}` : ''})`;
}
