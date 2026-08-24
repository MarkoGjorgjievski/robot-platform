import { describe, it, expect } from 'vitest';
import type { PaginationConfig } from '@robot/browser';
import { planRun } from './plan-run.js';
import { DETAIL_URL_FIELD } from './enumerate-detail-urls.js';
import { apiParamDeps, apiParamRequest, API_CONFIG } from './plan-run-api-param.fixtures.js';

describe('planRun — walking an api-param config', () => {
  it('enumerates detail URLs out of paged JSON without a page load per page', async () => {
    const deps = apiParamDeps({
      cachedConfig: API_CONFIG,
      pages: [
        ['https://listing.example/p/200001', 'https://listing.example/p/200002'],
        ['https://listing.example/p/300001'],
      ],
    });

    const outcome = await planRun(apiParamRequest({ maxPages: 3, maxItems: 50 }), deps);

    const detailUrls = outcome.items.filter((i) => i.kind === 'detail').map((i) => i.url);
    expect(detailUrls).toContain('https://listing.example/p/200001');
    expect(detailUrls).toContain('https://listing.example/p/300001');
    // One evaluate for the whole walk — not one per page, and no browser.crawl().
    expect(deps.evaluateCalls).toHaveLength(1);
    expect(deps.crawlCalls).toHaveLength(0);
  });

  it('substitutes {N} with the value the probe verified', async () => {
    const deps = apiParamDeps({ cachedConfig: API_CONFIG, pages: [['https://listing.example/p/200001']] });

    await planRun(apiParamRequest({ maxPages: 3, maxItems: 50 }), deps);

    // step is 2 in API_CONFIG, so page 2 asks for offset=2 and page 3 for offset=4.
    expect(deps.fetchedUrls[0]).toContain('offset=2');
    expect(deps.fetchedUrls[1]).toContain('offset=4');
  });

  it('a page that returns nothing new ends the walk and caches nothing', async () => {
    // Cold: detection probes and verifies, then the walk fetches and gets
    // nothing. `gained` is 0, so the verify-before-cache rule must refuse to
    // store the config even though detection itself succeeded.
    const deps = apiParamDeps({ cachedConfig: null, pages: [[]] });

    await planRun(apiParamRequest({ maxPages: 3, maxItems: 50 }), deps);

    expect(deps.saved).toEqual([]);
    // Pin WHICH walker produced that nothing. Without this the test passes under
    // the HTML walker too — its stubbed crawl generator also yields nothing, so
    // `gained === 0` either way and `saved === []` cannot tell them apart. The
    // claim being made here is about the api-param path specifically.
    expect(deps.crawlCalls).toHaveLength(0);
    expect(deps.fetchedUrls.length).toBeGreaterThan(0);
  });
});
