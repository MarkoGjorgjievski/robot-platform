import { describe, expect, test } from 'vitest';
import { formatValue, previewValue } from './format';

describe('previewValue', () => {
  test('summarizes an array of objects as a count plus its shape', () => {
    const variants = [
      { sku: null, size: null, color: null, price: null, finish: 'With Heatsink' },
      { sku: null, size: null, color: null, price: null, finish: 'Without Heatsink' },
    ];
    expect(previewValue(variants)).toBe('2 items · sku, size, color, price, finish');
  });

  test('caps the shape at five keys', () => {
    const wide = [{ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7 }];
    expect(previewValue(wide)).toBe('1 item · a, b, c, d, e, …');
  });

  test('renders a small plain object as readable key: value pairs', () => {
    expect(previewValue({ '1': 22, '2': 20 })).toBe('1: 22 · 2: 20');
  });

  test('caps a large plain object at four entries', () => {
    expect(previewValue({ a: 1, b: 2, c: 3, d: 4, e: 5 })).toBe('a: 1 · b: 2 · c: 3 · d: 4 · …');
  });

  test('joins an array of scalars', () => {
    expect(previewValue(['S', 'M', 'L'])).toBe('S · M · L');
  });

  test('falls through to formatValue for scalars and null', () => {
    expect(previewValue('plain')).toBe('plain');
    expect(previewValue(299)).toBe('299');
    expect(previewValue(null)).toBe('—');
  });
});

describe('formatValue', () => {
  test('passes strings through unchanged', () => {
    expect(formatValue('Nike Air Jordan')).toBe('Nike Air Jordan');
  });

  test('stringifies numbers and booleans', () => {
    expect(formatValue(129.99)).toBe('129.99');
    expect(formatValue(true)).toBe('true');
  });

  test('renders plain objects as JSON, not [object Object]', () => {
    expect(formatValue({ five_star: 120, four_star: 40 })).toBe(
      '{"five_star":120,"four_star":40}',
    );
  });

  test('renders arrays as JSON', () => {
    expect(formatValue([{ color: 'Black' }, { color: 'White' }])).toBe(
      '[{"color":"Black"},{"color":"White"}]',
    );
  });

  test('renders null and undefined as an em dash', () => {
    expect(formatValue(null)).toBe('—');
    expect(formatValue(undefined)).toBe('—');
  });

  test('falls back to String() for objects JSON cannot encode', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(formatValue(cyclic)).toBe('[object Object]');
  });
});
