import { describe, expect, it } from 'vitest';
import { sampledView } from './sampled-view';

const P = (n: number) => `https://shop.example/p/${n}`;
const read = (n: number) => ({ url: P(n), empty: [], values: { title: `T${n}` } });

describe('sampledView', () => {
  it('a listing with no products, or only proof products, has no rows: no table', () => {
    expect(sampledView([], [])).toMatchObject({ rows: [], unread: 0 });
    expect(sampledView([read(1), read(2), read(3)], [P(1), `${P(2)}/`, `${P(3)}?colour=red`]).rows).toEqual([]);
  });

  it('one, two or three products: those rows, and the heading counts them right', () => {
    expect(sampledView([read(4)], [P(1)])).toEqual({ rows: [read(4)], unread: 0, heading: '1 more product from your listing' });
    expect(sampledView([read(4), read(5)], []).heading).toBe('2 more products from your listing');
    expect(sampledView([read(4), read(5), read(6)], []).rows).toHaveLength(3);
  });

  it('a product that could not be read is never a row, only counted', () => {
    const v = sampledView([read(4), { url: P(5), unread: 'The page did not load.' }, { url: P(6), unread: 'Refused.' }], []);
    expect(v.rows).toEqual([read(4)]);
    expect(v.unread).toBe(2);
    expect(v.heading).toBe('1 more product from your listing');
    // None read: no rows at all, so no table.
    expect(sampledView([{ url: P(5), unread: 'Refused.' }], []).rows).toEqual([]);
  });
});
