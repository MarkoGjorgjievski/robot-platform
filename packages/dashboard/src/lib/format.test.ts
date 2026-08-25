import { describe, expect, test } from 'vitest';
import { formatValue } from './format';

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
