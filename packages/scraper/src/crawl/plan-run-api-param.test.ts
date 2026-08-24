































































































import { describe, it, expect } from 'vitest';
import type { PaginationConfig } from '@robot/browser';
import { planRun } from './plan-run.js';
import { DETAIL_URL_FIELD } from './enumerate-detail-urls.js';
import { apiParamDeps, apiParamRequest, API_CONFIG, PAGE_STYLE_CONFIG, UNRELATED_API, PAGE1 } from './plan-run-api-param.fixtures.js';

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

  it('warns with the endpoint and candidates tried when candidates were probed and none verified', async () => {
    // `ApiParamDetection.tried` used to be built and dropped on the floor —
    // this is the "raw material for tuning the heuristics from real traffic"
    // the spec asks for, and it must land in `outcome.warnings` (and so in
    // `runs.logs`) rather than vanish. Setting the probe response to PAGE1's
    // own items makes every candidate fail verification (full overlap), so
    // detection is attempted and rejects everything — the case the warning
    // exists for.
    const deps = apiParamDeps({ cachedConfig: null, probe: PAGE1 });

    const outcome = await planRun(apiParamRequest({ maxPages: 3, maxItems: 50 }), deps);

    const warning = outcome.warnings.find((w) => w.includes('api-param pagination not applied'));
    expect(warning).toBeDefined();
    expect(warning).toContain('https://listing.example/api?kn=py&offset=0');
    expect(warning).toContain('offset+');
    expect(warning).toContain('none returned a genuinely different page');
    expect(warning).toContain('1 intercepted JSON response(s) considered');
  });

  it('names a listing-API miss instead of reporting nothing at all', async () => {
    // The live Newegg gap. api-param did not apply, mechanical pagination
    // answered instead, and the only line in `runs.logs` was "budget reached".
    // Task 5's warning covered "a listing API was found but nothing verified"
    // and nothing else, so "no listing API was found" — the case that actually
    // happened — was silent.
    const deps = apiParamDeps({ cachedConfig: null, intercepted: [UNRELATED_API] });

    const outcome = await planRun(apiParamRequest({ maxPages: 3, maxItems: 50 }), deps);

    const warning = outcome.warnings.find((w) => w.includes('api-param pagination not applied'));
    expect(warning).toBeDefined();
    expect(warning).toContain("no intercepted JSON response carried page 1's detail URLs");
    expect(warning).toContain('1 intercepted JSON response(s) considered');
  });

  it('stays silent when there was no JSON response to consider', async () => {
    // The other half of the same requirement. Most listings make no JSON XHR
    // at all; a warning on every one of them would drown the signal the two
    // tests above depend on.
    const deps = apiParamDeps({ cachedConfig: null, intercepted: [] });

    const outcome = await planRun(apiParamRequest({ maxPages: 3, maxItems: 50 }), deps);

    expect(outcome.warnings.some((w) => w.includes('api-param'))).toBe(false);
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

  it('stops at the first empty page instead of walking on past it', async () => {
    // Fix 2. The break on an empty page was unverified: the only test with
    // empty pages had them ALL empty, so continuing past the break changed
    // nothing. Page 2 is empty and page 3 is not.
    //
    // Note what this can and cannot prove. Absorbing p/500001 is ALREADY
    // impossible without the break: `absorb([])` returns `'empty-page'`, which
    // is a non-null stop and ends the loop on the next line. So the break's own
    // contribution is the line before it — an empty page must not be recorded
    // in the work list as a listing page that was walked. Deleting the break
    // pushes a `kind: 'listing'` item for a page that yielded nothing, and it
    // is that phantom page the second assertion pins.
    const deps = apiParamDeps({
      cachedConfig: API_CONFIG,
      pages: [[], ['https://listing.example/p/500001']],
    });

    const outcome = await planRun(apiParamRequest({ maxPages: 3, maxItems: 50 }), deps);

    const detailUrls = outcome.items.filter((i) => i.kind === 'detail').map((i) => i.url);
    expect(detailUrls).not.toContain('https://listing.example/p/500001');
    // Page 1 is the only listing page this run actually got anything from.
    expect(outcome.items.filter((i) => i.kind === 'listing').map((i) => i.pageNumber)).toEqual([1]);
    // Both URLs were still requested in the one batch — the break governs what
    // is absorbed and recorded, not how many URLs the batch asked for.
    expect(deps.fetchedUrls).toHaveLength(2);
  });

  it('does not call a budget-stopped walk a thin walk', async () => {
    // Fix 3. `budgetStopped` had no test: hard-coding it either way passed
    // everything. Page 1 yields 8 against a cap of 9, so the walk can absorb
    // exactly one more item before the cap bites — 1 < 8 * 0.25, which is the
    // thin-walk shape exactly. The item budget is what stopped it, so the
    // "likely re-serving page 1" warning must NOT fire.
    const page1 = Array.from({ length: 8 }, (_, i) => `https://listing.example/p/10000${i}`);
    const deps = apiParamDeps({
      cachedConfig: API_CONFIG,
      page1,
      pages: [['https://listing.example/p/200001', 'https://listing.example/p/200002', 'https://listing.example/p/200003']],
    });

    const outcome = await planRun(apiParamRequest({ maxPages: 3, maxItems: 9 }), deps);

    // The cap really did bite — otherwise this test would pass for the wrong
    // reason (a walk that was never thin in the first place).
    expect(outcome.warnings.some((w) => w.startsWith('budget reached: 9 items'))).toBe(true);
    expect(outcome.items.filter((i) => i.kind === 'detail')).toHaveLength(9);
    expect(outcome.warnings.some((w) => w.includes('likely re-serving page 1'))).toBe(false);
  });

  it('survives a cached api-param config that is missing its fields', async () => {
    // Fix 4. Unreachable from cold detection, but a legacy or corrupted cache
    // row can hold one. Without the guard `apiTemplate.replace(...)` throws on
    // undefined, the outer handler catches it, and this input is downgraded to
    // `status: 'error'` — losing page 1's already-planned items, which spec §3
    // says a pagination failure must never do.
    const deps = apiParamDeps({ cachedConfig: { strategy: 'api-param' } });

    const outcome = await planRun(apiParamRequest({ maxPages: 3, maxItems: 50 }), deps);

    expect(outcome.errors).toEqual([]);
    const detailUrls = outcome.items.filter((i) => i.kind === 'detail').map((i) => i.url);
    expect(detailUrls).toEqual(PAGE1);
    expect(outcome.inputs[0]?.status).toBe('planned');
  });

  it('numbers walked pages from 2, in fetch order', async () => {
    // Fix 5. `pageNumber = i + 2` was asserted nowhere, so an off-by-one would
    // have shipped invisibly — and pageNumber is what phase 2 and the results
    // browser attribute an item to.
    const deps = apiParamDeps({
      cachedConfig: API_CONFIG,
      pages: [['https://listing.example/p/200001'], ['https://listing.example/p/300001']],
    });

    const outcome = await planRun(apiParamRequest({ maxPages: 3, maxItems: 50 }), deps);

    const pageOf = new Map(
      outcome.items.filter((i) => i.kind === 'detail').map((i) => [i.url, i.pageNumber]),
    );
    expect(pageOf.get(PAGE1[0]!)).toBe(1);
    expect(pageOf.get('https://listing.example/p/200001')).toBe(2);
    expect(pageOf.get('https://listing.example/p/300001')).toBe(3);
  });
});
