// packages/dashboard/src/lib/coverage-view.ts
// All the coverage-in-the-run-view logic lives here, pure and unit-tested —
// the dashboard has no component-test harness, so ResultsTable and
// source-run-detail.tsx stay thin wrappers around these five functions.
//
// The wire shapes mirror `@robot/api`'s `crawl.coverage` output
// (`packages/api/src/crawl/coverage.ts`) rather than importing it: this
// package only depends on `@robot/api`'s router types for tRPC's client, not
// its internal crawl types, and `work-list.ts` already sets the precedent of
// a local type mirroring what a procedure reports on the wire.

export type FieldCoverage = { name: string; filled: number; missing: number; confirmedAbsent: number; total: number };
export type ItemGap = { itemId: string; url: string; missingFields: string[] };

/** A results-table row. Every row carries `_url` — `mergeRow` always writes it. */
export type Row = Record<string, unknown> & { _url?: string };

/**
 * The column-header fill count — "36/40" — or `null` on a clean column.
 *
 * A column with nothing missing draws a badge nobody needs to act on; the
 * absence of a badge IS the "this field is fine" signal, so a complete
 * column must render no badge at all rather than a redundant "40/40".
 * `confirmedAbsent` counts as a gap here even though it isn't a repair
 * target on its own — the badge answers "how much of this column is
 * blank", and a confirmed-absent cell is blank, exactly like a missing one.
 */
export function fillBadge(cov: FieldCoverage | undefined): string | null {
  if (!cov) return null;
  if (cov.missing + cov.confirmedAbsent === 0) return null;
  return `${cov.filled}/${cov.total}`;
}

/**
 * Rows whose item is missing `field`, per the coverage report — used to
 * back the Excel-style "filter to rows missing X" click.
 *
 * A row absent from `gapByUrl` entirely (fully filled, or the item's row
 * was never a gap item at all) is never "missing" anything and is dropped,
 * same as a row present in the map but missing a DIFFERENT field.
 */
export function rowsMissingField(rows: Row[], field: string, gapByUrl: Map<string, ItemGap>): Row[] {
  return rows.filter((row) => {
    if (typeof row._url !== 'string') return false;
    const gap = gapByUrl.get(row._url);
    return gap != null && gap.missingFields.includes(field);
  });
}

/**
 * Selected row urls resolved to the `run_items.id`s `crawl.backfill` needs.
 *
 * A selected url with no gap entry is dropped rather than sent through —
 * there is nothing to intersect it with (`deriveBackfillItems` would drop
 * it anyway), and silently sending a bad id is worse than silently omitting
 * a row that turned out to have nothing to repair.
 */
export function selectionToItemIds(selectedUrls: string[], gapByUrl: Map<string, ItemGap>): string[] {
  const ids: string[] = [];
  for (const url of selectedUrls) {
    const gap = gapByUrl.get(url);
    if (gap) ids.push(gap.itemId);
  }
  return ids;
}

/**
 * The Re-extract button's label — the one spender on this page below the
 * confirm gate, so its label is the one place the cost shape gets said out
 * loud, every time, before the click: cached paths are tried first, and AI
 * only runs where the cache can't answer (spec: extraction-chain priority
 * order, mechanical/cache tiers before the paid AI tiers).
 */
export function reExtractLabel(count: number): string {
  const noun = count === 1 ? 'page' : 'pages';
  return `Re-extract selected (${count} ${noun} — cached paths first, AI only where the cache can't answer)`;
}

/**
 * The row selection after the field filter changes — always empty.
 *
 * A selection made while viewing "missing X" was chosen under that view: the
 * operator was looking at rows missing X when they picked them. Letting it
 * survive a switch to "missing Y" (or to no filter at all) means the
 * Re-extract button can fire against urls the operator never selected under
 * the filter they're currently looking at — either a stale-but-plausible
 * count that turns into a `PRECONDITION_FAILED` ("nothing to backfill") once
 * `targetFields` no longer matches what those items are missing, or worse, a
 * backfill that quietly succeeds against the wrong rows. Every filter
 * transition — picking a new field, toggling the same one off, or an
 * explicit "Clear filter" — must clear the selection, not just a change of
 * `runId`.
 */
export function nextSelectionOnFilterChange(): Set<string> {
  return new Set();
}

/**
 * A single cell's render state. Mirrors `computeCoverage`'s own precedence
 * (packages/api/src/crawl/coverage.ts): filled wins over confirmed-absent —
 * a field the extraction chain filled is filled, even on an item where an
 * earlier pass had confirmed it absent.
 */
export function cellState(value: unknown, field: string, absent: Set<string>): 'filled' | 'missing' | 'absent' {
  if (value != null && value !== '') return 'filled';
  if (absent.has(field)) return 'absent';
  return 'missing';
}
