import { describe, it, expect } from 'vitest';
import {
  stepStates,
  listingCheckLabel,
  productUrlCounts,
  runSentence,
  budgetFromForm,
  budgetToForm,
  lockedStripText,
  sampleFacts,
  emptyCellNote,
} from './extract-view';

describe('stepStates', () => {
  const base = { schemaGreen: true, mode: null as null | 'listing' | 'detail', pagesSaved: false, sampleRun: null as null | { status: string }, running: false };
  it('locks everything when the schema is not green', () => {
    expect(stepStates({ ...base, schemaGreen: false })).toEqual(['locked', 'locked', 'locked']);
    expect(stepStates({ ...base, schemaGreen: false, mode: 'listing', pagesSaved: true })).toEqual(['locked', 'locked', 'locked']);
  });
  it('step 1 is current until a mode is chosen and pages saved', () => {
    expect(stepStates(base)).toEqual(['current', 'later', 'later']);
    expect(stepStates({ ...base, mode: 'listing' })).toEqual(['current', 'later', 'later']);
  });
  it('listing mode with pages saved moves to sampling until a sample completes', () => {
    expect(stepStates({ ...base, mode: 'listing', pagesSaved: true })).toEqual(['done', 'current', 'later']);
    expect(stepStates({ ...base, mode: 'listing', pagesSaved: true, sampleRun: { status: 'running' } })).toEqual(['done', 'current', 'later']);
    expect(stepStates({ ...base, mode: 'listing', pagesSaved: true, sampleRun: { status: 'completed' } })).toEqual(['done', 'done', 'current']);
  });
  it('detail mode with pages saved goes straight to run regardless of sampleRun', () => {
    expect(stepStates({ ...base, mode: 'detail', pagesSaved: true })).toEqual(['done', 'done', 'current']);
    expect(stepStates({ ...base, mode: 'detail', pagesSaved: true, sampleRun: { status: 'failed' } })).toEqual(['done', 'done', 'current']);
  });
  it('running marks all three done', () => {
    expect(stepStates({ ...base, mode: 'listing', pagesSaved: true, sampleRun: { status: 'completed' }, running: true })).toEqual(['done', 'done', 'done']);
    expect(stepStates({ ...base, mode: 'detail', pagesSaved: true, running: true })).toEqual(['done', 'done', 'done']);
  });
  it('schema-not-green wins over running', () => {
    expect(stepStates({ ...base, schemaGreen: false, mode: 'listing', pagesSaved: true, sampleRun: { status: 'completed' }, running: true })).toEqual(['locked', 'locked', 'locked']);
  });
  // Pinning current precedence deliberately: `running` short-circuits before mode/pagesSaved are checked, so an
  // otherwise-unstarted stepper still shows all-done while a run is in flight.
  it('running wins over an unstarted stepper (mode null, pages not saved)', () => {
    expect(stepStates({ ...base, mode: null, pagesSaved: false, running: true })).toEqual(['done', 'done', 'done']);
  });
});

describe('listingCheckLabel', () => {
  it('is pending while checking', () => {
    expect(listingCheckLabel(null)).toEqual({ tone: 'pending', text: 'checking…' });
  });
  it('surfaces the error message', () => {
    expect(listingCheckLabel({ error: 'timed out' })).toEqual({ tone: 'error', text: 'timed out' });
  });
  it('reports product links and pager, singular and plural', () => {
    expect(listingCheckLabel({ productLinks: 12, pagerSeen: true })).toEqual({ tone: 'ok', text: '12 product links · pager found' });
    expect(listingCheckLabel({ productLinks: 1, pagerSeen: true })).toEqual({ tone: 'ok', text: '1 product link · pager found' });
    expect(listingCheckLabel({ productLinks: 12, pagerSeen: false })).toEqual({ tone: 'warn', text: '12 product links · no pager seen' });
    expect(listingCheckLabel({ productLinks: 1, pagerSeen: false })).toEqual({ tone: 'warn', text: '1 product link · no pager seen' });
  });
});

describe('productUrlCounts', () => {
  const proofUrls = ['https://shop.example/a', 'https://shop.example/b#section'];
  it('counts only lines that parse as http(s) urls', () => {
    expect(productUrlCounts(['https://shop.example/a', 'not a url', 'ftp://x.example/y', ''], proofUrls, 'shop.example')).toEqual({ total: 1, proof: 1, offHost: 0 });
  });
  it('matches proof urls with hash stripped on both sides', () => {
    expect(productUrlCounts(['https://shop.example/a#foo', 'https://shop.example/b'], proofUrls, 'shop.example')).toEqual({ total: 2, proof: 2, offHost: 0 });
  });
  it('flags off-host lines case-insensitively, and skips the check when host is null', () => {
    expect(productUrlCounts(['https://SHOP.example/a', 'https://other.example/c'], proofUrls, 'shop.example')).toEqual({ total: 2, proof: 1, offHost: 1 });
    expect(productUrlCounts(['https://other.example/c'], proofUrls, null)).toEqual({ total: 1, proof: 0, offHost: 0 });
  });
});

describe('runSentence', () => {
  it('pluralizes listings and formats the safety stop with a comma', () => {
    expect(runSentence({ items: 'all', pages: 'all' }, 3)).toBe('3 listings · up to 10 pages per listing · safety stop at 5,000 products per run');
    expect(runSentence({ items: 'all', pages: 'all' }, 1)).toBe('1 listing · up to 10 pages per listing · safety stop at 5,000 products per run');
  });
  it('adds the products-per-listing clause when items is a number, singular and plural', () => {
    expect(runSentence({ items: 5, pages: 'all' }, 2)).toBe('2 listings · first 5 products from each · up to 10 pages per listing · safety stop at 5,000 products per run');
    expect(runSentence({ items: 1, pages: 'all' }, 2)).toBe('2 listings · first 1 product from each · up to 10 pages per listing · safety stop at 5,000 products per run');
  });
  it('describes numeric pages, singular and plural', () => {
    expect(runSentence({ items: 'all', pages: 3 }, 2)).toBe('2 listings · first 3 pages of each · safety stop at 5,000 products per run');
    expect(runSentence({ items: 'all', pages: 1 }, 2)).toBe('2 listings · first 1 page of each · safety stop at 5,000 products per run');
  });
});

describe('budgetFromForm / budgetToForm', () => {
  it('round-trips explicit numbers', () => {
    expect(budgetFromForm(50, 3)).toEqual({ max_items: 50, max_pages: 3, mode: 'first_n' });
    expect(budgetToForm({ max_items: 50, max_pages: 3, mode: 'first_n' })).toEqual({ items: 50, pages: 3 });
  });
  it('treats all as all on both sides', () => {
    expect(budgetFromForm('all', 'all')).toEqual({ max_items: 'all', max_pages: 'all', mode: 'all' });
    expect(budgetToForm({ max_items: 'all', max_pages: 'all', mode: 'all' })).toEqual({ items: 'all', pages: 'all' });
  });
  it('falls back to all for missing or invalid raw input, including legacy mode: all with a numeric max_items', () => {
    expect(budgetToForm(null)).toEqual({ items: 'all', pages: 'all' });
    expect(budgetToForm({})).toEqual({ items: 'all', pages: 'all' });
    expect(budgetToForm({ max_items: -1, max_pages: 'x' })).toEqual({ items: 'all', pages: 'all' });
    expect(budgetToForm({ mode: 'all', max_items: 20 })).toEqual({ items: 'all', pages: 'all' });
  });
});

describe('lockedStripText', () => {
  it('names the fix target when there is a first failing field', () => {
    expect(lockedStripText({ fieldCount: 5, currentKeys: ['a', 'b', 'c', 'd'], firstFailing: 'author_url' })).toBe(
      'Extraction is locked · 4 of 5 fields verified · fix author_url on the Schema tab',
    );
  });
  it('omits the fix clause when nothing is failing', () => {
    expect(lockedStripText({ fieldCount: 5, currentKeys: ['a', 'b', 'c', 'd', 'e'], firstFailing: null })).toBe('Extraction is locked · 5 of 5 fields verified');
  });
  it('uses singular field when fieldCount is 1', () => {
    expect(lockedStripText({ fieldCount: 1, currentKeys: [], firstFailing: 'price' })).toBe('Extraction is locked · 0 of 1 field verified · fix price on the Schema tab');
  });
});

describe('sampleFacts', () => {
  it('returns the four facts in order with the given labels', () => {
    expect(sampleFacts({ pagesWalked: 3, itemsFound: 42, warningsCount: 0, paginationNote: 'offset' }, { detail: 42, done: 40 })).toEqual([
      { label: 'Pages walked', value: '3' },
      { label: 'Product links found', value: '42' },
      { label: 'Pagination detected', value: 'offset' },
      { label: 'Sample rows complete', value: '40 of 42' },
    ]);
  });
  it('carries through zero counts', () => {
    expect(sampleFacts({ pagesWalked: 0, itemsFound: 0, warningsCount: 0, paginationNote: 'not reported' }, { detail: 0, done: 0 })).toEqual([
      { label: 'Pages walked', value: '0' },
      { label: 'Product links found', value: '0' },
      { label: 'Pagination detected', value: 'not reported' },
      { label: 'Sample rows complete', value: '0 of 0' },
    ]);
  });
});

describe('emptyCellNote', () => {
  it('pluralizes pages', () => {
    expect(emptyCellNote('price', 2, 3)).toBe(
      'price was empty on 2 of 3 sampled pages. Extraction leaves such cells empty and counts them; it never guesses.',
    );
  });
  it('uses singular page when sampled is 1', () => {
    expect(emptyCellNote('price', 1, 1)).toBe(
      'price was empty on 1 of 1 sampled page. Extraction leaves such cells empty and counts them; it never guesses.',
    );
  });
});
