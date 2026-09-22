// The two decisions the Schema screen makes that no ported function already
// makes. Pure, so they are testable without a browser (task 4, app redesign
// plan 3). Everything else on that screen comes from `schema-grid.ts`,
// `verification-view.ts`, `schema-tab-view.ts` and `schema-stepper-view.ts`.
import type { GridRow, GridState } from './schema-grid';
import { isRowStale, type VerificationResults } from './verification-view';

/**
 * Has this cell's stored result stopped describing what is typed above it?
 *
 * Three ways, and a precondition. The precondition is that there IS a stored
 * result for this field: without it the first edit after a save painted
 * "changed since verified" across a grid that had never been verified at all —
 * untrue, and the loudest thing on the screen. Then:
 *
 * 1. the row drifted from what was last saved (`isRowStale`);
 * 2. the server no longer counts the key current — its stored `fieldHash` no
 *    longer matches the live definition, even though its last result certified;
 * 3. this column's URL was edited since, so the stored result at this index was
 *    proven against a different page. The old result stays visible, as stale,
 *    rather than vanishing.
 */
export function cellIsStale(args: {
  row: GridRow;
  grid: GridState;
  savedGrid: GridState | null;
  results: VerificationResults | null;
  currentKeys: string[];
  urlIndex: number;
}): boolean {
  const { row, grid, savedGrid, results, currentKeys, urlIndex } = args;
  const key = row.key;
  if (!key || !results?.[key]) return false;
  if (isRowStale(row, grid, savedGrid)) return true;
  if (!currentKeys.includes(key)) return true;
  const saved = savedGrid?.urls[urlIndex];
  return !!(saved && grid.urls[urlIndex] !== saved && results[key]?.cells[saved]);
}

/**
 * The explicit "Save pages and values" button (spec §6: every disabled control
 * has a visible reason within one line of it). Saving costs nothing, so it is
 * offered whenever there is something to save that the API would accept — the
 * first binding problem is the reason when there is not.
 *
 * A verification in flight refuses the save server-side, so the button says so
 * rather than letting the customer find out from an error.
 */
export function saveButton(args: {
  dirty: boolean;
  problems: string[];
  active: boolean;
  busy: boolean;
}): { disabled: boolean; reason?: string } {
  if (args.active) return { disabled: true, reason: 'A verification is running' };
  if (args.busy) return { disabled: true, reason: 'Saving' };
  if (!args.dirty) return { disabled: true, reason: 'Nothing has changed since the last save' };
  if (args.problems.length > 0) return { disabled: true, reason: args.problems[0] };
  return { disabled: false };
}
