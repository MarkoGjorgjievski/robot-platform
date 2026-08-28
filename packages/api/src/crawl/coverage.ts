// packages/api/src/crawl/coverage.ts
// Pure per-run coverage computation: how many items filled each field, and
// which items still have gaps. AI-free — no db, no extraction chain, just the
// binding cell semantics consumed verbatim by later repair-engine tasks.
//
// Cell semantics (binding for Tasks 3-7):
// - filled iff `row` exists and `row[name] != null && row[name] !== ''`.
// - confirmedAbsent iff `absentFields.includes(name)` — takes precedence over
//   missing, since a field the extraction chain positively determined is
//   absent is not a gap to repair.
// - otherwise missing — including every field of an item whose `row` is
//   null (a failed item; every field of a failed item is a re-extract
//   candidate, not selectively "confirmed absent").
// - `missingFields` on a gap item excludes confirmed-absent fields.

export type FieldCoverage = { name: string; filled: number; missing: number; confirmedAbsent: number; total: number };
export type ItemGap = { itemId: string; url: string; missingFields: string[] };
export type RunCoverage = { fields: FieldCoverage[]; gapItems: ItemGap[] };

export function computeCoverage(
  fields: Array<{ name: string }>,
  items: Array<{ id: string; url: string; row: Record<string, unknown> | null; absentFields: string[] }>,
): RunCoverage {
  const fieldCoverage: FieldCoverage[] = fields.map((f) => ({
    name: f.name, filled: 0, missing: 0, confirmedAbsent: 0, total: items.length,
  }));

  const gapItems: ItemGap[] = [];

  for (const item of items) {
    const missingFields: string[] = [];
    for (const fc of fieldCoverage) {
      const value = item.row ? item.row[fc.name] : undefined;
      const filled = item.row != null && value != null && value !== '';
      if (filled) {
        fc.filled++;
        continue;
      }
      if (item.absentFields.includes(fc.name)) {
        fc.confirmedAbsent++;
        continue;
      }
      fc.missing++;
      missingFields.push(fc.name);
    }
    if (missingFields.length > 0) {
      gapItems.push({ itemId: item.id, url: item.url, missingFields });
    }
  }

  return { fields: fieldCoverage, gapItems };
}
