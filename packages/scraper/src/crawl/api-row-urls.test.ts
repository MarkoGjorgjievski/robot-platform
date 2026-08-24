// Mechanism-level coverage for the six guards `api-row-urls.ts` is made of.
//
// The walk-level tests in `plan-run-api-param.test.ts` prove the module is
// WIRED IN. They do not, on their own, prove each guard is load-bearing: a
// refusal test built on bare slugs travels through `isUrlShaped` and stops
// there, leaving the origin check, the prefix check, `commonDirectory`,
// `directoryOf` and `page1Shape`'s protocol check individually deletable with
// the whole crawl suite green. That was the ninth such vacuum found on this
// branch, and it sat inside the fix written to close the eighth.
//
// Each test below is built so that exactly one guard, removed, changes its
// outcome. Two of them assert ACCEPTANCE rather than refusal — `commonDirectory`
// and `directoryOf` can only fail by making the shape too STRICT, and a test
// that only ever asserts refusal cannot see that.

import { describe, it, expect } from 'vitest';
import { page1Shape, rowUrls, type Page1Shape } from './api-row-urls.js';

/** The listing page every raw row value is resolved against. */
const BASE = 'https://listing.example/search';

/** Page 1's own detail URLs on a listing whose products all sit in /p/. */
const P_PAGE1 = [
  'https://listing.example/p/100001',
  'https://listing.example/p/100002',
  'https://listing.example/p/100003',
];

const shapeOf = (urls: string[]) => page1Shape(urls, BASE);

/** One API page's worth of rows at `results[].link`, fed through `rowUrls`. */
const rowsFor = (values: unknown[], shape: Page1Shape | null) =>
  rowUrls({ results: values.map((link) => ({ link })) }, 'results', 'link', BASE, shape);

describe('page1Shape', () => {
  it('demands only as much consistency as page 1 demonstrated', () => {
    // Isolates `commonDirectory`. A listing genuinely spread over /books/,
    // /dvd/ and /music/ has demonstrated nothing about directories, so the
    // prefix must degenerate to '/' and the prefix check must become a no-op.
    // Keeping the first directory, or the last, instead of intersecting them
    // would refuse two thirds of this listing's own catalogue.
    const shape = shapeOf([
      'https://listing.example/books/python-programming',
      'https://listing.example/dvd/blade-runner-1982',
      'https://listing.example/music/kind-of-blue',
    ]);

    expect(shape?.pathPrefix).toBe('/');
  });

  it('takes the DIRECTORY of a page-1 URL, not the URL itself', () => {
    // Isolates `directoryOf`. With a single page-1 URL there is nothing for
    // `commonDirectory` to intersect, so `directoryOf` is the only thing
    // standing between '/p/' and '/p/100001' — and a prefix of '/p/100001'
    // refuses every other product on the site.
    const shape = shapeOf(['https://listing.example/p/100001']);

    expect(shape?.pathPrefix).toBe('/p/');
  });

  it('ignores a page-1 value that is not an http(s) URL', () => {
    // Isolates the protocol check. `new URL('javascript:void(0)', BASE)` does
    // not throw: it parses, its origin is the string 'null', and its pathname
    // 'void(0)' has no '/' at all — so the directory is '' and
    // `commonDirectory` collapses the whole prefix to '/'. One such row poisons
    // the shape in both dimensions at once.
    const shape = shapeOf([...P_PAGE1, 'javascript:void(0)']);

    expect(shape?.pathPrefix).toBe('/p/');
    expect([...(shape?.origins ?? [])]).toEqual(['https://listing.example']);
  });

  it('is null when page 1 demonstrated nothing usable', () => {
    expect(shapeOf([])).toBeNull();
  });
});

describe('rowUrls', () => {
  it('refuses a bare slug even when the prefix check cannot see it', () => {
    // Isolates `isUrlShaped`. Page 1 is heterogeneous, so the prefix is '/' and
    // every same-origin value passes the prefix check. A bare slug resolved
    // against the listing page lands on the RIGHT origin, inside the '/'
    // prefix, and is still a URL nobody ever served — the fabrication §4 exists
    // to refuse.
    const shape = shapeOf([
      'https://listing.example/books/python-programming',
      'https://listing.example/dvd/blade-runner-1982',
      'https://listing.example/music/kind-of-blue',
    ]);
    expect(shape?.pathPrefix).toBe('/');

    expect(rowsFor(['java-in-depth'], shape)).toEqual({ usable: [], refused: 'java-in-depth' });
  });

  it('refuses a URL-shaped, in-prefix value served from another host', () => {
    // Isolates the origin check — the guard no test required at all before
    // this one. `https://cdn.other.example/p/200001` is URL-shaped, and its
    // pathname sits squarely inside page 1's '/p/' prefix. Only the host is
    // wrong, and a CDN or api.<site> host serving detail links is exactly the
    // shape that motivated the check.
    const shape = shapeOf(P_PAGE1);

    expect(rowsFor(['https://cdn.other.example/p/200001'], shape))
      .toEqual({ usable: [], refused: 'https://cdn.other.example/p/200001' });
  });

  it('refuses a same-origin, URL-shaped value outside page 1s directory', () => {
    // Isolates the prefix check. Both values are same-origin and carry real
    // path structure, so `isUrlShaped` and the origin check both wave them
    // through; only the prefix says the API is answering with its own internal
    // paths rather than the site's product URLs.
    const shape = shapeOf(P_PAGE1);

    expect(rowsFor(['/api/internal/v2/product/887766', '/cart/add?sku=887766'], shape))
      .toEqual({ usable: [], refused: '/api/internal/v2/product/887766' });
  });

  it('keeps a value the shape actually admits', () => {
    // The other side of every test above: the guards must not refuse page 2's
    // legitimate rows, or the walk gains nothing and the feature is dead.
    const shape = shapeOf(P_PAGE1);

    expect(rowsFor(['/p/200001', 'https://listing.example/p/200002'], shape))
      .toEqual({ usable: ['/p/200001', 'https://listing.example/p/200002'], refused: null });
  });

  it('refuses everything when page 1 demonstrated no shape', () => {
    expect(rowsFor(['/p/200001'], null)).toEqual({ usable: [], refused: '/p/200001' });
  });

  it('reports the FIRST refused value, and skips rows with no value at all', () => {
    // `refused` names one value in a warning an operator has to act on, so
    // which one it is matters. Rows missing the field entirely are not
    // refusals — they are rows the API did not answer for.
    const shape = shapeOf(P_PAGE1);

    expect(rowsFor([undefined, '', '/cart/add', '/api/internal/x'], shape))
      .toEqual({ usable: [], refused: '/cart/add' });
  });

  it('answers empty when itemsPath holds no array', () => {
    expect(rowUrls({ results: { total: 0 } }, 'results', 'link', BASE, shapeOf(P_PAGE1)))
      .toEqual({ usable: [], refused: null });
  });
});
