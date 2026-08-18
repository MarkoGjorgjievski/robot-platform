// Ranking decides which intercepted JSON reaches AI analysis. A mis-ranked top
// source sends the wrong document to the model, and whatever it extracts gets
// cached — so this is the upstream half of the cache-poisoning family tracked in
// docs/ideas.md.
//
// Fixture is a real pre-ranking capture of the Newegg product page (2026-08-18,
// 56 JSON responses). String values are truncated and arrays clipped to keep it
// small; keys and structure — the only things ranking scores — are intact.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { rankInterceptedRequests, urlWords, collectJsonKeys } from './rank-requests.js';
import type { InterceptedRequest } from './types.js';

const raw = JSON.parse(
  readFileSync(join(fileURLToPath(new URL('.', import.meta.url)), '__fixtures__', 'newegg-intercepted-raw.json'), 'utf-8'),
) as Array<Partial<InterceptedRequest>>;

const FIXTURE: InterceptedRequest[] = raw.map((r) => ({
  url: r.url!, method: r.method ?? 'GET', resourceType: 'xhr',
  responseStatus: r.responseStatus ?? 200, responseHeaders: {},
  responseBody: null, contentType: r.contentType ?? 'application/json',
  bodySize: r.bodySize ?? 0, isJson: true, parsedJson: r.parsedJson ?? null, timestamp: 0,
}));

const PAGE_URL = 'https://www.newegg.com/samsung-2tb-9100-pro-nvme-2-0/p/N82E16820147903';

/** Synthetic, but the URL is verbatim from the 2026-08-18 run log where this
 *  endpoint was ranked TOP — a related-products feed whose every field describes
 *  a DIFFERENT product. Body mirrors that: product-shaped keys throughout. */
const RELATION_FEED: InterceptedRequest = {
  url: 'https://www.newegg.com/product/api/ProductRelationInfoV3?itemNumber=9SIC0X3KPS7946&AdditionalCost=0',
  method: 'GET', resourceType: 'xhr', responseStatus: 200, responseHeaders: {},
  responseBody: null, contentType: 'application/json', bodySize: 2518, isJson: true, timestamp: 0,
  parsedJson: {
    items: [
      { title: 'Some Other SSD', price: 199.99, sku: 'X1', brand: 'Crucial', rating: 4.2, image: 'a.jpg', availability: 'InStock' },
      { title: 'Another Other SSD', price: 149.99, sku: 'X2', brand: 'WD', rating: 4.0, image: 'b.jpg', availability: 'InStock' },
    ],
  },
};

describe('urlWords', () => {
  it('splits camelCase and path separators into words', () => {
    expect(urlWords('https://x.com/product/api/ProductRealtime?a=1')).toContain('realtime');
    expect(urlWords('https://x.com/product/api/ProductRealtime?a=1')).toContain('product');
  });

  it('does not let "pricing" count as "price" — the substring bug', () => {
    const w = urlWords('https://x.com/api/messages/pricing');
    expect(w).toContain('pricing');
    expect(w).not.toContain('price');
  });

  it('ignores query parameters — they parameterise an endpoint, they do not define it', () => {
    // Newegg's genuine product API is ?ItemNumber=…&RecommendItem=&BestSellerItemList=…
    // Scoring the query made those PARAMETER NAMES trip the relation penalty and
    // sank the single response we most wanted to rank first.
    const w = urlWords('https://www.newegg.com/product/api/ProductRealtime?RecommendItem=&BestSellerItemList=20-147');
    expect(w).toContain('product');
    expect(w).toContain('realtime');
    expect(w).not.toContain('recommend');
    expect(w).not.toContain('bestseller');
  });
});

describe('collectJsonKeys', () => {
  it('collects keys, not values — a value of "name" is not a name key', () => {
    const keys = collectJsonKeys({ field: 'name', other: 'price' });
    expect(keys.has('field')).toBe(true);
    expect(keys.has('name')).toBe(false);
    expect(keys.has('price')).toBe(false);
  });

  it('walks nested objects and arrays', () => {
    expect(collectJsonKeys({ a: [{ price: 1 }], b: { c: { sku: 'x' } } })).toEqual(
      new Set(['a', 'price', 'b', 'c', 'sku']),
    );
  });

  it('terminates on deeply nested and self-referential input', () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    expect(() => collectJsonKeys(cyclic)).not.toThrow();
  });
});

describe('rankInterceptedRequests', () => {
  const ranked = rankInterceptedRequests(FIXTURE, PAGE_URL);

  it('puts a real product API first on the live Newegg capture', () => {
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked[0]!.url).toContain('ProductRealtime');
  });

  it('drops analytics, logging and beacon traffic entirely', () => {
    for (const r of ranked) {
      expect(r.url).not.toMatch(/log_event|\/logger\/|esuohni|googleapis/i);
    }
  });

  it('ranks a related-products feed below the real product API', () => {
    // The 2026-08-18 regression: this endpoint ranked TOP, so AI analysis read a
    // list of OTHER products and the cache learned paths into it.
    const withRelation = rankInterceptedRequests([...FIXTURE, RELATION_FEED], PAGE_URL);
    const relationIdx = withRelation.findIndex((r) => r.url.includes('ProductRelationInfoV3'));
    const realtimeIdx = withRelation.findIndex((r) => r.url.includes('ProductRealtime'));
    expect(realtimeIdx).toBeGreaterThanOrEqual(0);
    expect(relationIdx === -1 || relationIdx > realtimeIdx).toBe(true);
  });

  it('caps how many sources it returns', () => {
    expect(rankInterceptedRequests(FIXTURE, PAGE_URL, { maxResults: 3 }).length).toBeLessThanOrEqual(3);
  });

  it('accepts weight overrides so non-ecommerce verticals can be tuned', () => {
    const tuned = rankInterceptedRequests(FIXTURE, PAGE_URL, { weights: { productKey: 0 } });
    expect(Array.isArray(tuned)).toBe(true);
  });

  it('ignores non-JSON and unparsed responses', () => {
    const junk: InterceptedRequest = { ...RELATION_FEED, url: 'https://x.com/api/product', isJson: false, parsedJson: null };
    expect(rankInterceptedRequests([junk], PAGE_URL)).toEqual([]);
  });
});

describe('rankInterceptedRequests — payload quality floors', () => {
  const base = { method: 'GET', resourceType: 'xhr', responseStatus: 200, responseHeaders: {},
    responseBody: null, contentType: 'application/json', isJson: true as const, timestamp: 0 };

  it('drops acknowledgement payloads that carry no data', () => {
    // /api/v2/cookie_sent scored 4 on its URL words alone and displaced real content.
    const ack: InterceptedRequest = { ...base, url: 'https://x.com/api/v2/cookie_sent', bodySize: 22, parsedJson: { success: true } };
    expect(rankInterceptedRequests([ack], PAGE_URL)).toEqual([]);
  });

  it('does not let size alone qualify a payload with no product keys', () => {
    // A 12KB CSS theme file sits squarely in the "product-sized" band.
    const styles: InterceptedRequest = { ...base, url: 'https://cdn.example.com/site/styles.json', bodySize: 11535,
      parsedJson: Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`headerFontColor${i}`, '#fff'])) };
    expect(rankInterceptedRequests([styles], PAGE_URL)).toEqual([]);
  });

  it('finds product keys deep inside a large document', () => {
    // The node cap used to truncate the walk before reaching these.
    const deep: InterceptedRequest = { ...base, url: 'https://content.example.com/page/item.json', bodySize: 62183,
      parsedJson: { blocks: Array.from({ length: 400 }, (_, i) => ({ [`filler${i}`]: { a: 1, b: 2 } }))
        .concat([{ description: 'Real copy', image: 'x.jpg' } as never]) } };
    expect(rankInterceptedRequests([deep], PAGE_URL).length).toBe(1);
  });

  it('drops checkout widget traffic', () => {
    const affirm: InterceptedRequest = { ...base, url: 'https://features.affirm.com/v1/initialize?k=abc', bodySize: 6653,
      parsedJson: { currency: 'USD', price: 0, config: { a: 1 } } };
    expect(rankInterceptedRequests([affirm], PAGE_URL)).toEqual([]);
  });
});
