import { describe, it, expect } from 'vitest';
import { identifierFromUrl, collectFromJson, getPath } from './api-identifiers.js';

describe('identifierFromUrl', () => {
  it('takes the last meaningful path segment', () => {
    expect(identifierFromUrl('https://x.example/books/9780134685991')).toBe('9780134685991');
  });

  it('ignores a trailing slash', () => {
    expect(identifierFromUrl('https://x.example/books/abc-123/')).toBe('abc-123');
  });

  it('answers the same identifier for an absolute URL and its bare path', () => {
    // An API routinely returns "/p/9780134685991" where the DOM carried the
    // absolute URL. If those two do not compare equal, detection never matches
    // anything at all.
    expect(identifierFromUrl('https://x.example/p/9780134685991')).toBe('9780134685991');
    expect(identifierFromUrl('/p/9780134685991')).toBe('9780134685991');
  });

  it('never mistakes a hostname for an identifier', () => {
    // "x.example" is nine characters, so a naive split would sail past the
    // length bar and match itself in every payload on the domain.
    expect(identifierFromUrl('https://x.example')).toBeNull();
  });

  it('rejects a segment too short to be an identifier by coincidence', () => {
    // "4" or "en" would collide across unrelated payloads.
    expect(identifierFromUrl('https://x.example/p/4')).toBeNull();
  });

  it('answers null for a URL with no path', () => {
    expect(identifierFromUrl('https://x.example/')).toBeNull();
  });
});

describe('getPath', () => {
  it('walks dot notation', () => {
    expect(getPath({ data: { items: [1, 2] } }, 'data.items')).toEqual([1, 2]);
  });

  it('answers undefined for a missing branch rather than throwing', () => {
    expect(getPath({ data: {} }, 'data.items.0.url')).toBeUndefined();
  });

  it('treats an empty path as the root', () => {
    expect(getPath([1, 2], '')).toEqual([1, 2]);
  });
});

describe('collectFromJson', () => {
  const payload = {
    results: [
      { link: '/p/111111', name: 'One' },
      { link: '/p/222222', name: 'Two' },
      { name: 'No link' },
    ],
  };

  it('collects one identifier per item that has one', () => {
    expect(collectFromJson(payload, 'results', 'link')).toEqual(['111111', '222222']);
  });

  it('answers an empty array when the items path is not an array', () => {
    expect(collectFromJson(payload, 'nope', 'link')).toEqual([]);
  });

  it('reads a nested url path inside each item', () => {
    const nested = { d: { rows: [{ meta: { href: '/p/333333' } }] } };
    expect(collectFromJson(nested, 'd.rows', 'meta.href')).toEqual(['333333']);
  });
});
