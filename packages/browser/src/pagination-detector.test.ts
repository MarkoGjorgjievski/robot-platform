import { describe, it, expect } from 'vitest';
import { detectPaginationFromHtml } from './pagination-detector.js';

describe('detectPaginationFromHtml', () => {
  describe('URL pattern detection', () => {
    it('detects ?page=N pattern', () => {
      const html = `
        <div class="pagination">
          <a href="/search?q=shoes&page=1" class="active">1</a>
          <a href="/search?q=shoes&page=2">2</a>
          <a href="/search?q=shoes&page=3">3</a>
        </div>`;
      const result = detectPaginationFromHtml(html, 'https://example.com/search?q=shoes');
      expect(result).not.toBeNull();
      expect(result!.strategy).toBe('url-pattern');
      expect(result!.urlTemplate).toContain('{N}');
      expect(result!.urlTemplate).toContain('page=');
    });

    it('detects &p=N pattern', () => {
      const html = `
        <nav>
          <a href="/results?q=test&p=2">Next</a>
        </nav>`;
      const result = detectPaginationFromHtml(html, 'https://example.com/results?q=test');
      expect(result).not.toBeNull();
      expect(result!.strategy).toBe('url-pattern');
    });

    it('detects /page/N/ pattern', () => {
      const html = `
        <div class="pagination">
          <a href="/blog/page/2/">2</a>
          <a href="/blog/page/3/">3</a>
        </div>`;
      const result = detectPaginationFromHtml(html, 'https://example.com/blog/');
      expect(result).not.toBeNull();
      expect(result!.strategy).toBe('url-pattern');
      expect(result!.urlTemplate).toContain('/page/{N}/');
    });
  });

  describe('Next button detection', () => {
    it('detects a[rel="next"]', () => {
      const html = `<a rel="next" href="/page/2">Next</a>`;
      const result = detectPaginationFromHtml(html, 'https://example.com/page/1');
      expect(result).not.toBeNull();
      expect(result!.strategy).toBe('next-button');
      expect(result!.nextSelector).toBe('a[rel="next"]');
    });

    it('detects aria-label="Next"', () => {
      const html = `<button aria-label="Next page">→</button>`;
      const result = detectPaginationFromHtml(html, 'https://example.com/');
      expect(result).not.toBeNull();
      expect(result!.strategy).toBe('next-button');
      expect(result!.nextSelector).toContain('aria-label');
    });

    it('detects .pagination .next', () => {
      const html = `
        <ul class="pagination">
          <li class="active"><a href="?page=1">1</a></li>
          <li><a href="?page=2">2</a></li>
          <li class="next"><a href="?page=2">Next</a></li>
        </ul>`;
      const result = detectPaginationFromHtml(html, 'https://example.com/');
      expect(result).not.toBeNull();
      expect(['url-pattern', 'next-button']).toContain(result!.strategy);
    });
  });

  describe('Page number detection', () => {
    it('detects numbered links in pagination container', () => {
      const html = `
        <nav aria-label="Pagination">
          <a href="/p1" class="active">1</a>
          <a href="/p2">2</a>
          <a href="/p3">3</a>
          <a href="/p4">4</a>
        </nav>`;
      const result = detectPaginationFromHtml(html, 'https://example.com/p1');
      expect(result).not.toBeNull();
    });
  });

  describe('rel=next template — choosing the page parameter among several numeric candidates', () => {
    // The AbeBooks failure class, live-proven 2026-08-21: the next-page URL
    // carries several numeric params the current URL lacks, and only one of
    // them is the page cursor. The (current, next) PAIR cannot tell them apart
    // — the discriminating evidence is the page's own pager-link series.

    it('picks the stride-1 series param over an offset and a constant, whatever the URL param order', () => {
      // ds is a page-size constant (first in the URL, the old first-match victim),
      // spo is an offset (stride 30), p is the pager (stride 1 across the series).
      const html = `
        <link rel="next" href="/s?ds=30&amp;q=x&amp;p=1&amp;spo=30">
        <nav>
          <a href="/s?ds=30&amp;q=x&amp;p=1&amp;spo=30">2</a>
          <a href="/s?ds=30&amp;q=x&amp;p=2&amp;spo=60">3</a>
        </nav>`;
      const result = detectPaginationFromHtml(html, 'https://shop.example.com/s?q=x');
      expect(result!.strategy).toBe('url-pattern');
      expect(result!.urlTemplate).toContain('p={N}');
      expect(result!.urlTemplate).toContain('ds=30');
      expect(result!.urlTemplate).toContain('spo=30');
    });

    it('falls back to a known pager name when the page offers no link series', () => {
      // Only the rel=next link exists. foo iterates first and is numeric, but
      // `page` is a name only a pager uses.
      const html = `<link rel="next" href="/s?foo=2&amp;q=x&amp;page=1">`;
      const result = detectPaginationFromHtml(html, 'https://shop.example.com/s?q=x');
      expect(result!.urlTemplate).toContain('page={N}');
      expect(result!.urlTemplate).toContain('foo=2');
    });

    it('keeps the first-changed-param behaviour when there is no series and no known name', () => {
      const html = `<link rel="next" href="/s?aaa=2&amp;q=x">`;
      const result = detectPaginationFromHtml(html, 'https://shop.example.com/s?q=x');
      expect(result!.urlTemplate).toContain('aaa={N}');
    });
  });

  describe('No pagination', () => {
    it('returns null for pages without pagination', () => {
      const html = `<div><h1>Product</h1><p>Description</p></div>`;
      const result = detectPaginationFromHtml(html, 'https://example.com/product');
      expect(result).toBeNull();
    });

    it('returns null for empty HTML', () => {
      const result = detectPaginationFromHtml('', 'https://example.com/');
      expect(result).toBeNull();
    });
  });
});
