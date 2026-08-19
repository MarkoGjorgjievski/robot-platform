import { describe, it, expect } from 'vitest';
import { toCsv, toJson } from './serialize.js';

describe('toCsv', () => {
  it('writes a header row followed by one row per record', () => {
    const csv = toCsv(['title', 'price'], [
      { title: 'Kallax', price: 79 },
      { title: 'Billy', price: 49 },
    ]);
    expect(csv).toBe('﻿title,price\r\nKallax,79\r\nBilly,49\r\n');
  });

  it('writes only the header row when there are no records', () => {
    expect(toCsv(['title', 'price'], [])).toBe('﻿title,price\r\n');
  });

  it('quotes values containing a comma', () => {
    const csv = toCsv(['title'], [{ title: 'Kallax, white' }]);
    expect(csv).toBe('﻿title\r\n"Kallax, white"\r\n');
  });

  it('doubles embedded quotes and wraps the value', () => {
    const csv = toCsv(['title'], [{ title: 'The 13" shelf' }]);
    expect(csv).toBe('﻿title\r\n"The 13"" shelf"\r\n');
  });

  it('quotes values containing a newline', () => {
    const csv = toCsv(['description'], [{ description: 'line one\nline two' }]);
    expect(csv).toBe('﻿description\r\n"line one\nline two"\r\n');
  });

  it('quotes a column name that needs escaping', () => {
    const csv = toCsv(['price, usd'], [{ 'price, usd': 79 }]);
    expect(csv).toBe('﻿"price, usd"\r\n79\r\n');
  });

  it('writes an empty cell for null and for a missing key', () => {
    const csv = toCsv(['title', 'price'], [{ title: null }]);
    expect(csv).toBe('﻿title,price\r\n,\r\n');
  });

  it('writes booleans as true and false', () => {
    const csv = toCsv(['in_stock'], [{ in_stock: false }]);
    expect(csv).toBe('﻿in_stock\r\nfalse\r\n');
  });

  it('writes an array value as JSON in a single cell', () => {
    const csv = toCsv(['variants'], [{ variants: ['red', 'blue'] }]);
    expect(csv).toBe('﻿variants\r\n"[""red"",""blue""]"\r\n');
  });

  it('writes an object value as JSON in a single cell', () => {
    const csv = toCsv(['star_distribution'], [{ star_distribution: { '5': 12 } }]);
    expect(csv).toBe('﻿star_distribution\r\n"{""5"":12}"\r\n');
  });

  it('emits values in column order, ignoring key order in the record', () => {
    const csv = toCsv(['title', 'price'], [{ price: 79, title: 'Kallax' }]);
    expect(csv).toBe('﻿title,price\r\nKallax,79\r\n');
  });

  it('starts with a UTF-8 BOM so Excel reads non-ASCII correctly', () => {
    const csv = toCsv(['price'], [{ price: '£79' }]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('£79');
  });
});

describe('toJson', () => {
  it('serializes the envelope with indentation and preserves nested values', () => {
    const json = toJson({ rows: [{ variants: ['red'] }] });
    expect(json).toBe('{\n  "rows": [\n    {\n      "variants": [\n        "red"\n      ]\n    }\n  ]\n}');
    expect(JSON.parse(json)).toEqual({ rows: [{ variants: ['red'] }] });
  });
});
