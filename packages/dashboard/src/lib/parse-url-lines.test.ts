import { describe, expect, test } from 'vitest';
import { parseUrlLines } from './parse-url-lines';

describe('parseUrlLines', () => {
  test('parses each non-empty line as a URL', () => {
    const text = 'https://example.com/a\nhttps://example.com/b';
    expect(parseUrlLines(text)).toEqual({
      urls: ['https://example.com/a', 'https://example.com/b'],
      invalid: [],
    });
  });

  test('skips blank lines, including whitespace-only lines', () => {
    const text = 'https://example.com/a\n\n   \nhttps://example.com/b\n';
    expect(parseUrlLines(text)).toEqual({
      urls: ['https://example.com/a', 'https://example.com/b'],
      invalid: [],
    });
  });

  test('trims surrounding whitespace on each line before validating', () => {
    const text = '  https://example.com/a  \n\thttps://example.com/b\t';
    expect(parseUrlLines(text)).toEqual({
      urls: ['https://example.com/a', 'https://example.com/b'],
      invalid: [],
    });
  });

  test('reports lines that are not valid URLs, trimmed', () => {
    const text = 'https://example.com/a\nnot-a-url\n  also bad  ';
    expect(parseUrlLines(text)).toEqual({
      urls: ['https://example.com/a'],
      invalid: ['not-a-url', 'also bad'],
    });
  });

  test('returns empty arrays for empty or all-blank input', () => {
    expect(parseUrlLines('')).toEqual({ urls: [], invalid: [] });
    expect(parseUrlLines('   \n\n\t  ')).toEqual({ urls: [], invalid: [] });
  });

  test('preserves input order across a mix of valid and invalid lines', () => {
    const text = 'bad-one\nhttps://example.com/a\nbad-two\nhttps://example.com/b';
    expect(parseUrlLines(text)).toEqual({
      urls: ['https://example.com/a', 'https://example.com/b'],
      invalid: ['bad-one', 'bad-two'],
    });
  });
});
