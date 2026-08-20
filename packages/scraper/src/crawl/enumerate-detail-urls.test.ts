import { describe, it, expect } from 'vitest';
import { enumerateDetailUrls, DETAIL_URL_FIELD } from './enumerate-detail-urls.js';

const PAGE_URL = 'https://example.com/c/shelves?page=1';

function args(rows: Array<Record<string, unknown>>, overrides: Partial<Parameters<typeof enumerateDetailUrls>[0]> = {}) {
  return { rows, pageUrl: PAGE_URL, pageNumber: 1, seen: new Set<string>(), remaining: 100, ...overrides };
}

describe('enumerateDetailUrls', () => {
  it('resolves a relative href against the listing page URL', () => {
    const result = enumerateDetailUrls(args([{ [DETAIL_URL_FIELD]: '/p/kallax' }]));
    expect(result.items[0]?.url).toBe('https://example.com/p/kallax');
  });

  it('keeps an already-absolute URL unchanged', () => {
    const result = enumerateDetailUrls(args([{ [DETAIL_URL_FIELD]: 'https://cdn.example.com/p/1' }]));
    expect(result.items[0]?.url).toBe('https://cdn.example.com/p/1');
  });

  it('carries the row\'s other fields as that item\'s listing values', () => {
    const result = enumerateDetailUrls(args([{ [DETAIL_URL_FIELD]: '/p/1', listing_price: '79', category: 'Shelves' }]));
    expect(result.items[0]?.listingValues).toEqual({ listing_price: '79', category: 'Shelves' });
  });

  it('stamps the page number each URL was discovered on', () => {
    const result = enumerateDetailUrls(args([{ [DETAIL_URL_FIELD]: '/p/1' }], { pageNumber: 4 }));
    expect(result.items[0]?.pageNumber).toBe(4);
  });

  it('drops a row with no detail_url', () => {
    const result = enumerateDetailUrls(args([{ listing_price: '79' }, { [DETAIL_URL_FIELD]: '/p/1' }]));
    expect(result.items).toHaveLength(1);
  });

  it('drops a non-http scheme rather than queueing javascript: as work', () => {
    const result = enumerateDetailUrls(args([{ [DETAIL_URL_FIELD]: 'javascript:void(0)' }]));
    expect(result.items).toEqual([]);
  });

  it('drops a URL already seen on an earlier page', () => {
    const seen = new Set(['https://example.com/p/1']);
    const result = enumerateDetailUrls(args([{ [DETAIL_URL_FIELD]: '/p/1' }, { [DETAIL_URL_FIELD]: '/p/2' }], { seen }));
    expect(result.items.map((i) => i.url)).toEqual(['https://example.com/p/2']);
  });

  it('dedupes repeats within the same page', () => {
    const result = enumerateDetailUrls(args([{ [DETAIL_URL_FIELD]: '/p/1' }, { [DETAIL_URL_FIELD]: '/p/1' }]));
    expect(result.items).toHaveLength(1);
  });

  it('stops with empty-page when the page yielded no rows', () => {
    expect(enumerateDetailUrls(args([])).stop).toBe('empty-page');
  });

  it('stops with all-duplicates when every URL was already seen — the clamped-page-number signature', () => {
    const seen = new Set(['https://example.com/p/1']);
    const result = enumerateDetailUrls(args([{ [DETAIL_URL_FIELD]: '/p/1' }], { seen }));
    expect(result.stop).toBe('all-duplicates');
  });

  it('truncates to the remaining budget and reports the budget stop', () => {
    const result = enumerateDetailUrls(
      args([{ [DETAIL_URL_FIELD]: '/p/1' }, { [DETAIL_URL_FIELD]: '/p/2' }, { [DETAIL_URL_FIELD]: '/p/3' }], { remaining: 2 }),
    );
    expect(result.items.map((i) => i.url)).toEqual(['https://example.com/p/1', 'https://example.com/p/2']);
    expect(result.stop).toBe('budget');
  });

  it('does not stop while new URLs are still arriving under budget', () => {
    expect(enumerateDetailUrls(args([{ [DETAIL_URL_FIELD]: '/p/1' }])).stop).toBeNull();
  });

  it('reports the budget stop when a page\'s rows exactly consume the remaining budget', () => {
    const result = enumerateDetailUrls(
      args([{ [DETAIL_URL_FIELD]: '/p/1' }, { [DETAIL_URL_FIELD]: '/p/2' }], { remaining: 2 }),
    );
    expect(result.items.map((i) => i.url)).toEqual(['https://example.com/p/1', 'https://example.com/p/2']);
    expect(result.stop).toBe('budget');
  });

  it('does not mutate the caller\'s seen set', () => {
    const seen = new Set<string>();
    enumerateDetailUrls(args([{ [DETAIL_URL_FIELD]: '/p/1' }], { seen }));
    expect(seen.size).toBe(0);
  });
});

describe('self-links', () => {
  it('drops a candidate that is the listing page itself', () => {
    const result = enumerateDetailUrls({
      rows: [{ [DETAIL_URL_FIELD]: PAGE_URL }, { [DETAIL_URL_FIELD]: '/p/1' }],
      pageUrl: PAGE_URL,
      pageNumber: 1,
      seen: new Set<string>(),
      remaining: 100,
    });
    expect(result.items.map((i) => i.url)).toEqual(['https://example.com/p/1']);
  });

  it('drops a self-link that differs only by trailing slash or hash', () => {
    const result = enumerateDetailUrls({
      rows: [{ [DETAIL_URL_FIELD]: `${PAGE_URL}#top` }],
      pageUrl: PAGE_URL,
      pageNumber: 1,
      seen: new Set<string>(),
      remaining: 100,
    });
    expect(result.items).toEqual([]);
  });
});
