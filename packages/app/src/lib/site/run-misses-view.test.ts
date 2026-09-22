import { describe, it, expect } from 'vitest';
import { missLine, listingLabel } from './run-misses-view';

describe('run misses copy', () => {
  it('one sentence per field: the count, then each listing with its share', () => {
    expect(missLine({ name: 'price', count: 38, total: 600, groups: [
      { listingUrl: 'https://www.ikea.com/my/en/cat/two-seater-sofas-10668/', count: 36, urls: [] },
      { listingUrl: 'https://www.ikea.com/my/en/cat/armchairs-16239/', count: 2, urls: [] },
    ] }, 'Price')).toBe('Price is empty on 38 of 600 products · 36 from /my/en/cat/two-seater-sofas-10668/ · 2 from /my/en/cat/armchairs-16239/');
  });
  it('says "all" when one listing holds every miss, and handles products given directly', () => {
    expect(missLine({ name: 'price', count: 3, total: 10, groups: [{ listingUrl: 'https://s.example/cat/a', count: 3, urls: [] }] }, 'Price')).toBe('Price is empty on 3 of 10 products · all from /cat/a');
    expect(missLine({ name: 'price', count: 1, total: 4, groups: [{ listingUrl: null, count: 1, urls: [] }] }, 'Price')).toBe('Price is empty on 1 of 4 products · all from the product URLs you gave');
  });
  it('listingLabel is the path, never the host', () => {
    expect(listingLabel('https://s.example/cat/a?page=2')).toBe('/cat/a?page=2');
    expect(listingLabel('not a url')).toBe('not a url');
  });
});
