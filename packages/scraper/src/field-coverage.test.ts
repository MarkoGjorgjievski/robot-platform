import { describe, it, expect } from 'vitest';
import { calculateFieldCoverage, getMissingFields } from './field-coverage.js';
import type { SchemaField } from '@robot/agent';

const fields: SchemaField[] = [
  { name: 'title', type: 'string', description: 'Title', required: true },
  { name: 'price', type: 'price', description: 'Price', required: true },
  { name: 'url', type: 'url', description: 'URL', required: false },
  { name: 'rating', type: 'number', description: 'Rating', required: false },
];

describe('calculateFieldCoverage', () => {
  it('returns 1.0 when all fields present in all rows', () => {
    const data = [
      { title: 'A', price: 10, url: 'https://a.com', rating: 4 },
      { title: 'B', price: 20, url: 'https://b.com', rating: 5 },
    ];
    expect(calculateFieldCoverage(data, fields)).toBe(1.0);
  });

  it('returns 0.5 when half the fields are present', () => {
    const data = [
      { title: 'A', price: 10 },
      { title: 'B', price: 20 },
    ];
    expect(calculateFieldCoverage(data, fields)).toBe(0.5);
  });

  it('returns 0 for empty data', () => {
    expect(calculateFieldCoverage([], fields)).toBe(0);
  });

  it('returns 0 for empty fields', () => {
    expect(calculateFieldCoverage([{ title: 'A' }], [])).toBe(0);
  });

  it('averages across rows with uneven coverage', () => {
    const data = [
      { title: 'A', price: 10, url: 'https://a.com', rating: 4 },
      { title: 'B' },
    ];
    expect(calculateFieldCoverage(data, fields)).toBe(0.625);
  });

  it('ignores null and undefined values', () => {
    const data = [{ title: 'A', price: null, url: undefined, rating: 3 }];
    expect(calculateFieldCoverage(data, fields)).toBe(0.5);
  });
});

describe('getMissingFields', () => {
  it('returns fields missing in >50% of rows', () => {
    const data = [
      { title: 'A', price: 10 },
      { title: 'B', price: 20 },
      { title: 'C' },
    ];
    const missing = getMissingFields(data, fields);
    expect(missing).toContain('url');
    expect(missing).toContain('rating');
    expect(missing).not.toContain('title');
    expect(missing).not.toContain('price');
  });

  it('returns empty array when all fields present', () => {
    const data = [
      { title: 'A', price: 10, url: 'https://a.com', rating: 4 },
    ];
    expect(getMissingFields(data, fields)).toHaveLength(0);
  });

  it('returns all fields for empty data', () => {
    expect(getMissingFields([], fields)).toEqual(['title', 'price', 'url', 'rating']);
  });

  it('handles single row with partial data', () => {
    const data = [{ title: 'A' }];
    const missing = getMissingFields(data, fields);
    expect(missing).toContain('price');
    expect(missing).toContain('url');
    expect(missing).toContain('rating');
    expect(missing).not.toContain('title');
  });
});
