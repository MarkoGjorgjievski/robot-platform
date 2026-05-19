import { describe, it, expect, beforeEach } from 'vitest';
import { db, domainIntelligence } from '@robot/db';
import { eq, and } from 'drizzle-orm';
import { saveDomainCache, lookupDomainCache, resolveFromCache } from './domain-cache.js';

const DOMAIN = 'test-domain-completeness.example';
const PAGE_TYPE = 'detail';

async function cleanup() {
  await db.delete(domainIntelligence).where(
    and(eq(domainIntelligence.domain, DOMAIN), eq(domainIntelligence.pageType, PAGE_TYPE))
  );
}

describe('saveDomainCache — discovered-but-unresolved fields', () => {
  beforeEach(cleanup);

  it('persists empty-path entries for discovered fields that did not resolve', async () => {
    await saveDomainCache({
      domain: DOMAIN,
      pageType: PAGE_TYPE,
      interceptedRequests: [],
      fieldResults: {
        title: { value: 'Hello', source: 'json-ld', path: '$.name', confidence: 0.95 },
      },
      discoveredFieldNames: ['title', 'sizes', 'flavours'],
      overallConfidence: 0.33,
      hasJsonLd: true,
      hasNextData: false,
    });

    const cache = await lookupDomainCache(DOMAIN, PAGE_TYPE);
    expect(cache).not.toBeNull();
    expect(Object.keys(cache!.fieldPaths).sort()).toEqual(['flavours', 'sizes', 'title']);
    expect(cache!.fieldPaths['sizes'].paths).toEqual([]);
    expect(cache!.fieldPaths['flavours'].paths).toEqual([]);
    expect(cache!.fieldPaths['title'].paths.length).toBeGreaterThan(0);
  });

  it('does not prune empty-path entries on subsequent runs', async () => {
    await saveDomainCache({
      domain: DOMAIN,
      pageType: PAGE_TYPE,
      interceptedRequests: [],
      fieldResults: {},
      discoveredFieldNames: ['sizes'],
      overallConfidence: 0,
      hasJsonLd: false,
      hasNextData: false,
    });
    await saveDomainCache({
      domain: DOMAIN,
      pageType: PAGE_TYPE,
      interceptedRequests: [],
      fieldResults: {},
      discoveredFieldNames: ['sizes'],
      overallConfidence: 0,
      hasJsonLd: false,
      hasNextData: false,
    });
    const cache = await lookupDomainCache(DOMAIN, PAGE_TYPE);
    expect(cache!.fieldPaths['sizes']).toBeDefined();
    expect(cache!.fieldPaths['sizes'].paths).toEqual([]);
  });
});

describe('resolveFromCache — empty-path entries are skipped', () => {
  it('does not resolve empty-path entries — caller treats them as missing', () => {
    const fieldPaths = {
      sizes: { paths: [], conflictCount: 0 },
      title: {
        paths: [{
          path: '$.name',
          source: 'json-ld' as const,
          confidence: 0.9,
          hits: 5,
          misses: 0,
          lastValue: 'X',
          lastUsedAt: new Date().toISOString(),
        }],
        conflictCount: 0,
      },
    };
    const result = resolveFromCache(fieldPaths, { name: 'X', title: 'X' }, ['sizes', 'title']);
    expect(result.resolved['sizes']).toBeUndefined();
    expect(result.resolved['title']).toBeDefined();
  });
});
