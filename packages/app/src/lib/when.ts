const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const two = (n: number) => String(n).padStart(2, '0');

/**
 * A moment as the customer reads it: "13 Nov 2026, 20:32" in the viewer's own
 * time zone, 24-hour and locale-free like the rest of the app's dates. `short`
 * leaves the year out while it is this year's ("13 Nov, 20:32"). Null for a
 * missing or unreadable date, so the caller shows nothing.
 */
export function dateTime(at: Date | string | null | undefined, opts: { short?: boolean; now?: Date } = {}): string | null {
  if (!at) return null;
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return null;
  const year = opts.short && d.getFullYear() === (opts.now ?? new Date()).getFullYear() ? '' : ` ${d.getFullYear()}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${year}, ${two(d.getHours())}:${two(d.getMinutes())}`;
}

/** The same moment in UTC, for a tooltip: "2026-11-13 19:32 UTC". */
export function utcDateTime(at: Date | string | null | undefined): string | null {
  if (!at) return null;
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? null : `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/** The viewer's offset from UTC at that moment: "UTC", "UTC+1", "UTC-5:30". `offsetMin` is for tests. */
export function zoneOffset(at: Date, offsetMin: number = -at.getTimezoneOffset()): string {
  if (offsetMin === 0) return 'UTC';
  const abs = Math.abs(offsetMin);
  const m = abs % 60;
  return `UTC${offsetMin > 0 ? '+' : '-'}${Math.floor(abs / 60)}${m ? `:${two(m)}` : ''}`;
}
