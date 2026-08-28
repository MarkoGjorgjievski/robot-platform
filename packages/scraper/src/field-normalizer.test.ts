import { describe, it, expect } from 'vitest';
import { normalizeUserFields } from './field-normalizer.js';

describe('normalizeUserFields', () => {
  it('normalizes comma-separated field names', () => {
    const result = normalizeUserFields('title, price, sku');
    expect(result).toEqual([
      { name: 'title', type: 'string', description: '', required: true, tier: 'requested' },
      { name: 'price', type: 'price', description: '', required: true, tier: 'requested' },
      { name: 'sku', type: 'string', description: '', required: true, tier: 'requested' },
    ]);
  });

  it('normalizes newline-separated fields', () => {
    const result = normalizeUserFields('title\nprice\nsku');
    expect(result).toHaveLength(3);
    expect(result[0].name).toBe('title');
  });

  it('converts natural names to snake_case', () => {
    const result = normalizeUserFields('Product Name, Shipping Weight, Review Count');
    expect(result[0].name).toBe('product_name');
    expect(result[1].name).toBe('shipping_weight');
    expect(result[2].name).toBe('review_count');
  });

  it('infers types from field names', () => {
    const result = normalizeUserFields('price, image_url, rating, in_stock, publish_date');
    expect(result[0].type).toBe('price');
    expect(result[1].type).toBe('image_url');
    expect(result[2].type).toBe('number');
    expect(result[3].type).toBe('boolean');
    expect(result[4].type).toBe('date');
  });

  it('deduplicates fields', () => {
    const result = normalizeUserFields('title, price, title');
    expect(result).toHaveLength(2);
  });

  it('handles empty input', () => {
    const result = normalizeUserFields('');
    expect(result).toEqual([]);
  });

  it('handles fields with descriptions like "price - the current selling price"', () => {
    const result = normalizeUserFields('price - the current selling price');
    expect(result[0].name).toBe('price');
    expect(result[0].description).toBe('the current selling price');
  });

  it('splits "name: hint" into name + description (hint verbatim, trimmed)', () => {
    const result = normalizeUserFields('isbn: near the publisher line');
    expect(result[0].name).toBe('isbn');
    expect(result[0].description).toBe('near the publisher line');
  });

  it('leaves a bare field name unchanged when there is no colon or dash', () => {
    const result = normalizeUserFields('isbn');
    expect(result[0].name).toBe('isbn');
    expect(result[0].description).toBe('');
  });

  it('splits on the FIRST colon only, keeping the rest of the line in the hint', () => {
    // Newline-delimited (so the comma inside the hint isn't mistaken for an
    // entry separator — that split only happens when the whole input has no
    // newlines at all).
    const result = normalizeUserFields('release_date: format is 2024-01-01, check the footer: near copyright\nother_field');
    expect(result[0].name).toBe('release_date');
    expect(result[0].description).toBe('format is 2024-01-01, check the footer: near copyright');
    expect(result[1].name).toBe('other_field');
  });

  it('supports multiple newline-delimited "name: hint" entries', () => {
    const result = normalizeUserFields('isbn: near the imprint line\nbrand');
    expect(result).toEqual([
      { name: 'isbn', type: 'string', description: 'near the imprint line', required: true, tier: 'requested' },
      { name: 'brand', type: 'string', description: '', required: true, tier: 'requested' },
    ]);
  });
});
