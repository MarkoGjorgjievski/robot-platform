import { describe, it, expect } from 'vitest';
import { numberShownInText, pageTextOf, shownOnPage } from './shown-on-page.js';

const xp = { source: 'xpath' as const, path: '//h1', transform: 'identity' as const };
const ld = { source: 'json-ld' as const, path: 'description', transform: 'identity' as const };
const text = (f: 'text' | 'number' | 'money' | 'url' | 'image' | 'boolean' | 'date', key = 'f') => ({ type: f, key, concept: key });

describe('pageTextOf', () => {
  it('drops scripts, styles and tags, collapses whitespace, lower-cases, NFKC', () => {
    expect(pageTextOf('<p>Hello&nbsp;  WORLD</p><script>{"description":"hidden"}</script><style>.x{}</style>')).toBe('hello world');
  });
});

describe('numberShownInText', () => {
  it.each([
    ['4.5', 'rated 4.5 out of 5 stars', true], ['4.5', 'rated 4,5 von 5', true], ['4.5', '4.50 average', true],
    ['12', 'price $12.00 today', true], ['910', 'myr 910', true], ['1144', '(1,144) reviews', true], ['1144', '1.144 bewertungen', true],
    ['4.5', '4.5★ overall', true], ['12', '12€', true],
    ['12', 'sku 1200-12x price 15', false], ['4.5', 'nothing here', false],
    ['12', '12.5 cm', false], ['12', '120', false],
  ])('%s in "%s" → %s', (v, t, expected) => { expect(numberShownInText(v, 'number', t, ['rating'])).toBe(expected); });
  it('a European-format amount reads with a comma decimal mark (M1)', () => {
    expect(numberShownInText('1.299,99', 'money', 'nur 1.299,99 €', ['price'])).toBe(true);
    expect(numberShownInText('1.299,99', 'money', 'only $1,299.99', ['price'])).toBe(true);
    expect(numberShownInText('1.299,99', 'money', 'only 1.299 left', ['price'])).toBe(false);
    expect(numberShownInText('1,299.99', 'money', 'nur 1.299,99 €', ['price'])).toBe(true);
  });
  it('a bare 0 counts only next to the field words', () => {
    expect(numberShownInText('0', 'number', 'code p0-0 size 0.5', ['rating'])).toBe(false);
    expect(numberShownInText('0', 'number', 'rating 0 reviews', ['rating', 'reviews'])).toBe(true);
    expect(numberShownInText(0, 'number', '0 reviews', ['reviews'])).toBe(true);
  });
});

describe('shownOnPage', () => {
  const page = pageTextOf('<h1>Super Shock Shadow</h1><p>Drift</p><div class="price">$12.00</div><p>Rated 4.5 out of 5</p><p>A long description that starts here and goes on for quite a while, longer than eighty characters in total so that the prefix rule applies.</p><script type="application/ld+json">{"description":"SEO text nobody shows"}</script>');
  it('an xpath value is shown by definition', () => expect(shownOnPage(text('text'), xp, 'anything', page)).toBe(true));
  it('url, image, boolean, date are not checked', () => {
    for (const t of ['url', 'image', 'boolean', 'date'] as const) expect(shownOnPage(text(t), ld, 'x', page)).toBeNull();
  });
  it('text_list is not checked: its rendered value is sorted and joined, not how the page prints it (I1)', () => {
    expect(shownOnPage({ type: 'text_list', key: 'colors', concept: 'colors' }, ld, ['drift', 'shadow'], page)).toBeNull();
  });
  it('text: a normalised substring', () => {
    expect(shownOnPage(text('text'), ld, 'super shock SHADOW', page)).toBe(true);
    expect(shownOnPage(text('text'), ld, 'SEO text nobody shows', page)).toBe(false);          // Review Focus 1
    expect(shownOnPage(text('text'), ld, 'Drift', page)).toBe(true);                           // on the page, though not the heading
  });
  it('text over 80 characters: its first 80', () => {
    const long = 'A long description that starts here and goes on for quite a while, longer than eighty characters in total so that the prefix rule applies. And then it is folded away by the page.';
    expect(shownOnPage(text('text'), ld, long, page)).toBe(true);
  });
  it('money and number', () => {
    expect(shownOnPage(text('money'), ld, '12', page)).toBe(true);
    expect(shownOnPage(text('money'), ld, '15', page)).toBe(false);
    expect(shownOnPage({ type: 'number', key: 'rating', concept: 'rating' }, ld, 4.5, page)).toBe(true);
    expect(shownOnPage({ type: 'number', key: 'rating', concept: 'rating' }, ld, 0, page)).toBe(false);
  });
  it('an empty page flags every checkable value false and never throws', () => {               // Review Focus 3
    expect(shownOnPage(text('text'), ld, 'x', pageTextOf(''))).toBe(false);
    expect(shownOnPage(text('money'), ld, '12', '')).toBe(false);
  });
});
