// packages/api/src/verify/variant-fields.ts
// Entry fields and the plural noun for a website's variants (spec 2026-10-01
// §3/§4): the project's variant-level contract fields, plus the axis columns
// the website's setup maps. Kept out of sources.ts (ruling R1, variants plan
// 2 task 3) so both sources.ts (saveVariantAnswer/variantList) and the
// verify-side variant check (task 4) can import it without a router import
// from verify code.
import { contractFields, contractAxes, effectiveLevel, type VariantSetup } from '../contract.js';
import type { EntryField } from '@robot/scraper';

/**
 * Entry fields (Global Constraints): the project's variant-level contract
 * fields (`effectiveLevel(f) === 'variant'`), as `{ key, name, type,
 * concept }`, followed by one entry per column (`axisKey`) the
 * `setup.axes` mappings name that is actually on the schema — a stale
 * mapping to a since-deleted axis contributes nothing; a column several
 * mappings name gets `axisFrom` as the list of their `from`s, in order.
 */
export function entryFieldsFor(datasetSchema: unknown, setup: VariantSetup | null): EntryField[] {
  const contract = contractFields(datasetSchema);
  const fields: EntryField[] = contract
    .filter((f) => effectiveLevel(f) === 'variant')
    .map((f) => ({ key: f.key, name: f.name, type: f.type, concept: f.concept }));

  if (setup) {
    const axes = contractAxes(datasetSchema);
    const axisNames = new Map(axes.map((a) => [a.key, a.name] as const));
    // One entry field per column: several detected names mapped to one column (e.g. `color` and
    // `colour`, both "Colour") read the first of them that yields a value on an entry.
    const byKey = new Map<string, EntryField>();
    for (const a of setup.axes) {
      const name = axisNames.get(a.axisKey);
      if (name === undefined) continue; // stale mapping: the axis no longer exists
      const existing = byKey.get(a.axisKey);
      if (existing) {
        const from = existing.axisFrom!;
        existing.axisFrom = [...(typeof from === 'string' ? [from] : from), a.from];
        continue;
      }
      const field: EntryField = { key: a.axisKey, name, type: 'text', concept: 'axis', axisFrom: a.from };
      byKey.set(a.axisKey, field);
      fields.push(field);
    }
  }

  return fields;
}

/** The plural word for this website's variants (Global Constraints): the first mapped axis's name, lower-cased, with "s" added; "variants" with no mapped axis. */
export function variantNoun(datasetSchema: unknown, setup: VariantSetup | null): string {
  const fields = entryFieldsFor(datasetSchema, setup);
  const firstAxis = fields.find((f) => f.axisFrom !== undefined);
  return firstAxis ? `${firstAxis.name.toLowerCase()}s` : 'variants';
}
