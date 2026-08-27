// Soft page-type hints (mvp-simplification task 6) — pure functions, no
// browser, no database, no AI. `runAnalysis` still honors the caller's
// declared page type unconditionally (task 4); these are advisory strings
// attached alongside the outcome, never a gate.

import { describe, it, expect } from 'vitest';
import { listingHints, detailHints } from './page-hints.js';

const HUB_WARNING =
  "This doesn't look like a listing — it may be a hub/featured page; the real listing is often behind a 'shop all' link.";
const LOOKS_LIKE_LISTING_WARNING = 'This looks like a listing page.';

describe('listingHints', () => {
  it('fires the hub warning when almost nothing came back and no pagination was detected', () => {
    expect(listingHints(0, null)).toEqual([HUB_WARNING]);
  });

  it('fires at the boundary — rowsFound 2, no pagination', () => {
    expect(listingHints(2, null)).toEqual([HUB_WARNING]);
  });

  it('does NOT fire at rowsFound 3 with no pagination — the brief-mandated boundary', () => {
    expect(listingHints(3, null)).toEqual([]);
  });

  it('does NOT fire when pagination was detected, even with few rows', () => {
    expect(listingHints(1, 'url-pattern')).toEqual([]);
  });
});

describe('detailHints', () => {
  it('fires when a JSON-LD block\'s @type (string form) is ItemList', () => {
    expect(detailHints([{ '@type': 'ItemList' }])).toEqual([LOOKS_LIKE_LISTING_WARNING]);
  });

  it('fires when @type is an array form containing ItemList', () => {
    expect(detailHints([{ '@type': ['Thing', 'ItemList'] }])).toEqual([LOOKS_LIKE_LISTING_WARNING]);
  });

  it('does NOT fire for an ordinary Product block', () => {
    expect(detailHints([{ '@type': 'Product', name: 'Widget' }])).toEqual([]);
  });

  it('does NOT fire when there is no JSON-LD at all', () => {
    expect(detailHints([])).toEqual([]);
  });
});
