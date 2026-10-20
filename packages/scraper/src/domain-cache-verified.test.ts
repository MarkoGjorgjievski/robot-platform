import { describe, it, expect, afterEach, vi } from 'vitest';
import type { IBrowser, PageCapture } from '@robot/browser';
import { db, domainIntelligence } from '@robot/db';
import { and, eq, inArray } from 'drizzle-orm';
import { saveVerifiedPaths, lookupVerifiedPaths, recordVerifiedPathStats, lookupDomainCache, prunePaths, sourceAuthority } from './domain-cache.js';
import { extractBrand } from './domain-utils.js';
import { runVerification } from './verify/run-verification.js';
import { readsOneSource } from './verify/certify.js';

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
  // M1: `verified` paths bypass the general prune and the five-path cap
  // (isProtectedPath), which is right — statistics must not delete proof —
  // but it left the list unbounded: every re-verify that certifies a slightly
  // different path grows the concept forever, and each one is probed on every
  // extraction. saveVerifiedPaths caps it at MAX_CERTIFIED_PATHS.
  it('caps a concept at five verified paths, dropping the worst-performing ones', async () => {
    const p = (i: number) => ({ source: 'api' as const, path: `a.p${i}`, transform: 'identity' as const });
    await saveVerifiedPaths(D, 'detail', { price: [p(1), p(2), p(3), p(4), p(5)] }, 'https://x/1');

    // Two of the five now miss reliably; the other three stay untried, which
    // counts as a perfect rate.
    await recordVerifiedPathStats(D, 'detail', [
      { concept: 'price', path: p(2), hit: false },
      { concept: 'price', path: p(4), hit: false },
    ]);

    // A path from another source in the same concept must survive the cap.
    const [row] = await db.select().from(domainIntelligence)
      .where(and(eq(domainIntelligence.domain, D), eq(domainIntelligence.pageType, 'detail')));
    const fieldPaths = row!.fieldPaths as Record<string, { paths: Record<string, unknown>[] }>;
    fieldPaths.price!.paths.push({ path: '//legacy', source: 'xpath', confidence: 0.5, hits: 3, misses: 0, lastValue: null, lastUsedAt: new Date().toISOString() });
    await db.update(domainIntelligence).set({ fieldPaths }).where(eq(domainIntelligence.id, row!.id));

    await saveVerifiedPaths(D, 'detail', { price: [p(6), p(7)] }, 'https://x/2');

    const paths = await lookupVerifiedPaths(D, 'detail', 'price');
    expect(paths).toHaveLength(5);
    expect(paths.map((x) => x.path).sort()).toEqual(['a.p1', 'a.p3', 'a.p5', 'a.p6', 'a.p7']);

    const cache = await lookupDomainCache(D, 'detail');
    const stored = cache!.fieldPaths.price!.paths;
    expect(stored.filter((x) => x.source === 'verified')).toHaveLength(5);
    expect(stored.some((x) => x.path === '//legacy' && x.source === 'xpath')).toBe(true);
  });

  // Final review, Important: a re-Verify's certification is what the store keeps. Ikea held five API
  // siblings at 100 %; the re-Verify certified api price, json-ld offers.price, api priceExclTax, and the
  // cap by hit rate (API first on a tie) dropped the new JSON-LD backup, so every Verify searched again.
  describe('a re-Verify keeps its certified paths (final review, one-source)', () => {
    const api = (path: string) => ({ source: 'api' as const, path, transform: 'identity' as const });
    const ld = { source: 'json-ld' as const, path: 'offers.price', transform: 'identity' as const };
    const siblings = ['price', 'priceNumeral', 'priceExclTax', 'salesPrice', 'amount'].map(api);
    const seed = async (missing: string[] = []) => {
      await saveVerifiedPaths(D, 'detail', { price: siblings }, 'https://x/1');
      await recordVerifiedPathStats(D, 'detail', siblings.flatMap((p) => Array.from({ length: 4 }, () => ({ concept: 'price', path: p, hit: true }))));
      await recordVerifiedPathStats(D, 'detail', missing.map((path) => ({ concept: 'price', path: api(path), hit: false })));
    };
    const ids = (ps: ReadonlyArray<{ source: string; path: string }>) => ps.map((p) => `${p.source} ${p.path}`);

    it('the Ikea store keeps the new JSON-LD backup beside the API siblings', async () => {
      await seed();
      await saveVerifiedPaths(D, 'detail', { price: [api('price'), ld, api('priceExclTax')] }, 'https://x/2');
      const paths = ids(await lookupVerifiedPaths(D, 'detail', 'price'));
      expect(paths).toHaveLength(5);
      expect(paths).toEqual(expect.arrayContaining(['api price', 'json-ld offers.price', 'api priceExclTax']));
    });

    it('a store whose first path has misses keeps the newly certified first path', async () => {
      await seed(['price']);
      await saveVerifiedPaths(D, 'detail', { price: [api('price'), ld, api('priceExclTax')] }, 'https://x/2');
      const paths = ids(await lookupVerifiedPaths(D, 'detail', 'price'));
      expect(paths).toHaveLength(5);
      expect(paths).toEqual(expect.arrayContaining(['api price', 'json-ld offers.price', 'api priceExclTax']));
    });

    it('a second Verify on the saved store takes the cache shortcut: no search, and not one source', async () => {
      await seed();
      await saveVerifiedPaths(D, 'detail', { price: [api('price'), ld, api('priceExclTax')] }, 'https://x/2');
      const P = [1295, 349, 59];
      const urls = P.map((_, i) => `https://www.ikea.com/my/en/p/${i + 1}/`);
      const captures = Object.fromEntries(urls.map((u, i) => [u, {
        url: u, html: '<html></html>',
        structuredData: { ldJson: [{ '@type': 'Product', offers: { price: `${P[i]}.00` } }], nextData: null, initialState: null, meta: {} },
        interceptedRequests: [{ url: `https://www.ikea.com/my/en/products/${i + 1}.json`, method: 'GET', status: 200, isJson: true, parsedJson: Object.fromEntries(siblings.map((s) => [s.path, P[i]])) }],
      }])) as unknown as Record<string, PageCapture>;
      const noSearch = { setContentEvaluate: async () => { throw new Error('searched the pages again although the stored certification reads two sources'); } } as unknown as IBrowser;
      const agent = { proposePaths: vi.fn(async () => { throw new Error('the AI must not be called'); }) };
      const run = await runVerification(
        { fields: [{ key: 'price', name: 'Price', type: 'money', description: 'price', concept: 'price' }], verificationSet: { urls, expected: { price: Object.fromEntries(urls.map((u, i) => [u, String(P[i])])) } } },
        { browser: noSearch, agent, captures, cachedPaths: (concept) => lookupVerifiedPaths(D, 'detail', concept) },
      );
      const certified = run.outcome.fields.price!.certified;
      expect(ids(certified)).toContain('json-ld offers.price');
      expect(readsOneSource(certified)).toBe(false);
      expect(agent.proposePaths).not.toHaveBeenCalled();
    });
  });

  it('reads the exact (domain, pageType) row only — no brand fallback to a related domain', async () => {
    expect(extractBrand(D2)).toBe(extractBrand(D)); // sanity: D and D2 really do share a brand
    await saveVerifiedPaths(D, 'detail', { price: [{ source: 'api', path: 'p', transform: 'identity' }] }, 'https://x/1');
    const paths = await lookupVerifiedPaths(D2, 'detail', 'price');
    expect(paths).toEqual([]);
  });
});
