import type { CustomerFieldType, SchemaDefinitionField } from '@robot/scraper';

/**
 * The contract (spec 4.1): the project's field list, stored on its dataset.
 * Legacy dataset entries without a `key` (operator fields from the discovery
 * era) are preserved on every write but are not part of the contract.
 *
 * Variants (spec 2026-10-01 §2): a field's `level` is `product` or `variant`,
 * defaulting by `concept` via `effectiveLevel` when unset. Axis entries
 * (`kind: 'axis'`) live on the same dataset schema array but are never
 * contract fields — `contractFields` excludes them, `contractAxes` returns
 * only them.
 */
export type VariantMode = 'ignore' | 'row_per_variant' | 'nested';
export type FieldLevel = 'product' | 'variant';
export type ContractField = { key: string; name: string; type: CustomerFieldType; concept: string; description?: string; level?: FieldLevel; kind?: 'field' } & Record<string, unknown>;
export type ContractAxis = { key: string; name: string; kind: 'axis'; concept: 'axis' };

/** Field setup (spec 2026-10-01 §3): how a website exposes variants. */
export type VariantSetup = { method: 'list' | 'links' | 'none'; axes: Array<{ from: string; axisKey: string }>; confirmedAt: string };

/** Concepts whose effective level defaults to `variant` (constraints, Global Constraints). */
export const VARIANT_CONCEPTS: ReadonlySet<string> = new Set([
  'price',
  'regular_price',
  'discount',
  'unit_price',
  'sku',
  'url',
  'availability',
  'stock_count',
  'image_url',
  'additional_images',
]);

const isAxis = (f: unknown): f is ContractAxis => !!f && typeof f === 'object' && (f as { kind?: unknown }).kind === 'axis';

export function contractFields(schema: unknown): ContractField[] {
  if (!Array.isArray(schema)) return [];
  return schema.filter((f): f is ContractField => !isAxis(f) && !!f && typeof f === 'object' && typeof (f as ContractField).key === 'string' && (f as ContractField).key.length > 0);
}

/** The dataset schema's axis entries (spec 2026-10-01 §2), in storage order. */
export function contractAxes(schema: unknown): ContractAxis[] {
  if (!Array.isArray(schema)) return [];
  return schema
    .filter(isAxis)
    .filter((a): a is ContractAxis => typeof a.key === 'string' && typeof a.name === 'string')
    .map((a) => ({ key: a.key, name: a.name, kind: 'axis' as const, concept: 'axis' as const }));
}

/** A field's effective level: its stored `level` if set, else by concept (Global Constraints). */
export function effectiveLevel(f: Pick<ContractField, 'level' | 'concept'>): FieldLevel {
  return f.level ?? (VARIANT_CONCEPTS.has(f.concept) ? 'variant' : 'product');
}

/** A website's binding rows for a contract (spec 4.2): name/type/concept copied; the hint is the website's own, defaulting to the contract's description (a catalogue field arrives described). */
export function bindingFor(contract: ContractField[], descriptions: Record<string, string> = {}): SchemaDefinitionField[] {
  return contract.map((f) => ({ key: f.key, name: f.name, type: f.type, description: descriptions[f.key] ?? f.description ?? '', concept: f.concept }));
}
