import { describe, it, expect } from 'vitest';
import { datasetSchemaFieldSchema } from './datasets.js';

describe('datasetSchemaFieldSchema', () => {
  it('accepts a field with no origin (existing schemas keep working)', () => {
    const parsed = datasetSchemaFieldSchema.parse({ name: 'title', type: 'string' });
    expect(parsed.origin).toBeUndefined();
  });

  it('accepts every origin the spec defines', () => {
    for (const origin of ['detail', 'listing', 'input', 'system'] as const) {
      expect(datasetSchemaFieldSchema.parse({ name: 'f', type: 'string', origin }).origin).toBe(origin);
    }
  });

  it('rejects an origin outside the enum', () => {
    expect(() => datasetSchemaFieldSchema.parse({ name: 'f', type: 'string', origin: 'api' })).toThrow();
  });

  it('carries input_column for input-origin fields', () => {
    const parsed = datasetSchemaFieldSchema.parse({
      name: 'customer', type: 'string', origin: 'input', input_column: 'customer_name',
    });
    expect(parsed.input_column).toBe('customer_name');
  });
});
