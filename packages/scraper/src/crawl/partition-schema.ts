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
};

export type PartitionedSchema = {
  detail: OriginField[];
  listing: OriginField[];
  input: OriginField[];
  system: OriginField[];
};

export function partitionSchemaByOrigin(fields: OriginField[]): PartitionedSchema {
  const out: PartitionedSchema = { detail: [], listing: [], input: [], system: [] };
  for (const field of fields) {
    if (field.enabled === false) continue;
    out[field.origin ?? 'detail'].push(field);
  }
  return out;
}
