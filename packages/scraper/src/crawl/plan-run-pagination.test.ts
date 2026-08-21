import { describe, it, expect, vi } from 'vitest';
import type { CrawlOptions, PageCapture, PaginationConfig } from '@robot/browser';
import { planRun, type PlanRunDeps, type PlanRunRequest } from './plan-run.js';
import { DETAIL_URL_FIELD } from './enumerate-detail-urls.js';
import { fakeDeps, fakeRequest, listingHtml, CACHED_CONFIG } from './plan-run-pagination.fixtures.js';

describe('planRun — pagination config cache', () => {
  it('uses the stored config instead of detecting again', async () => {
    const detect = vi.fn();
    const deps = fakeDeps({
      cachedConfig: CACHED_CONFIG,
      agent: { detectPagination: detect },
    });

    await planRun(fakeRequest({ maxPages: 3, maxItems: 50 }), deps);

    // The whole point: a warm domain does not re-roll detection.
    expect(detect).not.toHaveBeenCalled();
    expect(deps.crawlCalls[0]?.paginationConfig).toEqual(CACHED_CONFIG);
  });

  it('detects from the capture when the domain is cold', async () => {
    const deps = fakeDeps({ cachedConfig: null });

    await planRun(fakeRequest({ maxPages: 3, maxItems: 50 }), deps);

    // listingHtml carries a rel=next link, so mechanical detection answers.
    expect(deps.crawlCalls[0]?.paginationConfig).toBeTruthy();
  });

  it('looks the config up under the listing partition', async () => {
    const lookup = vi.fn().mockResolvedValue(null);
    const deps = fakeDeps({ cachedConfig: null, lookupCache: lookup });

    await planRun(fakeRequest({ maxPages: 3, maxItems: 50 }), deps);

    expect(lookup).toHaveBeenCalledWith('listing.example', 'listing');
  });
});

describe('planRun — pagination cache lookup failure isolation', () => {
  it('treats a rejected cache lookup as a cold domain and keeps planning the rest of the plan', async () => {
    // A cache is advisory everywhere else in this codebase (listing capture,
    // page-level extract, the crawl walk all degrade to a warning + continue).
    // A DB blip on THIS lookup must not be the one exception that aborts every
    // remaining, unrelated input.
    const lookup = vi.fn().mockRejectedValue(new Error('db unreachable'));
    let extractCalls = 0;

    const request = {
      source: {
        listingMode: 'listing_to_detail',
        inputStrategy: 'direct',
        urlTemplate: null,
        budget: { max_pages: 3, max_items: 50, mode: 'first_n' },
      },
      schema: [{ name: DETAIL_URL_FIELD, type: 'url', origin: 'listing' }],
      inputSet: {
        columns: [{ name: 'url', primary: true }],
        rows: [
          { url: 'https://listing.example/search' },
          { url: 'https://listing.example/search-2' },
        ],
      },
    } as unknown as PlanRunRequest;

    const deps: PlanRunDeps = {
      browser: {
        capture: async (url: string) => ({
          url,
          html: listingHtml,
          screenshot: '',
          screenshotTiles: [],
          interceptedRequests: [],
        }) as unknown as PageCapture,
        async *crawl(_url: string, _options: CrawlOptions) {
          // No page 2 in this fixture -- only the lookup-failure path matters here.
        },
      } as unknown as PlanRunDeps['browser'],
      agent: null,
      extract: (async () => {
        extractCalls++;
        // A distinct detail URL per call so input 2's row is never mistaken
        // for a duplicate of input 1's -- that would stop it before it ever
        // reaches the pagination block this test is about.
        const url = `https://listing.example/p/${extractCalls}`;
        return {
          data: [{ [DETAIL_URL_FIELD]: url }],
          rows: [{ [DETAIL_URL_FIELD]: url }],
          plan: { row_xpath: '//a', fields: [{ name: DETAIL_URL_FIELD, xpath: './@href' }] },
          confidence: 1,
          sources: {},
          fieldCount: { found: 1, total: 1 },
          fieldsByTier: { requested: [], discovered: [] },
          cacheHit: false,
        };
      }) as unknown as PlanRunDeps['extract'],
      acquireLock: async () => () => {},
      lookupCache: lookup as unknown as PlanRunDeps['lookupCache'],
    };

    const outcome = await planRun(request, deps);

    expect(outcome.errors).toEqual([]);
    expect(outcome.inputs.map((i) => i.status)).toEqual(['planned', 'planned']);
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(outcome.warnings.some((w) => w.includes('pagination cache lookup failed'))).toBe(true);
  });
});

describe('planRun — writing the config back', () => {
  it('stores a freshly detected config once its walk produced new items', async () => {
    const deps = fakeDeps({ cachedConfig: null, pages: [['https://listing.example/p/3']] });

    await planRun(fakeRequest({ maxPages: 3, maxItems: 50 }), deps);

    expect(deps.saved).toHaveLength(1);
    expect(deps.saved[0]?.strategy).toBe('url-pattern');
  });

  it('stores NOTHING when the walk produced no new items', async () => {
    // A detected config that yields nothing is a false positive — a carousel
    // arrow, or a selector for an element that is not on the page. Caching it
    // would make every later run on this domain replay a known-bad answer.
    const deps = fakeDeps({ cachedConfig: null, pages: [[]] });

    await planRun(fakeRequest({ maxPages: 3, maxItems: 50 }), deps);

    expect(deps.saved).toEqual([]);
  });

  it('stores NOTHING when page 2 only re-serves URLs page 1 already produced', async () => {
    // The case above yields no page at all. THIS is the one that actually bites:
    // a page 2 that exists, extracts fine, and hands back the same products —
    // the signature of a site that clamps an out-of-range page number back to
    // page 1, and of a "next" selector that never moved. `gained` must count
    // NEW items, not extracted rows, or every such site caches a config that
    // walks in a circle forever.
    const deps = fakeDeps({
      cachedConfig: null,
      pages: [['https://listing.example/p/1', 'https://listing.example/p/2']],
    });

    await planRun(fakeRequest({ maxPages: 3, maxItems: 50 }), deps);

    expect(deps.saved).toEqual([]);
  });

  it('does not rewrite a cached config that worked', async () => {
    // It is already stored and already correct; a write here is pure noise.
    const deps = fakeDeps({ cachedConfig: CACHED_CONFIG, pages: [['https://listing.example/p/3']] });

    await planRun(fakeRequest({ maxPages: 3, maxItems: 50 }), deps);

    expect(deps.saved).toEqual([]);
  });
});

describe('planRun — a stale cached config', () => {
  it('re-detects and retries once when the cached config yields nothing', async () => {
    // First walk (cached config): nothing. Second walk (fresh config): items.
    const deps = fakeDeps({
      cachedConfig: CACHED_CONFIG,
      pages: [[], ['https://listing.example/p/9']],
    });

    const outcome = await planRun(fakeRequest({ maxPages: 3, maxItems: 50 }), deps);

    expect(deps.crawlCalls).toHaveLength(2);
    // The retry must not reuse the config that just failed.
    expect(deps.crawlCalls[1]?.paginationConfig).not.toEqual(CACHED_CONFIG);
    // And the replacement is stored only because its own walk verified it.
    expect(deps.saved).toHaveLength(1);
    expect(outcome.items.some((i) => i.url === 'https://listing.example/p/9')).toBe(true);
  });

  it('gives up after ONE retry rather than looping', async () => {
    const deps = fakeDeps({ cachedConfig: CACHED_CONFIG, pages: [[], []] });

    await planRun(fakeRequest({ maxPages: 3, maxItems: 50 }), deps);

    expect(deps.crawlCalls).toHaveLength(2);
    // A re-detection that also produced nothing is not evidence of anything:
    // the stored config stays, and a human sees the warning.
    expect(deps.saved).toEqual([]);
  });

  it('does not retry when the config that failed was freshly detected', async () => {
    // Re-detecting would just produce the same answer from the same capture.
    const deps = fakeDeps({ cachedConfig: null, pages: [[]] });

    await planRun(fakeRequest({ maxPages: 3, maxItems: 50 }), deps);

    expect(deps.crawlCalls).toHaveLength(1);
  });
});
