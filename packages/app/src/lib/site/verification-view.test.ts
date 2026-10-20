import { describe, expect, it, test } from 'vitest';
import {
  hintFor,
  cellStatusFor,
  verificationState,
  cellHint,
  blockedReasons,
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

  test('no_fitting_path names the field and asks for a mark', () => {
    expect(hintFor('no_fitting_path', undefined, 'yes/no', 'In stock')).toBe(
      "We can't tell which value on this page is In stock — mark it on the screenshot.",
    );
    expect(hintFor('no_fitting_path')).toBe(
      "We can't tell which value on this page is this field — mark it on the screenshot.",
    );
  });

  test('found_unexpected is a sentence and a question (spec 2026-10-20 §3.5.4)', () => {
    expect(hintFor('found_unexpected', '0', undefined, undefined, 4)).toBe("Found 0 on product 4, but you said it isn't there. Is it there after all?");
    expect(hintFor('found_unexpected', undefined, undefined, undefined, 4)).toBe("Found a value on product 4, but you said it isn't there. Is it there after all?");
  });

  test('elsewhere names the field and the way out (spec 2026-10-20 §3.4)', () => {
    expect(hintFor('elsewhere', undefined, 'text', 'Description', 4)).toBe('Found on this product, but not where your other products show it. If this product really has no Description of its own, choose "Not on this product".');
  });

  test('a fail cell passes the field name to the no_fitting_path hint', () => {
    const results: VerificationResults = {
      stock: { key: 'stock', cells: { 'https://x/1': { status: 'fail', reason: 'no_fitting_path' } }, certified: [], weakEvidence: false, aiCalled: false, incomplete: false },
    };
    expect(cellStatusFor(results, 'stock', 'https://x/1', false, 'boolean', 'In stock')?.hint).toBe(
      "We can't tell which value on this page is In stock — mark it on the screenshot.",
    );
  });

  test('type_mismatch substitutes found and the field type', () => {
    expect(hintFor('type_mismatch', 'banana', 'a number')).toBe(
      'Found banana, which is not a valid a number.',
    );
  });

  it('the ambiguous hint says what happened and what to do (spec 2026-10-17 §5)', () => {
    expect(hintFor('ambiguous')).toBe('Found on this product, but not in the same place as on the others. Mark it on the screenshot.');
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

describe('cellHint (spec 2026-10-20 §3.3, §3.5.1, §3.5.2)', () => {
  const U1 = 'https://x/1', U2 = 'https://x/2';
  const results: VerificationResults = {
    desc: { key: 'desc', cells: { [U1]: { status: 'pass', found: 'a' }, [U2]: { status: 'fail', reason: 'elsewhere' } }, certified: [], weakEvidence: false, aiCalled: false, incomplete: false },
    sku: { key: 'sku', cells: { [U1]: { status: 'fail', reason: 'not_found' } }, certified: [], weakEvidence: false, aiCalled: true, incomplete: false, failReason: 'ai_unavailable' },
    price: { key: 'price', cells: { [U1]: { status: 'pass', found: '1' }, [U2]: { status: 'not_captured' } }, certified: [], weakEvidence: false, aiCalled: false, incomplete: true },
  };
  const base = { results, unchanged: true, fieldType: 'text', product: 2 };
  it("a fail cell's hint", () => {
    expect(cellHint({ ...base, key: 'desc', url: U2, fieldName: 'Description' })).toBe(hintFor('elsewhere', undefined, 'text', 'Description', 2));
  });
  it('an ai_unavailable field says so on any of its cells', () => {
    expect(cellHint({ ...base, key: 'sku', url: U1, fieldName: 'SKU', product: 1 })).toBe("We couldn't finish checking SKU this time. Verify again — nothing else changed.");
  });
  it('a page the run could not capture says why', () => {
    expect(cellHint({ ...base, key: 'price', url: U2, fieldName: 'Price', blockedReason: 'x.example did not answer in time.' })).toBe('Not checked on product 2 — x.example did not answer in time.');
  });
  it('nothing for a pass, a changed field, or no result', () => {
    expect(cellHint({ ...base, key: 'desc', url: U1, fieldName: 'Description', product: 1 })).toBeUndefined();
    expect(cellHint({ ...base, key: 'desc', url: U2, fieldName: 'Description', unchanged: false })).toBeUndefined();
    expect(cellHint({ ...base, results: null, key: 'desc', url: U2, fieldName: 'Description' })).toBeUndefined();
  });
});

describe('blockedReasons', () => {
  it('reads the reason of each page the run could not capture, and nothing else', () => {
    expect(blockedReasons({
      'https://x/1': { captureId: 'c1', capturedAt: 't' },
      'https://x/2': { captureId: '', capturedAt: 't', blockedReason: 'x.example did not answer in time.' },
      _stage: 'searching',
    })).toEqual({ 'https://x/2': 'x.example did not answer in time.' });
    expect(blockedReasons(null)).toEqual({});
  });
});
