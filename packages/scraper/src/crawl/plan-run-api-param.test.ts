

















import { describe, it, expect } from 'vitest';
import type { PaginationConfig } from '@robot/browser';
import { planRun } from './plan-run.js';
import { DETAIL_URL_FIELD } from './enumerate-detail-urls.js';
import { apiParamDeps, apiParamRequest, API_CONFIG, PAGE_STYLE_CONFIG, PAGE1 } from './plan-run-api-param.fixtures.js';

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

  it('warns with the endpoint and candidates tried when api-param is attempted but nothing verifies', async () => {
    // `ApiParamDetection.tried` used to be built and dropped on the floor —
    // this is the "raw material for tuning the heuristics from real traffic"
    // the spec asks for, and it must land in `outcome.warnings` (and so in
    // `runs.logs`) rather than vanish. Setting the probe response to PAGE1's
    // own items makes every candidate fail verification (full overlap), so
    // detection is attempted and rejects everything — the case the warning
    // exists for.
    const deps = apiParamDeps({ cachedConfig: null, probe: PAGE1 });

    const outcome = await planRun(apiParamRequest({ maxPages: 3, maxItems: 50 }), deps);

    const warning = outcome.warnings.find((w) => w.includes('api-param pagination not verified'));
    expect(warning).toBeDefined();
    expect(warning).toContain('https://listing.example/api?kn=py&offset=0');
    expect(warning).toContain('offset+');
  });

  it('starts the walk at the value the probe verified, not at page 1 over again', async () => {
    // Fix 1. `probeUrl` verifies `from + step`; the template discards `from`,
    // so a walk built from `step * (page - 1)` alone re-requests page 1's own
    // parameter value and stops one page short of maxPages. Page-style pagers
    // start at 1, so the whole walk is shifted a page late.
    const deps = apiParamDeps({
      cachedConfig: PAGE_STYLE_CONFIG,
      pages: [['https://listing.example/p/200001'], ['https://listing.example/p/300001']],
    });

    await planRun(apiParamRequest({ maxPages: 3, maxItems: 50 }), deps);

    expect(deps.fetchedUrls[0]).toContain('page=2');
    expect(deps.fetchedUrls[1]).toContain('page=3');
    // And nothing asks for page 1 again.
    expect(deps.fetchedUrls.some((u) => u.includes('page=1'))).toBe(false);
  });
});
