// Popup dismissal must not follow links.
//
// The dismissal selector list is deliberately broad — `[aria-label="Close"]`,
// `.modal-close`, `[data-dismiss="modal"]` — because that is what it takes to
// close real cookie banners. Broad enough to close a banner is broad enough to
// match an anchor, and on Barnes & Noble it matched an accessory tile: three
// captures in four ended on a different product's page, and the data that came
// back was wrong AND self-consistent.
//
// The fix cannot be "never click an anchor": `<a href="#">` and
// `href="javascript:void(0)"` are the ordinary way to build a close button, so
// refusing those would break dismissal on many sites. The decision is about the
// destination, not the tag.

import { describe, it, expect } from 'vitest';
import { hrefNavigates } from './playwright-browser.js';

describe('hrefNavigates', () => {
  it('blocks a link to another page — the Barnes & Noble case', () => {
    expect(hrefNavigates({ href: '/w/nook-cover-in-daffodil/1140326163', target: null })).toBe(true);
    expect(hrefNavigates({ href: 'https://example.com/other-product', target: null })).toBe(true);
  });

  it('allows the standard anchor-as-close-button forms', () => {
    expect(hrefNavigates({ href: '#', target: null })).toBe(false);
    expect(hrefNavigates({ href: '', target: null })).toBe(false);
    expect(hrefNavigates({ href: 'javascript:void(0)', target: null })).toBe(false);
    expect(hrefNavigates({ href: 'JavaScript:closeModal()', target: null })).toBe(false);
  });

  it('allows a same-page fragment link', () => {
    expect(hrefNavigates({ href: '#main-content', target: null })).toBe(false);
  });

  it('allows a link that opens a new tab — the captured page stays put', () => {
    expect(hrefNavigates({ href: '/terms', target: '_blank' })).toBe(false);
  });

  it('allows a non-anchor element', () => {
    // The common case: a real <button>. closest('a') found nothing.
    expect(hrefNavigates(null)).toBe(false);
  });

  it('allows an anchor with no href — not a link, just markup', () => {
    expect(hrefNavigates({ href: null, target: null })).toBe(false);
  });

  it('is not fooled by surrounding whitespace or casing', () => {
    expect(hrefNavigates({ href: '   #  ', target: null })).toBe(false);
    expect(hrefNavigates({ href: '  /real/page  ', target: null })).toBe(true);
  });
});
