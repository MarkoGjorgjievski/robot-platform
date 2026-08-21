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
