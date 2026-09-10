import { describe, expect, test } from 'vitest';
import {
  hintFor,
  cellStatusFor,
  verificationState,
  isRowStale,
  reverifyKeys,
  type VerificationResults,
} from './verification-view';
import { emptyRow, type GridState } from './schema-grid';

describe('hintFor', () => {
  test('not_found', () => {
    expect(hintFor('not_found')).toBe(
      'Not found on this page. Check the value, or say where it is.',
    );
  });

  test('different_value substitutes the found value, no asterisks', () => {
    expect(hintFor('different_value', '$42.00')).toBe(
      'This page shows $42.00. Is your value right, or does the page show it differently?',
    );
  });

  test('ambiguous', () => {
    expect(hintFor('ambiguous')).toBe(
      'Several places match. Add what makes yours different to the description.',
    );
  });

  test('type_mismatch substitutes found and the field type', () => {
    expect(hintFor('type_mismatch', 'banana', 'a number')).toBe(
      'Found banana, which is not a valid a number.',
    );
  });
});

describe('cellStatusFor', () => {
  const results: VerificationResults = {
    price: {
      key: 'price',
      cells: { 'https://x/1': { status: 'pass', found: '$10' } },
      certified: [{}],
      weakEvidence: false,
      aiCalled: false,
      incomplete: false,
    },
  };

  test('stale wins over a pass in the underlying result', () => {
    expect(cellStatusFor(results, 'price', 'https://x/1', true)).toEqual({ status: 'stale' });
  });

  test('pass cell, not stale', () => {
    expect(cellStatusFor(results, 'price', 'https://x/1', false)).toEqual({ status: 'pass', found: '$10', weak: undefined });
  });

  test('missing field/url returns null', () => {
    expect(cellStatusFor(results, 'missing', 'https://x/1', false)).toBeNull();
    expect(cellStatusFor(results, 'price', 'https://x/nope', false)).toBeNull();
  });

  test('fail cell carries the spec hint, substituting found + type', () => {
    const failResults: VerificationResults = {
      qty: {
        key: 'qty',
        cells: { 'https://x/1': { status: 'fail', reason: 'type_mismatch', found: 'banana' } },
        certified: [],
        weakEvidence: false,
        aiCalled: false,
        incomplete: false,
      },
    };
    expect(cellStatusFor(failResults, 'qty', 'https://x/1', false, 'a number')).toEqual({
      status: 'fail',
      found: 'banana',
      reason: 'type_mismatch',
      hint: 'Found banana, which is not a valid a number.',
      weak: undefined,
    });
  });

  // M7: a green cell should be able to say where the value came from.
  test('pass cell carries the certified path source, xpath rendered as "page"', () => {
    const withPath = (source: 'api' | 'json-ld' | 'meta' | 'xpath'): VerificationResults => ({
      price: {
        key: 'price',
        cells: { 'https://x/1': { status: 'pass', found: '$10', path: { source, path: 'p', transform: 'identity' } } },
        certified: [{}],
        weakEvidence: false,
        aiCalled: false,
        incomplete: false,
      },
    });
    expect(cellStatusFor(withPath('api'), 'price', 'https://x/1', false)?.pathSource).toBe('api');
    expect(cellStatusFor(withPath('json-ld'), 'price', 'https://x/1', false)?.pathSource).toBe('json-ld');
    expect(cellStatusFor(withPath('meta'), 'price', 'https://x/1', false)?.pathSource).toBe('meta');
    expect(cellStatusFor(withPath('xpath'), 'price', 'https://x/1', false)?.pathSource).toBe('page');
    // A stored result predating the per-cell path leaves it undefined, not a guess.
    expect(cellStatusFor(results, 'price', 'https://x/1', false)?.pathSource).toBeUndefined();
  });

  test('not_captured cell', () => {
    const ncResults: VerificationResults = {
      qty: { key: 'qty', cells: { 'https://x/1': { status: 'not_captured' } }, certified: [], weakEvidence: false, aiCalled: false, incomplete: true },
    };
    expect(cellStatusFor(ncResults, 'qty', 'https://x/1', false)).toEqual({ status: 'not_captured', weak: undefined });
  });
});

describe('verificationState', () => {
  const NOW = Date.parse('2026-09-04T01:00:00Z');
  const STALL = 15 * 60 * 1000;

  test('none: no row at all', () => {
    expect(verificationState(null, { now: NOW, stallMs: STALL })).toBe('none');
    expect(verificationState(undefined, { now: NOW, stallMs: STALL })).toBe('none');
  });

  test('active: in flight, younger than stallMs', () => {
    const row = { startedAt: '2026-09-04T00:55:00Z', completedAt: null };
    expect(verificationState(row, { now: NOW, stallMs: STALL })).toBe('active');
  });

  test('stalled: in flight, older than stallMs', () => {
    const row = { startedAt: '2026-09-04T00:30:00Z', completedAt: null };
    expect(verificationState(row, { now: NOW, stallMs: STALL })).toBe('stalled');
  });

  test('failed: completed with an errorMessage', () => {
    const row = { startedAt: '2026-09-04T00:55:00Z', completedAt: '2026-09-04T00:56:00Z', errorMessage: 'boom' };
    expect(verificationState(row, { now: NOW, stallMs: STALL })).toBe('failed');
  });

  test('done: completed cleanly', () => {
    const row = { startedAt: '2026-09-04T00:55:00Z', completedAt: '2026-09-04T00:56:00Z', errorMessage: null };
    expect(verificationState(row, { now: NOW, stallMs: STALL })).toBe('done');
    // A completed row is done however old it is — the stall window is only
    // ever asked about rows that never completed.
    expect(verificationState({ startedAt: '2020-01-01T00:00:00Z', completedAt: '2020-01-01T00:01:00Z' }, { now: NOW, stallMs: STALL })).toBe('done');
  });

  test('an undateable in-flight row stays active rather than reading as stalled', () => {
    expect(verificationState({ completedAt: null }, { now: NOW, stallMs: STALL })).toBe('active');
    expect(verificationState({ startedAt: 'not a date', completedAt: null }, { now: NOW, stallMs: STALL })).toBe('active');
  });
});

describe('isRowStale', () => {
  function state(): GridState {
    const row = { ...emptyRow(), key: 'price', name: 'Price', type: 'money' as const, description: 'the price', expected: ['$10', '$20', '$30'] };
    return { urls: ['a', 'b', 'c'], listingUrl: '', rows: [row] };
  }

  test('no saved grid: never stale', () => {
    const row = state().rows[0]!;
    expect(isRowStale(row, null)).toBe(false);
  });

  test('unchanged row: not stale', () => {
    const saved = state();
    const row = { ...saved.rows[0]! };
    expect(isRowStale(row, saved)).toBe(false);
  });

  test('changed description: stale', () => {
    const saved = state();
    const row = { ...saved.rows[0]!, description: 'a different description' };
    expect(isRowStale(row, saved)).toBe(true);
  });

  test('changed one expected value: stale', () => {
    const saved = state();
    const row = { ...saved.rows[0]!, expected: ['$99', '$20', '$30'] };
    expect(isRowStale(row, saved)).toBe(true);
  });

  test('brand-new row with no matching key: not stale', () => {
    const saved = state();
    const row = { ...emptyRow(), name: 'New field' };
    expect(isRowStale(row, saved)).toBe(false);
  });
});

describe('reverifyKeys', () => {
  function row(key: string, overrides: Partial<ReturnType<typeof emptyRow>> = {}) {
    return { ...emptyRow(), key, name: key, type: 'text' as const, description: `the ${key}`, expected: ['a', 'b', 'c'], ...overrides };
  }

  function grid(rows: ReturnType<typeof row>[]): GridState {
    return { urls: ['u1', 'u2', 'u3'], listingUrl: '', rows };
  }

  test('no previous results (null): undefined', () => {
    const g = grid([row('price')]);
    expect(reverifyKeys(null, g, g)).toBeUndefined();
    expect(reverifyKeys(undefined, g, g)).toBeUndefined();
  });

  test('previous results is an empty object (stalled/failed run): undefined', () => {
    const g = grid([row('price')]);
    expect(reverifyKeys({}, g, g)).toBeUndefined();
  });

  test('results present: only unpassed-or-stale rows, nothing else', () => {
    const saved = grid([row('price'), row('qty'), row('desc')]);
    const current = grid([row('price'), row('qty'), row('desc', { description: 'edited after verifying' })]);
    const results: VerificationResults = {
      price: { key: 'price', cells: {}, certified: [{}], weakEvidence: false, aiCalled: false, incomplete: false },
      qty: { key: 'qty', cells: {}, certified: [], weakEvidence: false, aiCalled: false, incomplete: false },
      desc: { key: 'desc', cells: {}, certified: [{}], weakEvidence: false, aiCalled: false, incomplete: false },
    };
    expect(reverifyKeys(results, current, saved)).toEqual(['qty', 'desc']);
  });

  // The critical C1 follow-up: a URL edit touches no ROW, so the per-row
  // staleness check sees nothing and used to hand back `[]` — which the
  // server reads as "copy every previous field result", storing cells keyed
  // by the OLD urls under the NEW definitionHash and unlocking Extract
  // against pages nobody verified.
  test('a changed product URL forces a full re-verify (undefined), not []', () => {
    const saved = grid([row('price')]);
    const current: GridState = { ...grid([row('price')]), urls: ['u1', 'u2', 'u3-EDITED'] };
    const results: VerificationResults = {
      price: { key: 'price', cells: {}, certified: [{}], weakEvidence: false, aiCalled: false, incomplete: false },
    };
    // Everything green and no row edited: without the URL check this is `[]`.
    expect(reverifyKeys(results, grid([row('price')]), saved)).toEqual([]);
    expect(reverifyKeys(results, current, saved)).toBeUndefined();
  });

  test('a changed listing URL, or swapped URL order, forces a full re-verify', () => {
    const saved = grid([row('price')]);
    const results: VerificationResults = {
      price: { key: 'price', cells: {}, certified: [{}], weakEvidence: false, aiCalled: false, incomplete: false },
    };
    const listingChanged: GridState = { ...grid([row('price')]), listingUrl: 'https://shop.example/c' };
    expect(reverifyKeys(results, listingChanged, saved)).toBeUndefined();
    const swapped: GridState = { ...grid([row('price')]), urls: ['u2', 'u1', 'u3'] };
    expect(reverifyKeys(results, swapped, saved)).toBeUndefined();
  });

  test('URLs differing only by surrounding whitespace are not a change', () => {
    const saved = grid([row('price')]);
    const padded: GridState = { ...grid([row('price')]), urls: [' u1', 'u2 ', ' u3 '] };
    const results: VerificationResults = {
      price: { key: 'price', cells: {}, certified: [{}], weakEvidence: false, aiCalled: false, incomplete: false },
      qty: { key: 'qty', cells: {}, certified: [], weakEvidence: false, aiCalled: false, incomplete: false },
    };
    // Unchanged URLs: the per-row scoping still applies — here, the one stale row only.
    const stale = { ...padded, rows: [row('price', { description: 'edited after verifying' })] };
    expect(reverifyKeys(results, stale, saved)).toEqual(['price']);
  });

  test('all rows green and unchanged: empty array', () => {
    const saved = grid([row('price'), row('qty')]);
    const current = grid([row('price'), row('qty')]);
    const results: VerificationResults = {
      price: { key: 'price', cells: {}, certified: [{}], weakEvidence: false, aiCalled: false, incomplete: false },
      qty: { key: 'qty', cells: {}, certified: [{}], weakEvidence: false, aiCalled: false, incomplete: false },
    };
    expect(reverifyKeys(results, current, saved)).toEqual([]);
  });
});
