// View logic for the ops overview, `/ops` (plan "Ops design", cut-over Task
// 3): the default row order, the exact texts the Global Constraints give for
// the Verified/Last run cells, and the small pure helpers the route's toolbar
// (search, reason chips, money) reads. Pure and server-shape-agnostic, so the
// texts and the order are tested without a server or a browser — the route
// only calls these and renders what comes back.
import { relativeTime } from './projects-view';
import { runDotState } from './run-dot-view';

/** One row of `ops.websites`, narrowed to what this file's helpers read. */
export type OpsWebsiteRow = {
  sourceId: string;
  org: { id: string; name: string; slug: string };
  project: { name: string; slug: string };
  website: { name: string; slug: string; host: string };
  fields: number;
  currentFields: number;
  drifted: number;
  lastRun: { status: string; at: string } | null;
  spentThisMonthUsd: number;
};

/** The field stopped extracting (Global Constraints). */
export function isDrifted(row: Pick<OpsWebsiteRow, 'drifted'>): boolean {
  return row.drifted > 0;
}

/** The dot's own "failed" — the same mapping the Last run column's dot uses, so a row flagged here is a row that shows a red dot. */
export function lastRunFailed(row: Pick<OpsWebsiteRow, 'lastRun'>): boolean {
  return !!row.lastRun && runDotState({ status: row.lastRun.status }) === 'failed';
}

/** Short of every contract field being currently certified (spec 4.4). */
export function notFullyVerified(row: Pick<OpsWebsiteRow, 'fields' | 'currentFields'>): boolean {
  return row.currentFields < row.fields;
}

/** Any of the three reasons the toolbar's chips name. */
export function needsAttention(row: OpsWebsiteRow): boolean {
  return isDrifted(row) || lastRunFailed(row) || notFullyVerified(row);
}

/** 0 = drift, 1 = failed last run, 2 = not fully verified, 3 = the rest — the Global Constraints' own priority. */
function attentionRank(row: OpsWebsiteRow): 0 | 1 | 2 | 3 {
  if (isDrifted(row)) return 0;
  if (lastRunFailed(row)) return 1;
  if (notFullyVerified(row)) return 2;
  return 3;
}

/** A website that has never run sorts after any that has (oldest possible activity). */
function activityTime(row: OpsWebsiteRow): number {
  return row.lastRun ? new Date(row.lastRun.at).getTime() : -Infinity;
}

/**
 * The overview's default order (Global Constraints): drift first, then a
 * failed last run, then not fully verified, then the rest — each group by
 * most recent activity first. Returns a new array; `rows` is never mutated.
 */
export function opsRowOrder(rows: readonly OpsWebsiteRow[]): OpsWebsiteRow[] {
  return [...rows].sort((a, b) => attentionRank(a) - attentionRank(b) || activityTime(b) - activityTime(a));
}

/**
 * The Verified cell's text (Global Constraints): "{c} of {n} fields" whether
 * that is every field (the pass rail) or only some (the warn rail) — the
 * rail colour, not the words, says which — and "Not verified" for zero.
 */
export function verifiedText(currentFields: number, fields: number): string {
  return currentFields === 0 ? 'Not verified' : `${currentFields} of ${fields} fields`;
}

/** The Verified cell's rail colour, matching `verifiedText`'s own cases. */
export type VerifiedState = 'pass' | 'warn' | 'fail';
export function verifiedState(currentFields: number, fields: number): VerifiedState {
  if (currentFields === 0) return 'fail';
  return currentFields === fields ? 'pass' : 'warn';
}

/** The Last run cell's text (Global Constraints): status and relative time, or "No runs". */
export function lastRunText(lastRun: OpsWebsiteRow['lastRun'], now: Date = new Date()): string {
  if (!lastRun) return 'No runs';
  const state = runDotState({ status: lastRun.status });
  if (state === 'running') return 'Running';
  return relativeTime(new Date(lastRun.at), now);
}

/** The This month cell's text: "$3.42", or "—" for exactly zero. */
export function moneyText(usd: number): string {
  return usd === 0 ? '—' : `$${usd.toFixed(2)}`;
}

/** "Needs attention" is the default view only while something needs it — an all-clear overview opens on "All" rather than an empty table. */
export function defaultOpsView(needsAttentionCount: number): 'attention' | 'all' {
  return needsAttentionCount > 0 ? 'attention' : 'all';
}

/** The search box: website name, host, customer (org) and project — matched case-insensitively, substring. */
export function matchesOpsQuery(row: OpsWebsiteRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [row.website.name, row.website.host, row.org.name, row.project.name].some((s) => s.toLowerCase().includes(q));
}

/** The toolbar's reason chips, in the order they're shown — each the Global Constraints' own label and test. */
export const OPS_REASONS: Array<{ key: 'drift' | 'failed' | 'unverified'; label: string; test: (row: OpsWebsiteRow) => boolean }> = [
  { key: 'drift', label: 'Stopped extracting', test: isDrifted },
  { key: 'failed', label: 'Last run failed', test: lastRunFailed },
  { key: 'unverified', label: 'Not fully verified', test: notFullyVerified },
];

/** The two sortable headers, each with the direction that sorts "most first" (desc) or reverses it (asc). */
export type OpsSortKey = 'run-desc' | 'run-asc' | 'spend-desc' | 'spend-asc';

/**
 * An explicit column sort (Global Constraints: "Last run" and "This month"
 * are sortable headers). The default problems-first order lives in
 * `opsRowOrder` instead — this is only reached once a header has been
 * clicked. Returns a new array; `rows` is never mutated.
 */
export function sortRowsBy(rows: readonly OpsWebsiteRow[], sort: OpsSortKey): OpsWebsiteRow[] {
  const [column, dir] = sort.split('-') as ['run' | 'spend', 'asc' | 'desc'];
  const valueOf = column === 'run' ? activityTime : (r: OpsWebsiteRow) => r.spentThisMonthUsd;
  const ascending = (a: OpsWebsiteRow, b: OpsWebsiteRow) => valueOf(a) - valueOf(b);
  return [...rows].sort(dir === 'asc' ? ascending : (a, b) => ascending(b, a));
}

/** The footer's right side (Global Constraints): names the active sort, or the default problems-first order. */
export function sortFooterText(sort: OpsSortKey | undefined): string {
  if (!sort) return 'Sorted by what needs you, then most recent activity';
  return sort.startsWith('run') ? 'Sorted by last run' : 'Sorted by spend this month';
}

/** The footer's left side: "{n} websites across {m} customers". */
export function totalsText(websiteCount: number, customerCount: number): string {
  return `${websiteCount} ${websiteCount === 1 ? 'website' : 'websites'} across ${customerCount} ${customerCount === 1 ? 'customer' : 'customers'}`;
}
