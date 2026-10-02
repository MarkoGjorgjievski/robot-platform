// packages/scraper/src/verify/variant-rows.ts
// Turns one product page's certified row and its resolved variant entries
// (list method) into one row per variant — pure, no browser, no network, no
// model. Read variant-certify.ts (resolveVariantList, readEntryPath,
// EntryPath, VariantListRef) and verified-extraction.ts (how a resolved value
// becomes `data[key]`) first: an entry value is normalised and rendered the
// same way a certified path's value is for a product row (spec
// 2026-10-02-variants-plan3, Global Constraints).
import type { EntryPath } from './variant-certify.js';
import { readEntryPath } from './variant-certify.js';
import { normalizeVariantLink } from './variant-collector.js';
import { normalize, renderValue, type NormalizeContext } from './normalize.js';
import type { CustomerFieldType, VariantListRef } from './types.js';

export type VariantRunPlan = {
  method: 'list' | 'links';
  list?: VariantListRef;
  entryPaths: Record<string, EntryPath>; // list method: entry-field key → path
  fromProduct: string[];
  collector?: string; // links method
  axes: Array<{ key: string; name: string }>; // mapped axis columns, setup order
  fields: Array<{ key: string; name: string; type: CustomerFieldType; level: 'product' | 'variant' }>; // contract fields, contract order
  skuKey?: string; // the contract field with concept 'sku', if any
  gtinKey?: string; // the contract field with concept 'gtin' (or 'gtin13'), if any
};

export type VariantRunSummary = {
  variants: number;
  products: number;
  withoutVariants: number;
  partial: number;
  variantsSkippedForBudget: number;
};

/** The product's group key for the links method: the lexicographically smallest normalised URL among the page itself and its variant group. Deterministic whichever member page is extracted first. */
export function groupKeyOf(urls: string[]): string {
  return urls.map(normalizeVariantLink).reduce((min, u) => (u < min ? u : min));
}

function nonEmpty(v: unknown): string | undefined {
  return v !== null && v !== undefined && v !== '' ? String(v) : undefined;
}

/** A row's `_variant_key` (Global Constraints): the certified SKU value, else GTIN, else (links method) its own page URL, else its axis values joined " · " in setup-axes order. */
export function variantKeyOf(row: Record<string, unknown>, plan: VariantRunPlan, ownUrl?: string): string {
  if (plan.skuKey) {
    const v = nonEmpty(row[plan.skuKey]);
    if (v !== undefined) return v;
  }
  if (plan.gtinKey) {
    const v = nonEmpty(row[plan.gtinKey]);
    if (v !== undefined) return v;
  }
  if (plan.method === 'links' && ownUrl) return normalizeVariantLink(ownUrl);
  return plan.axes.map((a) => nonEmpty(row[a.key]) ?? '').join(' · ');
}

/** The same normalise-then-render a certified path's value takes for a product row (verified-extraction.ts's evaluatePath): empty/null/undefined reads as a miss (null), otherwise `normalize` then `renderValue`. */
function resolveValue(type: CustomerFieldType, raw: unknown, ctx: NormalizeContext): unknown {
  if (raw === null || raw === undefined || raw === '') return null;
  const norm = normalize(type, raw, ctx);
  return norm === null ? null : renderValue(type, norm);
}

export function buildVariantRows(args: {
  productRow: Record<string, unknown>; // the product page's certified row (keys = field keys)
  entries: Record<string, unknown>[] | null; // resolveVariantList's result on that page
  plan: VariantRunPlan;
  pageUrl: string;
}): { rows: Record<string, unknown>[]; partial: boolean; withVariants: boolean } {
  const { productRow, entries, plan, pageUrl } = args;
  const productKey = normalizeVariantLink(pageUrl);

  if (!entries || entries.length === 0) {
    return { rows: [{ ...productRow, _product_key: productKey }], partial: false, withVariants: false };
  }

  const ctx: NormalizeContext = { pageUrl };
  const variantFields = plan.fields.filter((f) => f.level === 'variant');

  let anyPartial = false;
  const rows = entries.map((entry) => {
    // Start from the full product row (spread), so `_url`, `_page_number` and any other
    // input/listing keys the caller carries survive onto every variant row, exactly as the
    // no-entries branch above already does — not just the contract's product-level fields.
    const row: Record<string, unknown> = { ...productRow };

    let rowPartial = false;
    for (const f of variantFields) {
      if (plan.fromProduct.includes(f.key)) { row[f.key] = productRow[f.key]; continue; }
      const ep = plan.entryPaths[f.key];
      if (!ep) { row[f.key] = null; continue; }
      const value = resolveValue(f.type, readEntryPath(entry, ep), ctx);
      row[f.key] = value;
      if (value === null) rowPartial = true;
    }

    for (const a of plan.axes) {
      const ep = plan.entryPaths[a.key];
      if (!ep) { row[a.key] = null; continue; }
      const value = resolveValue('text', readEntryPath(entry, ep), ctx);
      row[a.key] = value;
      if (value === null) rowPartial = true;
    }

    row._product_key = productKey;
    row._variant_key = variantKeyOf(row, plan);
    if (rowPartial) { row._variant_partial = true; anyPartial = true; }
    return row;
  });

  return { rows, partial: anyPartial, withVariants: true };
}

export function summariseVariantRows(rows: Record<string, unknown>[], skippedForBudget: number): VariantRunSummary {
  const productKeys = new Set<unknown>();
  const productsWithVariant = new Set<unknown>();
  const partialProducts = new Set<unknown>();
  let variants = 0;

  for (const row of rows) {
    const pk = row._product_key;
    if (pk !== undefined && pk !== null) productKeys.add(pk);
    const vk = row._variant_key;
    if (vk !== undefined && vk !== null && vk !== '') {
      variants += 1;
      if (pk !== undefined && pk !== null) productsWithVariant.add(pk);
    }
    if (row._variant_partial && pk !== undefined && pk !== null) partialProducts.add(pk);
  }

  const withoutVariants = [...productKeys].filter((pk) => !productsWithVariant.has(pk)).length;

  return {
    variants,
    products: productKeys.size,
    withoutVariants,
    partial: partialProducts.size,
    variantsSkippedForBudget: skippedForBudget,
  };
}
