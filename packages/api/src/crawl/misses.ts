// packages/api/src/crawl/misses.ts
// A run's empty cells, by field and by the listing each product came from
// (spec 2026-09-17 §5). Pure, like coverage.ts, and with the SAME cell
// semantics: filled iff the row has a non-null, non-empty value (0 and false
// count as filled); a confirmed-absent cell is not a miss; every field of a
// failed item (no row) is one. This is what tells a customer that a listing's
// products carry a different layout: "price is empty on 38 products, 36 from
// /cat/sofas" points at a page worth adding as a proof page.

export const MISS_URLS_PER_GROUP = 10;

export type MissGroup = { listingUrl: string | null; count: number; urls: string[] };
export type FieldMisses = { name: string; count: number; total: number; groups: MissGroup[] };
export type MissItem = { url: string; listingUrl: string | null; row: Record<string, unknown> | null; absentFields: string[] };

export function computeMisses(fields: Array<{ name: string }>, items: MissItem[]): FieldMisses[] {
  const out: FieldMisses[] = [];
  for (const f of fields) {
    const groups = new Map<string | null, MissGroup>();
    let count = 0;
    for (const item of items) {
      const value = item.row ? item.row[f.name] : undefined;
      const filled = item.row != null && value != null && value !== '';
      if (filled || item.absentFields.includes(f.name)) continue;
      count++;
      let g = groups.get(item.listingUrl);
      if (!g) { g = { listingUrl: item.listingUrl, count: 0, urls: [] }; groups.set(item.listingUrl, g); }
      g.count++;
      if (g.urls.length < MISS_URLS_PER_GROUP) g.urls.push(item.url);
    }
    if (count > 0) out.push({ name: f.name, count, total: items.length, groups: [...groups.values()].sort((a, b) => b.count - a.count) });
  }
  return out;
}
