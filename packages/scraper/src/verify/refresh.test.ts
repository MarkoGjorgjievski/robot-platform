import { describe, it, expect } from 'vitest';
import { planRefresh, changesByNature, inRefreshRange, refreshedText, type PathReading } from './refresh.js';
import type { CertifiedPath } from './types.js';

const U = ['https://s.example/p/1', 'https://s.example/p/2', 'https://s.example/p/3'];
const LD: CertifiedPath = { source: 'json-ld', path: 'offers.price', transform: 'identity' };
const API: CertifiedPath = { source: 'api', path: 'item.price', transform: 'identity' };
const price = { type: 'money' as const, concept: 'price' };
const read = (value: string | null, path: CertifiedPath | null = LD, shown: boolean | null = true): PathReading => ({ value, path, shown });
const expected = { [U[0]!]: '615.00', [U[1]!]: '435.00', [U[2]!]: '3250.00' };
const proven = { [U[0]!]: LD, [U[1]!]: LD, [U[2]!]: LD };

describe('changesByNature (spec 2026-10-21 §3.2)', () => {
  it('covers price, rating, review count and availability, by concept and type', () => {
    expect(changesByNature({ concept: 'price', type: 'money' })).toBe(true);
    expect(changesByNature({ concept: 'rating', type: 'number' })).toBe(true);
    expect(changesByNature({ concept: 'review_count', type: 'number' })).toBe(true);
    expect(changesByNature({ concept: 'availability', type: 'boolean' })).toBe(true);
    expect(changesByNature({ concept: 'availability', type: 'text' })).toBe(true);
  });
  it('never a title, brand, SKU, description, or a text field named for price', () => {
    for (const concept of ['product_name', 'brand', 'sku', 'description', 'image_url']) expect(changesByNature({ concept, type: 'text' })).toBe(false);
    expect(changesByNature({ concept: 'price', type: 'text' })).toBe(false); // "Price currency"
  });
});

describe('planRefresh (spec 2026-10-21 §3.2)', () => {
  it('refreshes every page whose value moved, through the path that passed there (Mejuri)', () => {
    const plan = planRefresh({ field: price, expected, provenOn: proven, readings: { [U[0]!]: read('625'), [U[1]!]: read('440'), [U[2]!]: read('3300') } });
    expect(plan).toEqual({ kind: 'refresh', pages: {
      [U[0]!]: { was: '615.00', now: '625.00', path: LD },
      [U[1]!]: { was: '435.00', now: '440.00', path: LD },
      [U[2]!]: { was: '3250.00', now: '3300.00', path: LD },
    } });
  });
  it('refreshes only the page that moved (Gymshark rating)', () => {
    const plan = planRefresh({
      field: { type: 'number', concept: 'rating' },
      expected: { [U[0]!]: '3.4', [U[1]!]: '3.5', [U[2]!]: '4' },
      provenOn: proven,
      readings: { [U[0]!]: read('3.4'), [U[1]!]: read('3.5'), [U[2]!]: read('4.2') },
    });
    expect(plan).toEqual({ kind: 'refresh', pages: { [U[2]!]: { was: '4', now: '4.2', path: LD } } });
  });
  it('is none when nothing moved, whatever the field', () => {
    expect(planRefresh({ field: { type: 'text', concept: 'product_name' }, expected: { [U[0]!]: 'A', [U[1]!]: 'B' }, provenOn: proven, readings: { [U[0]!]: read('A'), [U[1]!]: read('B') } })).toEqual({ kind: 'none' });
  });
  it('refuses a field that does not change by nature', () => {
    expect(planRefresh({ field: { type: 'text', concept: 'description' }, expected: { [U[0]!]: 'Old', [U[1]!]: 'B' }, provenOn: proven, readings: { [U[0]!]: read('New'), [U[1]!]: read('B') } }))
      .toEqual({ kind: 'refused', reason: 'not-by-nature' });
  });
  it('Review Focus 4: a page that reads nothing refuses as empty (a new design, not a price change)', () => {
    expect(planRefresh({ field: price, expected, provenOn: proven, readings: { [U[0]!]: read('625'), [U[1]!]: read(null, null, null), [U[2]!]: read('3250') } }))
      .toEqual({ kind: 'refused', reason: 'empty', url: U[1] });
  });
  it('refuses with fewer than two pages read', () => {
    expect(planRefresh({ field: price, expected, provenOn: proven, readings: { [U[0]!]: read('625') } })).toEqual({ kind: 'refused', reason: 'too-few-pages' });
  });
  it('refuses a value read through another path than the one that passed on that page', () => {
    expect(planRefresh({ field: price, expected, provenOn: proven, readings: { [U[0]!]: read('625', API), [U[1]!]: read('435'), [U[2]!]: read('3250') } }))
      .toEqual({ kind: 'refused', reason: 'not-same-place', url: U[0] });
  });
  it('refuses a fixed variant index (Everlane, Burrow, Ridge)', () => {
    const fixed: CertifiedPath = { source: 'json-ld', path: 'hasVariant[0].offers.price', transform: 'identity' };
    const p = { [U[0]!]: fixed, [U[1]!]: fixed, [U[2]!]: fixed };
    expect(planRefresh({ field: price, expected, provenOn: p, readings: { [U[0]!]: read('900', fixed), [U[1]!]: read('435', fixed), [U[2]!]: read('3250', fixed) } }))
      .toEqual({ kind: 'refused', reason: 'fixed-variant', url: U[0] });
  });
  it('refuses a value the page does not show (Oliverbonas), and lets a boolean through (shown null)', () => {
    expect(planRefresh({ field: price, expected, provenOn: proven, readings: { [U[0]!]: read('625', LD, false), [U[1]!]: read('435'), [U[2]!]: read('3250') } }))
      .toEqual({ kind: 'refused', reason: 'not-shown', url: U[0] });
    const stock = planRefresh({
      field: { type: 'boolean', concept: 'availability' },
      expected: { [U[0]!]: 'In stock', [U[1]!]: 'In stock' },
      provenOn: proven,
      readings: { [U[0]!]: read('false', LD, null), [U[1]!]: read('true', LD, null) },
    });
    expect(stock).toEqual({ kind: 'refresh', pages: { [U[0]!]: { was: 'In stock', now: 'Out of stock', path: LD } } });
  });
  it('refuses a price that moved more than five times (cents for units)', () => {
    expect(planRefresh({ field: price, expected, provenOn: proven, readings: { [U[0]!]: read('61500'), [U[1]!]: read('435'), [U[2]!]: read('3250') } }))
      .toEqual({ kind: 'refused', reason: 'out-of-range', url: U[0] });
  });
});

describe('inRefreshRange', () => {
  const rating = { type: 'number' as const, concept: 'rating' };
  const count = { type: 'number' as const, concept: 'review_count' };
  it('keeps a rating on its old scale and above zero', () => {
    expect(inRefreshRange(rating, '4.6', '4.5')).toBe(true);
    expect(inRefreshRange(rating, '6', '4.5')).toBe(false);
    expect(inRefreshRange(rating, '0', '4.5')).toBe(false);
    expect(inRefreshRange(rating, '8.4', '8.1')).toBe(true);
  });
  it('keeps a review count whole, lets a first review in, never drops to zero', () => {
    expect(inRefreshRange(count, '150', '149')).toBe(true);
    expect(inRefreshRange(count, '12.5', '12')).toBe(false);
    expect(inRefreshRange(count, '3', '0')).toBe(true);
    expect(inRefreshRange(count, '0', '45')).toBe(false);
  });
  it('lets a sale through and stops at a factor of five', () => {
    expect(inRefreshRange(price, '30.00', '100.00')).toBe(true);
    expect(inRefreshRange(price, '19.00', '100.00')).toBe(false);
  });
  it('says nothing about text and booleans', () => {
    expect(inRefreshRange({ type: 'text', concept: 'availability' }, 'Sold out', 'In stock')).toBe(true);
  });
});

describe('refreshedText', () => {
  it('writes stock in the customer’s words and money in its two-decimal form', () => {
    expect(refreshedText({ type: 'boolean', concept: 'availability' }, 'true')).toBe('In stock');
    expect(refreshedText({ type: 'boolean', concept: 'availability' }, 'false')).toBe('Out of stock');
    expect(refreshedText({ type: 'boolean', concept: 'gift_wrap' }, 'true')).toBe('Yes');
    expect(refreshedText(price, '625')).toBe('625.00');
    expect(refreshedText({ type: 'number', concept: 'rating' }, '4.2')).toBe('4.2');
  });
});
