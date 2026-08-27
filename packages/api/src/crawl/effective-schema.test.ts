import { describe, it, expect } from 'vitest';
import { effectiveSchema } from './effective-schema.js';

describe('effectiveSchema', () => {
  it('returns the dataset schema when it is non-empty', () => {
    const result = effectiveSchema({
      dataset: { schema: [{ name: 'price', type: 'number' }, { name: 'title', type: 'string' }] },
      selectorsJson: { fields: [{ name: 'ignored', type: 'string' }] },
    });
    expect(result).toEqual([
      { name: 'price', type: 'number' },
      { name: 'title', type: 'string' },
    ]);
  });

  it('falls back to selectorsJson.fields mapped to {name, type} when the dataset schema is empty', () => {
    const result = effectiveSchema({
      dataset: { schema: [] },
      selectorsJson: {
        fields: [
          { name: 'price', type: 'number', description: 'ignored, not in output', example_value: 'ignored' },
          { name: 'title', type: 'string' },
        ],
      },
    });
    expect(result).toEqual([
      { name: 'price', type: 'number' },
      { name: 'title', type: 'string' },
    ]);
  });

  it('falls back to selectorsJson.fields when the dataset has no schema at all', () => {
    const result = effectiveSchema({
      dataset: null,
      selectorsJson: { fields: [{ name: 'price', type: 'number' }] },
    });
    expect(result).toEqual([{ name: 'price', type: 'number' }]);
  });

  it('falls back to selectorsJson.fields when there is no dataset relation at all', () => {
    const result = effectiveSchema({
      selectorsJson: { fields: [{ name: 'price', type: 'number' }] },
    });
    expect(result).toEqual([{ name: 'price', type: 'number' }]);
  });

  it('excludes fields explicitly disabled (enabled === false) from the selectorsJson fallback', () => {
    const result = effectiveSchema({
      dataset: { schema: [] },
      selectorsJson: {
        fields: [
          { name: 'price', type: 'number', enabled: true },
          { name: 'title', type: 'string', enabled: false },
          { name: 'sku', type: 'string' },
        ],
      },
    });
    expect(result).toEqual([
      { name: 'price', type: 'number' },
      { name: 'sku', type: 'string' },
    ]);
  });

  it('returns an empty array when there is neither a dataset schema nor selectorsJson fields', () => {
    expect(effectiveSchema({ dataset: null, selectorsJson: null })).toEqual([]);
    expect(effectiveSchema({ dataset: { schema: [] }, selectorsJson: {} })).toEqual([]);
  });
});
