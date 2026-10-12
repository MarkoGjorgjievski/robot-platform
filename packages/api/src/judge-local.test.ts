import { describe, it, expect } from 'vitest';
import {
  numberShownInText, numberRenderings, textPrefixInText, pageTextForJudge, normaliseText, isLongText,
  EXCERPT_CHARS, START_CHARS,
} from './judge-local.js';

describe('numberRenderings', () => {
  it('covers both decimal marks, one or two decimals, and thousands separators', () => {
    expect(numberRenderings(4.5)).toEqual(expect.arrayContaining(['4.5', '4,5', '4.50', '4,50']));
    expect(numberRenderings(1144)).toEqual(expect.arrayContaining(['1144', '1,144', '1.144', '1 144', '1144.00', '1,144.00', '1.144,00']));
    expect(numberRenderings(1144)).not.toContain('1,144,00');
    expect(numberRenderings(12)).toEqual(expect.arrayContaining(['12', '12.0', '12.00', '12,00']));
  });
});

describe('numberShownInText — the fix-round rulings', () => {
  it('12 vs "12 colours · $15.00" does not settle (a bare whole number)', () => {
    expect(numberShownInText(12, 'money', '12 colours · $15.00', 'Price')).toBe(false);
  });
  it('12 vs "$12.00" settles', () => {
    expect(numberShownInText(12, 'money', 'Lippie Stix $12.00 Add to bag', 'Price')).toBe(true);
  });
  it('910 vs "MYR 910" settles', () => {
    expect(numberShownInText(910, 'money', 'Diamond Hoops MYR 910 Add to bag', 'Price')).toBe(true);
  });
  it('4.5 vs "4.5 out of 5" settles', () => {
    expect(numberShownInText(4.5, 'number', 'Rated 4.5 out of 5', 'Rating')).toBe(true);
  });
  it('5 vs "4.5 out of 5 stars" does not settle', () => {
    expect(numberShownInText(5, 'number', '4.5 out of 5 stars', 'Rating')).toBe(false);
  });
  it('1144 vs "(1,144) reviews" settles for a field named Reviews', () => {
    expect(numberShownInText(1144, 'number', '(1,144) reviews', 'Reviews')).toBe(true);
  });
  it('1144 vs "1144 ml bottle" does not settle', () => {
    expect(numberShownInText(1144, 'number', '1144 ml bottle', 'Reviews')).toBe(false);
  });
  it('0 with the "0" only in a product code does not settle', () => {
    expect(numberShownInText(0, 'number', 'Product code: CP-0-1188 Shade: Bae 10023-0 free shipping over $50', 'Review count')).toBe(false);
  });
});

describe('numberShownInText — money context', () => {
  it('a currency sign or code within 3 characters, either side', () => {
    expect(numberShownInText(12, 'money', 'now 12€ only', 'Price')).toBe(true);
    expect(numberShownInText(12, 'money', 'now 12 eur only', 'Price')).toBe(true);
    expect(numberShownInText(12, 'money', 'now $ 12 only', 'Price')).toBe(true);
    expect(numberShownInText(910, 'money', 'myr 910', 'Price')).toBe(true);
  });
  it('decimals settle without a currency', () => {
    expect(numberShownInText(12, 'money', 'price 12,00', 'Price')).toBe(true);
    expect(numberShownInText(19.99, 'money', '19,99', 'Price')).toBe(true);
    expect(numberShownInText(2499.5, 'money', 'Now 2,499.50', 'Price')).toBe(true);
  });
  it('a currency further than 3 characters away does not', () => {
    expect(numberShownInText(12, 'money', '$ — over 12 sold', 'Price')).toBe(false);
    expect(numberShownInText(12, 'money', '12 colours from $15', 'Price')).toBe(false);
  });
  it('a currency code inside a longer word does not count', () => {
    expect(numberShownInText(12, 'money', 'tryhard 12 pack', 'Price')).toBe(false);
  });
});

describe('numberShownInText — number context', () => {
  it('a field word within 40 characters', () => {
    expect(numberShownInText(1144, 'number', 'Reviews (1,144) Write a review', 'Review count')).toBe(true);
    expect(numberShownInText(1144, 'number', '1.144 reviews', 'Review count')).toBe(true);
    expect(numberShownInText(1144, 'number', '1 144 reviews', 'Review count')).toBe(true);
    expect(numberShownInText(1144, 'number', 'reviews ............................................ 1144', 'Review count')).toBe(false);
  });
  it('a rating suffix', () => {
    expect(numberShownInText(4, 'number', 'rating 4/5', 'Rating')).toBe(true);
    expect(numberShownInText(42, 'number', '42 stars', 'Score')).toBe(true);
    expect(numberShownInText(42, 'number', '42 ★', 'Score')).toBe(true);
    expect(numberShownInText(42, 'number', '42/100', 'Score')).toBe(true);
  });
  it('decimals settle anywhere', () => {
    expect(numberShownInText(4.5, 'number', 'Bewertung 4,5 von 5', 'Score')).toBe(true);
    expect(numberShownInText('4,5', 'number', 'rated 4.5', 'Score')).toBe(true);
  });
  it('a bare whole number does not', () => {
    expect(numberShownInText(42, 'number', 'item 42 in stock', 'Score')).toBe(false);
  });
});

describe('numberShownInText — whole tokens only', () => {
  it('does not match inside a longer number', () => {
    expect(numberShownInText(910, 'money', 'MYR 1910', 'Price')).toBe(false);
    expect(numberShownInText(910, 'money', 'MYR 9100', 'Price')).toBe(false);
    expect(numberShownInText(4.5, 'number', 'Rated 14.5', 'Rating')).toBe(false);
    expect(numberShownInText(4.5, 'number', 'Version 4.5.1', 'Rating')).toBe(false);
  });
  it('does not match a different decimal', () => {
    expect(numberShownInText(12, 'money', '$12.99', 'Price')).toBe(false);
    expect(numberShownInText(19.99, 'money', '$19.90', 'Price')).toBe(false);
  });
});

describe('numberShownInText — single digits need the field name beside them', () => {
  it('a 0 next to the name words', () => {
    expect(numberShownInText(0, 'number', 'Be the first! 0 reviews yet', 'Review count')).toBe(true);
    expect(numberShownInText(0, 'number', 'Product rating 0 of 5', 'Rating')).toBe(true);
    expect(numberShownInText(0, 'number', 'Reviews: 0', 'Review count')).toBe(true);
  });
  it('a 0 elsewhere is not enough', () => {
    expect(numberShownInText(0, 'number', 'Free shipping 0 items in your bag', 'Review count')).toBe(false);
  });
  it('a 5 beside its name settles', () => {
    expect(numberShownInText(5, 'number', 'Rating 5 out of 5', 'Rating')).toBe(true);
  });
});

describe('numberShownInText — what it refuses', () => {
  it('only number and money fields', () => {
    expect(numberShownInText(910, 'text', 'MYR 910', 'Price')).toBe(false);
    expect(numberShownInText(910, 'image', 'MYR 910', 'Price')).toBe(false);
  });
  it('non-numeric values and empty text', () => {
    expect(numberShownInText('sold out', 'money', 'sold out', 'Price')).toBe(false);
    expect(numberShownInText(null, 'money', '$910', 'Price')).toBe(false);
    expect(numberShownInText({ amount: 910 }, 'money', '$910', 'Price')).toBe(false);
    expect(numberShownInText(910, 'money', '', 'Price')).toBe(false);
    expect(numberShownInText(Number.NaN, 'number', 'NaN', 'Price')).toBe(false);
  });
  it('a value not on the page', () => {
    expect(numberShownInText(910, 'money', 'MYR 850', 'Price')).toBe(false);
  });
});

const DESCRIPTION = 'Our  lightweight Vital Seamless leggings are made for training: sweat-wicking, squat-proof and soft, with a high waist.';

describe('textPrefixInText — long text', () => {
  it('the description is 120 characters, so it is long text', () => {
    expect(DESCRIPTION.length).toBeGreaterThan(80);
    expect(isLongText(DESCRIPTION, 'text')).toBe(true);
  });
  it('settles when its first 80 characters are in the page text, normalised', () => {
    const page = `Home / Women / Leggings READ MORE ${DESCRIPTION.toUpperCase().replace(/ /g, ' ')} rest of the page`;
    expect(textPrefixInText(DESCRIPTION, 'text', page)).toBe(true);
  });
  it('matches through HTML entities and full-width forms', () => {
    const v = 'Tom &amp; Jerry socks: cotton, nylon & elastane — knit in Portugal for long wear, every day of the year.';
    expect(textPrefixInText(v.replace('&amp;', '&'), 'text', `x ${v} y`)).toBe(true);
    expect(normaliseText('ＡＢＣ  def')).toBe('abc def');
  });
  it('does not settle when the description is absent', () => {
    expect(textPrefixInText(DESCRIPTION, 'text', 'Home / Women / Leggings — Vital Seamless leggings, soft and squat-proof.')).toBe(false);
  });
  it('does not settle when only a later part of the value is on the page', () => {
    expect(textPrefixInText(DESCRIPTION, 'text', DESCRIPTION.slice(20))).toBe(false);
  });
  it('never settles short text, even when it is on the page', () => {
    expect(textPrefixInText('Vital Seamless Leggings', 'text', 'Vital Seamless Leggings')).toBe(false);
    expect(isLongText('Gymshark', 'text')).toBe(false);
  });
  it('only text fields', () => {
    expect(textPrefixInText(DESCRIPTION, 'number', DESCRIPTION)).toBe(false);
  });
});

describe('pageTextForJudge', () => {
  const filler = (n: number, ch = 'x') => ch.repeat(n);
  it('sends a 4,000-character window centred on a found value', () => {
    const page = `${filler(10_000)} MYR 910 ${filler(10_000, 'y')}`;
    const { text, kind } = pageTextForJudge(910, 'money', page);
    expect(kind).toBe('excerpt');
    expect(text.length).toBe(EXCERPT_CHARS);
    expect(text).toContain('MYR 910');
    const at = text.indexOf('910');
    expect(Math.abs(at - EXCERPT_CHARS / 2)).toBeLessThan(10);
  });
  it('centres on a long text by its first 80 characters, case-insensitively', () => {
    // Page text comes from visibleTextFromHtml, whitespace already collapsed; the stored value may not be.
    const shown = DESCRIPTION.toUpperCase().replace(/\s+/g, ' ');
    const page = `${filler(9_000)} ${shown} ${filler(9_000, 'y')}`;
    const { text, kind } = pageTextForJudge(DESCRIPTION, 'text', page);
    expect(kind).toBe('excerpt');
    expect(text).toContain(shown.slice(0, 80));
  });
  it('finds a short text value', () => {
    const page = `${filler(9_000)} Vital Seamless Leggings ${filler(9_000)}`;
    expect(pageTextForJudge('vital seamless leggings', 'text', page).kind).toBe('excerpt');
  });
  it('keeps the window inside the page near its start or end', () => {
    const page = `MYR 910 ${filler(10_000)}`;
    const { text } = pageTextForJudge(910, 'money', page);
    expect(text.startsWith('MYR 910')).toBe(true);
    expect(text.length).toBe(EXCERPT_CHARS);
    expect(pageTextForJudge(910, 'money', 'short page, MYR 910').text).toBe('short page, MYR 910');
  });
  it('sends the first 8,000 characters when the value is not found', () => {
    const page = `${filler(5_000)}${filler(5_000, 'y')}`;
    const { text, kind } = pageTextForJudge(850, 'money', page);
    expect(kind).toBe('start');
    expect(text).toBe(page.slice(0, START_CHARS));
  });
});
