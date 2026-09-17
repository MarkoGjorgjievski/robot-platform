import { describe, it, expect } from 'vitest';
import { computeMisses, MISS_URLS_PER_GROUP } from './misses.js';

const fields = [{ name: 'title' }, { name: 'price' }];
const L1 = 'https://s.example/cat/sofas';
const L2 = 'https://s.example/cat/chairs';
const item = (n: number, listingUrl: string | null, row: Record<string, unknown> | null, absentFields: string[] = []) =>
  ({ url: `https://s.example/p/${n}`, listingUrl, row, absentFields });

describe('computeMisses', () => {
  it('groups a field\'s empty cells by the listing each product came from, largest group first', () => {
    const out = computeMisses(fields, [
      item(1, L1, { title: 'A', price: 10 }),
      item(2, L2, { title: 'B', price: null }),
      item(3, L2, { title: 'C', price: '' }),
      item(4, L1, { title: 'D', price: null }),
      item(5, L2, { title: 'E' }),
    ]);
    expect(out).toEqual([{
      name: 'price', count: 4, total: 5,
      groups: [
        { listingUrl: L2, count: 3, urls: ['https://s.example/p/2', 'https://s.example/p/3', 'https://s.example/p/5'] },
        { listingUrl: L1, count: 1, urls: ['https://s.example/p/4'] },
      ],
    }]);
  });
  it('omits fields with nothing missing, and treats 0 and false as filled', () => {
    expect(computeMisses(fields, [item(1, L1, { title: 'A', price: 0 }), item(2, L1, { title: 'B', price: false })])).toEqual([]);
  });
  it('a confirmed-absent cell is not a miss', () => {
    expect(computeMisses(fields, [item(1, L1, { title: 'A', price: null }, ['price'])])).toEqual([]);
  });
  it('a failed item (no row) misses every field', () => {
    expect(computeMisses(fields, [item(1, L1, null)]).map((f) => f.name)).toEqual(['title', 'price']);
  });
  it('products given directly form one group with a null listing', () => {
    expect(computeMisses(fields, [item(1, null, { title: 'A' })])[0]!.groups).toEqual([{ listingUrl: null, count: 1, urls: ['https://s.example/p/1'] }]);
  });
  it('caps the urls listed per group but not the count', () => {
    const many = Array.from({ length: MISS_URLS_PER_GROUP + 5 }, (_, i) => item(i, L1, { title: 'x' }));
    const g = computeMisses(fields, many)[0]!.groups[0]!;
    expect(g.count).toBe(MISS_URLS_PER_GROUP + 5);
    expect(g.urls).toHaveLength(MISS_URLS_PER_GROUP);
  });
});
