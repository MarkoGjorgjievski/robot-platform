// Listing rows → the detail URLs a run will work through.
//
// `all-duplicates` is the important stop reason: a site that clamps an
// out-of-range page number back to page 1 serves the same products forever, and
// without this check every run would walk to max_pages before noticing.

/** Reserved field name the listing extraction resolves to each row's detail link. */
export const DETAIL_URL_FIELD = 'detail_url';

export type EnumeratedItem = {
  url: string;
  listingValues: Record<string, unknown>;
  pageNumber: number;
};

export type StopReason = 'budget' | 'empty-page' | 'all-duplicates' | null;

export type EnumerateResult = { items: EnumeratedItem[]; stop: StopReason };

export type EnumerateArgs = {
  rows: Array<Record<string, unknown>>;
  pageUrl: string;
  pageNumber: number;
  /** URLs already queued by earlier pages or inputs. Not mutated. */
  seen: Set<string>;
  /** How many more items the budget allows. */
  remaining: number;
};

function absolute(href: unknown, pageUrl: string): string | null {
  if (typeof href !== 'string' || href.trim() === '') return null;
  try {
    const resolved = new URL(href, pageUrl);
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return null;
    return resolved.href;
  } catch {
    return null;
  }
}

export function enumerateDetailUrls(args: EnumerateArgs): EnumerateResult {
  const { rows, pageUrl, pageNumber, seen, remaining } = args;
  if (rows.length === 0) return { items: [], stop: 'empty-page' };

  const items: EnumeratedItem[] = [];
  const local = new Set(seen);
  let sawAnyUrl = false;
  let truncated = false;

  for (const row of rows) {
    const url = absolute(row[DETAIL_URL_FIELD], pageUrl);
    if (!url) continue;
    sawAnyUrl = true;
    if (local.has(url)) continue;
    if (items.length >= remaining) {
      truncated = true;
      break;
    }
    local.add(url);
    const { [DETAIL_URL_FIELD]: _discarded, ...listingValues } = row;
    items.push({ url, listingValues, pageNumber });
  }

  // An exact fill (items.length === remaining, nothing left over to truncate)
  // is still the budget being exhausted — the caller must not fetch another
  // page believing there was room left.
  if (truncated || (items.length > 0 && items.length >= remaining)) return { items, stop: 'budget' };
  if (items.length === 0) return { items, stop: sawAnyUrl ? 'all-duplicates' : 'empty-page' };
  return { items, stop: null };
}
