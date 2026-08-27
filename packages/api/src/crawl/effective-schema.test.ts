import { describe, it, expect } from 'vitest';
import { DETAIL_URL_FIELD } from '@robot/scraper';
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
