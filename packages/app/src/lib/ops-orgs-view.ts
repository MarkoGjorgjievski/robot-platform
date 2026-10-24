// The ops "Organisations" view (spec 2026-10-24 metering §2.4): staff only. Pure. Mirrors `ops.orgs`' row (the app's
// views re-declare the api's shapes, like ops-view.ts).
import { monthKey, monthLabel, pagesLabel, runsLabel, shiftMonth, usdLabel } from './usage-view';
import { capText } from './ai-limit-view';

export type OpsOrgRow = {
  org: { id: string; name: string; slug: string };
  websites: number; pages: number; runs: number; aiUsd: number; jevUsd: number;
  capUsd: number | null; capIsDefault: boolean; ownCapUsd: number | null; defaultCapUsd: number | null;
  remainingUsd: number | null; percentUsed: number | null; reached: boolean;
};

export const LIMIT_REACHED = 'Limit reached';

export function capCell(r: Pick<OpsOrgRow, 'capUsd' | 'capIsDefault'>): string {
  if (r.capUsd === null) return 'No limit';
  return r.capIsDefault ? `${capText(r.capUsd)} (default)` : capText(r.capUsd);
}

export function percentCell(p: number | null): string {
  if (p === null) return '—';
  if (p > 0 && p < 1) return '<1%';
  return `${Math.round(p)}%`;
}

/** Labels only; the api orders the rows (highest % first, no limit last, then name). */
export function opsOrgsView(rows: readonly OpsOrgRow[]) {
  return rows.map((r) => ({
    id: r.org.id,
    name: r.org.name,
    websitesLabel: `${r.websites} ${r.websites === 1 ? 'website' : 'websites'}`,
    pagesLabel: pagesLabel(r.pages),
    runsLabel: runsLabel(r.runs),
    aiLabel: usdLabel(r.aiUsd),
    capLabel: capCell(r),
    percentLabel: percentCell(r.percentUsed),
    reached: r.reached,
    jevLabel: r.jevUsd === 0 ? '—' : usdLabel(r.jevUsd),
  }));
}

/** This month and the six before it, newest first (UTC, as `usage.byProject` keys months). */
export function opsOrgMonths(now: Date): Array<{ key: string; label: string }> {
  const current = monthKey(now);
  return Array.from({ length: 7 }, (_, i) => {
    const key = shiftMonth(current, -i);
    return { key, label: monthLabel(key) };
  });
}

export function matchesOrgQuery(row: Pick<OpsOrgRow, 'org'>, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || row.org.name.toLowerCase().includes(q) || row.org.slug.toLowerCase().includes(q);
}
