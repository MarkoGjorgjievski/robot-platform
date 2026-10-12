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
//
// Spec 2026-10-12 §4/§5/§8 property 6 (Task 2): an item's `shown` map records,
// per field, whether its certified value was shown on the page it came from
// (`true`/`false`), or is not checkable for that field/row (`null`/absent —
// a row written before this change, a type that is never checked, or a miss
// with no value to check). `null`/absent counts as NOT CHECKED, never as not
// shown — `checked` only advances on an explicit `true` or `false`.

export type FieldCoverage = {
  name: string; filled: number; missing: number; confirmedAbsent: number; total: number;
  /** Values flagged `false` — written, but not found on the page they came from. */
  notShown: number;
  /** Values with an explicit flag (`true` or `false`) — the denominator for `notShown`. */
  checked: number;
};
export type ItemGap = { itemId: string; url: string; missingFields: string[] };
export type RunCoverage = {
  fields: FieldCoverage[];
  gapItems: ItemGap[];
  /** Items with at least one field flagged `false`, in item order, first 50. */
  unshownItems: Array<{ url: string; fields: string[] }>;
};

export function computeCoverage(
  fields: Array<{ name: string }>,
  items: Array<{
    id: string; url: string; row: Record<string, unknown> | null; absentFields: string[];
    shown?: Record<string, boolean | null> | null;
  }>,
): RunCoverage {
  const fieldCoverage: FieldCoverage[] = fields.map((f) => ({
    name: f.name, filled: 0, missing: 0, confirmedAbsent: 0, total: items.length, notShown: 0, checked: 0,
  }));

  const gapItems: ItemGap[] = [];
  const unshownItems: Array<{ url: string; fields: string[] }> = [];

  for (const item of items) {
    const missingFields: string[] = [];
    const unshownFields: string[] = [];
    for (const fc of fieldCoverage) {
      const value = item.row ? item.row[fc.name] : undefined;
      const filled = item.row != null && value != null && value !== '';
      if (filled) {
        fc.filled++;
      } else if (item.absentFields.includes(fc.name)) {
        fc.confirmedAbsent++;
      } else {
        fc.missing++;
        missingFields.push(fc.name);
      }

      const flag = item.shown ? item.shown[fc.name] : undefined;
      if (flag === true) {
        fc.checked++;
      } else if (flag === false) {
        fc.checked++;
        fc.notShown++;
        unshownFields.push(fc.name);
      }
      // flag === null or undefined (unset, or no shown map at all): not checked.
    }
    if (missingFields.length > 0) {
      gapItems.push({ itemId: item.id, url: item.url, missingFields });
    }
    if (unshownFields.length > 0 && unshownItems.length < 50) {
      unshownItems.push({ url: item.url, fields: unshownFields });
    }
  }

  return { fields: fieldCoverage, gapItems, unshownItems };
}
