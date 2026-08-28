import { describe, it, expect } from 'vitest';
import { parseAddFields } from './add-fields';

// The add-fields textarea parser (Task 11 brief): one field per line, the
// `name: hint` form (FIRST colon splits — a hint may itself contain colons),
// name validation `[a-z0-9_]{1,100}` applied AFTER trim+lowercase+spaces→
// underscores. Blanks are dropped silently; dupes (by normalized name) are
// dropped silently, keeping the first; invalid lines are NEVER silently
// eaten — they land in `rejected` with the original line text. Unlike the
// API-side `normalizeUserFields`, this UI-facing parser documents only the
// colon form — a ` - ` in a line is just part of the hint (if after a colon)
// or part of an invalid name (if not), never a second delimiter.

describe('parseAddFields', () => {
  it('parses a bare name with no hint', () => {
    expect(parseAddFields('isbn')).toEqual({ fields: [{ name: 'isbn' }], rejected: [] });
  });

  it('splits name and hint on the colon', () => {
    expect(parseAddFields('isbn: near the publisher line')).toEqual({
      fields: [{ name: 'isbn', hint: 'near the publisher line' }],
      rejected: [],
    });
  });

  it('splits on the FIRST colon only — a hint may itself contain a colon', () => {
    expect(parseAddFields('isbn: near the publisher line: bottom left')).toEqual({
      fields: [{ name: 'isbn', hint: 'near the publisher line: bottom left' }],
      rejected: [],
    });
  });

  it('trims whitespace around the name and the hint', () => {
    expect(parseAddFields('  isbn  :   near the publisher line  ')).toEqual({
      fields: [{ name: 'isbn', hint: 'near the publisher line' }],
      rejected: [],
    });
  });

  it('lowercases the name and turns spaces into underscores before validating', () => {
    expect(parseAddFields('Product ID: on the box')).toEqual({
      fields: [{ name: 'product_id', hint: 'on the box' }],
      rejected: [],
    });
  });

  it('a " - " in the hint is just part of the hint text, not a second delimiter', () => {
    expect(parseAddFields('isbn: near the publisher - bottom left')).toEqual({
      fields: [{ name: 'isbn', hint: 'near the publisher - bottom left' }],
      rejected: [],
    });
  });

  it('a " - " with no preceding colon makes the whole line an invalid name', () => {
    const result = parseAddFields('isbn - near the publisher line');
    expect(result.fields).toEqual([]);
    expect(result.rejected).toEqual(['isbn - near the publisher line']);
  });

  it('drops blank lines silently', () => {
    expect(parseAddFields('isbn: near the publisher line\n\n   \nauthor')).toEqual({
      fields: [{ name: 'isbn', hint: 'near the publisher line' }, { name: 'author' }],
      rejected: [],
    });
  });

  it('drops an all-blank input to empty results', () => {
    expect(parseAddFields('\n   \n\t\n')).toEqual({ fields: [], rejected: [] });
  });

  it('drops a duplicate name, keeping the first occurrence', () => {
    expect(parseAddFields('isbn: first hint\nisbn: second hint')).toEqual({
      fields: [{ name: 'isbn', hint: 'first hint' }],
      rejected: [],
    });
  });

  it('dedupes by NORMALIZED name — case and spacing differences still collide', () => {
    expect(parseAddFields('ISBN: first hint\nisbn number: second hint\nisbn_number: third hint')).toEqual({
      fields: [{ name: 'isbn', hint: 'first hint' }, { name: 'isbn_number', hint: 'second hint' }],
      rejected: [],
    });
  });

  it('rejects a name with invalid characters, keeping the original line text', () => {
    const result = parseAddFields('product-id: on the box');
    expect(result.fields).toEqual([]);
    expect(result.rejected).toEqual(['product-id: on the box']);
  });

  it('rejects an empty name (a line that is only a colon and a hint)', () => {
    const result = parseAddFields(': near the publisher line');
    expect(result.fields).toEqual([]);
    expect(result.rejected).toEqual([': near the publisher line']);
  });

  it('rejects a name over 100 characters', () => {
    const longName = 'a'.repeat(101);
    const result = parseAddFields(`${longName}: hint`);
    expect(result.fields).toEqual([]);
    expect(result.rejected).toEqual([`${longName}: hint`]);
  });

  it('accepts a name at exactly 100 characters', () => {
    const maxName = 'a'.repeat(100);
    const result = parseAddFields(maxName);
    expect(result.fields).toEqual([{ name: maxName }]);
    expect(result.rejected).toEqual([]);
  });

  it('never silently eats an invalid line — mixes valid, invalid and rejected in one input', () => {
    const input = 'isbn: near the publisher line\nProduct-ID!: bad chars\nauthor';
    expect(parseAddFields(input)).toEqual({
      fields: [{ name: 'isbn', hint: 'near the publisher line' }, { name: 'author' }],
      rejected: ['Product-ID!: bad chars'],
    });
  });

  it('an empty input string produces no fields and no rejections', () => {
    expect(parseAddFields('')).toEqual({ fields: [], rejected: [] });
  });
});
