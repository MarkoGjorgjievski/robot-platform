import { describe, it, expect } from 'vitest';
import { stripState, columnStates, stripSummary, cellLine, verifyButton, typeFixSuggestion } from './schema-tab-view';

describe('stripState', () => {
  it('maps verification state and results', () => {
    expect(stripState({ verification: 'none', results: null, dirty: false })).toBe('editing');
    expect(stripState({ verification: 'active', results: null, dirty: false })).toBe('active');
    expect(stripState({ verification: 'stalled', results: null, dirty: false })).toBe('stalled');
    expect(stripState({ verification: 'failed', results: null, dirty: false })).toBe('failed');
    expect(stripState({ verification: 'done', results: {}, dirty: false })).toBe('editing');
    expect(stripState({ verification: 'done', results: { price: fv(true) }, dirty: true })).toBe('results');
  });
});

describe('columnStates', () => {
  const urls = ['https://s.example/1', 'https://s.example/2', 'https://s.example/3'];
  it('is idle before any run', () => expect(columnStates({ urls, state: 'editing', stage: null, captures: {} })).toEqual(['idle', 'idle', 'idle']));
  it('follows the capture stage while active', () => {
    expect(columnStates({ urls, state: 'active', stage: 'capturing 2/3', captures: {} })).toEqual(['captured', 'capturing', 'queued']);
    expect(columnStates({ urls, state: 'active', stage: 'searching', captures: {} })).toEqual(['captured', 'captured', 'captured']);
  });
  it('reads the captures map after a run', () => {
    expect(columnStates({ urls, state: 'results', stage: null, captures: { [urls[0]!]: { captureId: 'a' }, [urls[1]!]: { captureId: '', blockedReason: 'blocked' } } })).toEqual(['captured', 'not_captured', 'idle']);
  });
});

describe('stripSummary', () => {
  it('editing counts fields and pages', () => expect(stripSummary({ state: 'editing', fieldCount: 5, pageCount: 3, currentKeys: [], failingKeys: [], staleKeys: [] })).toBe('Not verified yet · 5 fields · 3 pages'));
  it('results counts verified, attention and changed', () => {
    expect(stripSummary({ state: 'results', fieldCount: 5, pageCount: 3, currentKeys: ['a', 'b', 'c', 'd'], failingKeys: ['e'], staleKeys: [] })).toBe('4 of 5 fields verified · 1 needs attention');
    expect(stripSummary({ state: 'results', fieldCount: 5, pageCount: 3, currentKeys: ['a', 'b', 'c'], failingKeys: ['d'], staleKeys: ['e'] })).toBe('3 of 5 fields verified · 1 needs attention · 1 changed since');
    expect(stripSummary({ state: 'results', fieldCount: 2, pageCount: 3, currentKeys: ['a', 'b'], failingKeys: [], staleKeys: [] })).toBe('2 of 2 fields verified');
    expect(stripSummary({ state: 'results', fieldCount: 1, pageCount: 3, currentKeys: ['a'], failingKeys: [], staleKeys: [] })).toBe('1 of 1 field verified');
  });
  it('other states', () => {
    expect(stripSummary({ state: 'active', fieldCount: 1, pageCount: 3, currentKeys: [], failingKeys: [], staleKeys: [] })).toBe('Verifying');
    expect(stripSummary({ state: 'stalled', fieldCount: 1, pageCount: 3, currentKeys: [], failingKeys: [], staleKeys: [] })).toBe('This verification stalled. Run it again.');
    expect(stripSummary({ state: 'failed', fieldCount: 1, pageCount: 3, currentKeys: [], failingKeys: [], staleKeys: [] })).toBe('The last verification failed');
  });
});

describe('cellLine', () => {
  it('green says where it came from, and what the page shows when it differs', () => {
    expect(cellLine({ status: 'pass', found: '1,000', pathSource: 'json-ld' }, '1,000')).toEqual({ tone: 'pass', text: 'from json-ld' });
    expect(cellLine({ status: 'pass', found: 'US$ 1,000', pathSource: 'page' }, '1,000')).toEqual({ tone: 'pass', text: 'page shows US$ 1,000' });
    expect(cellLine({ status: 'pass', found: '1,000' }, '1,000')).toEqual({ tone: 'pass', text: 'verified' });
  });
  it('red carries the hint, grey and amber their fixed copy, none is blank', () => {
    expect(cellLine({ status: 'fail', reason: 'ambiguous', hint: 'Several places match. Add what makes yours different to the description.' }, 'x')).toEqual({ tone: 'fail', text: 'Several places match. Add what makes yours different to the description.' });
    expect(cellLine({ status: 'stale' }, 'x')).toEqual({ tone: 'stale', text: 'changed since verified' });
    expect(cellLine({ status: 'not_captured' }, 'x')).toEqual({ tone: 'not_captured', text: 'page not captured' });
    expect(cellLine(null, 'x')).toEqual({ tone: 'none', text: '' });
  });
});

describe('verifyButton', () => {
  const base = { state: 'editing' as const, firstRun: true, reverifyCount: 0, capturesFresh: false, aiAvailable: true, upperBoundUsd: 0.25, complete: true, busy: false };
  it('first run shows the upper bound or mechanical only', () => {
    expect(verifyButton(base)).toEqual({ label: 'Verify · up to $0.25', disabled: false });
    expect(verifyButton({ ...base, aiAvailable: false })).toEqual({ label: 'Verify · mechanical only', disabled: false });
  });
  it('re-verify is free with fresh captures and no AI need, else priced', () => {
    expect(verifyButton({ ...base, state: 'results', firstRun: false, reverifyCount: 2, capturesFresh: true, upperBoundUsd: 0 })).toEqual({ label: 'Re-verify 2 fields · free', disabled: false });
    expect(verifyButton({ ...base, state: 'results', firstRun: false, reverifyCount: 1, capturesFresh: true, upperBoundUsd: 0.05 })).toEqual({ label: 'Re-verify 1 field · up to $0.05', disabled: false });
    expect(verifyButton({ ...base, state: 'results', firstRun: false, reverifyCount: 0, capturesFresh: true, upperBoundUsd: 0 })).toEqual({ label: 'Everything is verified', disabled: true, reason: 'Nothing has changed since the last verification' });
  });
  it('is off while active or busy or incomplete, with a reason', () => {
    expect(verifyButton({ ...base, state: 'active' })).toMatchObject({ disabled: true, reason: 'Verifying' });
    expect(verifyButton({ ...base, busy: true })).toMatchObject({ disabled: true });
    expect(verifyButton({ ...base, complete: false })).toMatchObject({ disabled: true, reason: 'Fill in every page and every cell first' });
  });
});

describe('typeFixSuggestion', () => {
  it('suggests url for a not_found text field whose values are links', () => {
    const cells = [{ status: 'fail' as const, reason: 'not_found' }, { status: 'fail' as const, reason: 'not_found' }, null];
    expect(typeFixSuggestion({ type: 'text', expected: ['https://a.example/x', 'https://a.example/y', 'https://a.example/z'] }, cells)).toBe('url');
    expect(typeFixSuggestion({ type: 'url', expected: ['https://a.example/x', 'https://a.example/y', 'https://a.example/z'] }, cells)).toBeNull();
    expect(typeFixSuggestion({ type: 'text', expected: ['South Col', 'x', 'y'] }, cells)).toBeNull();
    expect(typeFixSuggestion({ type: 'text', expected: ['https://a.example/x', 'https://a.example/y', 'https://a.example/z'] }, [{ status: 'pass' as const, found: 'x' }, null, null])).toBeNull();
  });
});

function fv(passed: boolean) {
  return { key: 'k', cells: {}, certified: passed ? [{}] : [], weakEvidence: false, aiCalled: false, incomplete: false };
}
