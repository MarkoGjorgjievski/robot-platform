import { describe, it, expect } from 'vitest';
import { resolveBudget, itemCap, PAGES_ALL_CEILING, HARD_ITEM_CEILING } from './budget.js';
import { API_WALK_MAX_BATCH } from './plan-run.js';

describe('resolveBudget', () => {
  it('applies conservative defaults to an empty budget', () => {
    expect(resolveBudget({})).toEqual({ maxPages: 3, maxItems: 50, mode: 'first_n', pagesAll: false });
  });

  it('applies the same defaults to null', () => {
    expect(resolveBudget(null)).toEqual({ maxPages: 3, maxItems: 50, mode: 'first_n', pagesAll: false });
  });

  it('reads the snake_case keys the database stores', () => {
    expect(resolveBudget({ max_pages: 10, max_items: 200, mode: 'all' }))
      .toEqual({ maxPages: 10, maxItems: 200, mode: 'all', pagesAll: false });
  });

  it('fills only the missing keys of a partial budget', () => {
    expect(resolveBudget({ max_pages: 7 })).toEqual({ maxPages: 7, maxItems: 50, mode: 'first_n', pagesAll: false });
  });

  it('rejects a non-positive page count rather than crawling zero pages', () => {
    expect(resolveBudget({ max_pages: 0 }).maxPages).toBe(3);
  });

  it('ignores an unknown mode', () => {
    expect(resolveBudget({ mode: 'everything' }).mode).toBe('first_n');
  });

  it("'all' pages resolves to the single-burst ceiling and says so", () => {
    expect(resolveBudget({ max_pages: 'all', max_items: 'all' }))
      .toEqual({ maxPages: PAGES_ALL_CEILING, maxItems: 50, mode: 'all', pagesAll: true });
    expect(PAGES_ALL_CEILING).toBe(API_WALK_MAX_BATCH);
  });

  it("'all' items is the existing all mode with the hard ceiling", () => {
    expect(itemCap(resolveBudget({ max_items: 'all' }))).toBe(HARD_ITEM_CEILING);
  });

  it('numbers still work', () => {
    expect(resolveBudget({ max_pages: 4, max_items: 12 })).toMatchObject({ maxPages: 4, maxItems: 12, pagesAll: false });
  });
});

describe('itemCap', () => {
  it('caps at max_items under first_n', () => {
    expect(itemCap({ maxPages: 3, maxItems: 50, mode: 'first_n', pagesAll: false })).toBe(50);
  });

  it('ignores max_items under all, falling back to the hard ceiling', () => {
    expect(itemCap({ maxPages: 3, maxItems: 50, mode: 'all', pagesAll: false })).toBe(HARD_ITEM_CEILING);
  });

  it('never exceeds the hard ceiling, however large max_items is', () => {
    expect(itemCap({ maxPages: 3, maxItems: 99999, mode: 'first_n', pagesAll: false })).toBe(HARD_ITEM_CEILING);
  });
});
