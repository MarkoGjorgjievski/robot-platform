import { describe, it, expect } from 'vitest';
import {
  numberShownInText, numberRenderings, textPrefixInText, pageTextForJudge, normaliseText, isLongText,
  EXCERPT_CHARS, START_CHARS,
} from './judge-local.js';

describe('numberRenderings', () => {
  it('covers both decimal marks, one or two decimals, and thousands separators', () => {
    expect(numberRenderings(4.5)).toEqual(expect.arrayContaining(['4.5', '4,5', '4.50', '4,50']));
    expect(numberRenderings(1144)).toEqual(expect.arrayContaining(['1144', '1,144', '1.144', '1 144', '1 144', "1'144", '1144.00', '1,144.00', '1.144,00']));
    expect(numberRenderings(1144)).not.toContain('1,144,00');
    expect(numberRenderings(12)).toEqual(expect.arrayContaining(['12', '12.0', '12.00', '12,00']));
  });
});

describe('whole tokens — thousands separators on both sides (fix round 2, item 1)', () => {
  // The field word is right there, so only the whole-token guard can refuse these.
  it('299 is not found in "1 299", with a space or a no-break space', () => {
    expect(numberShownInText(299, 'number', '1 299 reviews', 'Reviews')).toBe(false);
    expect(numberShownInText(299, 'number', '1 299 reviews', 'Reviews')).toBe(false);
    expect(pageTextForJudge(299, 'money', 'now 1 299 €').kind).toBe('start');
    expect(pageTextForJudge(299, 'money', 'now 1 299 €').kind).toBe('start');
  });
  it('299 is not found in "CHF 1\'299.00"', () => {
    expect(numberShownInText(299, 'number', "1'299.00 reviews", 'Reviews')).toBe(false);
    expect(pageTextForJudge(299, 'money', "CHF 1'299.00").kind).toBe('start');
    expect(pageTextForJudge(299, 'money', 'CHF 1’299.00').kind).toBe('start');
  });
  it('144 is not found in "1 144 reviews"', () => {
    expect(numberShownInText(144, 'number', '1 144 reviews', 'Reviews')).toBe(false);
  });
  it('1299 itself is found in all of them', () => {
    expect(numberShownInText(1299, 'number', '1 299 reviews', 'Reviews')).toBe(true);
    expect(numberShownInText(1299, 'number', '1 299 reviews', 'Reviews')).toBe(true);
    expect(pageTextForJudge(1299, 'money', "CHF 1'299.00").kind).toBe('excerpt');
  });
  it('does not match inside a longer number or a version', () => {
    expect(numberShownInText(910, 'number', '1910 reviews', 'Reviews')).toBe(false);
    expect(numberShownInText(910, 'number', '9100 reviews', 'Reviews')).toBe(false);
    expect(numberShownInText(4.5, 'number', 'rating 14.5', 'Rating')).toBe(false);
    expect(numberShownInText(4.5, 'number', 'rating 4.5.1', 'Rating')).toBe(false);
  });
});

describe('money never settles locally (item 2)', () => {
  it('not with a currency, not with decimals', () => {
    expect(numberShownInText(12, 'money', 'Lippie Stix $12.00 Add to bag', 'Price')).toBe(false);
    expect(numberShownInText(910, 'money', 'Diamond Hoops MYR 910', 'Price')).toBe(false);
    expect(numberShownInText(12, 'money', 'price 12', 'Price')).toBe(false);
  });
  it('but the judge gets an excerpt around it', () => {
    const page = `${'x'.repeat(10_000)} Diamond Hoops MYR 910 ${'y'.repeat(10_000)}`;
    const { text, kind } = pageTextForJudge(910, 'money', page);
    expect(kind).toBe('excerpt');
    expect(text).toContain('MYR 910');
  });
});

describe('numbers settle only with the field word beside them (item 3)', () => {
  it('the ruling cases', () => {
    expect(numberShownInText(4.5, 'number', 'size 4.5', 'Rating')).toBe(false);
    expect(numberShownInText(3.4, 'number', '3.4 oz', 'Rating')).toBe(false);
    expect(numberShownInText(200, 'number', '200 ml · 1,144 reviews', 'Reviews')).toBe(false);
    expect(numberShownInText(2024, 'number', '© 2024 · reviews', 'Reviews')).toBe(false);
    expect(numberShownInText(1144, 'number', 'reviews · sku 1144', 'Reviews')).toBe(false);
    expect(numberShownInText(1144, 'number', '1,144 reviews', 'Reviews')).toBe(true);
    expect(numberShownInText(4.5, 'number', '4.5 out of 5', 'Rating')).toBe(true);
    expect(numberShownInText(100, 'number', '100 out of 100 customers', 'Satisfaction')).toBe(false);
  });
  it('the field word before or after, through spaces, colons, brackets', () => {
    expect(numberShownInText(1144, 'number', 'Reviews (1,144) Write a review', 'Review count')).toBe(true);
    expect(numberShownInText(1144, 'number', '(1,144) reviews', 'Reviews')).toBe(true);
    expect(numberShownInText(4.5, 'number', 'Rating: 4,5', 'Rating')).toBe(true);
    expect(numberShownInText('1,144', 'number', 'Reviews 1144', 'Review count')).toBe(true);
  });
  it('not further than 15 characters', () => {
    expect(numberShownInText(1144, 'number', 'reviews                 1144', 'Reviews')).toBe(false);
  });
  it('rating suffixes, within 5 characters', () => {
    expect(numberShownInText(4.5, 'number', 'rated 4.5/5', 'Score')).toBe(true);
    expect(numberShownInText(4.5, 'number', 'rated 4.5 / 5', 'Score')).toBe(true);
    expect(numberShownInText(4.5, 'number', '4.5 stars', 'Score')).toBe(true);
    expect(numberShownInText(4.5, 'number', '4.5 star average', 'Score')).toBe(true);
    expect(numberShownInText(4.5, 'number', '4.5 ★', 'Score')).toBe(true);
    expect(numberShownInText(4.5, 'number', '4.5/10', 'Score')).toBe(false);
    expect(numberShownInText(4.5, 'number', '4.5 starter kit', 'Score')).toBe(false);
  });
  it('decimals alone never settle', () => {
    expect(numberShownInText(4.5, 'number', 'Bewertung 4,5 von 5', 'Score')).toBe(false);
    expect(numberShownInText(12, 'number', 'only 12.00 left', 'Score')).toBe(false);
  });
  it('a bare whole number never settles', () => {
    expect(numberShownInText(42, 'number', 'item 42 in stock', 'Score')).toBe(false);
  });
});

describe('single digits need the field word within 3 characters', () => {
  it('a 0 next to the name words', () => {
    expect(numberShownInText(0, 'number', 'Be the first! 0 reviews yet', 'Review count')).toBe(true);
    expect(numberShownInText(0, 'number', 'Product rating 0 of 5', 'Rating')).toBe(true);
    expect(numberShownInText(0, 'number', 'Reviews: 0', 'Review count')).toBe(true);
  });
  it('a 0 in a product code or elsewhere is not enough', () => {
    expect(numberShownInText(0, 'number', 'Product code: CP-0-1188 Shade: Bae 10023-0 free shipping over $50', 'Review count')).toBe(false);
    expect(numberShownInText(0, 'number', 'Free shipping 0 items in your bag', 'Review count')).toBe(false);
  });
  it('a 5 is not settled by "out of 5 stars"; beside its name it is', () => {
    expect(numberShownInText(5, 'number', '4.5 out of 5 stars', 'Rating')).toBe(false);
    expect(numberShownInText(5, 'number', 'Rating 5 out of 5', 'Rating')).toBe(true);
  });
});

describe('numberShownInText — what it refuses (item 6)', () => {
  it('values holding two numbers, and negative numbers', () => {
    expect(numberShownInText('12-15', 'number', '12-15 reviews', 'Reviews')).toBe(false);
    expect(numberShownInText('12 x 3', 'number', '12 x 3 reviews', 'Reviews')).toBe(false);
    expect(numberShownInText(-4, 'number', 'reviews -4', 'Reviews')).toBe(false);
    expect(numberShownInText('-4', 'number', 'reviews -4', 'Reviews')).toBe(false);
  });
  it('a string holding one number with separators is fine', () => {
    expect(numberShownInText('1 144', 'number', '1,144 reviews', 'Reviews')).toBe(true);
  });
  it('only number fields', () => {
    expect(numberShownInText(910, 'text', '910 reviews', 'Reviews')).toBe(false);
    expect(numberShownInText(910, 'money', '910 reviews', 'Reviews')).toBe(false);
  });
  it('non-numeric values and empty text', () => {
    expect(numberShownInText('sold out', 'number', 'sold out', 'Reviews')).toBe(false);
    expect(numberShownInText(null, 'number', '910 reviews', 'Reviews')).toBe(false);
    expect(numberShownInText({ n: 910 }, 'number', '910 reviews', 'Reviews')).toBe(false);
    expect(numberShownInText(910, 'number', '', 'Reviews')).toBe(false);
    expect(numberShownInText(Number.NaN, 'number', 'NaN reviews', 'Reviews')).toBe(false);
  });
});

const DESCRIPTION = 'Our  lightweight Vital Seamless leggings are made for training: sweat-wicking, squat-proof and soft, with a high waist.';

describe('textPrefixInText — long text', () => {
  it('the description is longer than 80 characters, so it is long text', () => {
    expect(DESCRIPTION.length).toBeGreaterThan(80);
    expect(isLongText(DESCRIPTION, 'text')).toBe(true);
  });
  it('settles when its first 80 characters occur once in the page text, normalised', () => {
    const page = `Home / Women / Leggings READ MORE ${DESCRIPTION.toUpperCase().replace(/ /g, ' ')} rest of the page`;
    expect(textPrefixInText(DESCRIPTION, 'text', page, 'description')).toBe(true);
    expect(textPrefixInText(DESCRIPTION, 'text', page)).toBe(true);
  });
  it('does not settle when the prefix occurs twice (boilerplate)', () => {
    const page = `${DESCRIPTION} — related: ${DESCRIPTION}`;
    expect(textPrefixInText(DESCRIPTION, 'text', page, 'description')).toBe(false);
  });
  it('matches through HTML entities and full-width forms', () => {
    const v = 'Tom &amp; Jerry socks: cotton, nylon & elastane — knit in Portugal for long wear, every day of the year.';
    expect(textPrefixInText(v.replace('&amp;', '&'), 'text', `x ${v} y`)).toBe(true);
    expect(normaliseText('ＡＢＣ  def')).toBe('abc def');
  });
  it('does not settle when the description is absent, or only a later part is there', () => {
    expect(textPrefixInText(DESCRIPTION, 'text', 'Home / Women / Leggings — Vital Seamless leggings, soft and squat-proof.')).toBe(false);
    expect(textPrefixInText(DESCRIPTION, 'text', DESCRIPTION.slice(20))).toBe(false);
  });
  it('never settles a product name or a brand, however long', () => {
    const name = 'Vital Seamless 2.0 High Waisted Leggings — Black Marl / Charcoal, Women’s Training Collection';
    expect(name.length).toBeGreaterThan(80);
    expect(textPrefixInText(name, 'text', `x ${name} y`, 'product_name')).toBe(false);
    expect(textPrefixInText(name, 'text', `x ${name} y`, 'brand')).toBe(false);
    expect(textPrefixInText(name, 'text', `x ${name} y`, 'description')).toBe(true);
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
    const { text } = pageTextForJudge(910, 'money', `MYR 910 ${filler(10_000)}`);
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
