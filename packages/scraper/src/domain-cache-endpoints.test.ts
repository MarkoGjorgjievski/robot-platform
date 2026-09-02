import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, domainIntelligence } from '@robot/db';
import { eq, and } from 'drizzle-orm';
import type { InterceptedRequest } from '@robot/browser';
import { saveDomainCache, lookupDomainCache, mergeApiEndpoints, API_ENDPOINTS_CAP } from './domain-cache.js';

const DOMAIN = 'test-domain-endpoints.example';
const PAGE_TYPE = 'detail';

async function cleanup() {
  await db.delete(domainIntelligence).where(
    and(eq(domainIntelligence.domain, DOMAIN), eq(domainIntelligence.pageType, PAGE_TYPE))
  );
}

const endpoint = (url: string, method = 'GET') => ({ url, urlPattern: url, method });

const request = (url: string): InterceptedRequest => ({
  url, method: 'GET', resourceType: 'xhr', responseStatus: 200, responseHeaders: {},
  responseBody: null, contentType: 'application/json', bodySize: 0, isJson: true,
  parsedJson: null, timestamp: 0,
});

const outcome = (requests: InterceptedRequest[]) => ({
  domain: DOMAIN,
  pageType: PAGE_TYPE,
  url: `https://${DOMAIN}/p/1`,
  interceptedRequests: requests,
  fieldResults: {
    title: { value: 'Hello', source: 'json-ld' as const, path: '$.name', confidence: 0.95 },
  },
  discoveredFieldNames: ['title'],
  overallConfidence: 1,
  hasJsonLd: true,
  hasNextData: false,
});

describe('mergeApiEndpoints', () => {
  it('appends endpoints not already known, keeping existing ones first', () => {
    const merged = mergeApiEndpoints([endpoint('https://a/1')], [endpoint('https://a/2')]);
    expect(merged.map((e) => e.url)).toEqual(['https://a/1', 'https://a/2']);
  });

  it('does not duplicate an endpoint already known by (url, method)', () => {
    const merged = mergeApiEndpoints([endpoint('https://a/1')], [endpoint('https://a/1')]);
    expect(merged).toHaveLength(1);
  });

  it('the same url under a different method is a different endpoint', () => {
    const merged = mergeApiEndpoints([endpoint('https://a/1', 'GET')], [endpoint('https://a/1', 'POST')]);
    expect(merged).toHaveLength(2);
  });

  it('caps the list oldest-first once it grows past the bound', () => {
    const existing = Array.from({ length: API_ENDPOINTS_CAP }, (_, i) => endpoint(`https://a/${i}`));
    const merged = mergeApiEndpoints(existing, [endpoint('https://a/new')]);
    expect(merged).toHaveLength(API_ENDPOINTS_CAP);
    expect(merged[0]!.url).toBe('https://a/1');
    expect(merged[merged.length - 1]!.url).toBe('https://a/new');
  });
});

describe('saveDomainCache — apiEndpoints enrichment', () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  it('a later run adds endpoints the first run did not see (the list used to freeze at first write)', async () => {
    await saveDomainCache(outcome([request(`https://${DOMAIN}/api/product/1`)]));
    await saveDomainCache(outcome([request(`https://${DOMAIN}/api/reviews/1`)]));

    const cache = await lookupDomainCache(DOMAIN, PAGE_TYPE);
    const urls = cache!.apiEndpoints.map((e) => e.url);
    expect(urls).toContain(`https://${DOMAIN}/api/product/1`);
    expect(urls).toContain(`https://${DOMAIN}/api/reviews/1`);
  });
});
