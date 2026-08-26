import { describe, it, expect } from 'vitest';
import { pickerOptions } from './candidate-picker';

const catalogue = {
  price: [
    { label: 'list', source: 'api', path: 'a', sampleValue: 679.99 },
    { label: 'displayed', source: 'xpath', path: 'b', sampleValue: 389.99, displayed: true },
  ],
  brand: [{ label: 'only', source: 'meta', path: 'c', sampleValue: 'X' }],
};

describe('pickerOptions', () => {
  it('offers a picker for a field whose concept has 2+ candidates, displayed first', () => {
    const opts = pickerOptions(catalogue, 'price');
    expect(opts).toHaveLength(2);
    expect(opts![0]!.label).toBe('displayed');
  });
  it('marks the current selection', () => {
    const opts = pickerOptions(catalogue, 'price', { concept: 'price', label: 'list' });
    expect(opts!.find((o) => o.selected)!.label).toBe('list');
  });
  it('returns null for single-candidate concepts and unknown fields', () => {
    expect(pickerOptions(catalogue, 'brand')).toBeNull();
    expect(pickerOptions(catalogue, 'weight')).toBeNull();
  });
  it('matches naive plurals (images -> image)', () => {
    const c = { image: [{ label: 'a', source: 'meta', path: 'x', sampleValue: 1 }, { label: 'b', source: 'json-ld', path: 'y', sampleValue: 2 }] };
    expect(pickerOptions(c, 'images')).toHaveLength(2);
  });
});
