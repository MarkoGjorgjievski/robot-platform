import { describe, expect, it, test } from 'vitest';
import {
  hintFor,
  cellStatusFor,
  verificationState,
  type VerificationResults,
} from './verification-view';

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

  test('no_fitting_path asks for a mark', () => {
    expect(hintFor('no_fitting_path')).toBe(
      "We can't tell which value on this page is this field. Mark it on the screenshot.",
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

describe('cellStatusFor — which layout proved a cell', () => {
  const A = { source: 'api', path: 'item.priceCents', transform: 'cents_to_units' };
  const B = { source: 'api', path: 'clearance.amount', transform: 'identity' };
  const results = { price: { key: 'price', weakEvidence: false, certified: [{ ...A, provenOn: ['u1', 'u2', 'u3'] }, { ...B, provenOn: ['u4'] }], cells: {
    u1: { status: 'pass', found: '1', path: { ...A, provenOn: ['u1', 'u2', 'u3'] } },
    u4: { status: 'pass', found: '89.5', path: { ...B, provenOn: ['u4'] } },
  } } } as never;
  it('numbers the layout only when the field has more than one', () => {
    expect(cellStatusFor(results, 'price', 'u1', false)).toMatchObject({ status: 'pass', layout: 1 });
    expect(cellStatusFor(results, 'price', 'u4', false)).toMatchObject({ status: 'pass', layout: 2 });
    const one = { price: { key: 'price', weakEvidence: false, certified: [A], cells: { u1: { status: 'pass', found: '1', path: A } } } } as never;
    expect(cellStatusFor(one, 'price', 'u1', false)!.layout).toBeUndefined();
  });
});
