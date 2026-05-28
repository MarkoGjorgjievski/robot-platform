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

  it('rejects arrays where every item has all-null sku/price/image_url (looks like a recommendations carousel)', () => {
    const value = [{ name: 'You may also like A' }, { name: 'You may also like B' }];
    const res = validateFieldShape(value, 'variant_array', { fieldName: 'variants' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/core/i);
  });

  it('accepts when at least ONE item has a non-null core field, even if others lack all three', () => {
    const value = [
      { sku: '850000-003', color: 'Black/Varsity Red', price: 80 },
      { color: 'Taxi' },  // missing all three core fields, but the array as a whole is valid
    ];
    const res = validateFieldShape(value, 'variant_array', { fieldName: 'variants' });
    expect(res.ok).toBe(true);
  });
});
