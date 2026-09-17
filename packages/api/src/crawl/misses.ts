// packages/api/src/crawl/misses.ts
// A run's empty cells, by field and by the listing each product came from
// (spec 2026-09-17 §5). Pure, like coverage.ts, and mostly the same cell
// semantics: filled iff the row has a non-null, non-empty value (0 and false
// count as filled); a confirmed-absent cell is not a miss.
//
// The one place this deliberately DIFFERS from coverage.ts: an item that
// produced no row at all (still `pending`/`running`, or `failed`) is not a
// miss and takes no part here — not in a field's `count`, not in any group,
// and not in `total` (which is the number of items that DID produce a row).
// A product that was never extracted says nothing about where a field lives
// on the page; it is not evidence of a layout the customer should look at.
// (coverage.ts's own rule — every field of a row-less item is a gap — is
// right for repair/backfill, which needs those items back in its work list;
// the work list and the "Extract N pending" control already surface an
// unextracted item on its own terms, so misses does not need to as well.)
// This is what tells a customer that a listing's products carry a different
// layout: "price is empty on 38 of 40 extracted products, 36 from
// /cat/sofas" points at a page worth adding as a proof page.

export const MISS_URLS_PER_GROUP = 10;

export type MissGroup = { listingUrl: string | null; count: number; urls: string[] };
export type FieldMisses = { name: string; count: number; total: number; groups: MissGroup[] };
export type MissItem = { url: string; listingUrl: string | null; row: Record<string, unknown> | null; absentFields: string[] };

export function computeMisses(fields: Array<{ name: string }>, items: MissItem[]): FieldMisses[] {
  const extracted = items.filter((item): item is MissItem & { row: Record<string, unknown> } => item.row != null);
  const out: FieldMisses[] = [];
  for (const f of fields) {
    const groups = new Map<string | null, MissGroup>();
    let count = 0;
    for (const item of extracted) {
      const value = item.row[f.name];
      const filled = value != null && value !== '';
      if (filled || item.absentFields.includes(f.name)) continue;
      count++;
      let g = groups.get(item.listingUrl);
      if (!g) { g = { listingUrl: item.listingUrl, count: 0, urls: [] }; groups.set(item.listingUrl, g); }
      g.count++;
      if (g.urls.length < MISS_URLS_PER_GROUP) g.urls.push(item.url);
    }
    if (count > 0) out.push({ name: f.name, count, total: extracted.length, groups: [...groups.values()].sort((a, b) => b.count - a.count) });
  }
  return out;
}
