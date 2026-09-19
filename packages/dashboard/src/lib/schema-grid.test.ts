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
  planArrival,
  reconcileRows,
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

  // A website can now have up to six proof pages, but an ordinary file only ever has
  // the three required columns (spec 2026-09-17 §6, controller ruling 1). Only url
  // 1..URL_MIN are required; a missing url 4..6 column just leaves those cells blank.
  test('on a 4-page grid, a file with only url 1..3 fills a blank fourth cell and reports no problems', () => {
    const table = [
      ['name', 'type', 'description', 'url 1', 'url 2', 'url 3'],
      ['price', 'money', 'near the button', '10', '20', '30'],
    ];
    const { rows, problems } = rowsFromTable(table, 4);
    expect(problems).toEqual([]);
    expect(rows[0]!.expected).toEqual(['10', '20', '30', '']);
  });

  test('a required column (url 2) missing is still a problem on a 4-page grid', () => {
    const table = [
      ['name', 'type', 'description', 'url 1', 'url 3'], // url 2 missing
      ['price', 'money', 'near the button', '10', '30'],
    ];
    const { rows, problems } = rowsFromTable(table, 4);
    expect(rows).toEqual([]);
    expect(problems).toContain('Missing column: url 2');
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

// Fix round 1: every GridState this module produces must keep every row's
// expected.length === state.urls.length. A grid grown to four-to-six pages
// exposed three spots that still assumed a fixed width of three.
describe('row width matches the grid (invariant: expected.length === urls.length)', () => {
  it('pasting more rows than the grid has, on a 4-page grid, gives new rows 4 cells and keeps the page-4 value', () => {
    // No existing rows: both pasted rows are created by applyPaste's own padding loop
    // (`while (rows.length <= idx) rows.push(emptyRow(...))`), which is exactly the path
    // the reviewer flagged as width-unaware on a grid past three pages.
    const state: GridState = { urls: ['u1', 'u2', 'u3', 'u4'], listingUrl: '', rows: [] };
    const block = [['a', 'text', 'd1', 'w', 'x', 'y', 'z'], ['b', 'text', 'd2', 'w2', 'x2', 'y2', 'z2']];
    const next = applyPaste(state, { row: 0, col: 0 }, block);
    expect(next.rows).toHaveLength(2);
    for (const row of next.rows) expect(row.expected).toHaveLength(4);
    expect(next.rows[0]!.expected).toEqual(['w', 'x', 'y', 'z']);
    expect(next.rows[1]!.expected).toEqual(['w2', 'x2', 'y2', 'z2']);
  });

  it('rowsFromTable(table, 4) with a url 4 column returns rows 4 wide, fourth value included', () => {
    const table = [
      ['name', 'type', 'description', 'url 1', 'url 2', 'url 3', 'url 4'],
      ['price', 'money', 'near the button', '10', '20', '30', '40'],
    ];
    const { rows, problems } = rowsFromTable(table, 4);
    expect(problems).toEqual([]);
    expect(rows[0]!.expected).toEqual(['10', '20', '30', '40']);
  });

  it('applyImportToRows: a 3-wide imported row on a 4-page grid stays 4 wide, first three replaced, fourth kept', () => {
    const current: GridRow[] = [{ id: 'a', key: 'price', name: 'Price', type: 'money', description: '', expected: ['old1', 'old2', 'old3', 'kept4'] }];
    const imported: GridRow[] = [{ id: 'x', name: 'price', type: 'text', description: 'green', expected: ['1', '2', '3'] }];
    const { rows } = applyImportToRows(current, imported);
    expect(rows[0]!.expected).toEqual(['1', '2', '3', 'kept4']);
  });

  it('applyImportToRows: a 4-wide imported row on a 4-page grid replaces all four', () => {
    const current: GridRow[] = [{ id: 'a', key: 'price', name: 'Price', type: 'money', description: '', expected: ['old1', 'old2', 'old3', 'old4'] }];
    const imported: GridRow[] = [{ id: 'x', name: 'price', type: 'text', description: 'green', expected: ['1', '2', '3', '4'] }];
    const { rows } = applyImportToRows(current, imported);
    expect(rows[0]!.expected).toEqual(['1', '2', '3', '4']);
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

// Fix round 1 (Task 6 review, controller finding): the arrival effect's decision logic
// is a pure function so the "locked" behavior is testable directly, not just reasoned
// about in a React effect. `col`/`focus` are in the page-index coordinate system
// SchemaGrid's `focusCell` prop expects (0-based, matching `state.urls`), not the
// grid's internal +3 ref-key offset.
describe('planArrival', () => {
  const base = (): GridState => ({
    urls: ['https://s.example/1', 'https://s.example/2', 'https://s.example/3'], listingUrl: '',
    rows: [
      { id: 'a', key: 'title', name: 'Title', type: 'text', description: 'heading', expected: ['A', 'B', 'C'] },
      { id: 'b', key: 'price', name: 'Price', type: 'money', description: 'green', expected: ['1', '2', '3'] },
    ],
  });

  it('no addPage param: none', () => {
    expect(planArrival(base(), { locked: false })).toEqual({ kind: 'none' });
  });

  it('locked: wait, with no state change, even if a page would otherwise be added', () => {
    const result = planArrival(base(), { addPage: 'https://s.example/4', field: 'title', locked: true });
    expect(result).toEqual({ kind: 'wait', note: 'A verification is running. This page will be added when it finishes.' });
  });

  it('six pages already, url absent: refused', () => {
    let s = base();
    for (let i = 4; i <= 9; i++) s = addPage(s, `https://s.example/${i}`);
    expect(s.urls).toHaveLength(URL_MAX);
    const result = planArrival(s, { addPage: 'https://s.example/99', field: 'title', locked: false });
    expect(result).toEqual({ kind: 'refused', note: 'This website already has six proof pages. Remove one to add this page.' });
  });

  it('url already present: add, state unchanged in length, focus on that existing column', () => {
    const result = planArrival(base(), { addPage: 'https://s.example/2', field: 'title', locked: false });
    expect(result.kind).toBe('add');
    if (result.kind !== 'add') throw new Error('unreachable');
    expect(result.state.urls).toHaveLength(3); // addPage no-ops: the url is already page 2
    expect(result.focus).toEqual({ row: 0, col: 1 });
  });

  it('normal: add, a new last column, note names the field, focus at the named row and the new page index', () => {
    const result = planArrival(base(), { addPage: 'https://s.example/4', field: 'price', locked: false });
    expect(result.kind).toBe('add');
    if (result.kind !== 'add') throw new Error('unreachable');
    expect(result.state.urls).toHaveLength(4);
    expect(result.note).toBe('Added from a run: type what Price should be on this page, then verify.');
    expect(result.focus).toEqual({ row: 1, col: 3 });
  });

  it('normal, field matches no row: generic note, no focus', () => {
    const result = planArrival(base(), { addPage: 'https://s.example/4', field: 'nope', locked: false });
    expect(result.kind).toBe('add');
    if (result.kind !== 'add') throw new Error('unreachable');
    expect(result.note).toBe('Added from a run: type the expected value on this page, then verify.');
    expect(result.focus).toBeNull();
  });

  // Fix round 2 (Task 6 review, controller finding F1): on a cold load, the arrival
  // effect could fire in the same React commit where the seeding effect flips its ref
  // (synchronous) but before the seeded `setGrid` (asynchronous) has actually applied —
  // so `planArrival` must refuse to plan against a grid that has not been seeded yet,
  // even when everything else about the request looks normal.
  it('grid not yet seeded from the source (ready: false): none, regardless of addPage or field', () => {
    const result = planArrival(emptyState(), { addPage: 'https://s.example/4', field: 'title', locked: false, ready: false });
    expect(result).toEqual({ kind: 'none' });
  });

  it('not ready takes priority over locked (no "verification running" note before the grid even exists)', () => {
    const result = planArrival(base(), { addPage: 'https://s.example/4', field: 'title', locked: true, ready: false });
    expect(result).toEqual({ kind: 'none' });
  });

  it('ready defaults to true when omitted, so existing callers/tests are unaffected', () => {
    const result = planArrival(base(), { addPage: 'https://s.example/4', field: 'price', locked: false });
    expect(result.kind).toBe('add');
  });
});

describe('reconcileRows', () => {
  it('appends rows for new keys, drops rows for removed keys, keeps existing cells', () => {
    const rows = [{ ...emptyRow(), key: 'price', name: 'Price', type: 'money' as const, description: 'd', expected: ['1', '2', '3'] }];
    const def = [
      { key: 'price', name: 'Price', type: 'money' as const, description: 'd' },
      { key: 'title', name: 'Title', type: 'text' as const, description: 'The product name' },
    ];
    const next = reconcileRows(rows, def);
    expect(next.map((r) => r.key)).toEqual(['price', 'title']);
    expect(next[0]!.expected).toEqual(['1', '2', '3']);
    expect(next[1]).toMatchObject({ name: 'Title', type: 'text', description: 'The product name' });
    expect(reconcileRows(next, [def[1]!]).map((r) => r.key)).toEqual(['title']);
  });

  it('a new row is as wide as the grid it joins, not as wide as a fresh one', () => {
    const rows = [{ ...emptyRow(5), key: 'price', name: 'Price', type: 'money' as const, description: 'd', expected: ['1', '2', '3', '4', '5'] }];
    const def = [
      { key: 'price', name: 'Price', type: 'money' as const, description: 'd' },
      { key: 'title', name: 'Title', type: 'text' as const, description: 'The product name' },
    ];
    expect(reconcileRows(rows, def, 5)[1]!.expected).toEqual(['', '', '', '', '']);
    // Width inferred from the rows themselves when the caller does not say.
    expect(reconcileRows(rows, def)[1]!.expected).toHaveLength(5);
  });

  // Name and type live on the project's contract, so step 1 owns them and a
  // rename/retype there has to reach the grid. The description does not: it is
  // this website's own location hint, which the contract only seeds a default
  // for, so it survives a rename untouched.
  it('a renamed, retyped key keeps its id, cells and description, and takes the new name and type', () => {
    const rows = [{ ...emptyRow(), key: 'price', name: 'Price', type: 'money' as const, description: 'next to the buy button', expected: ['1', '2', '3'] }];
    const def = [{ key: 'price', name: 'Ticket price', type: 'text' as const, description: 'The price the customer pays now' }];
    const next = reconcileRows(rows, def);
    expect(next[0]).toMatchObject({ name: 'Ticket price', type: 'text', description: 'next to the buy button' });
    expect(next[0]!.id).toBe(rows[0]!.id);
    expect(next[0]!.expected).toEqual(['1', '2', '3']);
  });

  it('leaves a grid alone when the definition has not moved (same rows, same objects)', () => {
    const rows = [{ ...emptyRow(), key: 'price', name: 'Price', type: 'money' as const, description: 'd', expected: ['1', '2', '3'] }];
    const def = [{ key: 'price', name: 'Price', type: 'money' as const, description: 'd' }];
    expect(reconcileRows(rows, def)[0]).toBe(rows[0]);
  });

  it('an empty grid takes every key from the definition', () => {
    const def = [{ key: 'title', name: 'Title', type: 'text' as const, description: 'h1' }];
    expect(reconcileRows([], def).map((r) => r.key)).toEqual(['title']);
  });
});
