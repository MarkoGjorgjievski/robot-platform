import { describe, expect, test } from 'vitest';
import { parseCsv } from './csv';

describe('parseCsv', () => {
  test('handles quoted fields, escaped quotes, and CRLF', () => {
    const text = '"a,b","c""d"\r\n1,2';
    expect(parseCsv(text)).toEqual([
      ['a,b', 'c"d'],
      ['1', '2'],
    ]);
  });

  test('parses plain unquoted rows separated by LF', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  test('drops trailing blank rows', () => {
    expect(parseCsv('a,b\n1,2\n\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  test('handles a mix of CRLF and LF row endings', () => {
    expect(parseCsv('a,b\r\n1,2\n3,4')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  test('a quoted field can itself contain a newline', () => {
    expect(parseCsv('"line1\nline2",b')).toEqual([['line1\nline2', 'b']]);
  });
});
