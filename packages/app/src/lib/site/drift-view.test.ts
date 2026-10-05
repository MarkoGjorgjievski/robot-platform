import { describe, it, expect } from 'vitest';
import { driftBadge, driftBanner, driftRows, acceptMoved, acceptChanged, type DriftCheckView, type DriftCheckResultsLike } from './drift-view';
import { emptyBoard, answer, type Board, type Mark } from './verification-model';

describe('driftBadge', () => {
  it('is null with nothing drifted', () => {
    expect(driftBadge(null)).toBeNull();
    expect(driftBadge([])).toBeNull();
  });

  it('is singular for one field', () => {
    expect(driftBadge(['price'])).toBe('1 field stopped extracting');
  });

  it('counts for more than one', () => {
    expect(driftBadge(['price', 'rating', 'sku'])).toBe('3 fields stopped extracting');
  });
});

const FIELD_NAMES = { price: 'Price', rating: 'Rating', sku: 'SKU' };

describe('driftBanner', () => {
  it('is none with nothing drifted', () => {
    expect(driftBanner({ driftedFields: null, fieldNames: FIELD_NAMES, check: null })).toEqual({ kind: 'none' });
    expect(driftBanner({ driftedFields: [], fieldNames: FIELD_NAMES, check: null })).toEqual({ kind: 'none' });
  });

  it('is none for a stale check once the website was re-verified (Review Focus 3), even with old results', () => {
    const check: DriftCheckView = {
      status: 'done',
      results: { fields: { price: { emptyShare: 0.4 } } },
      runAt: new Date('2026-09-20T00:00:00Z'),
    };
    expect(driftBanner({ driftedFields: null, fieldNames: FIELD_NAMES, check })).toEqual({ kind: 'none' });
  });

  it('is "checking" while a check runs, whatever shares are already on hand', () => {
    const check: DriftCheckView = {
      status: 'running',
      results: null,
      runAt: null,
    };
    expect(driftBanner({ driftedFields: ['price'], fieldNames: FIELD_NAMES, check })).toEqual({
      kind: 'checking',
      text: 'Checking what changed…',
    });
  });

  it('gives the full result text with two fields and their shares', () => {
    const check: DriftCheckView = {
      status: 'done',
      results: { fields: { price: { emptyShare: 0.345 }, rating: { emptyShare: 0.2 } } },
      runAt: new Date('2026-09-26T10:00:00Z'),
    };
    expect(driftBanner({ driftedFields: ['price', 'rating'], fieldNames: FIELD_NAMES, check })).toEqual({
      kind: 'result',
      text: 'Price and Rating stopped extracting in the run of 26 Sep (35 % and 20 % of products empty)',
    });
  });

  it('joins three field names without an Oxford comma', () => {
    const check: DriftCheckView = {
      status: 'done',
      results: { fields: { price: { emptyShare: 0.1 }, rating: { emptyShare: 0.2 }, sku: { emptyShare: 0.3 } } },
      runAt: new Date('2026-09-26T10:00:00Z'),
    };
    expect(driftBanner({ driftedFields: ['price', 'rating', 'sku'], fieldNames: FIELD_NAMES, check })).toEqual({
      kind: 'result',
      text: 'Price, Rating and SKU stopped extracting in the run of 26 Sep (10 %, 20 % and 30 % of products empty)',
    });
  });

  it('drops percentages when a share is missing, but keeps the run date', () => {
    const check: DriftCheckView = {
      status: 'failed',
      results: null,
      runAt: new Date('2026-09-26T10:00:00Z'),
    };
    expect(driftBanner({ driftedFields: ['price', 'rating'], fieldNames: FIELD_NAMES, check })).toEqual({
      kind: 'result',
      text: 'Price and Rating stopped extracting in the run of 26 Sep',
    });
  });

  it('drops the run date too when there is no check at all', () => {
    expect(driftBanner({ driftedFields: ['price', 'rating'], fieldNames: FIELD_NAMES, check: null })).toEqual({
      kind: 'result',
      text: 'Price and Rating stopped extracting',
    });
  });

  it('names an undrifted-by-name field by its key when fieldNames has nothing for it', () => {
    expect(driftBanner({ driftedFields: ['unknown-key'], fieldNames: FIELD_NAMES, check: null })).toEqual({
      kind: 'result',
      text: 'unknown-key stopped extracting',
    });
  });

  it('accepts runAt as an ISO string, not only a Date', () => {
    const check: DriftCheckView = { status: 'done', results: null, runAt: '2026-09-26T10:00:00Z' };
    expect(driftBanner({ driftedFields: ['price'], fieldNames: FIELD_NAMES, check })).toEqual({
      kind: 'result',
      text: 'Price stopped extracting in the run of 26 Sep',
    });
  });
});

const URLS = ['https://shop.example/p/1', 'https://shop.example/p/2', 'https://shop.example/p/3'];
const MARK: Mark = { xpaths: ['//div[1]'], text: '19.99', rect: { x: 0, y: 0, w: 10, h: 10 } };

describe('driftRows', () => {
  it('is empty with no results', () => {
    expect(driftRows({ fieldKeys: ['price'], urls: URLS, results: null, values: {} })).toEqual({});
  });

  it('skips a drifted field with no result yet (not classified)', () => {
    const results: DriftCheckResultsLike = { runId: null, fields: {} };
    expect(driftRows({ fieldKeys: ['price'], urls: URLS, results, values: {} })).toEqual({});
  });

  it('builds a moved row, with a mark per page that has one', () => {
    const results: DriftCheckResultsLike = {
      runId: 'run-1',
      fields: {
        price: {
          result: 'moved',
          pages: {
            [URLS[0]!]: { status: 'ok', value: '19.99', mark: MARK },
            [URLS[1]!]: { status: 'ok', value: '24.99' }, // a structured path: no element to mark
            [URLS[2]!]: { status: 'ok', value: '29.99', mark: MARK },
          },
        },
      },
    };
    const rows = driftRows({ fieldKeys: ['price'], urls: URLS, results, values: {} });
    expect(rows.price).toEqual([
      { kind: 'moved', text: 'Moved on the page — Accept new location', marks: { [URLS[0]!]: MARK, [URLS[2]!]: MARK } },
    ]);
  });

  it('builds a changed row, with the old value per product and no "on product n" suffix for a single product', () => {
    const results: DriftCheckResultsLike = {
      runId: null,
      fields: { price: { result: 'changed', pages: { [URLS[0]!]: { status: 'ok', value: '24.99' } } } },
    };
    const rows = driftRows({ fieldKeys: ['price'], urls: URLS, results, values: { price: { [URLS[0]!]: '19.99' } } });
    expect(rows.price).toEqual([{ kind: 'changed', text: 'Page now shows 24.99 (was 19.99)', values: { [URLS[0]!]: { value: '24.99' } } }]);
  });

  it('joins a changed row across products, each naming its product, when more than one is affected', () => {
    const results: DriftCheckResultsLike = {
      runId: null,
      fields: {
        price: {
          result: 'changed',
          pages: { [URLS[0]!]: { status: 'ok', value: '24.99' }, [URLS[1]!]: { status: 'ok', value: '29.99', mark: MARK } },
        },
      },
    };
    const rows = driftRows({
      fieldKeys: ['price'],
      urls: URLS,
      results,
      values: { price: { [URLS[0]!]: '19.99', [URLS[1]!]: '25.00' } },
    });
    expect(rows.price).toEqual([
      {
        kind: 'changed',
        text: 'Page now shows 24.99 (was 19.99) on product 1; Page now shows 29.99 (was 25.00) on product 2',
        values: { [URLS[0]!]: { value: '24.99' }, [URLS[1]!]: { value: '29.99', mark: MARK } },
      },
    ]);
  });

  it('builds an other-layout row carrying the check\'s runId, for "See missed products"', () => {
    const results: DriftCheckResultsLike = {
      runId: 'run-9',
      fields: { title: { result: 'other-layout', pages: { [URLS[0]!]: { status: 'ok', value: 'Widget' } } } },
    };
    const rows = driftRows({ fieldKeys: ['title'], urls: URLS, results, values: {} });
    expect(rows.title).toEqual([
      { kind: 'other-layout', text: 'The products you verified still work; some others differ — See missed products', runId: 'run-9' },
    ]);
  });

  it('builds a lost row', () => {
    const results: DriftCheckResultsLike = { runId: null, fields: { sku: { result: 'lost', pages: { [URLS[0]!]: { status: 'ok', value: null } } } } };
    const rows = driftRows({ fieldKeys: ['sku'], urls: URLS, results, values: {} });
    expect(rows.sku).toEqual([{ kind: 'lost', text: 'Not found on the page — Mark it again' }]);
  });

  it("puts a page-gone row beside the field's own result row, one entry per gone product", () => {
    const results: DriftCheckResultsLike = {
      runId: null,
      fields: {
        price: {
          result: 'moved',
          pages: {
            [URLS[0]!]: { status: 'ok', value: '19.99', mark: MARK },
            [URLS[1]!]: { status: 'page-gone' },
            [URLS[2]!]: { status: 'page-gone' },
          },
        },
      },
    };
    const rows = driftRows({ fieldKeys: ['price'], urls: URLS, results, values: {} });
    expect(rows.price).toEqual([
      { kind: 'moved', text: 'Moved on the page — Accept new location', marks: { [URLS[0]!]: MARK } },
      {
        kind: 'page-gone',
        texts: [
          { url: URLS[1]!, text: 'Product 2 no longer loads — Replace product 2' },
          { url: URLS[2]!, text: 'Product 3 no longer loads — Replace product 3' },
        ],
      },
    ]);
  });

  it('a field wholly lost on a gone page still gets a lost row plus its page-gone row', () => {
    const results: DriftCheckResultsLike = {
      runId: null,
      fields: { sku: { result: 'lost', pages: { [URLS[0]!]: { status: 'ok', value: null }, [URLS[1]!]: { status: 'page-gone' } } } },
    };
    const rows = driftRows({ fieldKeys: ['sku'], urls: URLS, results, values: {} });
    expect(rows.sku).toEqual([
      { kind: 'lost', text: 'Not found on the page — Mark it again' },
      { kind: 'page-gone', texts: [{ url: URLS[1]!, text: 'Product 2 no longer loads — Replace product 2' }] },
    ]);
  });

  it('keeps fieldKeys order and skips keys results has nothing for', () => {
    const results: DriftCheckResultsLike = {
      runId: null,
      fields: { sku: { result: 'lost', pages: {} }, price: { result: 'lost', pages: {} } },
    };
    const rows = driftRows({ fieldKeys: ['price', 'rating', 'sku'], urls: URLS, results, values: {} });
    expect(Object.keys(rows)).toEqual(['price', 'sku']);
  });
});

describe('acceptMoved', () => {
  function boardWith(key: string, values: Record<string, { value: string; mark: Mark | null }>): Board {
    let b = emptyBoard();
    for (const [url, a] of Object.entries(values)) b = answer(b, key, url, a);
    return b;
  }

  it('replaces the mark and keeps the value', () => {
    const board = boardWith('price', { [URLS[0]!]: { value: '19.99', mark: null } });
    const newMark: Mark = { xpaths: ['//span[2]'], text: '19.99', rect: { x: 1, y: 1, w: 2, h: 2 } };
    const next = acceptMoved(board, 'price', { [URLS[0]!]: newMark });
    expect(next.answers.price![URLS[0]!]).toEqual({ value: '19.99', mark: newMark });
  });

  it('drops a stale structured `via`: the new mark is the evidence now', () => {
    const board = answer(emptyBoard(), 'price', URLS[0]!, { value: '19.99', mark: null, via: { source: 'json-ld', path: 'offers.price' } });
    const newMark: Mark = { xpaths: ['//span[2]'], text: '19.99', rect: { x: 1, y: 1, w: 2, h: 2 } };
    const next = acceptMoved(board, 'price', { [URLS[0]!]: newMark });
    expect(next.answers.price![URLS[0]!]).toEqual({ value: '19.99', mark: newMark });
  });

  it("never touches another field's pending cell", () => {
    let board = boardWith('price', { [URLS[0]!]: { value: '19.99', mark: null } });
    board = answer(board, 'rating', URLS[0]!, { value: '4.5', mark: null });
    const newMark: Mark = { xpaths: ['//span[2]'], text: '19.99', rect: { x: 1, y: 1, w: 2, h: 2 } };
    const next = acceptMoved(board, 'price', { [URLS[0]!]: newMark });
    expect(next.answers.rating).toEqual(board.answers.rating);
  });

  it('skips a url with no prior answer for that field', () => {
    const board = emptyBoard();
    const mark: Mark = { xpaths: ['//span'], text: 'x', rect: { x: 0, y: 0, w: 1, h: 1 } };
    const next = acceptMoved(board, 'price', { [URLS[0]!]: mark });
    expect(next).toEqual(board);
  });
});

describe('acceptChanged', () => {
  it('sets the new value and mark', () => {
    const board = emptyBoard();
    const mark: Mark = { xpaths: ['//span'], text: '24.99', rect: { x: 0, y: 0, w: 1, h: 1 } };
    const next = acceptChanged(board, 'price', { [URLS[0]!]: { value: '24.99', mark } });
    expect(next.answers.price![URLS[0]!]).toEqual({ value: '24.99', mark });
  });

  it('sets a typed value (null mark) when the change came with no mark', () => {
    const board = emptyBoard();
    const next = acceptChanged(board, 'price', { [URLS[0]!]: { value: '24.99' } });
    expect(next.answers.price![URLS[0]!]).toEqual({ value: '24.99', mark: null });
  });

  it('replaces an existing answer for that field and url', () => {
    const board = answer(emptyBoard(), 'price', URLS[0]!, { value: '19.99', mark: MARK });
    const next = acceptChanged(board, 'price', { [URLS[0]!]: { value: '24.99' } });
    expect(next.answers.price![URLS[0]!]).toEqual({ value: '24.99', mark: null });
  });

  it("never touches another field's pending cell", () => {
    let board = emptyBoard();
    board = answer(board, 'rating', URLS[0]!, { value: '4.5', mark: null });
    const next = acceptChanged(board, 'price', { [URLS[0]!]: { value: '24.99' } });
    expect(next.answers.rating).toEqual(board.answers.rating);
  });
});
