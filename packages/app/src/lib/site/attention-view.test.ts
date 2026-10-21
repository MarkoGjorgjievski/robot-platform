import { describe, it, expect } from 'vitest';
import { attentionBanner, extractHeldLine, heldWord, NEEDS_ATTENTION, refreshLine, websiteBadge } from './attention-view';

const names = { price: 'Price', rating: 'Rating', description: 'Description' };
const oct8 = new Date(2026, 9, 8);
const base = { driftedFields: null, fieldNames: names, goneProducts: [] as number[], heldSince: oct8, runnable: true };

describe('websiteBadge (spec 2026-10-21 §5)', () => {
  it('drift speaks first, then Needs attention, else nothing', () => {
    expect(websiteBadge(['price'], true)).toBe('1 field stopped extracting');
    expect(websiteBadge(null, true)).toBe(NEEDS_ATTENTION);
    expect(NEEDS_ATTENTION).toBe('Needs attention');
    expect(websiteBadge([], false)).toBeNull();
  });
});

describe('attentionBanner', () => {
  it('names the fields that need the customer, and that runs go on', () => {
    expect(attentionBanner({ ...base, fields: ['rating', 'description'] })).toBe('Rating and Description need you — runs go on with what you verified on 8 Oct.');
    expect(attentionBanner({ ...base, fields: ['price'] })).toBe('Price needs you — runs go on with what you verified on 8 Oct.');
  });
  it('names gone products, alone or with fields', () => {
    expect(attentionBanner({ ...base, fields: [], goneProducts: [2] })).toBe('Product 2 no longer loads — runs go on with what you verified on 8 Oct.');
    expect(attentionBanner({ ...base, fields: ['rating'], goneProducts: [2, 3] })).toBe('Rating needs you and products 2 and 3 no longer load — runs go on with what you verified on 8 Oct.');
  });
  it('says runs go on as before with nothing held, and that extraction waits when it cannot run', () => {
    expect(attentionBanner({ ...base, heldSince: null, fields: ['description'] })).toBe('Description needs you — runs go on as before.');
    expect(attentionBanner({ ...base, runnable: false, fields: ['price'] })).toBe('Price needs you — extraction waits for you.');
  });
  it('is silent when drift speaks, or nothing needs the customer', () => {
    expect(attentionBanner({ ...base, driftedFields: ['price'], fields: ['price'] })).toBeNull();
    expect(attentionBanner({ ...base, fields: [] })).toBeNull();
  });
  it('never names an internal', () => {
    const text = attentionBanner({ ...base, fields: ['price'], goneProducts: [1] })!;
    expect(text).not.toMatch(/path|json|check|hold|model|schedule|\$/i);
  });
});

describe('heldWord, refreshLine, extractHeldLine', () => {
  it('the held row word', () => {
    expect(heldWord(oct8)).toBe('runs use what you verified on 8 Oct');
    expect(heldWord(undefined)).toBeNull();
  });
  it('the refreshed line, in product order, skipping pages no longer on the board', () => {
    const urls = ['u1', 'u2', 'u3'];
    expect(refreshLine({ at: new Date(2026, 9, 24), pages: { u3: { was: '4', now: '4.2' } } }, urls)).toBe('Updated automatically on 24 Oct: 4.2 on product 3 (was 4)');
    expect(refreshLine({ at: new Date(2026, 9, 24), pages: { u2: { was: '45', now: '46' }, u1: { was: '149', now: '150' }, gone: { was: '1', now: '2' } } }, urls))
      .toBe('Updated automatically on 24 Oct: 150 on product 1 (was 149); 46 on product 2 (was 45)');
    expect(refreshLine(undefined, urls)).toBeNull();
  });
  it('the Extract tab line', () => {
    expect(extractHeldLine(['price'], names, oct8)).toBe('Price needs you on the Verification tab — runs go on with what you verified on 8 Oct.');
    expect(extractHeldLine(['price', 'rating'], names, oct8)).toBe('Price and Rating need you on the Verification tab — runs go on with what you verified on 8 Oct.');
    expect(extractHeldLine([], names, oct8)).toBeNull();
  });
});
