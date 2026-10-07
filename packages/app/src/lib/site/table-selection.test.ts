import { describe, expect, test } from 'vitest';
import { clampSelection, fixLabel, headerCount, moveSelection, stateWord } from './table-selection';

const KEYS = ['title', 'price', 'rating'];

describe('moveSelection', () => {
  test('ArrowRight moves one product, ArrowLeft back', () => {
    expect(moveSelection({ product: 0, key: 'price' }, 'ArrowRight', KEYS, 3)).toEqual({ product: 1, key: 'price' });
    expect(moveSelection({ product: 1, key: 'price' }, 'ArrowLeft', KEYS, 3)).toEqual({ product: 0, key: 'price' });
  });
  test('ArrowDown moves one field, ArrowUp back', () => {
    expect(moveSelection({ product: 0, key: 'title' }, 'ArrowDown', KEYS, 3)).toEqual({ product: 0, key: 'price' });
    expect(moveSelection({ product: 0, key: 'price' }, 'ArrowUp', KEYS, 3)).toEqual({ product: 0, key: 'title' });
  });
  test('clamps at the edges, never wraps — Right at the last product stays put even with an add column after it', () => {
    expect(moveSelection({ product: 2, key: 'price' }, 'ArrowRight', KEYS, 3)).toEqual({ product: 2, key: 'price' });
    expect(moveSelection({ product: 0, key: 'price' }, 'ArrowLeft', KEYS, 3)).toEqual({ product: 0, key: 'price' });
    expect(moveSelection({ product: 0, key: 'title' }, 'ArrowUp', KEYS, 3)).toEqual({ product: 0, key: 'title' });
    expect(moveSelection({ product: 0, key: 'rating' }, 'ArrowDown', KEYS, 3)).toEqual({ product: 0, key: 'rating' });
  });
  test('Home and End go to the first and last product on the row', () => {
    expect(moveSelection({ product: 1, key: 'price' }, 'Home', KEYS, 3)).toEqual({ product: 0, key: 'price' });
    expect(moveSelection({ product: 1, key: 'price' }, 'End', KEYS, 3)).toEqual({ product: 2, key: 'price' });
  });
  test('a key not in the field list leaves the selection unchanged', () => {
    expect(moveSelection({ product: 0, key: 'gone' }, 'ArrowDown', KEYS, 3)).toEqual({ product: 0, key: 'gone' });
  });
});

describe('clampSelection', () => {
  test('keeps a selection that still exists', () => {
    expect(clampSelection({ product: 2, key: 'rating' }, KEYS, 3)).toEqual({ product: 2, key: 'rating' });
  });
  test('drops a selection whose field or product is gone, and passes null through', () => {
    expect(clampSelection({ product: 0, key: 'gone' }, KEYS, 3)).toBeNull();
    expect(clampSelection({ product: 3, key: 'title' }, KEYS, 3)).toBeNull();
    expect(clampSelection(null, KEYS, 3)).toBeNull();
  });
});

describe('headerCount', () => {
  const cards = [{ url: 'https://s/1', title: '1' }, { url: 'https://s/2', title: '2' }, { url: '', title: '' }];
  test('null before any verdict, and once the field has changed since', () => {
    expect(headerCount(null, 'price', ['price'], cards)).toBeNull();
    expect(headerCount({}, 'price', ['price'], cards)).toBeNull();
    const r = { price: { cells: { 'https://s/1': { status: 'pass' }, 'https://s/2': { status: 'pass' } } } };
    expect(headerCount(r, 'price', [], cards)).toBeNull();
  });
  test('counts cards with a URL; a fail lowers passed', () => {
    const r = { price: { cells: { 'https://s/1': { status: 'pass' }, 'https://s/2': { status: 'fail' } } } };
    expect(headerCount(r, 'price', ['price'], cards)).toEqual({ passed: 1, checked: 2 });
  });
  test('all pass', () => {
    const r = { price: { cells: { 'https://s/1': { status: 'pass' }, 'https://s/2': { status: 'pass' } } } };
    expect(headerCount(r, 'price', ['price'], cards)).toEqual({ passed: 2, checked: 2 });
  });
});

describe('words', () => {
  test('stateWord', () => {
    expect(stateWord('empty')).toBe('nothing found');
    expect(stateWord('suggested')).toBe('suggested');
    expect(stateWord('answered')).toBe('accepted');
    expect(stateWord('failed')).toBe('fails on this product');
  });
  test('fixLabel reads Mark only on an empty cell', () => {
    expect(fixLabel('empty')).toBe('Mark');
    expect(fixLabel('suggested')).toBe('Fix');
    expect(fixLabel('answered')).toBe('Fix');
    expect(fixLabel('failed')).toBe('Fix');
  });
});
