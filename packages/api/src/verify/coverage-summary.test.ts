import { describe, it, expect } from 'vitest';
import type { Shape } from '@robot/scraper';
import { summariseCoverage, stageLine, type CoverageResults } from './coverage-summary.js';

const single: Shape = { jsonLdTypes: ['Product'], offers: 'top-level', rating: true, address: '/p/n' };
const multi: Shape = { jsonLdTypes: ['ProductGroup'], offers: 'in-variants', rating: true, address: '/p/n' };
const noRating: Shape = { ...single, rating: false };
const P = ['https://s.example/p/1', 'https://s.example/p/2', 'https://s.example/p/3'];
const results = (sampled: CoverageResults['sampled']): CoverageResults => ({ listingUrl: 'https://s.example/l', sampled, proofShapes: Object.fromEntries(P.map((u) => [u, single])) });
const page = (i: number, empty: string[], shape: Shape = single) => ({ url: `https://s.example/p/${i}`, empty, shape });

describe('summariseCoverage (spec 2026-10-10 §A5)', () => {
  it('Lookfantastic: price empty on the multi-size pages, explained because every empty page has what no proof page has', () => {
    const sampled = [...Array.from({ length: 11 }, (_, i) => page(10 + i, ['price', 'in_stock'], multi)), ...Array.from({ length: 9 }, (_, i) => page(30 + i, []))];
    const [price] = summariseCoverage(results(sampled), ['price', 'title']).filter((f) => f.key === 'price');
    expect(price).toEqual({
      key: 'price', empty: sampled.slice(0, 11).map((p) => p.url), sampled: 20, unread: 0,
      explanation: 'all 11 list their sizes as variants in the page data',
      representative: 'https://s.example/p/10',
    });
  });
  it('no proof shapes (none captured fresh): no explanation, since nothing shows the proof pages lack the feature', () => {
    const sampled = [...Array.from({ length: 11 }, (_, i) => page(10 + i, ['price'], multi)), ...Array.from({ length: 9 }, (_, i) => page(30 + i, []))];
    const [price] = summariseCoverage({ ...results(sampled), proofShapes: {} }, ['price']);
    expect(price).toMatchObject({ key: 'price', empty: sampled.slice(0, 11).map((p) => p.url), explanation: null, representative: 'https://s.example/p/10' });
  });
  it('no explanation when the empties share nothing the proof pages lack; representative is still the first empty', () => {
    const [price] = summariseCoverage(results([page(10, ['price']), page(11, ['price']), page(12, [])]), ['price']);
    expect(price.explanation).toBeNull();
    expect(price.representative).toBe('https://s.example/p/10');
  });
  it('"n of m" when at least four of five share the feature, none below that', () => {
    const r = summariseCoverage(results([page(10, ['rating'], noRating), page(11, ['rating'], noRating), page(12, ['rating'], noRating), page(13, ['rating'], noRating), page(14, ['rating'])]), ['rating']);
    expect(r[0].explanation).toBe('4 of 5 show no rating in the page data');
    const low = summariseCoverage(results([page(10, ['rating'], noRating), page(11, ['rating']), page(12, ['rating'])]), ['rating']);
    expect(low[0].explanation).toBeNull();
  });
  it('one empty page reads in the singular', () => {
    const r = summariseCoverage(results([page(10, ['price'], multi), page(11, [])]), ['price']);
    expect(r[0].explanation).toBe('it lists its sizes as variants in the page data');
  });
  it('unread pages count as unread, never as empty; a field with no empties is left out', () => {
    const r = summariseCoverage(results([page(10, []), { url: 'https://s.example/p/11', unread: 'shop.example refused the browser (HTTP 403).' }]), ['price']);
    expect(r).toEqual([]);
  });
  it('the representative is the first empty page of the largest shape group', () => {
    const r = summariseCoverage(results([page(10, ['price'], noRating), page(11, ['price'], multi), page(12, ['price'], multi)]), ['price']);
    expect(r[0].representative).toBe('https://s.example/p/11');
  });
});

describe('stageLine (spec §5)', () => {
  const twenty = results(Array.from({ length: 20 }, (_, i) => page(10 + i, [])));
  it('running', () => expect(stageLine('running', twenty, 0, null)).toBe('Checking 20 more products from the listing…'));
  it('running with planned, before any page is sampled', () => {
    const planned: CoverageResults = { listingUrl: 'x', sampled: [], proofShapes: {}, planned: 20 };
    expect(stageLine('running', planned, 0, null)).toBe('Checking 20 more products from the listing…');
  });
  it('clean', () => expect(stageLine('done', twenty, 0, null)).toBe('Checked 20 more products from the listing: every field was found on all of them.'));
  it('clean with unread', () => {
    const r = results([...twenty.sampled.slice(0, 17), ...[1, 2, 3].map((i) => ({ url: `https://s.example/u/${i}`, unread: 'wall' }))]);
    expect(stageLine('done', r, 0, null)).toBe('Checked 20 more products from the listing: every field was found on all of them. (3 could not be read)');
  });
  it('empties', () => expect(stageLine('done', twenty, 2, null)).toBe('2 fields were empty on some of the 20 sampled products — see the rows.'));
  it('one field, one product', () => expect(stageLine('done', results([page(10, ['price'])]), 1, null)).toBe('1 field was empty on some of the 1 sampled product — see the row.'));
  it('failed reads the error', () => expect(stageLine('failed', null, 0, 'shop.example refused the browser (HTTP 403).')).toBe('shop.example refused the browser (HTTP 403).'));
  it('nothing sampled says nothing', () => expect(stageLine('done', results([]), 0, null)).toBeNull());
});
