/**
 * The Usage screen's words (spec §5 `/usage`). Months are UTC keys so the
 * screen and `usage.byProject` agree on where a month starts, whatever the
 * browser's zone; the same reason `isoDate` in projects-view is UTC.
 */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number) as [number, number];
  return monthKey(new Date(Date.UTC(y, m - 1 + delta, 1)));
}

export function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number) as [number, number];
  return `${MONTHS[m - 1]} ${y}`;
}

/**
 * Cents, like every other price in the app. Below half a cent the figure is
 * not zero — a verification that cost $0.004 was not free — so it says so
 * instead of rounding to a "$0.00" the customer would read as nothing spent.
 */
export function usdLabel(n: number): string {
  if (n > 0 && n < 0.005) return '< $0.01';
  return `$${n.toFixed(2)}`;
}

export function pagesLabel(n: number): string {
  return `${n} ${n === 1 ? 'page' : 'pages'}`;
}

export type UsageRow = { id: string; name: string; slug: string; spendUsd: number; pagesCaptured: number };
export type UsageRowView = UsageRow & { spendLabel: string; pagesLabel: string };

/** Labels only; the API already orders by spend then name. Pure. */
export function usageView(rows: readonly UsageRow[]): UsageRowView[] {
  return rows.map((r) => ({ ...r, spendLabel: usdLabel(r.spendUsd), pagesLabel: pagesLabel(r.pagesCaptured) }));
}

export type UsageScreenState = 'loading' | 'empty' | 'error' | 'table';

/**
 * One state at a time (Global Constraints: loading / empty / error are
 * mutually exclusive). Error wins over pending — a query's `status` is one
 * of `pending` | `error` | `success`, never two — so this is really "which
 * of the three terminal cases, else loading", not a priority fight.
 */
export function usageScreenState({
  isPending,
  isError,
  rowCount,
}: {
  isPending: boolean;
  isError: boolean;
  rowCount: number;
}): UsageScreenState {
  if (isError) return 'error';
  if (isPending) return 'loading';
  return rowCount === 0 ? 'empty' : 'table';
}
