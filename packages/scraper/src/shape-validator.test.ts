import { describe, it, expect } from 'vitest';
import { validateFieldShape } from './shape-validator.js';

describe('validateFieldShape', () => {
  it('accepts a number for a number field', () => {
    expect(validateFieldShape(24.99, 'number')).toEqual({ ok: true, normalized: 24.99 });
  });

  it('accepts a number-shaped string for a number field, stripping currency symbols', () => {
    expect(validateFieldShape('24.99', 'number')).toEqual({ ok: true, normalized: 24.99 });
    expect(validateFieldShape('$24.99', 'number')).toEqual({ ok: true, normalized: 24.99 });
  });

  it('rejects a non-numeric string for a number field', () => {
    const r = validateFieldShape('not a number', 'number');
    expect(r.ok).toBe(false);
  });

  it('rejects a UI label for a description field', () => {
    expect(validateFieldShape('Customer reviews', 'string', { fieldName: 'description' }).ok).toBe(false);
  });

  it('accepts a long string for a description field', () => {
    const long = 'A delicious assortment of premium chocolates in a gift box, hand-selected for any occasion.';
    expect(validateFieldShape(long, 'string', { fieldName: 'description' }).ok).toBe(true);
  });

  it('rejects a too-short description', () => {
    expect(validateFieldShape('Hi', 'string', { fieldName: 'description' }).ok).toBe(false);
  });

  it('rejects an empty array for an array field', () => {
    expect(validateFieldShape([], 'array').ok).toBe(false);
  });

  it('accepts a populated array for an array field', () => {
    expect(validateFieldShape(['S', 'M', 'L'], 'array').ok).toBe(true);
  });

  it('rejects null and undefined', () => {
    expect(validateFieldShape(null, 'string').ok).toBe(false);
    expect(validateFieldShape(undefined, 'string').ok).toBe(false);
  });

  it('accepts unknown types as passthrough', () => {
    expect(validateFieldShape('anything', 'some-unknown-type').ok).toBe(true);
  });
});
