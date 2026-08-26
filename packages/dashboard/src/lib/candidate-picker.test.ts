import { describe, it, expect } from 'vitest';
import { pickerOptions, pickerOptionLabel, sourceHostnames } from './candidate-picker';

describe('sourceHostnames', () => {
  it('keeps the hostname verbatim, www included — domain_intelligence rows are stored keyed by it', () => {
    expect(sourceHostnames([{ urlTemplate: 'https://www.newegg.com/p/{id}' }])).toEqual(['www.newegg.com']);
  });

  it('dedupes and skips malformed or missing urlTemplates', () => {
    expect(sourceHostnames([
      { urlTemplate: 'https://a.com/x' },
      { urlTemplate: 'https://a.com/y' },
      { urlTemplate: 'not a url' },
      { urlTemplate: null },
      {},
    ])).toEqual(['a.com']);
  });
});

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
  it('carries a candidate-level hostname through when the catalogue entry has one', () => {
    const c = {
      price: [
        { label: 'list', source: 'api', path: 'a', sampleValue: 1, hostname: 'a.com' },
        { label: 'msrp', source: 'api', path: 'b', sampleValue: 2, hostname: 'b.com' },
      ],
    };
    const opts = pickerOptions(c, 'price');
    expect(opts!.map((o) => o.hostname)).toEqual(['a.com', 'b.com']);
  });
});

describe('pickerOptionLabel', () => {
  const base = { concept: 'price', label: 'list', sampleValue: 679.99, displayed: false, selected: false };

  it('formats label — sample with no hostname annotation for a single-hostname dataset', () => {
    expect(pickerOptionLabel({ ...base, hostname: 'a.com' }, { multiHostname: false }))
      .toBe('list — 679.99');
  });

  it('flags the displayed candidate', () => {
    expect(pickerOptionLabel({ ...base, displayed: true }, { multiHostname: false }))
      .toBe('list — 679.99 (displayed)');
  });

  it('appends the source hostname only when the dataset spans more than one hostname', () => {
    expect(pickerOptionLabel({ ...base, hostname: 'www.newegg.com' }, { multiHostname: true }))
      .toBe('list — 679.99 · www.newegg.com');
  });

  it('omits the hostname suffix when the option carries no hostname, even if multiHostname', () => {
    expect(pickerOptionLabel(base, { multiHostname: true })).toBe('list — 679.99');
  });
});
