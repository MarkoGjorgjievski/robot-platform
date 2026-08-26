// Field origin partitions the schema by WHERE each field lives.
//
// The partitions are disjoint, so the final row is a plain key merge with no
// precedence rules to get wrong — and a listing-classified field is never
// looked for on the detail page, so it cannot silently return a wrong value
// from a page that does not have it.

export type FieldOrigin = 'detail' | 'listing' | 'input' | 'system';

export type OriginField = {
  name: string;
  type: string;
  origin?: FieldOrigin;
  /** Which InputSet column supplies this field, when origin is 'input'. */
  input_column?: string;
  enabled?: boolean;
  /** The customer's explicit candidate choice for this field (v2.5 serving order). */
  candidate?: { concept: string; label: string };
};

export type PartitionedSchema = {
  detail: OriginField[];
  listing: OriginField[];
  input: OriginField[];
  system: OriginField[];
};

export function partitionSchemaByOrigin(fields: OriginField[]): PartitionedSchema {
  const out: PartitionedSchema = { detail: [], listing: [], input: [], system: [] };
  const validOrigins = new Set<FieldOrigin>(['detail', 'listing', 'input', 'system']);
  for (const field of fields) {
    if (field.enabled === false) continue;
    const origin: FieldOrigin = (field.origin && validOrigins.has(field.origin)) ? field.origin : 'detail';
    out[origin].push(field);
  }
  return out;
}
