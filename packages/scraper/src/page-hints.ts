// Soft page-type hints (mvp-simplification task 6).
//
// mvp-simplification task 4 deleted arbitration entirely: `runAnalysis` takes
// the caller's declared page type as ground truth, no vote, no override.
// These functions do NOT reopen that door — they attach an advisory string
// alongside an outcome that is otherwise unchanged, for a human to read and
// act on (or ignore). Pure, cheap, no browser/DB/AI involved.

const HUB_WARNING =
  "This doesn't look like a listing — it may be a hub/featured page; the real listing is often behind a 'shop all' link.";

const LOOKS_LIKE_LISTING_WARNING = 'This looks like a listing page.';

/**
 * A declared LISTING page that came back with almost nothing and has no
 * detected pagination reads more like a hub/featured page than a real
 * listing (spec §2). Pagination being present is itself evidence the page
 * IS a listing — even a thin first page — so it suppresses the warning.
 */
export function listingHints(rowsFound: number, paginationStrategy: string | null): string[] {
  if (rowsFound <= 2 && paginationStrategy === null) return [HUB_WARNING];
  return [];
}

/**
 * A declared DETAIL page whose own JSON-LD says ItemList or CollectionPage
 * is itself evidence the URL is actually a listing, not a single item.
 * `@type` may be a bare string or an array of strings — schema.org allows
 * both, and real pages use the array form to multi-classify.
 */
export function detailHints(ldJson: unknown[]): string[] {
  const looksLikeListing = ldJson.some((block) => {
    const type = (block as { '@type'?: unknown } | null | undefined)?.['@type'];
    const types = Array.isArray(type) ? type : [type];
    return types.includes('ItemList') || types.includes('CollectionPage');
  });
  return looksLikeListing ? [LOOKS_LIKE_LISTING_WARNING] : [];
}
