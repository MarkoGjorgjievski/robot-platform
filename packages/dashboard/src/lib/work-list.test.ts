import { describe, it, expect } from 'vitest';
import { summariseWorkList, listingValuesLabel } from './work-list';

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
