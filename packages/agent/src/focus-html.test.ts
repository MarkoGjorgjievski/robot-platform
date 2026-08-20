// The selector model is shown a slice of the page. Taking the FIRST 50k of a
// 790k-character category page showed it the header and footer and never one
// product tile — so a live crawl returned the site's privacy-policy link as if
// it were a product.
//
// These tests use the real captured Newegg category page: 790k chars cleaned,
// with the product grid starting at ~681k.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { cleanHtml, focusWindow, densestWindow } from './focus-html.js';

const CORPUS = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', '..', 'scraper', 'src', '__fixtures__', 'corpus',
);
const listing = JSON.parse(readFileSync(join(CORPUS, 'newegg-gpu-listing.json'), 'utf-8')) as { html: string };
const cleaned = cleanHtml(listing.html);
const BUDGET = 50_000;

describe('densestWindow', () => {
  it('picks the window covering the most positions', () => {
    // Two loose hits early, a tight cluster late.
    expect(densestWindow([0, 10, 900, 905, 910, 915], 100)).toBe(900);
  });

  it('returns 0 when there is nothing to go on', () => {
    expect(densestWindow([], 100)).toBe(0);
  });
});

describe('focusWindow on a real category page', () => {
  it('contains the product grid, which the old first-N slice never did', () => {
    const focused = focusWindow(cleaned, BUDGET);
    expect(cleaned.slice(0, BUDGET)).not.toContain('item-container');
    expect(focused.text).toContain('item-container');
  });

  it('contains enough product links for a model to see the repetition', () => {
    const focused = focusWindow(cleaned, BUDGET);
    const productLinks = [...focused.text.matchAll(/href="[^"]*\/p\/[^"]*"/g)];
    expect(productLinks.length).toBeGreaterThanOrEqual(10);
  });

  it('respects the character budget', () => {
    expect(focusWindow(cleaned, BUDGET).text.length).toBeLessThanOrEqual(BUDGET);
  });

  it('reports which locator won, so a bad window is diagnosable', () => {
    const focused = focusWindow(cleaned, BUDGET);
    expect(focused.strategy).toBeTruthy();
    expect(focused.index).toBeGreaterThan(0);
  });
});

describe('vision landmark', () => {
  it('starts the window at text the screenshot reported above the results', () => {
    // "Featured Items" occurs exactly once, 613 chars before the grid.
    const focused = focusWindow(cleaned, BUDGET, { landmark: 'Featured Items' });
    expect(focused.strategy).toBe('landmark');
    expect(focused.text).toContain('Featured Items');
    expect(focused.text).toContain('item-container');
  });

  it('ignores a landmark that is not in the document and still finds the grid', () => {
    const focused = focusWindow(cleaned, BUDGET, { landmark: 'No Such Heading Anywhere' });
    expect(focused.strategy).not.toBe('landmark');
    expect(focused.text).toContain('item-container');
  });
});

describe('documents that need no focusing', () => {
  it('returns a short document unchanged', () => {
    const short = '<div><p>hello</p></div>';
    const focused = focusWindow(short, BUDGET);
    expect(focused.text).toBe(short);
    expect(focused.strategy).toBe('whole-document');
  });
});

describe('fallback ladder', () => {
  const wrap = (body: string) => `<html><body>${'<nav>chrome</nav>'.repeat(400)}${body}</body></html>`;

  it('finds repeated semantic elements when there are no product-shaped links', () => {
    const articles = '<article class="post"><h2>Title</h2><p>Body text here</p></article>'.repeat(30);
    const focused = focusWindow(wrap(articles), 4_000);
    expect(focused.text).toContain('<article');
  });

  it('finds a repeating card class when the markup is all divs', () => {
    const cards = '<div class="product-card"><span>Name</span></div>'.repeat(40);
    const focused = focusWindow(wrap(cards), 3_000);
    expect(focused.text).toContain('product-card');
  });

  it('finds a cluster of images when nothing else repeats recognisably', () => {
    const imgs = '<div><img src="/thumb.jpg" alt="thing"></div>'.repeat(40);
    const focused = focusWindow(wrap(imgs), 3_000);
    expect(focused.text).toContain('<img');
  });

  it('falls back to the head of the document when no signal fires at all', () => {
    const flat = 'x'.repeat(200_000);
    const focused = focusWindow(flat, 1_000);
    expect(focused.strategy).toBe('head-of-document');
    expect(focused.text.length).toBeLessThanOrEqual(1_000);
  });
});

describe('a second real page: AbeBooks search results', () => {
  const abe = JSON.parse(readFileSync(join(CORPUS, 'abebooks-search-listing.json'), 'utf-8')) as { html: string };
  const abeCleaned = cleanHtml(abe.html);

  // A live crawl of this page queued seven facet links (pt=book, pt=mag, pt=comic
  // …) as if they were books: the window it was shown held the refine-by-format
  // sidebar, not the results. The mechanical ladder does NOT rescue this page —
  // every book row carries several same-shape links close together, which
  // collapses the gap signal the ladder leans on. The screenshot does rescue it,
  // which is the entire reason the landmark rung exists.
  it('is rescued by a vision landmark where the mechanical ladder is not', () => {
    // "Search Results" appears exactly once in 445k characters, 20k above the
    // first book link — the kind of heading a model reads straight off the page.
    const focused = focusWindow(abeCleaned, BUDGET, { landmark: 'Search Results' });
    expect(focused.strategy).toBe('landmark');
    const bookLinks = [...focused.text.matchAll(/href="[^"]*\/servlet\/BookDetails[^"]*"/g)];
    expect(bookLinks.length).toBeGreaterThanOrEqual(10);
  });
});

describe('results-container attributes', () => {
  const abe2 = JSON.parse(readFileSync(join(CORPUS, 'abebooks-search-listing.json'), 'utf-8')) as { html: string };
  const cleanedAbe = cleanHtml(abe2.html);

  it('anchors on the element that says it holds the results', () => {
    // <ul id="srp-search-results-list" aria-label="Search Results"> sits exactly
    // on the book list, with <li id="product-0"> immediately inside it. Markup
    // that names itself is better evidence than any statistic over the document.
    const focused = focusWindow(cleanedAbe, BUDGET);
    expect(focused.strategy).toBe('results-attribute');
    const bookLinks = [...focused.text.matchAll(/href="[^"]*\/servlet\/BookDetails[^"]*"/g)];
    expect(bookLinks.length).toBeGreaterThanOrEqual(10);
  });
});

describe('landmark matching tolerates what a screenshot reports', () => {
  const abe3 = JSON.parse(readFileSync(join(CORPUS, 'abebooks-search-listing.json'), 'utf-8')) as { html: string };
  const cleanedAbe3 = cleanHtml(abe3.html);

  it('finds a landmark whose punctuation and spacing differ from the markup', () => {
    // Live, the model returned "Python (Over 100,000 results)" — visually exact,
    // but not a literal substring of the HTML, because the count is rendered in
    // its own element. An exact-match-only lookup discarded the vision signal.
    // (Tested on the Newegg page, whose markup names no results container, so
    // the landmark rung is not outranked by one that does.)
    const focused = focusWindow(cleaned, BUDGET, { landmark: 'Featured   Items!!' });
    expect(focused.strategy).toBe('landmark');
    expect(focused.text).toContain('item-container');
  });

  it('ignores a landmark with no recognisable phrase rather than anchoring at random', () => {
    const focused = focusWindow(cleaned, BUDGET, { landmark: 'Zzz Qqq Xyzzy' });
    expect(focused.strategy).not.toBe('landmark');
  });
});
