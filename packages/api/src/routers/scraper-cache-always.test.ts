// packages/api/src/routers/scraper-cache-always.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db, domainIntelligence } from '@robot/db';
import { eq } from 'drizzle-orm';
import { saveDomainCache, resolveFromCache, lookupDomainCache } from '@robot/scraper';

const DOMAIN = 'cache-always-consulted.example';
const PAGE_TYPE = 'detail';

async function cleanup() {
  await db.delete(domainIntelligence).where(eq(domainIntelligence.domain, DOMAIN));
}
beforeEach(cleanup);
afterEach(cleanup);

describe('cache is consulted regardless of consecutiveFailures', () => {
  it('still resolves a cached field after many consecutive failures', async () => {
    await saveDomainCache({
      domain: DOMAIN, pageType: PAGE_TYPE, url: `https://${DOMAIN}/p/1`, interceptedRequests: [],
      fieldResults: { title: { value: 'Seed', source: 'json-ld', path: '$.name', confidence: 0.9 } },
      discoveredFieldNames: ['title'],
      overallConfidence: 0.9, hasJsonLd: true, hasNextData: false,
    });
    for (let i = 0; i < 6; i++) {
      await saveDomainCache({
        domain: DOMAIN, pageType: PAGE_TYPE, url: `https://${DOMAIN}/p/1`, interceptedRequests: [],
        fieldResults: {}, discoveredFieldNames: ['title'],
        overallConfidence: 0, hasJsonLd: true, hasNextData: false,
      });
    }

    const cache = await lookupDomainCache(DOMAIN, PAGE_TYPE);
    expect(cache).not.toBeNull();
    expect(cache!.consecutiveFailures).toBeGreaterThanOrEqual(5);

    const out = resolveFromCache(cache!.fieldPaths, { title: 'Live Value' }, ['title']);
    expect(out.resolved['title']).toBeDefined();
    expect(out.resolved['title'].value).toBe('Live Value');
  });
});
