import { describe, it, expect } from 'vitest';
import { DETAIL_URL_FIELD } from '@robot/scraper';
import { effectiveSchema, isCustomerSchema } from './effective-schema.js';

describe('isCustomerSchema', () => {
  it('is true only for a non-empty array', () => {
    expect(isCustomerSchema({ schemaDefinition: [{ key: 'price', name: 'Price', type: 'money', description: '', concept: 'price' }] })).toBe(true);
    expect(isCustomerSchema({ schemaDefinition: [] })).toBe(false);
    expect(isCustomerSchema({ schemaDefinition: null })).toBe(false);
    expect(isCustomerSchema({})).toBe(false);
  });
});

describe('effectiveSchema', () => {
  it('uses the customer schema definition when present, ignoring dataset schema and selectorsJson', () => {
    const result = effectiveSchema({
      dataset: { schema: [{ name: 'ignored', type: 'string' }] },
      selectorsJson: { fields: [{ name: 'also-ignored', type: 'string' }] },
      schemaDefinition: [
        { key: 'price', name: 'Unit cost', type: 'money', description: '', concept: 'price' },
        { key: 'name', name: 'Product Name', type: 'text', description: '', concept: 'product_name' },
      ],
    });
    expect(result).toEqual([
      { name: 'price', type: 'price', origin: 'detail', displayName: 'Unit cost' },
      { name: 'name', type: 'string', origin: 'detail', displayName: 'Product Name' },
    ]);
  });

  it('falls back to legacy branches when schemaDefinition is absent or empty', () => {
    const result = effectiveSchema({
      dataset: { schema: [{ name: 'price', type: 'number' }] },
      selectorsJson: null,
      schemaDefinition: [],
    });
    expect(result).toEqual([{ name: 'price', type: 'number' }]);
  });

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

  it('falls back to selectorsJson.fields — full objects, nothing stripped — when the dataset schema is empty', () => {
    const result = effectiveSchema({
      dataset: { schema: [] },
      selectorsJson: {
        fields: [
          { name: 'price', type: 'number', description: 'kept — extraction hints ride along', example_value: '$9.99' },
          { name: 'title', type: 'string' },
        ],
      },
    });
    expect(result).toEqual([
      { name: 'price', type: 'number', description: 'kept — extraction hints ride along', example_value: '$9.99' },
      { name: 'title', type: 'string' },
    ]);
  });

  // A Scratch source's schema lives ONLY in selectorsJson — mapping the
  // fallback down to {name, type} silently dropped the customer's explicit
  // candidate choice (v2.5 serving order) and any origin/input_column
  // placement before extraction ever saw them, hidden by `as OriginField[]`
  // casts at the call sites.
  it('preserves candidate/origin/input_column through the selectorsJson fallback', () => {
    const result = effectiveSchema({
      dataset: { schema: [] },
      selectorsJson: {
        fields: [
          { name: 'price', type: 'number', candidate: { concept: 'price', label: 'Sale price' } },
          { name: 'sku', type: 'string', origin: 'input', input_column: 'sku' },
        ],
      },
    });
    expect(result).toEqual([
      { name: 'price', type: 'number', candidate: { concept: 'price', label: 'Sale price' } },
      { name: 'sku', type: 'string', origin: 'input', input_column: 'sku' },
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
      { name: 'price', type: 'number', enabled: true },
      { name: 'sku', type: 'string' },
    ]);
  });

  it('returns an empty array when there is neither a dataset schema nor selectorsJson fields', () => {
    expect(effectiveSchema({ dataset: null, selectorsJson: null })).toEqual([]);
    expect(effectiveSchema({ dataset: { schema: [] }, selectorsJson: {} })).toEqual([]);
  });

  // Finding 4 (final-review-findings.md): DETAIL_URL_FIELD is planning
  // machinery re-added by plan-run.ts itself — left in here, it round-trips
  // into extract-item.ts's detail fields (no origin to place it by) and
  // pollutes the never-overwritten (domain, 'detail') cache with a junk
  // `detail_url` fieldPath.
  it('filters DETAIL_URL_FIELD out of the dataset-schema branch', () => {
    const result = effectiveSchema({
      dataset: {
        schema: [
          { name: DETAIL_URL_FIELD, type: 'url' },
          { name: 'title', type: 'string' },
        ],
      },
      selectorsJson: null,
    });
    expect(result).toEqual([{ name: 'title', type: 'string' }]);
  });

  it('filters DETAIL_URL_FIELD out of the selectorsJson fallback branch', () => {
    const result = effectiveSchema({
      dataset: { schema: [] },
      selectorsJson: {
        fields: [
          { name: DETAIL_URL_FIELD, type: 'url' },
          { name: 'price', type: 'number' },
        ],
      },
    });
    expect(result).toEqual([{ name: 'price', type: 'number' }]);
  });
});
