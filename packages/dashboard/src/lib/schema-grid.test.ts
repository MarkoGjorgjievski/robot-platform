import { describe, expect, it, test } from 'vitest';
import {
  URL_COUNT,
  URL_MAX,
  emptyRow,
  emptyState,
  validateExpectedClient,
  parseBlock,
  applyPaste,
  applyPasteByName,
  rowsFromTable,
  toBindingInput,
  bindingProblems,
  applyImportToRows,
  isComplete,
  shortUrl,
  fromSource,
  importProblems,
  addPage,
  removePage,
  canAddPage,
  type GridState,
  type GridRow,
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

describe('applyPasteByName', () => {
  const named: GridState = {
    urls: ['https://s.example/1', 'https://s.example/2', 'https://s.example/3'],
    listingUrl: '',
    rows: [
      { id: 'a', key: 'price', name: 'Price', type: 'money', description: '', expected: ['', '', ''] },
      { id: 'b', key: 'title', name: 'Title', type: 'text', description: '', expected: ['', '', ''] },
    ],
  };

  test('a 6-column block (name, type, description, v1..v3) maps by name, in any order', () => {
    const block = [
      ['Title', 'text', 'the h1', 'A', 'B', 'C'],
      ['Price', 'money', 'near the button', '1', '2', '3'],
    ];
    const { state: next, byName } = applyPasteByName(named, { row: 0, col: 0 }, block);
    expect(byName).toBe(true);
    expect(next.rows[0]!.name).toBe('Price');
    expect(next.rows[0]!.description).toBe('near the button');
    expect(next.rows[0]!.expected).toEqual(['1', '2', '3']);
    expect(next.rows[1]!.name).toBe('Title');
    expect(next.rows[1]!.description).toBe('the h1');
    expect(next.rows[1]!.expected).toEqual(['A', 'B', 'C']);
  });

  test('a 5-column block without the type column also maps by name', () => {
    const block = [
      ['Price', 'near the button', '1', '2', '3'],
      ['Title', 'the h1', 'A', 'B', 'C'],
    ];
    const { state: next, byName } = applyPasteByName(named, { row: 0, col: 0 }, block);
    expect(byName).toBe(true);
    expect(next.rows[0]!.description).toBe('near the button');
    expect(next.rows[0]!.expected).toEqual(['1', '2', '3']);
    expect(next.rows[1]!.description).toBe('the h1');
  });

  test('a 5-column block whose description equals a type name is still read as 5 columns', () => {
    const block = [['Price', 'url', '1', '2', '3']];
    const { state: next, byName } = applyPasteByName(named, { row: 0, col: 0 }, block);
    expect(byName).toBe(true);
    expect(next.rows[0]!.description).toBe('url');
    expect(next.rows[0]!.expected).toEqual(['1', '2', '3']);
  });

  test('falls back to positional paste, clipped to existing rows, when the first column is not a field name', () => {
    const block = [
      ['not-a-field', 'x', 'y'],
      ['also-not', 'x', 'y'],
      ['still-not', 'x', 'y'],
    ];
    const { state: next, byName } = applyPasteByName(named, { row: 0, col: 0 }, block);
    expect(byName).toBe(false);
    expect(next.rows).toHaveLength(2);
    expect(next.rows[0]!.name).toBe('not-a-field');
    expect(next.rows[1]!.name).toBe('also-not');
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

describe('toBindingInput', () => {
  it('keys descriptions and expected values by field key and skips keyless rows', () => {
    const state: GridState = { urls: ['https://s.example/1', 'https://s.example/2', 'https://s.example/3'], listingUrl: '', rows: [
      { id: 'a', key: 'price', name: 'Price', type: 'money', description: 'green', expected: ['1', '2', '3'] },
      { id: 'b', name: 'ghost', type: 'text', description: 'x', expected: ['a', 'b', 'c'] },
    ] };
    expect(toBindingInput(state)).toEqual({ urls: state.urls, descriptions: { price: 'green' }, expected: { price: { 'https://s.example/1': '1', 'https://s.example/2': '2', 'https://s.example/3': '3' } } });
  });
});

describe('bindingProblems', () => {
  const ok: GridState = { urls: ['https://s.example/1', 'https://s.example/2', 'https://s.example/3'], listingUrl: '', rows: [{ id: 'a', key: 'price', name: 'Price', type: 'money', description: 'green', expected: ['1', '2', '3'] }] };
  it('is clean when every row has a description and valid cells', () => expect(bindingProblems(ok)).toEqual([]));
  it('names the gaps by field name', () => {
    expect(bindingProblems({ ...ok, rows: [{ ...ok.rows[0]!, description: '' }] })).toContain('Price: say where it is on this website');
    expect(bindingProblems({ ...ok, rows: [{ ...ok.rows[0]!, expected: ['x', '2', '3'] }] })).toEqual(expect.arrayContaining([expect.stringContaining('Price @ https://s.example/1: Not a money amount')]));
    // Message text changed under the three-to-six-page rule (spec 2026-09-17 §4): it
    // no longer names a fixed count, since the floor is a constant (URL_MIN) but the
    // grid itself can carry more pages.
    expect(bindingProblems({ ...ok, urls: ['', ...ok.urls.slice(1)] })).toContain('Every proof page needs a URL');
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

describe('applyImportToRows', () => {
  const current: GridRow[] = [{ id: 'a', key: 'price', name: 'Price', type: 'money', description: '', expected: ['', '', ''] }];
  it('fills matching rows and reports names it could not place', () => {
    const imported: GridRow[] = [
      { id: 'x', name: 'price', type: 'text', description: 'green', expected: ['1', '2', '3'] },
      { id: 'y', name: 'colour', type: 'text', description: 'swatch', expected: ['r', 'g', 'b'] },
    ];
    const r = applyImportToRows(current, imported);
    expect(r.rows).toEqual([{ id: 'a', key: 'price', name: 'Price', type: 'money', description: 'green', expected: ['1', '2', '3'] }]);
    expect(r.ignored).toEqual(['colour']);
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

    // Round trip through toBindingInput should reproduce the same expected map.
    const input = toBindingInput(state!);
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

describe('proof pages: three to six', () => {
  const base = (): GridState => ({
    urls: ['https://s.example/1', 'https://s.example/2', 'https://s.example/3'], listingUrl: '',
    rows: [
      { id: 'a', key: 'title', name: 'Title', type: 'text', description: 'heading', expected: ['A', 'B', 'C'] },
      { id: 'b', key: 'price', name: 'Price', type: 'money', description: 'green', expected: ['1', '2', '3'] },
    ],
  });
  it('addPage appends a url and a blank cell on every row', () => {
    const s = addPage(base(), 'https://s.example/4');
    expect(s.urls).toHaveLength(4);
    expect(s.rows.map((r) => r.expected)).toEqual([['A', 'B', 'C', ''], ['1', '2', '3', '']]);
  });
  it('addPage focuses an existing page instead of duplicating it, and stops at six', () => {
    expect(addPage(base(), 'https://s.example/2').urls).toHaveLength(3);
    let s = base();
    for (let i = 4; i <= 9; i++) s = addPage(s, `https://s.example/${i}`);
    expect(s.urls).toHaveLength(URL_MAX);
    expect(canAddPage(s)).toBe(false);
  });
  it('removePage drops the column on every row, but never one of the first three', () => {
    const s = addPage(base(), 'https://s.example/4');
    expect(removePage(s, 3).rows[0]!.expected).toEqual(['A', 'B', 'C']);
    expect(removePage(s, 1)).toBe(s);
  });
  it('a blank cell is a problem on pages one to three and fine on page four', () => {
    const s = addPage(base(), 'https://s.example/4');
    s.rows[1]!.expected[3] = '89.50';
    expect(bindingProblems(s)).toEqual([]);
    s.rows[0]!.expected[1] = '';
    expect(bindingProblems(s)).toEqual([expect.stringContaining('Title @ https://s.example/2')]);
  });
  it('an extra page nobody typed on is a problem', () => {
    expect(bindingProblems(addPage(base(), 'https://s.example/4'))).toEqual(['https://s.example/4: type at least one expected value on this page, or remove it']);
  });
  it('toBindingInput sends every page, blanks included', () => {
    const s = addPage(base(), 'https://s.example/4');
    expect(toBindingInput(s).expected.title).toEqual({ 'https://s.example/1': 'A', 'https://s.example/2': 'B', 'https://s.example/3': 'C', 'https://s.example/4': '' });
  });
});
