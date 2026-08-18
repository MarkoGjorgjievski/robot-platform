import { describe, it, expect } from 'vitest';
import { cachedFieldsFromCache } from './cached-fields-from-cache.js';
import type { FieldPathSet } from '@robot/scraper';

const pathSetWithPath = (lastValue: unknown = 'X'): FieldPathSet => ({
  paths: [{
    path: '$.name',
    source: 'json-ld',
    confidence: 0.9,
    hits: 5,
    misses: 0,
    lastValue,
    lastUsedAt: new Date().toISOString(),
  }],
  conflictCount: 0,
});

const emptyPathSet = (): FieldPathSet => ({ paths: [], conflictCount: 0 });

describe('cachedFieldsFromCache', () => {
  it('marks empty-path entries with needsRediscovery: true', () => {
    const out = cachedFieldsFromCache({
      title: pathSetWithPath('Hello'),
      sizes: emptyPathSet(),
    });
    const titleField = out.find(f => f.name === 'title');
    const sizesField = out.find(f => f.name === 'sizes');
    expect(titleField?.needsRediscovery).toBe(false);
    expect(sizesField?.needsRediscovery).toBe(true);
  });

  it('gives empty-path entries a distinct description', () => {
    const out = cachedFieldsFromCache({ sizes: emptyPathSet() });
    expect(out[0].description).toContain('awaiting re-discovery');
  });

  it('has no example_value for empty-path entries', () => {
    const out = cachedFieldsFromCache({ sizes: emptyPathSet() });
    expect(out[0].example_value).toBeUndefined();
  });

  it('preserves all input field names regardless of path state', () => {
    const out = cachedFieldsFromCache({
      title: pathSetWithPath(),
      sizes: emptyPathSet(),
      flavours: emptyPathSet(),
    });
    expect(out.map(f => f.name).sort()).toEqual(['flavours', 'sizes', 'title']);
  });

  it('prefers a live value over the cached lastValue for the example', () => {
    const out = cachedFieldsFromCache(
      { price: { paths: [{ path: '//p', source: 'xpath', confidence: 0.9, hits: 3, misses: 0, lastValue: '$10.00', lastUsedAt: new Date().toISOString() }], conflictCount: 0 } },
      { price: '$62.17' },
    );
    expect(out[0].example_value).toBe('$62.17');
  });
});
