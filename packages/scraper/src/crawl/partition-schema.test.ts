import { describe, it, expect } from 'vitest';
import { partitionSchemaByOrigin } from './partition-schema.js';

describe('partitionSchemaByOrigin', () => {
  it('treats a field with no origin as a detail field', () => {
    const result = partitionSchemaByOrigin([{ name: 'title', type: 'string' }]);
    expect(result.detail.map((f) => f.name)).toEqual(['title']);
    expect(result.listing).toEqual([]);
  });

  it('routes each field to the partition its origin names', () => {
    const result = partitionSchemaByOrigin([
      { name: 'title', type: 'string', origin: 'detail' },
      { name: 'category', type: 'string', origin: 'listing' },
      { name: 'requested_by', type: 'string', origin: 'input', input_column: 'customer' },
      { name: '_url', type: 'url', origin: 'system' },
    ]);
    expect(result.detail.map((f) => f.name)).toEqual(['title']);
    expect(result.listing.map((f) => f.name)).toEqual(['category']);
    expect(result.input.map((f) => f.name)).toEqual(['requested_by']);
    expect(result.system.map((f) => f.name)).toEqual(['_url']);
  });

  it('drops fields the user disabled', () => {
    const result = partitionSchemaByOrigin([
      { name: 'title', type: 'string' },
      { name: 'internal', type: 'string', enabled: false },
    ]);
    expect(result.detail.map((f) => f.name)).toEqual(['title']);
  });

  it('preserves schema order inside a partition', () => {
    const result = partitionSchemaByOrigin([
      { name: 'b', type: 'string', origin: 'listing' },
      { name: 'a', type: 'string', origin: 'listing' },
    ]);
    expect(result.listing.map((f) => f.name)).toEqual(['b', 'a']);
  });

  it('returns empty partitions for an empty schema', () => {
    expect(partitionSchemaByOrigin([])).toEqual({ detail: [], listing: [], input: [], system: [] });
  });
});
