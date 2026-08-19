import { describe, it, expect } from 'vitest';
import { buildInputUrls } from './build-input-urls.js';

const COLUMNS = [{ name: 'url', primary: true }];

describe('buildInputUrls', () => {
  it('uses the primary value itself for the direct strategy', () => {
    const result = buildInputUrls({
      strategy: 'direct',
      urlTemplate: null,
      columns: COLUMNS,
      rows: [{ url: 'https://example.com/p/1' }],
    });
    expect(result.urls).toEqual([
      { url: 'https://example.com/p/1', inputIndex: 0, inputValues: { url: 'https://example.com/p/1' } },
    ]);
  });

  it('substitutes the primary value into the template by column name', () => {
    const result = buildInputUrls({
      strategy: 'template',
      urlTemplate: 'https://example.com/dp/{asin}',
      columns: [{ name: 'asin', primary: true }],
      rows: [{ asin: 'B001' }],
    });
    expect(result.urls[0]?.url).toBe('https://example.com/dp/B001');
  });

  it('substitutes non-primary columns too', () => {
    const result = buildInputUrls({
      strategy: 'template',
      urlTemplate: 'https://example.com/{country}/dp/{asin}',
      columns: [{ name: 'asin', primary: true }, { name: 'country' }],
      rows: [{ asin: 'B001', country: 'uk' }],
    });
    expect(result.urls[0]?.url).toBe('https://example.com/uk/dp/B001');
  });

  it('url-encodes a search query so spaces cannot break the URL', () => {
    const result = buildInputUrls({
      strategy: 'search',
      urlTemplate: 'https://example.com/search?q={query}',
      columns: [{ name: 'query', primary: true }],
      rows: [{ query: 'protein bars' }],
    });
    expect(result.urls[0]?.url).toBe('https://example.com/search?q=protein%20bars');
  });

  it('does not re-encode a direct URL', () => {
    const result = buildInputUrls({
      strategy: 'direct',
      urlTemplate: null,
      columns: COLUMNS,
      rows: [{ url: 'https://example.com/search?q=a%20b&x=1' }],
    });
    expect(result.urls[0]?.url).toBe('https://example.com/search?q=a%20b&x=1');
  });

  it('reports a row whose placeholder has no matching column instead of emitting a broken URL', () => {
    const result = buildInputUrls({
      strategy: 'template',
      urlTemplate: 'https://example.com/dp/{asin}',
      columns: [{ name: 'sku', primary: true }],
      rows: [{ sku: 'X1' }],
    });
    expect(result.urls).toEqual([]);
    expect(result.errors).toEqual([{ inputIndex: 0, message: 'unresolved placeholder: {asin}' }]);
  });

  it('reports a template strategy with no template', () => {
    const result = buildInputUrls({
      strategy: 'template',
      urlTemplate: null,
      columns: [{ name: 'asin', primary: true }],
      rows: [{ asin: 'B001' }],
    });
    expect(result.errors[0]?.message).toBe('source has no url_template');
  });

  it('reports a direct row whose value is not a URL', () => {
    const result = buildInputUrls({
      strategy: 'direct',
      urlTemplate: null,
      columns: COLUMNS,
      rows: [{ url: 'not a url' }],
    });
    expect(result.urls).toEqual([]);
    expect(result.errors[0]?.message).toBe('not an absolute http(s) URL: not a url');
  });

  it('keeps good rows when a sibling row is broken, and preserves input index', () => {
    const result = buildInputUrls({
      strategy: 'direct',
      urlTemplate: null,
      columns: COLUMNS,
      rows: [{ url: 'nope' }, { url: 'https://example.com/ok' }],
    });
    expect(result.urls).toEqual([
      { url: 'https://example.com/ok', inputIndex: 1, inputValues: { url: 'https://example.com/ok' } },
    ]);
    expect(result.errors).toHaveLength(1);
  });
});
