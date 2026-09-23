/** The Settings tab's view logic (spec 2026-09-21 §5's settings row; task brief 9). Pure. */

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The stored enum, in the customer's own words — and the state before either is chosen. */
export function listingModeLabel(mode: 'listing_to_detail' | 'detail' | null): string {
  if (mode === 'listing_to_detail') return 'Listing pages';
  if (mode === 'detail') return 'Product URLs';
  return 'Not chosen yet';
}

/**
 * Why the Listing mode control is disabled, shown beside it — or null when it
 * isn't. Mirrors the server's own rule (`sources.update`'s `listingMode` guard):
 * once a website is confirmed, its mode is locked.
 */
export function modeLockNote(confirmedAt: Date | null): string | null {
  return confirmedAt ? 'Mode is locked once the website is confirmed.' : null;
}

function itemsClause(n: number | 'all'): string {
  return n === 'all' ? 'All products' : `Up to ${n.toLocaleString('en-US')} ${n === 1 ? 'product' : 'products'}`;
}

function pagesClause(n: number | 'all'): string {
  return n === 'all' ? 'across all pages' : `across ${n.toLocaleString('en-US')} ${n === 1 ? 'page' : 'pages'}`;
}

/**
 * What a budget means, said out loud — the Settings tab's one-line summary
 * under the two inputs. `null` (a budget nobody has chosen yet, `sources.get`'s
 * own reading) reads exactly as the all/all default it will run as.
 */
export function budgetSummary(b: { max_items: number | 'all'; max_pages: number | 'all' } | null): string {
  return `${itemsClause(b?.max_items ?? 'all')} ${pagesClause(b?.max_pages ?? 'all')}`;
}

/**
 * The Delete dialog's description. A confirmed website is not the customer's
 * to delete from here at all, so that rule is stated outright rather than
 * alongside a cost that does not apply; otherwise it counts what goes with it,
 * in the same words as the `sources.delete` API refusal reserves for the
 * confirmed case.
 */
export function deleteNote(confirmedAt: Date | null, runCount: number): string {
  if (confirmedAt) return 'A confirmed website cannot be deleted from here.';
  return `Deletes the website, its pages, values and ${plural(runCount, 'extraction')}.`;
}
