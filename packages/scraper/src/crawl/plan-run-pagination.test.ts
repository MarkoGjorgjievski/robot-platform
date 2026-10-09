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
          verdict: { kind: 'ok', status: 200 },
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
    expect(deps.saved[0]?.config.strategy).toBe('url-pattern');
  });

  it('keys the stored config by hostname, not by the start URL', async () => {
    // `savePagination(paginationDomain, …)` and `savePagination(start.url, …)`
    // are one token apart and both compile. Only the hostname is readable again:
    // the read side is `lookupDomainCache(new URL(start.url).hostname, 'listing')`.
    // Write a full URL here and the cache silently never warms again — which is
    // invisible unless a test looks at the domain argument.
    const deps = fakeDeps({ cachedConfig: null, pages: [['https://listing.example/p/3']] });

    await planRun(fakeRequest({ maxPages: 3, maxItems: 50 }), deps);

    expect(deps.saved.map((s) => s.domain)).toEqual(['listing.example']);
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

describe('planRun — a walk that mostly re-fetched page 1', () => {
  it('refuses to cache when the walk gained only a trickle and the budget was not what stopped it', async () => {
    // The AbeBooks shape, live-proven 2026-08-21: `deriveTemplate` pinned the
    // real pager (`p=1`) and paged the `ds` filter instead, so pages 2 and 3
    // re-served page 1. Three stray items leaked past dedupe — enough to satisfy
    // `gained > 0`, so a broken template reached the cross-customer cache and had
    // to be purged by hand. The budget-aware signal makes this refusable without
    // the false negative: a thin gain is only damning when the pager had room to
    // deliver and didn't.
    const deps = fakeDeps({
      page1: Array.from({ length: 10 }, (_, i) => `https://listing.example/p/${i + 1}`),
      cachedConfig: null,
      pages: [['https://listing.example/p/99']],
    });

    const outcome = await planRun(fakeRequest({ maxPages: 3, maxItems: 50 }), deps);

    const thin = outcome.warnings.find((w) => w.includes('gained only'));
    expect(thin).toBeDefined();
    // Evidence an operator can act on: the URL, page 1's yield, the walk's gain,
    // and which strategy produced it.
    expect(thin).toContain('https://listing.example/search');
    expect(thin).toContain('page 1 yielded 10');
    expect(thin).toContain('gained only 1');
    expect(thin).toContain('url-pattern');
    expect(thin).toContain('not cached');
    // The refusal is about the CONFIG, not the walk's items: a URL that passed
    // dedupe is real work regardless of how it was found.
    expect(deps.saved).toEqual([]);
    expect(outcome.items.some((i) => i.url === 'https://listing.example/p/99')).toBe(true);
  });

  it('still caches — and does not warn — when the walk was cut short by the item budget', async () => {
    // This is the shape the refusal must never touch: `absorb` passes
    // `remaining: cap - detailCount()` down, so a WORKING pager on a nearly-full
    // budget legitimately returns one item. Refusing here would mean the cache
    // never warms on this repo's own default `{max_items: 8, max_pages: 2}`.
    const deps = fakeDeps({
      page1: Array.from({ length: 20 }, (_, i) => `https://listing.example/p/${i + 1}`),
      cachedConfig: null,
      pages: [['https://listing.example/p/91', 'https://listing.example/p/92', 'https://listing.example/p/93']],
    });

    const outcome = await planRun(fakeRequest({ maxPages: 3, maxItems: 21 }), deps);

    expect(outcome.warnings.filter((w) => w.includes('gained only'))).toEqual([]);
    expect(outcome.warnings).toContain('budget reached: 21 items');
    expect(deps.saved).toHaveLength(1);
  });

  it('does not let a thin re-detected walk overwrite the stored config on the stale path', async () => {
    // The stale path re-detects when a cached config gains nothing, and its save
    // shares the same gate. A replacement config whose own walk was thin is not
    // better evidence than the config it would overwrite — leave the stored one
    // for the operator, who is already being warned twice here.
    const deps = fakeDeps({
      page1: Array.from({ length: 10 }, (_, i) => `https://listing.example/p/${i + 1}`),
      cachedConfig: CACHED_CONFIG,
      pages: [[], ['https://listing.example/p/99']],
    });

    const outcome = await planRun(fakeRequest({ maxPages: 3, maxItems: 50 }), deps);

    expect(deps.crawlCalls).toHaveLength(2);
    expect(deps.saved).toEqual([]);
    expect(outcome.warnings.some((w) => w.includes('gained only'))).toBe(true);
  });
});

describe('planRun — overwriting a stored config', () => {
  it('names the config it replaced when the stale path writes a new one', async () => {
    // Spec §4 accepts one-config-per-domain collisions on the premise that "the
    // thrash is visible — each overwrite is preceded by a warning naming the
    // URL". As implemented that was false: the retry reassigns `gained` before
    // the `gained === 0` check, so the overwrite happened in total silence.
    // (`savePaginationConfig`'s console.log never reaches outcome.warnings, so
    // it never reaches runs.logs either.)
    const deps = fakeDeps({
      cachedConfig: CACHED_CONFIG,
      pages: [[], ['https://listing.example/p/9']],
    });

    const outcome = await planRun(fakeRequest({ maxPages: 3, maxItems: 50 }), deps);

    expect(deps.saved).toHaveLength(1);
    const overwrite = outcome.warnings.find((w) => w.includes('replacing'));
    expect(overwrite).toBeDefined();
    expect(overwrite).toContain(CACHED_CONFIG.strategy); // the config being lost
    expect(overwrite).toContain('url-pattern');          // the one taking its place
    expect(overwrite).toContain('https://listing.example/search');
    expect(overwrite).toContain('listing.example');
  });
});

describe('planRun — a cache WRITE that fails', () => {
  it('still reports the input as planned, with a warning rather than an error', async () => {
    // Symmetry with the read side (which already degrades to a warning): by the
    // time savePagination runs, the walk is done and every detail URL is already
    // in `items`. A DB blip on a bookkeeping write must not relabel a completed
    // input as failed — phase 2 would then be told to skip work that exists.
    const deps = fakeDeps({
      cachedConfig: null,
      pages: [['https://listing.example/p/3']],
      savePagination: (async () => { throw new Error('db unreachable'); }) as PlanRunDeps['savePagination'],
    });

    const outcome = await planRun(fakeRequest({ maxPages: 3, maxItems: 50 }), deps);

    expect(outcome.errors).toEqual([]);
    expect(outcome.inputs.map((i) => i.status)).toEqual(['planned']);
    expect(outcome.items.some((i) => i.url === 'https://listing.example/p/3')).toBe(true);
    expect(outcome.warnings.some((w) => w.includes('pagination cache save failed'))).toBe(true);
  });
});
