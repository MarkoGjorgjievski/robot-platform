import { describe, it, expect } from 'vitest';
import { findLoadMore } from './load-more.js';

describe('findLoadMore', () => {
  it('finds a button by its id', () => {
    expect(findLoadMore('<div id="results"></div><button id="more">Load more</button>'))
      .toBe('#more');
  });

  it('matches every documented wording, case-insensitively', () => {
    for (const text of ['Load More', 'SHOW MORE', 'See more', 'View more', 'More results']) {
      expect(findLoadMore(`<div id="results"></div><button id="b">${text}</button>`)).toBe('#b');
    }
  });

  it('falls back to a class selector when there is no id', () => {
    expect(findLoadMore('<div id="results"></div><button class="btn more-btn">Load more</button>'))
      .toBe('button.more-btn');
  });

  it('prefers the id over the class when a clickable has both', () => {
    // Real "Load more" buttons routinely carry both. No prior fixture gave a
    // clickable both attributes, so a return-order swap (class checked before
    // id) passed every existing test — and would silently hand back a less
    // stable class selector when a stable id existed.
    expect(findLoadMore('<div id="results"></div><button id="more" class="btn more-btn">Load more</button>'))
      .toBe('#more');
  });

  it('captures the actual tag, not just <button>', () => {
    // Every prior fixture used <button>. A link-rendered "Load more" would get
    // a selector matching nothing if the tag were hardcoded — pagination
    // silently disabled rather than erroring.
    expect(findLoadMore('<div id="results"></div><a class="btn more-link" href="#">Load more</a>'))
      .toBe('a.more-link');
  });

  it('recognizes wording even when markup splits the label', () => {
    // <button>Load <b>more</b></button> and icon-plus-label buttons are the
    // common real shape; nothing previously nested markup inside the label.
    expect(findLoadMore('<div id="results"></div><button id="more">Load <b>more</b></button>'))
      .toBe('#more');
  });

  it('ignores a clickable whose text is not a load-more wording', () => {
    // "Subscribe" and "More filters" are the false positives that would click
    // something destructive or useless.
    expect(findLoadMore('<button id="s">Subscribe</button>')).toBeNull();
    expect(findLoadMore('<button id="f">More filters</button>')).toBeNull();
  });

  it('ignores a matching control that sits BEFORE the results', () => {
    // A "show more" in a filter sidebar above the grid is not the pager, and
    // clicking it changes the result set rather than extending it. This is the
    // only test that isolates the position rule — the wording rule accepts this
    // element, so if position stopped being checked nothing else would fail.
    //
    // The anchor is a URL page 1 actually produced. That is evidence the caller
    // already has, unlike a results-container selector, which nothing upstream
    // knows.
    const html = '<button id="filters">Show more</button><div><a href="/p/100001">x</a></div>';
    expect(findLoadMore(html, '/p/100001')).toBeNull();
  });

  it('accepts the same control when it sits AFTER the results', () => {
    // The other half of the position rule: without this, a rule that rejected
    // everything would pass the test above and nothing would catch it.
    const html = '<div><a href="/p/100001">x</a></div><button id="more">Show more</button>';
    expect(findLoadMore(html, '/p/100001')).toBe('#more');
  });

  it('answers null when there is no clickable at all', () => {
    expect(findLoadMore('<div id="results"></div>')).toBeNull();
  });
});
