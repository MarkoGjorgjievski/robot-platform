import { describe, expect, it } from 'vitest';
import { listingBarStart } from './listing-bar-view';

describe('listingBarStart (first run 2026-10-25, D5)', () => {
  it('the address typed in Add website fills the bar when it can be a listing', () => {
    expect(listingBarStart('', 'https://www.gymshark.com/collections/leggings/womens')).toBe('https://www.gymshark.com/collections/leggings/womens');
    expect(listingBarStart('', 'https://www.ikea.com/my/en/cat/sofas-fu003/')).toBe('https://www.ikea.com/my/en/cat/sofas-fu003/');
    expect(listingBarStart('', 'https://shop.example/search?q=sofa')).toBe('https://shop.example/search?q=sofa');
  });
  it('the listing the website already has wins', () => {
    expect(listingBarStart('https://shop.example/c/chairs', 'https://shop.example/c/sofas')).toBe('https://shop.example/c/chairs');
  });
  it('a shop front page is the website, not a listing: the bar stays empty', () => {
    expect(listingBarStart('', 'https://www.gymshark.com')).toBe('');
    expect(listingBarStart('', 'https://www.gymshark.com/')).toBe('');
    expect(listingBarStart('', 'https://www.ikea.com/my/en/')).toBe('');
  });
  it('a product page is not a listing', () => {
    expect(listingBarStart('', 'https://www.skullcandy.com/products/crusher-evo')).toBe('');
    expect(listingBarStart('', 'https://shop.example/collections/x/products/y')).toBe('');
    expect(listingBarStart('', 'https://www.ikea.com/my/en/p/glostad-3-seat-sofa-knisa-dark-grey-40489002/')).toBe('');
    expect(listingBarStart('', 'https://www.amazon.com/Some-Thing/dp/B000123')).toBe('');
  });
  it('no address, or not a web address: empty', () => {
    expect(listingBarStart('', null)).toBe('');
    expect(listingBarStart('', 'not a url')).toBe('');
    expect(listingBarStart('', 'ftp://shop.example/c/x')).toBe('');
  });
  it('an address with a {placeholder} is a template, never a page to load', () => {
    expect(listingBarStart('', 'https://shop.example/{country}/c/sofas')).toBe('');
  });
});
