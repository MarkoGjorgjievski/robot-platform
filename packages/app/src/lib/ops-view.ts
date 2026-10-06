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

// ─── `/ops/websites/$sourceId` — one website (cut-over Task 4) ─────────────

/** `ops.website`'s certified-source vocabulary, named with the ops page's own kind words. */
export type OpsPathSource = 'api' | 'json-ld' | 'meta' | 'xpath';

/** One row of `ops.website`'s `fields[].paths` — the ladder's one step. */
export type OpsFieldPath = { source: OpsPathSource; path: string; provenOn?: string[]; uses: number; hits: number; container?: string };

/** One section of `ops.website`'s `fields` — a contract field's certified paths, in try order. */
/**
 * `current` — the field's latest verification result passed and still
 * matches the field as it stands now (`loadFieldCurrency`'s `currentKeys`).
 * `changed` — a result exists but is not current, typically because the
 * field, its proof pages or its expected values changed since that result
 * ran; its (possibly stale) paths are still shown, flagged. `none` — no
 * result at all: "Not verified yet" (reviewer fix round 1).
 */
export type OpsFieldState = 'current' | 'changed' | 'none';
export type OpsField = { key: string; name: string; type: string; state: OpsFieldState; paths: OpsFieldPath[] };

/** Kind, in the customer's own words (Global Constraints) — never the internal `CertifiedSource` vocabulary. */
const PATH_KIND: Record<OpsPathSource, string> = { api: 'API', 'json-ld': 'Page data', meta: 'Meta', xpath: 'Page element' };
export function pathKind(source: OpsPathSource): string {
  return PATH_KIND[source];
}

/**
 * "Proven on" (Global Constraints): no `provenOn` reads as every proof page;
 * otherwise the 1-based positions of `provenOn`'s urls within `proofUrls`,
 * joined "product 1" / "products 1 and 3" / "products 1, 2 and 3" — singular
 * only for exactly one page. A `provenOn` url this website's current
 * `proofUrls` no longer lists (a binding changed since certification) is
 * dropped rather than crashing; an empty result still reads as every page,
 * since there is nothing narrower left to say.
 */
export function provenText(provenOn: string[] | undefined, proofUrls: readonly string[]): string {
  if (!provenOn) return 'all proof pages';
  const positions = provenOn
    .map((url) => proofUrls.indexOf(url))
    .filter((i) => i >= 0)
    .map((i) => i + 1)
    .sort((a, b) => a - b);
  if (positions.length === 0) return 'all proof pages';
  if (positions.length === 1) return `product ${positions[0]}`;
  const joined = positions.length === 2
    ? `${positions[0]} and ${positions[1]}`
    : `${positions.slice(0, -1).join(', ')} and ${positions[positions.length - 1]}`;
  return `products ${joined}`;
}

/** "In runs" (Global Constraints): 0 uses reads "Not needed yet", in neutral colour, never "0 %" and never as a problem. */
export function runStatsText(uses: number, hits: number): string {
  if (uses === 0) return 'Not needed yet';
  return `${hits} of ${uses} (${pathPercent(uses, hits)} %)`;
}

/** A path's hit rate, rounded, or `null` for a path with 0 uses — the one place the ladder's bar width, a field row's "First path {pct} %" and the below-90 % flag all read it from, so the three never disagree. */
export function pathPercent(uses: number, hits: number): number | null {
  return uses === 0 ? null : Math.round((hits / uses) * 100);
}

/** The one-source warning's exact text (Global Constraints) — display only, never an error. */
export const ONE_SOURCE_WARNING = 'All backups read the same response — if it changes, they fail together';

/**
 * The one-source warning (Global Constraints): a field with more than one
 * certified path, every one of them `api` or every one `json-ld`. For
 * `api`, `container` (the intercepted request's url) is what tells two
 * backups apart — a path with none recorded reads as the same response as
 * any other (the brief's own rule), so the warning fires unless at least
 * two DIFFERENT containers are on record.
 */
export function oneSourceWarning(paths: ReadonlyArray<Pick<OpsFieldPath, 'source' | 'container'>>): string | null {
  if (paths.length < 2) return null;
  const allApi = paths.every((p) => p.source === 'api');
  const allJsonLd = paths.every((p) => p.source === 'json-ld');
  if (!allApi && !allJsonLd) return null;
  if (allApi) {
    const containers = new Set(paths.map((p) => p.container).filter((c): c is string => !!c));
    if (containers.size > 1) return null;
  }
  return ONE_SOURCE_WARNING;
}

/** The collapsed row's "API, 2 backups" / "Page data, no backups" (Global Constraints: "the first path's kind and backup count"). */
export function backupsSummary(paths: ReadonlyArray<Pick<OpsFieldPath, 'source'>>): string {
  const backups = paths.length - 1;
  const kind = pathKind(paths[0]!.source);
  return backups === 0 ? `${kind}, no backups` : `${kind}, ${backups} backup${backups > 1 ? 's' : ''}`;
}

/**
 * The collapsed row's warn flag (Global Constraints, reviewer fix round 1):
 * the first that applies — drift outranks a field that changed since it was
 * verified, which outranks a shared source, which outranks a weak first
 * path — never more than one shown at once. `null` when none applies.
 */
export function fieldFlag(args: { drifted: boolean; changed: boolean; oneSource: boolean; firstPathPct: number | null }): string | null {
  if (args.drifted) return 'Stopped extracting';
  if (args.changed) return 'Changed since verified';
  if (args.oneSource) return 'Backups share one source';
  if (args.firstPathPct !== null && args.firstPathPct < 90) return `First path finds it on ${args.firstPathPct} %`;
  return null;
}

/**
 * The website page's summary strip "Last run" cell (plan "Ops design"):
 * "Completed 2 h ago, 1,248 rows", "Failed 35 min ago", "Running" or "No
 * runs" — a longer sentence than the overview's own `lastRunText`, which
 * this does not replace: the overview's table cell has no room for a row
 * count, the website page's strip does.
 */
export function siteLastRunText(lastRun: { status: string; at: string; rows: number | null } | null, now: Date = new Date()): string {
  if (!lastRun) return 'No runs';
  const state = runDotState({ status: lastRun.status });
  if (state === 'running') return 'Running';
  const label = state === 'done' ? 'Completed' : state === 'failed' ? 'Failed' : state === 'partial' ? 'Partial' : 'Done';
  const when = relativeTime(new Date(lastRun.at), now);
  const rows = (state === 'done' || state === 'partial') && typeof lastRun.rows === 'number' ? `, ${lastRun.rows.toLocaleString('en-US')} rows` : '';
  return `${label} ${when}${rows}`;
}

// `@robot/api`'s `DriftFieldResult`/`DriftPage` (verify/run-drift-check.ts),
// re-declared narrow — the app never imports `@robot/scraper`'s verify
// types, same reason `lib/site/drift-view.ts` re-declares its own.
export type OpsDriftPage = { status: 'ok'; value: string | null; changed?: boolean; was?: string } | { status: 'page-gone' };
export type OpsDriftFieldResult = { key: string; result: 'other-layout' | 'moved' | 'changed' | 'lost'; pages: Record<string, OpsDriftPage> };
/** `ops.website`'s `drift.results` once the check is done. */
export type OpsDriftResults = { fields: Record<string, OpsDriftFieldResult> } | null;

/** The three result kinds whose "What changed" text never depends on a page's value (Global Constraints). */
const DRIFT_RESULT_TEXT: Record<'moved' | 'other-layout' | 'lost', string> = {
  moved: 'Moved on the page — a new location is proposed',
  'other-layout': 'Still works on the proof pages; some other products differ',
  lost: 'Not found on the page',
};

/**
 * A `changed` field's text (Global Constraints): "Page now shows {new} (was
 * {old})", across whichever proof pages actually changed — more than one
 * names each by position ("… on product n"), the same join rule
 * `lib/site/drift-view.ts`'s `driftRows` uses for its own `changed` row,
 * minus the accept affordance: ops is read-only, it only explains.
 */
function changedText(pages: Record<string, OpsDriftPage>, proofUrls: readonly string[]): string {
  const lines: Array<{ n: number; line: string }> = [];
  proofUrls.forEach((url, i) => {
    const p = pages[url];
    if (!p || p.status !== 'ok' || p.value === null || p.changed === false) return;
    lines.push({ n: i + 1, line: `Page now shows ${p.value} (was ${p.was ?? ''})` });
  });
  if (lines.length === 0) return 'Page now shows a different value';
  return lines.length === 1 ? lines[0]!.line : lines.map((l) => `${l.line} on product ${l.n}`).join('; ');
}

/**
 * One line per drifted field, for the "What changed" notice (plan "Ops
 * design"): the field's own result, in the Verification tab's own wording
 * minus the accept affordance, plus one "Product {n} no longer loads" line
 * for each proof page that field's check found gone. A key with no entry in
 * `results.fields` (the check hasn't classified it, or found nothing to
 * say) is skipped rather than shown blank.
 */
export function driftNoticeLines(args: {
  driftedKeys: readonly string[];
  fieldNames: Record<string, string>;
  results: OpsDriftResults;
  proofUrls: readonly string[];
}): Array<{ name: string; text: string }> {
  const { driftedKeys, fieldNames, results, proofUrls } = args;
  if (!results) return [];
  const out: Array<{ name: string; text: string }> = [];
  for (const key of driftedKeys) {
    const r = results.fields[key];
    if (!r) continue;
    const name = fieldNames[key] ?? key;
    out.push({ name, text: r.result === 'changed' ? changedText(r.pages, proofUrls) : DRIFT_RESULT_TEXT[r.result] });
    proofUrls.forEach((url, i) => {
      if (r.pages[url]?.status === 'page-gone') out.push({ name, text: `Product ${i + 1} no longer loads` });
    });
  }
  return out;
}

/** The overview's shareable URL state (view/reason/search/customer/sort) — named here, not in the route, so the website page's breadcrumb can round-trip it without importing a route file. */
export type OpsOverviewState = {
  view?: 'attention' | 'all';
  reason?: 'drift' | 'failed' | 'unverified';
  q?: string;
  customer?: string;
  sort?: OpsSortKey;
};

const OPS_REASON_KEYS = OPS_REASONS.map((r) => r.key);
const OPS_SORT_KEYS: readonly OpsSortKey[] = ['run-desc', 'run-asc', 'spend-desc', 'spend-asc'];

/**
 * Packs the overview's shareable state into one query string, carried as the
 * website page's `from` search param so its first two breadcrumb crumbs
 * return to exactly the view the operator left ("Ops design": the first two
 * crumbs link back, keeping the overview's URL state).
 */
export function encodeOpsOverviewState(state: OpsOverviewState): string {
  const params = new URLSearchParams();
  if (state.view) params.set('view', state.view);
  if (state.reason) params.set('reason', state.reason);
  if (state.q) params.set('q', state.q);
  if (state.customer) params.set('customer', state.customer);
  if (state.sort) params.set('sort', state.sort);
  return params.toString();
}

/** The inverse of `encodeOpsOverviewState`, validated the same way `/ops`'s own `validateSearch` would — a missing, empty or tampered `from` degrades to "no state" rather than a crash. */
export function decodeOpsOverviewState(raw: string | undefined): OpsOverviewState {
  if (!raw) return {};
  const params = new URLSearchParams(raw);
  const view = params.get('view');
  const reason = params.get('reason');
  const q = params.get('q');
  const customer = params.get('customer');
  const sort = params.get('sort');
  return {
    view: view === 'all' || view === 'attention' ? view : undefined,
    reason: OPS_REASON_KEYS.includes(reason as (typeof OPS_REASON_KEYS)[number]) ? (reason as OpsOverviewState['reason']) : undefined,
    q: q && q.length > 0 ? q : undefined,
    customer: customer && customer.length > 0 ? customer : undefined,
    sort: OPS_SORT_KEYS.includes(sort as OpsSortKey) ? (sort as OpsSortKey) : undefined,
  };
}
