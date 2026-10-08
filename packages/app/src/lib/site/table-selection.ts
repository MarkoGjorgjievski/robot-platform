// Pure helpers for the Verification table's spreadsheet behaviour (spec
// 2026-10-07 §1, §2, §3): where the selection goes on a key, whether a stored
// selection still points at a cell, the "n/m" after a Verify badge, and the
// words the detail bar and the Fix button use for a cell's state.
import type { Card, Segment } from './verification-model';

/** One selected cell: the 0-based card index and the field key. */
export type CellSelection = { product: number; key: string };

export type MoveKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'Home' | 'End';

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

/** The selection after `key`: one cell at a time, clamped at the table's edges, never wrapping. */
export function moveSelection(sel: CellSelection, key: MoveKey, fieldKeys: string[], products: number): CellSelection {
  const row = fieldKeys.indexOf(sel.key);
  if (row < 0 || products <= 0) return sel;
  const lastProduct = products - 1;
  switch (key) {
    case 'ArrowLeft':
      return { ...sel, product: clamp(sel.product - 1, 0, lastProduct) };
    case 'ArrowRight':
      return { ...sel, product: clamp(sel.product + 1, 0, lastProduct) };
    case 'Home':
      return { ...sel, product: 0 };
    case 'End':
      return { ...sel, product: lastProduct };
    case 'ArrowUp':
      return { ...sel, key: fieldKeys[clamp(row - 1, 0, fieldKeys.length - 1)]! };
    case 'ArrowDown':
      return { ...sel, key: fieldKeys[clamp(row + 1, 0, fieldKeys.length - 1)]! };
  }
}

/** A selection survives only while its field and product are still on the table. */
export function clampSelection(sel: CellSelection | null, fieldKeys: string[], products: number): CellSelection | null {
  if (!sel) return null;
  return fieldKeys.includes(sel.key) && sel.product >= 0 && sel.product < products ? sel : null;
}

/** The slice of a Verify result this needs; the route's `results` satisfies it. */
export type ResultsLike = Record<string, { cells: Record<string, { status: string }> }>;

/**
 * "n/m" after a Verify badge (spec §2): m = proof pages that have a result for
 * this field (a card that answers only another field was not checked for this
 * one), n = those on which the field did not fail. Null before a verdict, and
 * once the field has changed since it (the badge then reads "changed since
 * verified" and a count would contradict it).
 */
export function headerCount(results: ResultsLike | null | undefined, key: string, unchangedKeys: string[], cards: Card[]): { passed: number; checked: number } | null {
  const fv = results?.[key];
  if (!fv || !unchangedKeys.includes(key)) return null;
  const checked = cards.map((c) => c.url.trim()).filter((u) => u && fv.cells[u] !== undefined);
  const failed = checked.filter((u) => fv.cells[u]?.status === 'fail').length;
  return { passed: checked.length - failed, checked: checked.length };
}

const STATE_WORD: Record<Segment, string> = {
  empty: 'nothing found',
  suggested: 'suggested',
  answered: 'accepted',
  failed: 'fails on this product',
};

/** The detail bar's state word for a cell (spec §2). */
export function stateWord(s: Segment): string {
  return STATE_WORD[s];
}

/** The Fix button reads Mark on an empty cell: there is nothing to fix yet, only something to point at. */
export function fixLabel(s: Segment): 'Fix' | 'Mark' {
  return s === 'empty' ? 'Mark' : 'Fix';
}
