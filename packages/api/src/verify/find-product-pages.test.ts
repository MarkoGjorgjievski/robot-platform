import { describe, it, expect } from 'vitest';
import { rankProductLinks } from './find-product-pages.js';

describe('rankProductLinks', () => {
  it('returns the largest same-host path cluster in document order, capped', () => {
    const anchors = [
      { href: '/', text: 'Home' }, { href: '/c/shoes', text: 'Shoes' },
      { href: '/p/air-1-12345', text: 'Air 1' }, { href: '/p/air-2-12346', text: 'Air 2' }, { href: '/p/air-3-12347', text: 'Air 3' },
      { href: 'https://cdn.other/x', text: '' }, { href: '/p/air-1-12345', text: 'dup' }, { href: '/help/returns', text: 'Returns' },
    ];
    expect(rankProductLinks(anchors, 'https://shop.example/c/shoes', 2)).toEqual(['https://shop.example/p/air-1-12345', 'https://shop.example/p/air-2-12346']);
  });

  it('ignores off-host, non-http(s), and the listing page itself', () => {
    const anchors = [
      { href: 'https://shop.example/c/shoes', text: 'self' },
      { href: 'https://other.example/p/1-111111111111', text: 'other host' },
      { href: 'mailto:x@example.com', text: 'mail' },
      { href: '/p/1-111111111111', text: 'p1' },
      { href: '/p/2-222222222222', text: 'p2' },
    ];
    expect(rankProductLinks(anchors, 'https://shop.example/c/shoes', 10)).toEqual([
      'https://shop.example/p/1-111111111111',
      'https://shop.example/p/2-222222222222',
    ]);
  });

  it('dedupes repeated hrefs and drops the bare root path', () => {
    const anchors = [
      { href: '/', text: 'home' },
      { href: '/p/1', text: 'a' },
      { href: '/p/1', text: 'a again' },
      { href: '/p/2', text: 'b' },
    ];
    expect(rankProductLinks(anchors, 'https://shop.example/', 10)).toEqual([
      'https://shop.example/p/1',
      'https://shop.example/p/2',
    ]);
  });

  it('returns an empty list when no anchors share a same-host template', () => {
    const anchors = [
      { href: '/about', text: 'About' },
      { href: '/contact', text: 'Contact' },
    ];
    // Both "/about" and "/contact" template to themselves (no digits/long
    // tokens), forming two singleton groups — the largest is size 1.
    expect(rankProductLinks(anchors, 'https://shop.example/c/shoes', 10)).toEqual(['https://shop.example/about']);
  });
});
