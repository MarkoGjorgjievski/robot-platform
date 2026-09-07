import { describe, expect, test } from 'vitest';
import {
  URL_COUNT,
  emptyRow,
  emptyState,
  validateExpectedClient,
  parseBlock,
  applyPaste,
  rowsFromTable,
  mergeImportedRows,
  gridProblems,
  isComplete,
  shortUrl,
  toSchemaInput,
  fromSource,
  importProblems,
  type GridState,
} from './schema-grid';

describe('emptyState / emptyRow', () => {
  test('emptyState has 3 empty urls and one empty row', () => {
    const s = emptyState();
    expect(s.urls).toEqual(['', '', '']);
    expect(s.listingUrl).toBe('');
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0]!.expected).toEqual(['', '', '']);
  });

  test('emptyRow ids are unique', () => {
    const a = emptyRow();
    const b = emptyRow();
    expect(a.id).not.toBe(b.id);
  });
});

describe('validateExpectedClient', () => {
  test('requires a value', () => {
    expect(validateExpectedClient('text', '   ')).toMatch(/required/i);
  });
  test('accepts any non-blank text', () => {
    expect(validateExpectedClient('text', 'x')).toBeNull();
  });
  test('rejects a non-money value', () => {
    expect(validateExpectedClient('money', 'call for price')).toMatch(/money/i);
  });
  test('accepts a money value', () => {
    expect(validateExpectedClient('money', '$1,299.00')).toBeNull();
  });
});

describe('parseBlock', () => {
  test('splits tabs into columns and newlines into rows', () => {
    expect(parseBlock('a\tb\tc\n1\t2\t3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  test('trims a single trailing newline', () => {
    expect(parseBlock('a\tb\n')).toEqual([['a', 'b']]);
  });

  test('normalizes CRLF line endings', () => {
    expect(parseBlock('a\tb\r\nc\td')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });
});

describe('applyPaste', () => {
  test('grows rows to fit the pasted block', () => {
    const state = emptyState();
    const block = [
      ['name1', 'text', 'desc1'],
      ['name2', 'number', 'desc2'],
      ['name3', 'money', 'desc3'],
    ];
    const next = applyPaste(state, { row: 0, col: 0 }, block);
    expect(next.rows).toHaveLength(3);
    expect(next.rows[0]!.name).toBe('name1');
    expect(next.rows[1]!.type).toBe('number');
    expect(next.rows[2]!.description).toBe('desc3');
  });

  test('starting mid-way through existing rows still grows past the end', () => {
    const state: GridState = { ...emptyState(), rows: [emptyRow(), emptyRow()] };
    const next = applyPaste(state, { row: 1, col: 0 }, [['a'], ['b'], ['c']]);
    expect(next.rows).toHaveLength(4);
    expect(next.rows[1]!.name).toBe('a');
    expect(next.rows[3]!.name).toBe('c');
  });

  test('never writes past the last expected column', () => {
    const state = emptyState();
    // FIXED_COLS(3) + URL_COUNT(3) = 6 columns total (indices 0..5).
    // A row with values for columns 3,4,5,6,7 pastes starting at col 3:
    // the 4th and 5th values (indices 6,7, i.e. expected index 3,4) are
    // out of range and must be dropped without throwing or corrupting state.
    const block = [['e0', 'e1', 'e2', 'overflow1', 'overflow2']];
    const next = applyPaste(state, { row: 0, col: 3 }, block);
    expect(next.rows[0]!.expected).toEqual(['e0', 'e1', 'e2']);
  });

  test('an out-of-range type value leaves the existing type unchanged', () => {
    const state = emptyState();
    const next = applyPaste(state, { row: 0, col: 1 }, [['not-a-real-type']]);
    expect(next.rows[0]!.type).toBe('text');
  });
});

describe('rowsFromTable', () => {
  test('maps headers case-insensitively', () => {
    const table = [
      ['Name', 'Type', 'Description', 'URL 1', 'Url 2', 'url 3'],
      ['price', 'money', 'near the button', '10', '20', '30'],
    ];
    const { rows, problems } = rowsFromTable(table, URL_COUNT);
    expect(problems).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe('price');
    expect(rows[0]!.type).toBe('money');
    expect(rows[0]!.description).toBe('near the button');
    expect(rows[0]!.expected).toEqual(['10', '20', '30']);
  });

  test('accepts "expected N" as an alias for a url column', () => {
    const table = [
      ['name', 'type', 'description', 'expected 1', 'expected 2', 'expected 3'],
      ['price', 'money', 'near the button', '10', '20', '30'],
    ];
    const { rows, problems } = rowsFromTable(table, URL_COUNT);
    expect(problems).toEqual([]);
    expect(rows[0]!.expected).toEqual(['10', '20', '30']);
  });

  test('reports a missing header', () => {
    const table = [
      ['name', 'type', 'description', 'url 1', 'url 3'], // url 2 missing
      ['price', 'money', 'near the button', '10', '30'],
    ];
    const { rows, problems } = rowsFromTable(table, URL_COUNT);
    expect(rows).toEqual([]);
    expect(problems).toContain('Missing column: url 2');
  });

  test('requires at least a header and one data row', () => {
    const { rows, problems } = rowsFromTable([['name', 'type', 'description', 'url 1', 'url 2', 'url 3']], URL_COUNT);
    expect(rows).toEqual([]);
    expect(problems.length).toBeGreaterThan(0);
  });
});

describe('gridProblems', () => {
  const urls = ['https://shop.example/a', 'https://shop.example/b', 'https://shop.example/c'];

  function completeState(): GridState {
    return {
      urls,
      listingUrl: '',
      rows: [
        {
          id: 'r1',
          name: 'Price',
          type: 'money',
          description: 'near the button',
          expected: ['$10.00', '$20.00', '$30.00'],
        },
      ],
    };
  }

  test('a fully filled-out state has no problems', () => {
    expect(gridProblems(completeState())).toEqual([]);
    expect(isComplete(completeState())).toBe(true);
  });

  test('flags URLs on different hosts', () => {
    const state = completeState();
    state.urls = [urls[0]!, urls[1]!, 'https://other.example/p'];
    expect(gridProblems(state)).toContain('All URLs must be on the same website');
  });

  test('flags duplicate URLs', () => {
    const state = completeState();
    state.urls = [urls[0]!, urls[0]!, urls[2]!];
    expect(gridProblems(state)).toContain('URLs must be different pages');
  });

  test('flags a missing expected value with the field @ url wording', () => {
    const state = completeState();
    state.rows[0]!.expected = ['', '$20.00', '$30.00'];
    expect(gridProblems(state)).toContain(`Price @ ${urls[0]}: Expected value is required`);
  });

  test('flags a non-money expected value with the field @ url wording', () => {
    const state = completeState();
    state.rows[0]!.expected = ['call for price', '$20.00', '$30.00'];
    expect(gridProblems(state)).toContain(`Price @ ${urls[0]}: Not a money amount`);
  });
});

describe('shortUrl', () => {
  test('truncates a long path to within 28 characters', () => {
    const result = shortUrl('https://shop.example/p/very/long/path/that/goes/on');
    expect(result.length).toBeLessThanOrEqual(28);
    expect(result).toContain('…');
    expect(result.startsWith('/p/very/long/')).toBe(true);
    expect(result.endsWith('h/that/goes/on')).toBe(true);
  });

  test('leaves a short path untouched', () => {
    expect(shortUrl('https://shop.example/p')).toBe('/p');
  });

  test('falls back to the raw string for an invalid URL', () => {
    expect(shortUrl('not-a-url')).toBe('not-a-url');
  });
});

describe('toSchemaInput', () => {
  test('keys expected by key when present, else by name', () => {
    const state: GridState = {
      urls: ['https://a.example/1', 'https://a.example/2', 'https://a.example/3'],
      listingUrl: '',
      rows: [
        { id: 'r1', key: 'price_key', name: 'Price', type: 'money', description: 'd', expected: ['1', '2', '3'] },
        { id: 'r2', name: 'Title', type: 'text', description: 'd2', expected: ['t1', 't2', 't3'] },
      ],
    };
    const input = toSchemaInput(state);
    expect(Object.keys(input.expected)).toEqual(['price_key', 'Title']);
    expect(input.expected['price_key']).toEqual({
      'https://a.example/1': '1',
      'https://a.example/2': '2',
      'https://a.example/3': '3',
    });
    expect(input.fields[0]).toEqual({ key: 'price_key', name: 'Price', type: 'money', description: 'd' });
    expect(input.fields[1]).toEqual({ name: 'Title', type: 'text', description: 'd2' });
  });

  test('omits listingUrl when blank, includes it trimmed when present', () => {
    const state = emptyState();
    expect(toSchemaInput(state).listingUrl).toBeUndefined();
    state.listingUrl = '  https://a.example/list  ';
    expect(toSchemaInput(state).listingUrl).toBe('https://a.example/list');
  });
});

describe('fromSource', () => {
  test('round-trips a stored schema definition + verification set', () => {
    const urls = ['https://a.example/1', 'https://a.example/2', 'https://a.example/3'];
    const source = {
      schemaDefinition: [
        { key: 'price_key', name: 'Price', type: 'money' as const, description: 'near the button' },
      ],
      verificationSet: {
        urls,
        expected: { price_key: { [urls[0]!]: '$1', [urls[1]!]: '$2', [urls[2]!]: '$3' } },
        listing_url: 'https://a.example/list',
      },
    };
    const state = fromSource(source);
    expect(state).not.toBeNull();
    expect(state!.urls).toEqual(urls);
    expect(state!.listingUrl).toBe('https://a.example/list');
    expect(state!.rows).toHaveLength(1);
    expect(state!.rows[0]!.key).toBe('price_key');
    expect(state!.rows[0]!.name).toBe('Price');
    expect(state!.rows[0]!.type).toBe('money');
    expect(state!.rows[0]!.description).toBe('near the button');
    expect(state!.rows[0]!.expected).toEqual(['$1', '$2', '$3']);

    // Round trip through toSchemaInput should reproduce the same expected map.
    const input = toSchemaInput(state!);
    expect(input.expected).toEqual(source.verificationSet.expected);
  });

  test('returns null when schemaDefinition or verificationSet is missing', () => {
    expect(fromSource({ schemaDefinition: null, verificationSet: null })).toBeNull();
    expect(fromSource({ schemaDefinition: [], verificationSet: null })).toBeNull();
  });
});

describe('importProblems', () => {
  test('formats an Error message', () => {
    expect(importProblems(new Error('bad zip'))).toEqual(['Could not read the file: bad zip']);
  });

  test('formats a non-Error thrown value', () => {
    expect(importProblems('nope')).toEqual(['Could not read the file: nope']);
  });
});

describe('mergeImportedRows', () => {
  const saved = (key: string, name: string) => ({
    ...emptyRow(), key, name, type: 'text' as const, description: `old ${name}`, expected: ['a', 'b', 'c'],
  });
  const fresh = (name: string) => ({
    ...emptyRow(), name, type: 'money' as const, description: `new ${name}`, expected: ['1', '2', '3'],
  });

  test('a name match keeps the saved key and id, but takes the imported values', () => {
    const current = [saved('price', 'Price')];
    const [merged] = mergeImportedRows(current, [fresh('Price')]);
    expect(merged!.key).toBe('price');
    expect(merged!.id).toBe(current[0]!.id);
    expect(merged!.type).toBe('money');
    expect(merged!.description).toBe('new Price');
    expect(merged!.expected).toEqual(['1', '2', '3']);
  });

  test('matching is case- and whitespace-insensitive', () => {
    const merged = mergeImportedRows([saved('price', 'Price')], [fresh('  pRiCe ')]);
    expect(merged[0]!.key).toBe('price');
  });

  test('an unmatched imported row is appended with no key; a current row absent from the import is dropped', () => {
    const current = [saved('price', 'Price'), saved('sku', 'SKU')];
    const merged = mergeImportedRows(current, [fresh('Price'), fresh('Brand')]);
    expect(merged.map((r) => r.name)).toEqual(['Price', 'Brand']);
    expect(merged[0]!.key).toBe('price');
    expect(merged[1]!.key).toBeUndefined();
  });

  test('rows with no saved key (a never-saved grid) merge cleanly', () => {
    const merged = mergeImportedRows([fresh('Price')], [fresh('Price')]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.key).toBeUndefined();
  });
});
