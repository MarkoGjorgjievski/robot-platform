import type { CustomerFieldType, SchemaDefinitionField } from '@robot/scraper';

/**
 * The contract (spec 4.1): the project's field list, stored on its dataset.
 * Legacy dataset entries without a `key` (operator fields from the discovery
 * era) are preserved on every write but are not part of the contract.
 */
export type ContractField = { key: string; name: string; type: CustomerFieldType; concept: string; description?: string } & Record<string, unknown>;

export function contractFields(schema: unknown): ContractField[] {
  if (!Array.isArray(schema)) return [];
  return schema.filter((f): f is ContractField => !!f && typeof f === 'object' && typeof (f as ContractField).key === 'string' && (f as ContractField).key.length > 0);
}

/** A website's binding rows for a contract (spec 4.2): name/type/concept copied; the hint is the website's own, defaulting to the contract's description (a catalogue field arrives described). */
export function bindingFor(contract: ContractField[], descriptions: Record<string, string> = {}): SchemaDefinitionField[] {
  return contract.map((f) => ({ key: f.key, name: f.name, type: f.type, description: descriptions[f.key] ?? f.description ?? '', concept: f.concept }));
}
