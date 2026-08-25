// The mechanical detector had never run against a real listing page. Against two
// captured ones it was wrong both times, in different ways:
//
//   AbeBooks  — `rel="next"` exists, but on a <link> in the head, not an anchor.
//               The produced selector `a[rel="next"]` matches nothing clickable,
//               so the crawl would stop after page 1 while the actual next-page
//               URL sat unused in that same tag.
//   Newegg    — no pagination at all. The loose class~="next" rule matched a
//               Swiper carousel (`swiper-slide-next`, `aria-label="Next slide"`)
//               and reported next-button pagination with confidence.
//
// A wrong config is worse than none: Plan B caches it as the domain's pagination
// pattern, so one bad guess poisons every future run on that domain.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { detectPaginationFromHtml } from './pagination-detector.js';

const CORPUS = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', '..', 'scraper', 'src', '__fixtures__', 'corpus',
);
const load = (name: string) => JSON.parse(readFileSync(join(CORPUS, `${name}.json`), 'utf-8')) as { html: string; url: string };

describe('a real paginated search page (AbeBooks)', () => {
  const page = load('abebooks-search-listing');

  it('uses the next-page URL the page declares, rather than a selector for an element that is not there', () => {
    const config = detectPaginationFromHtml(page.html, page.url);
    expect(config).not.toBeNull();
    // The page has NO <a rel="next"> — only <link rel="next"> in the head.
    expect(config?.nextSelector).not.toBe('a[rel="next"]');
    expect(config?.strategy).toBe('url-pattern');
    expect(config?.urlTemplate).toContain('abebooks.com');
    expect(config?.urlTemplate).toContain('{N}');
  });

  it('templates the page parameter the pager series varies, not the first numeric param in the URL', () => {
    // Live-proven failure, 2026-08-21: `ds` (the page-size constant, first in
    // the rel=next URL) was templated, so the walk fetched pages sized 2 and 3
    // items. This page's own pager links vary `p` (1, 2 — stride 1) and `spo`
    // (30, 60 — an offset), while `ds=30` is pinned on every link.
    const config = detectPaginationFromHtml(page.html, page.url);
    expect(config?.urlTemplate).toContain('p={N}');
    expect(config?.urlTemplate).toContain('ds=30');
  });
});

describe('a real listing page with no pagination (Newegg category)', () => {
  const page = load('newegg-gpu-listing');

  it('reports no pagination rather than matching a carousel arrow', () => {
    // This page carries swiper-slide-next and aria-label="Next slide", and no
    // pagination markup whatsoever.
    expect(detectPaginationFromHtml(page.html, page.url)).toBeNull();
  });
});

describe('a next anchor that really exists', () => {
  it('is still detected when the page has one', () => {
    // No page number in the href, so clicking is the only option available.
    const html = '<html><body><div class="results"></div><a rel="next" href="/s/more">Next</a></body></html>';
    const config = detectPaginationFromHtml(html, 'https://shop.example.com/s');
    expect(config?.strategy).toBe('next-button');
    expect(config?.nextSelector).toBe('a[rel="next"]');
  });

  it('prefers the URL over the click when the anchor carries a page number', () => {
    const html = '<html><body><a rel="next" href="/s?page=2">Next</a></body></html>';
    const config = detectPaginationFromHtml(html, 'https://shop.example.com/s?page=1');
    expect(config?.strategy).toBe('url-pattern');
  });
});
