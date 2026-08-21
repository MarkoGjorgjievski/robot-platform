import { describe, it, expect, vi } from 'vitest';
import type { PaginationConfig } from '@robot/browser';
import { planRun } from './plan-run.js';
import { fakeDeps, fakeRequest, CACHED_CONFIG } from './plan-run-pagination.fixtures.js';

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
