import { describe, it, expect } from 'vitest';
import { normalize, valuesEqual, validateExpected, renderValue } from './normalize.js';

describe('normalize', () => {
  it('text: trims, collapses whitespace, NFKC; keeps case (comparison folds it)', () => {
    expect(normalize('text', '  Samsung  T7  2TB ')).toBe('Samsung T7 2TB');
    expect(normalize('text', 'ﬁle')).toBe('file');
    expect(valuesEqual('text', 'SAMSUNG t7', 'Samsung T7')).toBe(true);
  });
  it('number: parses both decimal separators and thousands separators', () => {
    expect(normalize('number', '1,299.50')).toBe('1299.5');
    expect(normalize('number', '1.299,50')).toBe('1299.5');
    expect(normalize('number', 1299.5)).toBe('1299.5');
    expect(normalize('number', 'twelve')).toBeNull();
  });
  it('money: strips currency symbols and codes, two decimals', () => {
    expect(normalize('money', '$129.99')).toBe('129.99');
    expect(normalize('money', 'EUR 129,99')).toBe('129.99');
    expect(normalize('money', '129.994')).toBe('129.99');
    expect(normalize('money', 'call for price')).toBeNull();
  });
  it('money vs number: single dot with exactly 3 trailing digits', () => {
    expect(normalize('money', '1.299')).toBe('1299.00');
    expect(normalize('money', '1.299 €')).toBe('1299.00');
    expect(normalize('number', '1.299')).toBe('1.299');
    expect(normalize('money', '1.299,00')).toBe('1299.00');
    expect(normalize('money', '129.99')).toBe('129.99');
    expect(normalize('money', '129.999')).toBe('129999.00');
    expect(normalize('money', '1299.999')).toBe('1299999.00');
  });
  it('boolean: synonym sets', () => {
    expect(normalize('boolean', 'In Stock')).toBe('true');
    expect(normalize('boolean', 'https://schema.org/InStock')).toBe('true');
    expect(normalize('boolean', 'Out of stock')).toBe('false');
    expect(normalize('boolean', true)).toBe('true');
    expect(normalize('boolean', 'maybe')).toBeNull();
  });
  it('date: calendar day', () => {
    expect(normalize('date', '2026-09-04T13:00:00Z')).toBe('2026-09-04');
    expect(normalize('date', 'September 4, 2026')).toBe('2026-09-04');
    expect(normalize('date', 'not a date')).toBeNull();
  });
  it('date: Date instance normalizes with local components', () => {
    expect(normalize('date', new Date(2026, 8, 4))).toBe('2026-09-04');
  });
  it('url/image: resolves against the page and drops the fragment', () => {
    expect(normalize('url', '/p/1#top', { pageUrl: 'https://shop.example/x' })).toBe('https://shop.example/p/1');
    expect(normalize('image', 'HTTPS://CDN.Example/a.jpg')).toBe('https://cdn.example/a.jpg');
  });
  it('text_list: splits on newline, comma, semicolon; set semantics', () => {
    expect(normalize('text_list', 'Red, Blue;Green')).toBe(normalize('text_list', ['green', 'red', 'blue']));
  });
});

describe('valuesEqual', () => {
  it('money within a cent', () => expect(valuesEqual('money', '129.99', 129.994)).toBe(true));
  it('null on either side is never equal', () => expect(valuesEqual('number', 'x', 'x')).toBe(false));
});

describe('validateExpected', () => {
  it('rejects a blank cell for every type', () => {
    expect(validateExpected('text', '   ')).toMatch(/required/i);
  });
  it('rejects a non-money in a money cell', () => {
    expect(validateExpected('money', 'call for price')).toMatch(/money/i);
    expect(validateExpected('money', '$1,299.00')).toBeNull();
  });
  it('accepts any non-blank text', () => expect(validateExpected('text', 'x')).toBeNull());
});

describe('renderValue', () => {
  it('numbers, booleans, lists become typed values', () => {
    expect(renderValue('money', '129.99')).toBe(129.99);
    expect(renderValue('boolean', 'true')).toBe(true);
    expect(renderValue('text_list', ['a', 'b'].join(String.fromCharCode(31)))).toEqual(['a', 'b']);
    expect(renderValue('text', 'hello')).toBe('hello');
  });
});
