// Pure view-model helpers for the Schema screen's verification surface
// (Task 15 brief). Kept dependency-free from tRPC/React so they are trivial
// to unit test: the route component casts the jsonb-typed `results`/
// `captures` fields it gets back from `sources.verificationStatus` into the
// shapes below (mirroring `@robot/scraper`'s verify/types.ts — not imported
// directly since the dashboard has no dependency on `@robot/scraper`) and
// hands them to these functions.

import type { GridRow, GridState } from './schema-grid';
import type { CellStatus } from '../components/schema-grid';

export type FailReason = 'not_found' | 'different_value' | 'ambiguous' | 'type_mismatch' | 'no_fitting_path';

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
  thinEvidence?: boolean;
  aiCalled: boolean;
  incomplete: boolean;
};

/** The identity fields a certified path needs, for matching a cell's proving path against
 * the field's ranked `certified` list (M8's per-cell `layout` number) — plus the optional
 * set of proof pages it was proven on (spec 2026-09-17 §3). `certified` stays `unknown[]`
 * above since most callers never need its shape; this is only for that one comparison. */
type CertifiedPathLike = { source: CertifiedSource; path: string; transform?: string; provenOn?: string[] };

export type VerificationResults = Record<string, FieldVerification>;

export type VerificationRow =
  | { startedAt?: string | Date | null; completedAt: string | Date | null; errorMessage?: string | null }
  | null
  | undefined;

/** Spec 5.6 red-cell hints, verbatim, with `found`/`type` substituted where the copy calls for it. */
/** `field`: the field's name, for the no_fitting_path hint (spec 2026-09-29 C2). */
export function hintFor(reason: FailReason, found?: string, type?: string, field?: string): string {
  switch (reason) {
    case 'not_found':
      return 'Not found on this page. Check the value, or say where it is.';
    case 'different_value':
      return `This page shows ${found ?? ''}. Is your value right, or does the page show it differently?`;
    case 'ambiguous':
      return 'Several places match. Add what makes yours different to the description.';
    case 'type_mismatch':
      return `Found ${found ?? ''}, which is not a valid ${type ?? 'value'}.`;
    case 'no_fitting_path':
      return `We can't tell which value on this page is ${field || 'this field'} — mark it on the screenshot.`;
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
  fieldName?: string,
): CellStatus | null {
  if (stale) return { status: 'stale' };

  const fv = results?.[fieldKey];
  if (!fv) return null;
  const cell = fv.cells[url];
  if (!cell) return null;

  const weak = fv.weakEvidence || undefined;
  if (cell.status === 'pass') {
    // Which certified path proved this page, 1-based, only when the field needed more than one layout.
    const same = (a: CertifiedPathLike, b: CertifiedPathLike) => a.source === b.source && a.path === b.path && a.transform === b.transform;
    const certified = fv.certified as CertifiedPathLike[];
    const at = certified.length > 1 && cell.path ? certified.findIndex((p) => same(p, cell.path!)) : -1;
    return { status: 'pass', found: cell.found, weak, pathSource: pathSourceLabel(cell.path?.source), ...(at >= 0 ? { layout: at + 1 } : {}) };
  }
  if (cell.status === 'not_captured') return { status: 'not_captured', weak };
  return {
    status: 'fail',
    found: cell.found,
    reason: cell.reason,
    hint: hintFor(cell.reason, cell.found, fieldType, fieldName),
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

/** The (url, expected) pairs a row is actually checked on: blank cells on pages four to six
 * are "not checked" and take no part (mirrors the server's `checkedPages` / `fieldHash`). */
function checkedCells(row: GridRow, urls: string[]): Array<[string, string]> {
  return urls.map((u, i) => [u.trim(), row.expected[i] ?? ''] as [string, string]).filter(([, v]) => v.trim() !== '');
}

/**
 * Has this row drifted from what was last saved? Its definition, or the pages
 * it is checked on, or a value on one of them. A page added for ANOTHER field
 * leaves this row alone (spec 2026-09-17 §4); replacing one of the first three
 * pages moves every row, since every row has a value there.
 */
export function isRowStale(row: GridRow, grid: GridState, saved: GridState | null): boolean {
  if (!saved) return false;
  const savedRow = row.key ? saved.rows.find((r) => r.key === row.key) : undefined;
  if (!savedRow) return false;
  return (
    row.name !== savedRow.name ||
    row.type !== savedRow.type ||
    row.description !== savedRow.description ||
    JSON.stringify(checkedCells(row, grid.urls)) !== JSON.stringify(checkedCells(savedRow, saved.urls))
  );
}

/**
 * Which field keys a re-verify should scope to, given the previous
 * verification's `results` and the (post-save) grid vs. its pre-edit
 * baseline. `undefined` means "verify everything" — either there's no prior
 * run to compare against, or that prior run's `results` are empty (a
 * stalled/crashed run left nothing to diff), so scoping down would be
 * meaningless. Otherwise: every row whose field never certified (never
 * verified at all, or its last run had no certified path), whose
 * definition/checked pages drifted from the saved baseline (`isRowStale`,
 * which now covers a url change per row — see below), or — when
 * `currentKeys` is given — whose key the server no longer counts as current
 * (its stored `fieldHash` no longer matches the live definition, even
 * though its last result did certify) — a plain `[]` when nothing
 * qualifies (everything's already green, unchanged, and current). Rows
 * with no key (never saved) are skipped — nothing in `results` could ever
 * reference them.
 *
 * A changed URL is no longer handled here as a blanket `undefined` — the old
 * `urlsChanged` short-circuit is gone. `isRowStale`'s `checkedCells` pairs
 * each page's url with its expected value, so a moved or swapped url shows up
 * as drift on every row checked against that page, same as any other edit.
 */
export function reverifyKeys(
  results: VerificationResults | null | undefined,
  grid: GridState,
  savedGrid: GridState | null,
  currentKeys?: string[],
): string[] | undefined {
  if (!results || Object.keys(results).length === 0) return undefined;
  const keys: string[] = [];
  for (const row of grid.rows) {
    if (!row.key) continue;
    const fv = results[row.key];
    if (isRowStale(row, grid, savedGrid) || !fv || fv.certified.length === 0 || (currentKeys && !currentKeys.includes(row.key))) keys.push(row.key);
  }
  return keys;
}
