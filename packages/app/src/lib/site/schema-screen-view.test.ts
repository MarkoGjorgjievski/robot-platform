import { describe, expect, it } from 'vitest';
import { cellIsStale, saveButton } from './schema-screen-view';
import type { GridRow, GridState } from './schema-grid';
import type { VerificationResults } from './verification-view';

const URLS = ['https://shop.example/1', 'https://shop.example/2', 'https://shop.example/3'];

const row = (over: Partial<GridRow> = {}): GridRow => ({
  id: 'r1',
  key: 'price',
  name: 'Price',
  type: 'money',
  description: 'next to Add to cart',
  expected: ['10.00', '11.00', '12.00'],
  ...over,
});

const grid = (rows: GridRow[], urls = URLS): GridState => ({ urls, listingUrl: '', rows });

const results = (): VerificationResults => ({
  price: {
    key: 'price',
    cells: {
      [URLS[0]!]: { status: 'pass', found: '10.00' },
      [URLS[1]!]: { status: 'pass', found: '11.00' },
      [URLS[2]!]: { status: 'pass', found: '12.00' },
    },
    certified: [{ source: 'json-ld', path: '$.price' }],
    weakEvidence: false,
    aiCalled: false,
    incomplete: false,
  },
});

describe('cellIsStale', () => {
  it('is false for a field that was never verified, however far the grid has drifted', () => {
    const saved = grid([row()]);
    const edited = grid([row({ expected: ['99.00', '11.00', '12.00'] })]);
    expect(
      cellIsStale({ row: edited.rows[0]!, grid: edited, savedGrid: saved, results: null, currentKeys: [], urlIndex: 0 }),
    ).toBe(false);
  });

  it('is false for a row with no key at all', () => {
    const g = grid([row({ key: undefined })]);
    expect(cellIsStale({ row: g.rows[0]!, grid: g, savedGrid: g, results: results(), currentKeys: ['price'], urlIndex: 0 })).toBe(false);
  });

  it('is true once a verified row drifts from what was saved', () => {
    const saved = grid([row()]);
    const edited = grid([row({ expected: ['99.00', '11.00', '12.00'] })]);
    expect(
      cellIsStale({ row: edited.rows[0]!, grid: edited, savedGrid: saved, results: results(), currentKeys: ['price'], urlIndex: 0 }),
    ).toBe(true);
  });

  it('is true when the server no longer counts the key current', () => {
    const g = grid([row()]);
    expect(cellIsStale({ row: g.rows[0]!, grid: g, savedGrid: g, results: results(), currentKeys: [], urlIndex: 0 })).toBe(true);
  });

  it('is true for the one column whose URL was edited, and false for the others', () => {
    const saved = grid([row()]);
    const moved = grid([row()], ['https://shop.example/9', URLS[1]!, URLS[2]!]);
    const args = { row: moved.rows[0]!, grid: moved, savedGrid: saved, results: results(), currentKeys: ['price'] };
    expect(cellIsStale({ ...args, urlIndex: 0 })).toBe(true);
    expect(cellIsStale({ ...args, urlIndex: 1 })).toBe(true); // the row itself drifted: its checked pages moved
  });

  it('is false for an unchanged, current, verified cell', () => {
    const g = grid([row()]);
    expect(cellIsStale({ row: g.rows[0]!, grid: g, savedGrid: g, results: results(), currentKeys: ['price'], urlIndex: 1 })).toBe(false);
  });
});

describe('saveButton', () => {
  it('is offered once there is something to save and nothing wrong with it', () => {
    expect(saveButton({ dirty: true, problems: [], active: false, busy: false })).toEqual({ disabled: false });
  });

  it('says a run is in the way before anything else', () => {
    expect(saveButton({ dirty: true, problems: ['x'], active: true, busy: false })).toEqual({
      disabled: true,
      reason: 'A verification is running',
    });
  });

  it('says nothing has changed rather than naming a problem the customer cannot see the point of', () => {
    expect(saveButton({ dirty: false, problems: ['Every proof page needs a URL'], active: false, busy: false }).reason).toBe(
      'Nothing has changed since the last save',
    );
  });

  it('names the first problem when there is one', () => {
    expect(saveButton({ dirty: true, problems: ['Every proof page needs a URL', 'and another'], active: false, busy: false })).toEqual({
      disabled: true,
      reason: 'Every proof page needs a URL',
    });
  });

  it('says it is saving while the mutation is in flight', () => {
    expect(saveButton({ dirty: true, problems: [], active: false, busy: true }).reason).toBe('Saving');
  });
});
