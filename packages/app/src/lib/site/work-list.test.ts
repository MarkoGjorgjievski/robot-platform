import { describe, it, expect } from 'vitest';
import { summariseWorkList, listingValuesLabel, groupWorkList, pageStatusWord } from './work-list';

describe('summariseWorkList', () => {
  it('describes what a plan produced, before anything is extracted', () => {
    expect(summariseWorkList({ listing: 2, detail: 47, pending: 47, done: 2, failed: 0 }))
      .toBe('47 URLs to extract · 2 listing pages walked');
  });

  it('uses the singular where it should', () => {
    expect(summariseWorkList({ listing: 1, detail: 1, pending: 1, done: 1, failed: 0 }))
      .toBe('1 URL to extract · 1 listing page walked');
  });

  it('surfaces failures, which are the reason to look at this at all', () => {
    expect(summariseWorkList({ listing: 1, detail: 10, pending: 7, done: 1, failed: 3 }))
      .toBe('10 URLs to extract · 1 listing page walked · 3 failed');
  });

  it('says plainly when a plan found nothing', () => {
    expect(summariseWorkList({ listing: 1, detail: 0, pending: 0, done: 1, failed: 0 }))
      .toBe('No URLs found · 1 listing page walked');
  });
});

describe('listingValuesLabel', () => {
  it('shows the values a detail row inherited from its listing page', () => {
    expect(listingValuesLabel({ category_name: 'GPU & Video Graphics Device' }))
      .toBe('category_name: GPU & Video Graphics Device');
  });

  it('joins several values readably', () => {
    expect(listingValuesLabel({ category_name: 'Books', listing_price: '12.99' }))
      .toBe('category_name: Books · listing_price: 12.99');
  });

  it('reads as empty when nothing was carried down', () => {
    expect(listingValuesLabel({})).toBe('—');
    expect(listingValuesLabel(null)).toBe('—');
  });

  it('hides keys whose value never resolved, rather than showing null', () => {
    expect(listingValuesLabel({ category_name: 'Books', missing: null })).toBe('category_name: Books');
  });

  it('renders structured values as JSON, never [object Object]', () => {
    expect(listingValuesLabel({ scroll_rounds: [{ rows: 180, planned: 36 }] }))
      .toBe('scroll_rounds: [{"rows":180,"planned":36}]');
  });
});

describe('groupWorkList', () => {
  const row = (id: string, kind: string, inputIndex: number, pageNumber: number | null, status = 'done') => ({ id, kind, url: `https://s.example/${id}`, status, pageNumber, inputIndex });
  it('puts each product under the listing page it was found on, in listing and page order', () => {
    const groups = groupWorkList([
      row('p3', 'detail', 0, 2, 'pending'), row('l2', 'listing', 0, 2), row('p1', 'detail', 0, 1), row('l1', 'listing', 0, 1), row('p2', 'detail', 0, 1, 'failed'),
    ]);
    expect(groups.map((g) => [g.title, g.products.map((p) => p.id)])).toEqual([['Listing · page 1', ['p1', 'p2']], ['Listing · page 2', ['p3']]]);
    expect(groups[0]!.summary).toBe('2 products · 1 extracted · 1 failed');
    expect(groups[1]!.summary).toBe('1 product');
  });
  it('numbers the listings only when there are several', () => {
    const groups = groupWorkList([row('la', 'listing', 0, 1), row('lb', 'listing', 1, 1), row('pb', 'detail', 1, 1)]);
    expect(groups.map((g) => g.title)).toEqual(['Listing 1 · page 1', 'Listing 2 · page 1']);
  });
  it('products given as their own addresses have no listing above them', () => {
    const groups = groupWorkList([row('a', 'detail', 0, null), row('b', 'detail', 1, null)]);
    expect(groups.map((g) => [g.listing, g.title, g.products.length])).toEqual([[null, 'Products', 2]]);
  });
  it('says pending in plain words', () => {
    expect(pageStatusWord('pending')).toBe('not extracted yet');
    expect(pageStatusWord('done')).toBe('extracted');
  });
});
