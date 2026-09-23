import { describe, it, expect } from 'vitest';
import { listingModeLabel, modeLockNote, budgetSummary, deleteNote } from './site-settings-view';

describe('listingModeLabel', () => {
  it('names each stored mode, and the unchosen state', () => {
    expect(listingModeLabel('listing_to_detail')).toBe('Listing pages');
    expect(listingModeLabel('detail')).toBe('Product URLs');
    expect(listingModeLabel(null)).toBe('Not chosen yet');
  });
});

describe('modeLockNote', () => {
  it('is the lock reason once confirmed, and null otherwise', () => {
    expect(modeLockNote(new Date('2026-09-01'))).toBe('Mode is locked once the website is confirmed.');
    expect(modeLockNote(null)).toBeNull();
  });
});

describe('budgetSummary', () => {
  it('reads all/all as the plain sentence, with no budget the same as none chosen', () => {
    expect(budgetSummary({ max_items: 'all', max_pages: 'all' })).toBe('All products across all pages');
    expect(budgetSummary(null)).toBe('All products across all pages');
  });

  it('names a custom ceiling on either side, singular and plural', () => {
    expect(budgetSummary({ max_items: 500, max_pages: 10 })).toBe('Up to 500 products across 10 pages');
    expect(budgetSummary({ max_items: 1, max_pages: 1 })).toBe('Up to 1 product across 1 page');
    expect(budgetSummary({ max_items: 50, max_pages: 'all' })).toBe('Up to 50 products across all pages');
    expect(budgetSummary({ max_items: 'all', max_pages: 3 })).toBe('All products across 3 pages');
  });
});

describe('deleteNote', () => {
  it('refuses a confirmed website outright', () => {
    expect(deleteNote(new Date('2026-09-01'), 4)).toBe('A confirmed website cannot be deleted from here.');
  });

  it('otherwise counts what goes with it, singular and plural', () => {
    expect(deleteNote(null, 0)).toBe('Deletes the website, its pages, values and 0 extractions.');
    expect(deleteNote(null, 1)).toBe('Deletes the website, its pages, values and 1 extraction.');
    expect(deleteNote(null, 3)).toBe('Deletes the website, its pages, values and 3 extractions.');
  });
});
