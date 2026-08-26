import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, domainIntelligence } from '@robot/db';
import { eq, and } from 'drizzle-orm';
import type { PaginationConfig } from '@robot/browser';
import { savePaginationConfig, lookupDomainCache, saveDomainCache } from './domain-cache.js';

const DOMAIN = 'test-pagination-cache.example';
const PAGE_TYPE = 'listing';

const URL_PATTERN: PaginationConfig = {
  strategy: 'url-pattern',
  urlTemplate: 'https://test-pagination-cache.example/search?page={N}',
};
const NEXT_BUTTON: PaginationConfig = { strategy: 'next-button', nextSelector: 'a.next' };

async function cleanup() {
  await db.delete(domainIntelligence).where(
    and(eq(domainIntelligence.domain, DOMAIN), eq(domainIntelligence.pageType, PAGE_TYPE)),
  );
}

beforeEach(cleanup);
afterAll(cleanup);

describe('savePaginationConfig', () => {
  it('creates the listing row when the domain has no intelligence yet', async () => {
    // A domain can be walked before anything has ever cached a listing extraction
    // for it, so the writer cannot assume a row exists.
    await savePaginationConfig(DOMAIN, URL_PATTERN);

    const cache = await lookupDomainCache(DOMAIN, PAGE_TYPE);
    expect(cache?.paginationConfig).toEqual(URL_PATTERN);
  });

  it('replaces a stored config without disturbing the rest of the row', async () => {
    await saveDomainCache({
      domain: DOMAIN,
      pageType: PAGE_TYPE,
      url: `https://${DOMAIN}/search`,
      interceptedRequests: [],
      fieldResults: {
        detail_url: { value: 'https://x.example/p/1', source: 'xpath', path: './/a/@href', confidence: 0.9 },
      },
      discoveredFieldNames: ['detail_url'],
      overallConfidence: 0.9,
      hasJsonLd: false,
      hasNextData: false,
    });
    await savePaginationConfig(DOMAIN, URL_PATTERN);

    await savePaginationConfig(DOMAIN, NEXT_BUTTON);

    const cache = await lookupDomainCache(DOMAIN, PAGE_TYPE);
    expect(cache?.paginationConfig).toEqual(NEXT_BUTTON);
    // The field paths this domain learned are not collateral damage of a
    // pagination write — the cache is an accumulator, not a snapshot.
    expect(Object.keys(cache?.fieldPaths ?? {})).toContain('detail_url');
  });

  it('writes to the listing partition, never the detail one', async () => {
    await savePaginationConfig(DOMAIN, URL_PATTERN);

    const detail = await lookupDomainCache(DOMAIN, 'detail');
    expect(detail?.paginationConfig ?? null).toBeNull();
  });
});
