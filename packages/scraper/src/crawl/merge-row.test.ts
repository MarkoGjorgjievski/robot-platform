import { describe, it, expect } from 'vitest';
import { mergeRow } from './merge-row.js';

const BASE = {
  inputFields: [],
  inputValues: {},
  listingValues: {},
  detailRow: {},
  url: 'https://example.com/p/1',
  pageNumber: 2,
};

describe('mergeRow', () => {
  it('always stamps the system fields', () => {
    expect(mergeRow(BASE)).toEqual({ _url: 'https://example.com/p/1', _page_number: 2 });
  });

  it('records a null page number for a source with no listing phase', () => {
    expect(mergeRow({ ...BASE, pageNumber: null })._page_number).toBeNull();
  });

  it('includes detail values', () => {
    expect(mergeRow({ ...BASE, detailRow: { title: 'Kallax' } }).title).toBe('Kallax');
  });

  it('carries listing values down to the detail row', () => {
    expect(mergeRow({ ...BASE, listingValues: { category: 'Shelves' } }).category).toBe('Shelves');
  });

  it('copies an input-origin field from the named InputSet column', () => {
    const row = mergeRow({
      ...BASE,
      inputFields: [{ name: 'requested_category', type: 'string', origin: 'input', input_column: 'category_slug' }],
      inputValues: { category_slug: 'shelves' },
    });
    expect(row.requested_category).toBe('shelves');
  });

  it('falls back to the field name when input_column is absent', () => {
    const row = mergeRow({
      ...BASE,
      inputFields: [{ name: 'category_slug', type: 'string', origin: 'input' }],
      inputValues: { category_slug: 'shelves' },
    });
    expect(row.category_slug).toBe('shelves');
  });

  it('emits null for an input field whose column the row does not carry', () => {
    const row = mergeRow({
      ...BASE,
      inputFields: [{ name: 'missing', type: 'string', origin: 'input', input_column: 'absent' }],
      inputValues: { category_slug: 'shelves' },
    });
    expect(row.missing).toBeNull();
  });

  it('does not leak unrequested InputSet columns into the output', () => {
    const row = mergeRow({ ...BASE, inputValues: { internal_note: 'do not export' } });
    expect(row).not.toHaveProperty('internal_note');
  });

  it('merges all four origins into one row', () => {
    const row = mergeRow({
      inputFields: [{ name: 'batch', type: 'string', origin: 'input', input_column: 'batch' }],
      inputValues: { batch: 'Q3' },
      listingValues: { category: 'Shelves' },
      detailRow: { title: 'Kallax', price: 79 },
      url: 'https://example.com/p/1',
      pageNumber: 1,
    });
    expect(row).toEqual({
      batch: 'Q3',
      category: 'Shelves',
      title: 'Kallax',
      price: 79,
      _url: 'https://example.com/p/1',
      _page_number: 1,
    });
  });
});
