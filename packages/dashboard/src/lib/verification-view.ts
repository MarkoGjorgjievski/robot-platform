// Pure view-model helpers for the Schema screen's verification surface
// (Task 15 brief). Kept dependency-free from tRPC/React so they are trivial
// to unit test: the route component casts the jsonb-typed `results`/
// `captures` fields it gets back from `sources.verificationStatus` into the
// shapes below (mirroring `@robot/scraper`'s verify/types.ts — not imported
// directly since the dashboard has no dependency on `@robot/scraper`) and
// hands them to these functions.

import type { GridRow, GridState } from './schema-grid';
import type { CellStatus } from '../components/schema-grid';

export type FailReason = 'not_found' | 'different_value' | 'ambiguous' | 'type_mismatch';

export type CertifiedSource = 'api' | 'json-ld' | 'meta' | 'xpath';

export type CellResult =
  | { status: 'pass'; found: string; path?: { source: CertifiedSource; path: string; transform?: string } }
  | { status: 'fail'; reason: FailReason; found?: string; nearMisses?: string[] }
  | { status: 'not_captured' };

export type FieldVerification = {
  key: string;
  cells: Record<string, CellResult>; // url → result
  certified: unknown[]; // ranked paths; empty when the field never passed
  weakEvidence: boolean;
  aiCalled: boolean;
  incomplete: boolean;
};

export type VerificationResults = Record<string, FieldVerification>;

export type VerificationRow =
  | { startedAt?: string | Date | null; completedAt: string | Date | null; errorMessage?: string | null }
  | null
  | undefined;

/** Spec 5.6 red-cell hints, verbatim, with `found`/`type` substituted where the copy calls for it. */
export function hintFor(reason: FailReason, found?: string, type?: string): string {
  switch (reason) {
    case 'not_found':
      return 'Not found on this page. Check the value, or say where it is.';
    case 'different_value':
      return `This page shows ${found ?? ''}. Is your value right, or does the page show it differently?`;
    case 'ambiguous':
      return 'Several places match. Add what makes yours different to the description.';
    case 'type_mismatch':
      return `Found ${found ?? ''}, which is not a valid ${type ?? 'value'}.`;
  }
}

/**
 * Where a green cell's value actually came from, in the operator's words
 * (M7): `xpath` is an internal name for "we read it off the rendered page",
 * so it is shown as `page`; the structured sources keep their own names
 * because those are what the evidence panels elsewhere call them. Undefined
 * for a pass whose result predates the per-cell `path` (older stored rows).
 */
function pathSourceLabel(source: CertifiedSource | undefined): string | undefined {
  if (!source) return undefined;
  return source === 'xpath' ? 'page' : source;
}

/**
 * The `cellStatus` shape a `SchemaGrid` cell needs, for one (field, url) pair.
 * `stale` wins over everything else — a row whose definition or expected
 * value has changed since the last save makes its old verification result
 * meaningless, whether that old result was a pass or a fail. `fieldType` is
 * only consulted for the `type_mismatch` hint's "<type>" substitution.
 */
export function cellStatusFor(
  results: VerificationResults | null | undefined,
  fieldKey: string,
  url: string,
  stale: boolean,
  fieldType?: string,
): CellStatus | null {
  if (stale) return { status: 'stale' };

  const fv = results?.[fieldKey];
  if (!fv) return null;
  const cell = fv.cells[url];
  if (!cell) return null;

  const weak = fv.weakEvidence || undefined;
  if (cell.status === 'pass') return { status: 'pass', found: cell.found, weak, pathSource: pathSourceLabel(cell.path?.source) };
  if (cell.status === 'not_captured') return { status: 'not_captured', weak };
  return {
    status: 'fail',
    found: cell.found,
    reason: cell.reason,
    hint: hintFor(cell.reason, cell.found, fieldType),
    weak,
  };
}

export type VerificationState = 'active' | 'stalled' | 'failed' | 'done' | 'none';

/**
 * How old an in-flight row is, in ms — `null` when it carries no parseable
 * `startedAt`. That is the "we cannot tell" case, and it must never read as
 * stalled: a row we cannot date stays `active` rather than showing the stall
 * banner over a run that may have started a second ago.
 */
function ageMs(row: NonNullable<VerificationRow>, now: number): number | null {
  if (row.startedAt === null || row.startedAt === undefined) return null;
  const started = row.startedAt instanceof Date ? row.startedAt.getTime() : Date.parse(row.startedAt);
  return Number.isNaN(started) ? null : now - started;
}

/**
 * The single classification the Schema screen reads (C1). A verification that
 * died with the api-server (`completedAt` never set, nothing polling it any
 * more) used to read as forever-`active` and wedge the screen: the grid
 * stayed disabled and Verify stayed greyed out with no way back. So an
 * in-flight row older than the server's own `VERIFY_STALL_MS` — handed to us
 * by `sources.verifyEstimate` as `stallMs`, never hardcoded here — is
 * `'stalled'`, not `'active'`, and the screen offers Verify again (whose
 * server side closes the stale row out and starts a fresh one).
 *
 * `'failed'` is a run that DID complete but recorded an `errorMessage`;
 * `'done'` is a clean completion; `'none'` is a Source never verified at all.
 */
export function verificationState(
  row: VerificationRow,
  opts?: { now?: number; stallMs?: number },
): VerificationState {
  if (!row) return 'none';
  if (row.completedAt !== null && row.completedAt !== undefined) {
    return row.errorMessage ? 'failed' : 'done';
  }
  const { now = Date.now(), stallMs } = opts ?? {};
  if (stallMs !== undefined) {
    const age = ageMs(row, now);
    if (age !== null && age > stallMs) return 'stalled';
  }
  return 'active';
}

/**
 * A row is stale (spec §4.6) when its name, type, description, or any
 * expected value differs from what was last saved — matched by `key`, since
 * that's what a verification result is keyed on. A row with no matching
 * saved row (freshly added, never saved) is never "stale": there is nothing
 * to have drifted from.
 */
export function isRowStale(row: GridRow, saved: GridState | null): boolean {
  if (!saved) return false;
  const savedRow = row.key ? saved.rows.find((r) => r.key === row.key) : undefined;
  if (!savedRow) return false;
  return (
    row.name !== savedRow.name ||
    row.type !== savedRow.type ||
    row.description !== savedRow.description ||
    row.expected.some((v, i) => v !== savedRow.expected[i])
  );
}

/**
 * Do the verification URLs differ between the grid and its saved baseline?
 * Order-sensitive (URL 1 and URL 2 swapped IS a change — every stored cell
 * is keyed by url, and the expected-value columns are positional) and
 * trimmed, since that is exactly what `toBindingInput` sends to the server.
 */
function urlsChanged(grid: GridState, saved: GridState): boolean {
  const trim = (u: string) => u.trim();
  const a = grid.urls.map(trim);
  const b = saved.urls.map(trim);
  if (a.length !== b.length) return true;
  if (a.some((u, i) => u !== b[i])) return true;
  return grid.listingUrl.trim() !== saved.listingUrl.trim();
}

/**
 * Which field keys a re-verify should scope to, given the previous
 * verification's `results` and the (post-save) grid vs. its pre-edit
 * baseline. `undefined` means "verify everything" — either there's no prior
 * run to compare against, or that prior run's `results` are empty (a
 * stalled/crashed run left nothing to diff), so scoping down would be
 * meaningless. Otherwise: every row whose field never certified (never
 * verified at all, or its last run had no certified path) or whose
 * definition/expected values drifted from the saved baseline — a plain `[]`
 * when nothing qualifies (everything's already green and unchanged). Rows
 * with no key (never saved) are skipped — nothing in `results` could ever
 * reference them.
 *
 * A CHANGED URL (or listing URL) also forces `undefined`. Every stored cell
 * result is keyed on the URL it was proven against, so when the set of URLs
 * moves, none of the previous results describe the pages we are about to
 * verify — but no ROW changed, so the per-row staleness check above sees
 * nothing and would hand back `[]`. Server-side `[]` is truthy, which means
 * "re-run none of them, copy them all": the copies (cells keyed by the OLD
 * urls) would be stored under the NEW definitionHash and Extract would
 * unlock against pages nobody verified.
 */
export function reverifyKeys(
  results: VerificationResults | null | undefined,
  grid: GridState,
  savedGrid: GridState | null,
): string[] | undefined {
  if (!results || Object.keys(results).length === 0) return undefined;
  if (savedGrid && urlsChanged(grid, savedGrid)) return undefined;
  const keys: string[] = [];
  for (const row of grid.rows) {
    if (!row.key) continue;
    const fv = results[row.key];
    if (isRowStale(row, savedGrid) || !fv || fv.certified.length === 0) keys.push(row.key);
  }
  return keys;
}
