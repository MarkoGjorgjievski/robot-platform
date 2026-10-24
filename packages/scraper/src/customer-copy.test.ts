// The customer sentences the app shows and the emails send (spec 2026-10-24 email §3.1): one module, two importers.
import { describe, it, expect } from 'vitest';
import { attentionSentence, captureWords, formatDMMM, joinList, PAGE_NOT_READ_SENTENCE } from './customer-copy.js';

const names = { price: 'Price', rating: 'Rating', description: 'Description' };
const oct8 = new Date(2026, 9, 8);
const base = { fields: [] as string[], fieldNames: names, goneProducts: [] as number[], heldSince: oct8, runnable: true };

describe('attentionSentence', () => {
  it('names the fields that need the customer and what runs do meanwhile', () => {
    expect(attentionSentence({ ...base, fields: ['rating', 'description'] })).toBe('Rating and Description need you — runs go on with what you verified on 8 Oct.');
    expect(attentionSentence({ ...base, fields: ['price'], goneProducts: [2, 3] })).toBe('Price needs you and products 2 and 3 no longer load — runs go on with what you verified on 8 Oct.');
    expect(attentionSentence({ ...base, goneProducts: [2] })).toBe('Product 2 no longer loads — runs go on with what you verified on 8 Oct.');
    expect(attentionSentence({ ...base, heldSince: null, fields: ['description'] })).toBe('Description needs you — runs go on as before.');
    expect(attentionSentence({ ...base, runnable: false, fields: ['price'] })).toBe('Price needs you — extraction waits for you.');
  });
  it('is null when nothing needs the customer', () => {
    expect(attentionSentence(base)).toBeNull();
  });
});

describe('joinList / formatDMMM / captureWords', () => {
  it('lists, dates and rewords as the app always has', () => {
    expect(joinList(['a', 'b', 'c'])).toBe('a, b and c');
    expect(formatDMMM(oct8)).toBe('8 Oct');
    expect(captureWords("That page doesn't exist on shop.example.com (404). Check the address.")).toBe("That page doesn't exist. Check the address.");
    expect(captureWords('page.goto: Timeout 30000ms exceeded.')).toBe(PAGE_NOT_READ_SENTENCE);
  });
});
