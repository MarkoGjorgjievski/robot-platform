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
