import { describe, it, expect, afterEach } from 'vitest';
import { db, domainIntelligence } from '@robot/db';
import { and, eq } from 'drizzle-orm';
import { saveVerifiedPaths, lookupVerifiedPaths, recordVerifiedPathStats, lookupDomainCache, prunePaths, sourceAuthority } from './domain-cache.js';

const D = 'test-verified.example';
afterEach(async () => { await db.delete(domainIntelligence).where(eq(domainIntelligence.domain, D)); });

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
});
