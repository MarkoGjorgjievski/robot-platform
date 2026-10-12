import { describe, it, expect } from 'vitest';
import { numberShownInText, numberRenderings } from './judge-local.js';

describe('numberRenderings', () => {
  it('covers both decimal marks, one or two decimals, and thousands separators', () => {
    expect(numberRenderings(4.5)).toEqual(expect.arrayContaining(['4.5', '4,5', '4.50', '4,50']));
    expect(numberRenderings(1144)).toEqual(expect.arrayContaining(['1144', '1,144', '1.144', '1 144', '1144.00', '1,144.00', '1.144,00']));
    expect(numberRenderings(1144)).not.toContain('1,144,00');
    expect(numberRenderings(12)).toEqual(expect.arrayContaining(['12', '12.0', '12.00', '12,00']));
  });
});

describe('numberShownInText — campaign 2 cases', () => {
  it('4.5 in "4.5 out of 5 stars"', () => {
    expect(numberShownInText(4.5, 'number', 'Rated 4.5 out of 5 stars (210 reviews)', 'Rating')).toBe(true);
  });
  it('12 in "$12.00"', () => {
    expect(numberShownInText(12, 'money', 'Lippie Stix $12.00 Add to bag', 'Price')).toBe(true);
  });
  it('910 in "MYR 910"', () => {
    expect(numberShownInText(910, 'money', 'Diamond Hoops MYR 910 Add to bag', 'Price')).toBe(true);
  });
  it('1144 in "(1,144)"', () => {
    expect(numberShownInText(1144, 'number', 'Reviews (1,144) Write a review', 'Review count')).toBe(true);
  });
  it('0 with the "0" only in a product code is not shown', () => {
    expect(numberShownInText(0, 'number', 'Product code: CP-0-1188 Shade: Bae 10023-0 free shipping over $50', 'Review count')).toBe(false);
  });
});

describe('numberShownInText — renderings', () => {
  it('matches the other decimal mark and a padded decimal', () => {
    expect(numberShownInText(4.5, 'number', 'Bewertung 4,5 von 5', 'Rating')).toBe(true);
    expect(numberShownInText(4.5, 'number', 'Price 4.50', 'Rating')).toBe(true);
    expect(numberShownInText(19.99, 'money', '19,99 €', 'Price')).toBe(true);
  });
  it('matches thousands separators, including a non-breaking space', () => {
    expect(numberShownInText(1144, 'number', '1.144 Bewertungen', 'Review count')).toBe(true);
    expect(numberShownInText(1144, 'number', '1 144 avis', 'Review count')).toBe(true);
    expect(numberShownInText(2499.5, 'money', 'Now $2,499.50', 'Price')).toBe(true);
  });
  it('reads a stored string value', () => {
    expect(numberShownInText('1,144', 'number', 'Reviews 1144', 'Review count')).toBe(true);
    expect(numberShownInText('$12.00', 'money', 'only 12 left at $12', 'Price')).toBe(true);
    expect(numberShownInText('4,5', 'number', 'rated 4.5', 'Rating')).toBe(true);
  });
  it('is case-insensitive about the surrounding text', () => {
    expect(numberShownInText(910, 'money', 'myr 910', 'Price')).toBe(true);
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

describe('numberShownInText — small whole numbers need the field name beside them', () => {
  it('a bare 0 next to the name words', () => {
    expect(numberShownInText(0, 'number', 'Be the first! 0 reviews yet', 'Review count')).toBe(true);
    expect(numberShownInText(0, 'number', 'Product rating 0 of 5', 'Rating')).toBe(true);
    expect(numberShownInText(0, 'number', 'Reviews: 0', 'Review count')).toBe(true);
  });
  it('a bare 0 elsewhere on the page is not enough', () => {
    expect(numberShownInText(0, 'number', 'Free shipping 0 items in your bag', 'Review count')).toBe(false);
  });
  it('a single digit like 5 is not settled by "out of 5 stars"', () => {
    expect(numberShownInText(5, 'number', 'Rated 4.5 out of 5 stars', 'Rating')).toBe(false);
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
    expect(numberShownInText(null, 'money', '910', 'Price')).toBe(false);
    expect(numberShownInText({ amount: 910 }, 'money', '910', 'Price')).toBe(false);
    expect(numberShownInText(910, 'money', '', 'Price')).toBe(false);
    expect(numberShownInText(Number.NaN, 'number', 'NaN', 'Price')).toBe(false);
  });
  it('a value not on the page', () => {
    expect(numberShownInText(910, 'money', 'MYR 850', 'Price')).toBe(false);
  });
});
