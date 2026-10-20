// Pure view-model helpers for the Verification tab's verification surface
// (Task 15 brief). Kept dependency-free from tRPC/React so they are trivial
// to unit test: the route component casts the jsonb-typed `results`/
// `captures` fields it gets back from `sources.verificationStatus` into the
// shapes below (mirroring `@robot/scraper`'s verify/types.ts — not imported
// directly since the dashboard has no dependency on `@robot/scraper`) and
// hands them to these functions.

import { aiUnavailableHint, notCheckedText } from './verify-messages';

/** The status of one (field, url) verification cell, for cellStatusFor's callers. */
export type CellStatus = { status: 'pass' | 'fail' | 'not_captured' | 'stale'; found?: string; reason?: string; hint?: string; weak?: boolean; pathSource?: string; layout?: number };

export type FailReason = 'not_found' | 'different_value' | 'ambiguous' | 'type_mismatch' | 'no_fitting_path' | 'found_unexpected' | 'elsewhere';

export type CertifiedSource = 'api' | 'json-ld' | 'meta' | 'xpath';

/** The variant a proof page's capture shows and the variant its address names — mirrors
 * `@robot/browser`'s `PageVariant` (not imported; spec 2026-10-14 §6). */
export type PageVariantLike = { ids: string[]; pairs: Array<{ name: string; value: string }>; labels: string[]; named: boolean; selected: boolean };

export type CellResult =
  | { status: 'pass'; found: string; path?: { source: CertifiedSource; path: string; transform?: string } }
  | { status: 'fail'; reason: FailReason; found?: string; nearMisses?: string[] }
  | { status: 'not_captured' };

export type FieldVerification = {
  key: string;
  cells: Record<string, CellResult>; // url → result
  certified: unknown[]; // ranked paths; empty when the field never passed
  /** Passed on the website's default alone: no path certified (spec 2026-10-13 §4). */
  defaultOnly?: true;
  /** Not on this website at all — absent on every product (spec 2026-10-17 §2). */
  notOnWebsite?: true;
  /** The field's AI step failed this run (spec 2026-10-20 §3.3); its other results stand. Absent otherwise. */
  failReason?: 'ai_unavailable';
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
/** `field`: the field's name, for the no_fitting_path hint (spec 2026-09-29 C2). `product`: the
 * 1-based product number, for the found_unexpected hint (spec 2026-10-10 §B3/§5) — a page the
 * customer said doesn't have this field, but a value was found on it. */
export function hintFor(reason: FailReason, found?: string, type?: string, field?: string, product?: number): string {
  switch (reason) {
    case 'not_found':
      return 'Not found on this page. Check the value, or say where it is.';
    case 'different_value':
      return `This page shows ${found ?? ''}. Is your value right, or does the page show it differently?`;
    case 'ambiguous':
      return 'Found on this product, but not in the same place as on the others. Mark it on the screenshot.';
    case 'type_mismatch':
      return `Found ${found ?? ''}, which is not a valid ${type ?? 'value'}.`;
    case 'no_fitting_path':
      return `We can't tell which value on this page is ${field || 'this field'} — mark it on the screenshot.`;
    case 'found_unexpected':
      return `Found ${found ?? 'a value'}${product !== undefined ? ` on product ${product}` : ''}, but you said it isn't there. Is it there after all?`;
    case 'elsewhere':
      return `Found on this product, but not where your other products show it. If this product really has no ${field || 'value'} of its own, choose "Not on this product".`;
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
  product?: number,
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
    hint: hintFor(cell.reason, cell.found, fieldType, fieldName, product),
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
 * What a cell says under its state (spec 2026-10-20 §3.3, §3.5.1, §3.5.2): the field's AI failure on
 * any of its cells, a fail cell's hint, or why a page was not checked. Undefined for a pass, for a
 * field that changed since its result, and before any result.
 */
export function cellHint(args: {
  results: VerificationResults | null | undefined;
  key: string;
  url: string;
  unchanged: boolean;
  fieldType?: string;
  fieldName: string;
  product: number;
  blockedReason?: string;
}): string | undefined {
  if (!args.unchanged) return undefined;
  const fv = args.results?.[args.key];
  if (!fv) return undefined;
  if (fv.failReason === 'ai_unavailable' && fv.certified.length === 0) return aiUnavailableHint(args.fieldName);
  const cell = fv.cells[args.url];
  if (!cell) return undefined;
  if (cell.status === 'fail') return hintFor(cell.reason, cell.found, args.fieldType, args.fieldName, args.product);
  if (cell.status === 'not_captured') return notCheckedText(args.product, args.blockedReason);
  return undefined;
}

/** url → the reason the run could not capture that page, from a status answer's `captures` (a ref with no capture id). */
export function blockedReasons(captures: unknown): Record<string, string> {
  if (!captures || typeof captures !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [url, ref] of Object.entries(captures as Record<string, unknown>)) {
    const r = ref && typeof ref === 'object' ? (ref as { captureId?: unknown; blockedReason?: unknown }) : null;
    if (r && !r.captureId && typeof r.blockedReason === 'string') out[url] = r.blockedReason;
  }
  return out;
}
