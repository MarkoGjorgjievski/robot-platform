import { describe, it, expect } from 'vitest';
import { numberShown, textShown, typedNotShown, normText, defaultNotShown } from './shown';
import type { Field, Answer } from './verification-model';

const brand: Field = { key: 'brand', name: 'Brand', type: 'text', description: 'brand', concept: 'brand' };
const title: Field = { key: 'title', name: 'Title', type: 'text', description: 'title', concept: 'product_name' };
const price: Field = { key: 'price', name: 'Price', type: 'money', description: 'price', concept: 'price' };
const rating: Field = { key: 'rating', name: 'Rating', type: 'number', description: 'rating', concept: 'rating' };
const available: Field = { key: 'available', name: 'Available', type: 'boolean', description: 'available', concept: 'availability' };
const typed = (value: string): Answer => ({ value, mark: null });

describe('normText', () => {
  it('NFKC-normalises, decodes nbsp, collapses whitespace, lower-cases', () => {
    expect(normText('Hello&nbsp;  WORLD')).toBe('hello world');
    expect(normText('Café')).toBe('café');
  });
});

describe('numberShown', () => {
  it('finds a common rendering as a whole token', () => {
    expect(numberShown('4.5', 'rated 4,5 von 5', ['rating'])).toBe(true);
    expect(numberShown('1144', '(1,144) reviews', ['rating'])).toBe(true);
    expect(numberShown('22', '$22.00 today', ['price'])).toBe(true);
    expect(numberShown('22', '$22.50 today', ['price'])).toBe(false);
  });
  it('a bare 0 counts only next to the field words', () => {
    expect(numberShown('0', 'code p0-0 size 0.5', ['rating'])).toBe(false);
    expect(numberShown('0', 'rating 0 reviews', ['rating', 'reviews'])).toBe(true);
  });
});

describe('textShown', () => {
  it('a normalised substring, checked on the first 80 characters when longer', () => {
    expect(textShown('Widget A', 'the page says widget a somewhere')).toBe(true);
    expect(textShown('Drift', 'super shock shadow')).toBe(false);
    const long = 'a'.repeat(90);
    expect(textShown(long, long.slice(0, 80))).toBe(true);
  });
});

describe('typedNotShown (spec B2)', () => {
  it('a typed tagline the page does not show warns (Gymshark)', () => {
    const page = normText('Gymshark official store — shop leggings, tops and accessories');
    expect(typedNotShown(brand, typed('Gymshark | We Do Gym'), page)).toBe(true);
  });
  it('a price typed as 22 against a page showing $22.00 does not warn', () => {
    const page = normText('Now only $22.00 — add to bag');
    expect(typedNotShown(price, typed('22'), page)).toBe(false);
  });
  it('a marked answer never warns', () => {
    const page = normText('nothing matches here');
    expect(typedNotShown(title, { value: 'Widget A', mark: { xpaths: ['//h1'], text: 'Widget A', rect: { x: 0, y: 0, w: 1, h: 1 } } }, page)).toBe(false);
  });
  it('an answer accepted from a suggestion (via, no mark) never warns', () => {
    const page = normText('nothing matches here');
    expect(typedNotShown(title, { value: 'Widget A', mark: null, via: { source: 'json-ld', path: 'name' } }, page)).toBe(false);
  });
  it('a European-format price shown the same way, or the other way, does not warn (M1)', () => {
    expect(typedNotShown(price, typed('1.299,99'), normText('Nur 1.299,99 € heute'))).toBe(false);
    expect(typedNotShown(price, typed('1.299,99'), normText('Only $1,299.99 today'))).toBe(false);
    expect(typedNotShown(price, typed('1.299,99'), normText('Only 1.299 left'))).toBe(true);
  });
  it('a list field never warns: a list is rarely printed the way it is typed (I1)', () => {
    const colors: Field = { key: 'colors', name: 'Colors', type: 'text_list', description: 'colors', concept: 'colors' };
    expect(typedNotShown(colors, typed('Red, Blue'), normText('Colours: blue / red'))).toBe(false);
  });
  it('a boolean field never warns', () => {
    const page = normText('out of stock');
    expect(typedNotShown(available, typed('true'), page)).toBe(false);
  });
  it('no answer, or an absent-marked one, never warns', () => {
    const page = normText('anything');
    expect(typedNotShown(title, undefined, page)).toBe(false);
    expect(typedNotShown(title, { value: '', mark: null, absent: true }, page)).toBe(false);
  });
  it('an empty page text (not yet captured) never warns', () => {
    expect(typedNotShown(title, typed('Anything at all'), '')).toBe(false);
  });
});

describe('defaultNotShown (spec 2026-10-13 §6)', () => {
  it('warns only when every captured proof page lacks the value', () => {
    expect(defaultNotShown(brand, 'Gymshark', ['gymshark we do gym', 'shop gymshark'])).toBe(false);
    expect(defaultNotShown(brand, 'Gymshark', ['gymshark we do gym', 'nothing here'])).toBe(false);
    expect(defaultNotShown(brand, 'Gymshark | We Do Gym', ['gymshark shorts', 'gymshark tops'])).toBe(true);
  });
  it('is inert with no captured text, a blank value, or an unchecked type', () => {
    expect(defaultNotShown(brand, 'Gymshark', ['', ''])).toBe(false);
    expect(defaultNotShown(brand, '  ', ['x'])).toBe(false);
    expect(defaultNotShown(available, 'yes', ['x'])).toBe(false);
  });
});
