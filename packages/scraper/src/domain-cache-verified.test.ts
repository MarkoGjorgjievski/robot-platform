import { describe, it, expect, afterEach } from 'vitest';
import { db, domainIntelligence } from '@robot/db';
import { and, eq, inArray } from 'drizzle-orm';
import { saveVerifiedPaths, lookupVerifiedPaths, recordVerifiedPathStats, lookupDomainCache, prunePaths, sourceAuthority } from './domain-cache.js';
import { extractBrand } from './domain-utils.js';

const D = 'test-verified.example';
// Shares the 'test-verified' brand token with D (extractBrand('test-verified.co.uk')
// === extractBrand('test-verified.example')) — used to prove lookupVerifiedPaths does
// NOT fall back to a related domain the way lookupDomainCache does.
const D2 = 'test-verified.co.uk';
afterEach(async () => { await db.delete(domainIntelligence).where(inArray(domainIntelligence.domain, [D, D2])); });

describe('verified paths in the domain cache', () => {
  it('saves under the concept with source verified, ranks human above and everything else below', async () => {
    await saveVerifiedPaths(D, 'detail', { price: [{ source: 'api', path: 'item.priceCents', transform: 'cents_to_units' }] }, 'https://x/1');
    const paths = await lookupVerifiedPaths(D, 'detail', 'price');
    expect(paths).toEqual([{ source: 'api', path: 'item.priceCents', transform: 'cents_to_units' }]);
    const cache = await lookupDomainCache(D, 'detail');
    expect(cache!.fieldPaths.price!.paths[0]).toMatchObject({ source: 'verified', path: 'item.priceCents', transform: 'cents_to_units', hits: 0, misses: 0 });
    expect(sourceAuthority('verified')).toBeGreaterThan(sourceAuthority('json-ld'));
    expect(sourceAuthority('verified')).toBeLessThan(sourceAuthority('human'));
  });
  it('re-saving the same path keeps its counters; the prune never drops a verified path', async () => {
    await saveVerifiedPaths(D, 'detail', { price: [{ source: 'api', path: 'p', transform: 'identity' }] }, 'https://x/1');
    await recordVerifiedPathStats(D, 'detail', [{ concept: 'price', path: { source: 'api', path: 'p', transform: 'identity' }, hit: false }, { concept: 'price', path: { source: 'api', path: 'p', transform: 'identity' }, hit: false }]);
    await saveVerifiedPaths(D, 'detail', { price: [{ source: 'api', path: 'p', transform: 'identity' }] }, 'https://x/2');
    const cache = await lookupDomainCache(D, 'detail');
    const p = cache!.fieldPaths.price!.paths[0]!;
    expect(p.misses).toBe(2);
    expect(prunePaths([{ ...p, hits: 0, misses: 50 }])).toHaveLength(1);
  });
  it('orders untried paths by the certification tie-break, then re-ranks by hit rate on a miss', async () => {
    await saveVerifiedPaths(D, 'detail', {
      price: [
        { source: 'xpath', path: '//div[@class="price"]', transform: 'identity' },
        { source: 'json-ld', path: 'offers.price', transform: 'identity' },
        { source: 'api', path: 'a.b', transform: 'identity' },
      ],
    }, 'https://x/1');

    let paths = await lookupVerifiedPaths(D, 'detail', 'price');
    expect(paths.map((p) => p.source)).toEqual(['api', 'json-ld', 'xpath']);

    await recordVerifiedPathStats(D, 'detail', [
      { concept: 'price', path: { source: 'api', path: 'a.b', transform: 'identity' }, hit: false },
    ]);
    paths = await lookupVerifiedPaths(D, 'detail', 'price');
    expect(paths[0]!.source).toBe('json-ld');
    expect(paths[paths.length - 1]!.source).toBe('api');
  });
  it('reads the exact (domain, pageType) row only — no brand fallback to a related domain', async () => {
    expect(extractBrand(D2)).toBe(extractBrand(D)); // sanity: D and D2 really do share a brand
    await saveVerifiedPaths(D, 'detail', { price: [{ source: 'api', path: 'p', transform: 'identity' }] }, 'https://x/1');
    const paths = await lookupVerifiedPaths(D2, 'detail', 'price');
    expect(paths).toEqual([]);
  });
});
