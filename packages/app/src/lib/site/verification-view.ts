// Pure view-model helpers for the Verification tab's verification surface
// (Task 15 brief). Kept dependency-free from tRPC/React so they are trivial
// to unit test: the route component casts the jsonb-typed `results`/
// `captures` fields it gets back from `sources.verificationStatus` into the
// shapes below (mirroring `@robot/scraper`'s verify/types.ts — not imported
// directly since the dashboard has no dependency on `@robot/scraper`) and
// hands them to these functions.

/** The status of one (field, url) verification cell, for cellStatusFor's callers. */
export type CellStatus = { status: 'pass' | 'fail' | 'not_captured' | 'stale'; found?: string; reason?: string; hint?: string; weak?: boolean; pathSource?: string; layout?: number };

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
 * The `CellStatus` for one (field, url) pair.
 * `stale` wins over everything else — a row whose definition or expected
 * value has changed since the last save makes its old verification result
 * meaningless, whether that old result was a pass or a fail. `fieldType` is
 * only consulted for the `type_mismatch` hint's "<type>" substitution;
 * `fieldName` only for the `no_fitting_path` hint's field name.
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
