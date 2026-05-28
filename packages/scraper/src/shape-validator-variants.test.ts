import { describe, it, expect } from 'vitest';
import { validateFieldShape } from './shape-validator.js';

describe('validateFieldShape — variant_array', () => {
  it('accepts an array of objects with at least one non-null core field', () => {
    const value = [
      { sku: '850000-003', color: 'Black/Varsity Red', price: 80 },
      { sku: '850000-170', color: 'Taxi', price: 80 },
    ];
    const res = validateFieldShape(value, 'variant_array', { fieldName: 'variants' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.normalized).toEqual(value);
  });

  it('rejects non-array values', () => {
    const res = validateFieldShape({ sku: 'x' }, 'variant_array', { fieldName: 'variants' });
    expect(res.ok).toBe(false);
  });

  it('rejects empty arrays', () => {
    const res = validateFieldShape([], 'variant_array', { fieldName: 'variants' });
    expect(res.ok).toBe(false);
  });

  it('rejects arrays where items are not plain objects', () => {
    const res = validateFieldShape(['Black', 'Taxi'], 'variant_array', { fieldName: 'variants' });
    expect(res.ok).toBe(false);
  });

  it('rejects arrays where no item has any recognized variant axis (looks like a recommendations carousel)', () => {
    const value = [{ name: 'You may also like A' }, { name: 'You may also like B' }];
    const res = validateFieldShape(value, 'variant_array', { fieldName: 'variants' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/axes/i);
  });

  it('accepts when every item has at least one recognized axis (color/size/etc.), even with no sku/price/image_url', () => {
    const value = [
      { color: 'Black-brown', size: '30 1/8x57 5/8 "' },
      { color: 'White', size: '30 1/8x57 5/8 "' },
      { color: 'Oak effect', size: '30 1/8x57 5/8 "' },
    ];
    const res = validateFieldShape(value, 'variant_array', { fieldName: 'variants' });
    expect(res.ok).toBe(true);
  });

  it('accepts a mix of core-only and axis-only variants', () => {
    const value = [
      { sku: '850000-003', color: 'Black/Varsity Red', price: 80 },
      { color: 'Taxi' },
    ];
    const res = validateFieldShape(value, 'variant_array', { fieldName: 'variants' });
    expect(res.ok).toBe(true);
  });

  it('rejects when one item has no recognized axis (mixed valid + invalid)', () => {
    const value = [
      { color: 'Red' },
      { name: 'Not a variant — a recommendation' },
    ];
    const res = validateFieldShape(value, 'variant_array', { fieldName: 'variants' });
    expect(res.ok).toBe(false);
  });
});
