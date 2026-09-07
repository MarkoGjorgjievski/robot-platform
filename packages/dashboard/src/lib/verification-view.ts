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

export type CellResult =
  | { status: 'pass'; found: string }
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

export type VerificationRow = { completedAt: string | Date | null } | null | undefined;

/** Spec §4.6 red-cell hints, verbatim, with `found`/`type` substituted where the copy calls for it. */
export function hintFor(reason: FailReason, found?: string, type?: string): string {
  switch (reason) {
    case 'not_found':
      return "We couldn't find this value on this page. Check the value, or open the page and copy it exactly.";
    case 'different_value':
      return `On this page we found ${found ?? ''}. Is the expected value right, or does this product show it differently?`;
    case 'ambiguous':
      return 'Several places on the page match. Add to the description what distinguishes the one you want.';
    case 'type_mismatch':
      return `Found ${found ?? ''}, which is not a valid ${type ?? 'value'}.`;
  }
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
  if (cell.status === 'pass') return { status: 'pass', found: cell.found, weak };
  if (cell.status === 'not_captured') return { status: 'not_captured', weak };
  return {
    status: 'fail',
    found: cell.found,
    reason: cell.reason,
    hint: hintFor(cell.reason, cell.found, fieldType),
    weak,
  };
}

/** "N of M fields verified" — M is every field in `results`, N is every field with at least one certified path. Singular when M === 1. */
export function summaryLine(results: VerificationResults | null | undefined): string {
  const fields = Object.values(results ?? {});
  const total = fields.length;
  const verified = fields.filter((f) => f.certified.length > 0).length;
  return `${verified} of ${total} field${total === 1 ? '' : 's'} verified`;
}

/** A verification run is active from the moment it starts until `completedAt` is set. No row at all is not active. */
export function isVerificationActive(row: VerificationRow): boolean {
  return !!row && row.completedAt === null;
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
