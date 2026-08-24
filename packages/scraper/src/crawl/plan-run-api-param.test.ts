































































































import { describe, it, expect } from 'vitest';
import type { PaginationConfig } from '@robot/browser';
import { planRun, API_WALK_MAX_BATCH } from './plan-run.js';
import { DETAIL_URL_FIELD } from './enumerate-detail-urls.js';
import {
  apiParamDeps, apiParamRequest, API_CONFIG, PAGE_STYLE_CONFIG, UNRELATED_API, RELATIVE_URL_API, PAGE1,
  CROSS_ORIGIN_CONFIG, SLUG_PAGE1,
} from './plan-run-api-param.fixtures.js';

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


  it('refuses to fabricate detail URLs from bare slugs, and caches nothing when it does', async () => {
    // Fix 1, half one. Detection genuinely passes on a slug API: identifiers are
    // compared as trailing path segments, and `MIN_IDENTIFIER_LENGTH`'s own
    // comment blesses a pure slug as a comparison key. So the probe returns
    // different slugs, overlap is 0, the config verifies — and then the walk
    // turns "java-in-depth" into https://listing.example/java-in-depth when the
    // real URL is /books/java-in-depth. Spec §4: fall through rather than
    // fabricate.
    const deps = apiParamDeps({
      cachedConfig: null,
      page1: SLUG_PAGE1,
      probe: ['ruby-metaprogramming', 'elixir-in-action', 'clojure-applied'],
      pages: [['java-in-depth'], ['scala-with-cats']],
    });

    const outcome = await planRun(apiParamRequest({ maxPages: 3, maxItems: 50 }), deps);

    const detailUrls = outcome.items.filter((i) => i.kind === 'detail').map((i) => i.url);
    // Page 1's own work survives untouched — a pagination failure never costs it.
    expect(detailUrls).toEqual(SLUG_PAGE1);
    // And nothing outside the shape page 1 demonstrated was planned.
    expect(detailUrls.every((u) => u.startsWith('https://listing.example/books/'))).toBe(true);
    // The whole point: an unverifiable walk must not reach the domain cache.
    expect(deps.saved).toEqual([]);
    expect(outcome.warnings.some((w) => w.includes('not detail URLs for this listing'))).toBe(true);
  });

  it('refuses a page that MIXES in-shape and out-of-shape rows, rather than keeping the half it likes', async () => {
    // The refusal branch used to require `usable.length === 0`, so a page with
    // one good row and one bad one hit neither branch: the bad row was dropped
    // in silence, `gained` went up, and the config was written to the
    // cross-customer domain cache. That is the 2026-08-21 failure class
    // arriving through the fix written to prevent it, and it is reachable on
    // any listing whose detail URLs span two directories.
    const deps = apiParamDeps({
      cachedConfig: null,
      page1: SLUG_PAGE1,
      probe: ['ruby-metaprogramming', 'elixir-in-action', 'clojure-applied'],
      pages: [['/books/d-scala-primer', '/ebooks/e-elixir-primer']],
    });

    const outcome = await planRun(apiParamRequest({ maxPages: 3, maxItems: 50 }), deps);

    const detailUrls = outcome.items.filter((i) => i.kind === 'detail').map((i) => i.url);
    // The whole page is refused: the shape assumption is what failed, and the
    // rows that happen to fit it are not independently trustworthy.
    expect(detailUrls).toEqual(SLUG_PAGE1);
    expect(outcome.warnings.some((w) => w.includes('not detail URLs for this listing'))).toBe(true);
    expect(deps.saved).toEqual([]);
  });

  it('does not cache a config whose walk was refused on a LATER page', async () => {
    // The refusal comment leans on `gained` staying at 0 to keep the config out
    // of the cache — which only holds when page 2 is the page that was refused.
    // Refuse page 3 instead and `gained` is 1, so the verify-before-cache gate
    // waves through a config that has already been caught inventing URLs.
    const deps = apiParamDeps({
      cachedConfig: null,
      page1: SLUG_PAGE1,
      probe: ['ruby-metaprogramming', 'elixir-in-action', 'clojure-applied'],
      pages: [['/books/d-scala-primer'], ['/ebooks/e-elixir-primer']],
    });

    const outcome = await planRun(apiParamRequest({ maxPages: 3, maxItems: 50 }), deps);

    const detailUrls = outcome.items.filter((i) => i.kind === 'detail').map((i) => i.url);
    // Page 2 was clean, so its item is planned — the work is not thrown away.
    expect(detailUrls).toContain('https://listing.example/books/d-scala-primer');
    expect(detailUrls.some((u) => u.includes('/ebooks/'))).toBe(false);
    expect(outcome.warnings.some((w) => w.includes('not detail URLs for this listing'))).toBe(true);
    // But a config caught fabricating on ANY page is not a config to remember.
    expect(deps.saved).toEqual([]);
  });

  it('builds the shape from the rows enumeration KEPT, not from the raw extraction', async () => {
    // `page1Shape` was fed `listingRows.map(row => row[DETAIL_URL_FIELD])`,
    // unfiltered — while `enumerateDetailUrls` drops self-links, because a tier
    // answering with the page's own canonical URL is how the first live crawl
    // queued a category page as if it were a product. ONE such row is enough:
    // '#' resolves to the listing page, whose directory is '/', and
    // `commonDirectory` collapses the prefix for the whole walk to '/'. Every
    // guard downstream of the prefix then has nothing to hold, and the API's
    // own internal path is admitted as a detail URL.
    const deps = apiParamDeps({
      cachedConfig: null,
      page1: [...PAGE1, '#'],
      pages: [['/api/internal/v2/product/887766']],
    });

    const outcome = await planRun(apiParamRequest({ maxPages: 3, maxItems: 50 }), deps);

    const detailUrls = outcome.items.filter((i) => i.kind === 'detail').map((i) => i.url);
    // The junk anchor is a self-link and was never work; page 1's real URLs are.
    expect(detailUrls).toEqual(PAGE1);
    expect(detailUrls.some((u) => u.includes('/api/internal/'))).toBe(false);
    expect(outcome.warnings.some((w) => w.includes('not detail URLs for this listing'))).toBe(true);
    expect(deps.saved).toEqual([]);
  });

  it('resolves page 2+ URLs against the LISTING page, not the API endpoint', async () => {
    // Fix 1, half two. api.<site> fronting www.<site> is ordinary. Resolving a
    // row's "/p/200001" against the API response's own URL puts every page-2+
    // detail URL on the API host, gains > 0, and caches the config in silence.
    const deps = apiParamDeps({
      cachedConfig: CROSS_ORIGIN_CONFIG,
      pages: [['/p/200001', '/p/200002'], ['/p/300001']],
    });

    const outcome = await planRun(apiParamRequest({ maxPages: 3, maxItems: 50 }), deps);

    const detailUrls = outcome.items.filter((i) => i.kind === 'detail').map((i) => i.url);
    expect(detailUrls.length).toBeGreaterThan(PAGE1.length);
    for (const url of detailUrls) expect(new URL(url).origin).toBe('https://listing.example');
    expect(detailUrls).toContain('https://listing.example/p/200001');
    expect(detailUrls).toContain('https://listing.example/p/300001');
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

  it('says so when detection THREW rather than pretending nothing was considered', async () => {
    // `probeApiParam`'s catch returned NO_ATTEMPT, whose `considered: 0` is
    // documented to mean "there was genuinely nothing to consider" — the one
    // case the caller must stay silent about. So a swallowed throw produced
    // exactly zero operator signal, and looked identical to the commonest and
    // most boring outcome. The never-throw wrapper is right; reporting the throw
    // as a non-event is not.
    const deps = apiParamDeps({ cachedConfig: null, intercepted: [RELATIVE_URL_API] });

    const outcome = await planRun(apiParamRequest({ maxPages: 3, maxItems: 50 }), deps);

    const warning = outcome.warnings.find((w) => w.includes('api-param pagination not applied'));
    expect(warning).toBeDefined();
    expect(warning).toContain('detection threw');
    // Page 1's work is untouched — a detection bug must not cost it.
    expect(outcome.errors).toEqual([]);
    expect(outcome.items.filter((i) => i.kind === 'detail').map((i) => i.url)).toEqual(PAGE1);
  });

  it('says the api-param miss ONCE per domain, not once per input row', async () => {
    // The warning fires inside the per-input loop, so a 100-row InputSet against
    // one domain emitted 100 identical lines into `runs.logs` — the same
    // drowning-the-signal failure the `considered > 0` gate exists to prevent,
    // arriving by a different route. The reason is a property of the domain's
    // traffic, not of the input row.
    const deps = apiParamDeps({
      cachedConfig: null,
      intercepted: [UNRELATED_API],
      page1ByInput: {
        'https://listing.example/a': ['https://listing.example/p/100001', 'https://listing.example/p/100002'],
        'https://listing.example/b': ['https://listing.example/p/200001', 'https://listing.example/p/200002'],
      },
    });

    const outcome = await planRun(
      apiParamRequest({ maxPages: 3, maxItems: 50 }, ['https://listing.example/a', 'https://listing.example/b']),
      deps,
    );

    // Both inputs really did reach the pagination block — otherwise this passes
    // for the wrong reason (a second input that never got there).
    expect(outcome.warnings.filter((w) => w.includes('no pagination detected'))).toHaveLength(2);
    expect(outcome.warnings.filter((w) => w.includes('api-param pagination not applied'))).toHaveLength(1);
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
      // The walk gains nothing here, which now triggers the bounded stale
      // re-detect — and that re-detect can reach api-param again (see the
      // re-detection test below). Nothing intercepted keeps it out of the way
      // so the fetch count below still measures this walk's batch.
      intercepted: [],
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

  describe('a cached api-param config that is missing a field', () => {
    // Unreachable from cold detection, but a legacy or corrupted cache row can
    // hold one. Without the guard the walk either throws (`apiTemplate.replace`
    // on undefined, `itemsPath.split` on undefined) or silently builds
    // `offset=NaN` URLs — and a throw is caught by the outer handler, which
    // downgrades the input to `status: 'error'` and loses page 1's
    // already-planned items. Spec §3 says a pagination failure must never do
    // that.
    //
    // One case per condition, each missing EXACTLY one field. The original
    // single case passed `{ strategy: 'api-param' }`, which trips all four at
    // once — so `!step` and the two path checks could each be deleted with the
    // suite green. That is the "two constraints at once" pattern that has bitten
    // this branch three times.
    const TEMPLATE = 'https://listing.example/api?kn=py&offset={N}';
    const cases: Array<{ missing: string; config: PaginationConfig }> = [
      { missing: 'every field', config: { strategy: 'api-param' } },
      { missing: 'apiTemplate', config: { strategy: 'api-param', step: 2, itemsPath: 'results', urlPath: 'link' } },
      { missing: 'step', config: { strategy: 'api-param', apiTemplate: TEMPLATE, itemsPath: 'results', urlPath: 'link' } },
      { missing: 'itemsPath', config: { strategy: 'api-param', apiTemplate: TEMPLATE, step: 2, urlPath: 'link' } },
      { missing: 'urlPath', config: { strategy: 'api-param', apiTemplate: TEMPLATE, step: 2, itemsPath: 'results' } },
    ];

    for (const { missing, config } of cases) {
      it(`keeps page 1's work when ${missing} is absent`, async () => {
        // `intercepted: []` so the stale re-detect finds nothing to re-detect:
        // this test is about the guard, and a successful re-detect would add
        // items and fetches that have nothing to do with it.
        const deps = apiParamDeps({ cachedConfig: config, intercepted: [] });

        const outcome = await planRun(apiParamRequest({ maxPages: 3, maxItems: 50 }), deps);

        expect(outcome.errors).toEqual([]);
        expect(outcome.inputs[0]?.status).toBe('planned');
        const detailUrls = outcome.items.filter((i) => i.kind === 'detail').map((i) => i.url);
        expect(detailUrls).toEqual(PAGE1);
        // The silent half: a missing `step` builds `offset=NaN` rather than
        // throwing, so nothing above would notice it.
        expect(deps.fetchedUrls.filter((u) => u.includes('NaN'))).toEqual([]);
      });
    }
  });

  describe('a page that did not come back cleanly', () => {
    // Spec §7 lists this row — "a non-2xx or non-JSON page ends the loop without
    // losing page 1's work" — and it had no test: the fixture hardcoded
    // `status: 200, error: null`, so the walk's response guards could never
    // fire and each was deletable with the suite green.
    const surviving = (outcome: Awaited<ReturnType<typeof planRun>>) =>
      outcome.items.filter((i) => i.kind === 'detail').map((i) => i.url);

    it('ends the walk on a non-JSON page, keeping page 1 and absorbing nothing after it', async () => {
      const deps = apiParamDeps({
        cachedConfig: API_CONFIG,
        intercepted: [],
        pages: [[], ['https://listing.example/p/300001']],
        bodies: { 0: { error: 'not json', json: null } },
      });

      const outcome = await planRun(apiParamRequest({ maxPages: 3, maxItems: 50 }), deps);

      expect(surviving(outcome)).toEqual(PAGE1);
      expect(outcome.errors).toEqual([]);
      // Page 3 was fetched in the same batch but must never be reached.
      expect(surviving(outcome)).not.toContain('https://listing.example/p/300001');
      expect(outcome.items.filter((i) => i.kind === 'listing').map((i) => i.pageNumber)).toEqual([1]);
    });

    it('does not absorb a page whose record carries an error, however well its body parses', async () => {
      // This is the half with teeth. A `json: null` body is ALSO stopped one
      // line later by the emptiness check, so `json === null` alone cannot be
      // isolated (it is documented as belt-and-braces where it stands). An error
      // record that nonetheless carries a parseable results array can only be
      // stopped by the error check — and if it is not stopped, the walk plans
      // items out of a response the page reported as failed.
      const deps = apiParamDeps({
        cachedConfig: API_CONFIG,
        intercepted: [],
        pages: [[]],
        bodies: { 0: { error: 'net::ERR_ABORTED', json: { results: [{ link: '/p/700001' }] } } },
      });

      const outcome = await planRun(apiParamRequest({ maxPages: 3, maxItems: 50 }), deps);

      expect(surviving(outcome)).toEqual(PAGE1);
      expect(outcome.errors).toEqual([]);
    });

    it('does not absorb a non-2xx page', async () => {
      // Detection checks `body.status`; the walk did not. A 429 or a 403 from
      // an anti-bot tier commonly comes back as a well-formed JSON envelope,
      // and one that happens to hold an array at the cached `itemsPath` would
      // have been absorbed as if it were a page of results.
      const deps = apiParamDeps({
        cachedConfig: API_CONFIG,
        intercepted: [],
        pages: [[]],
        bodies: { 0: { status: 429, error: null, json: { results: [{ link: '/p/800001' }] } } },
      });

      const outcome = await planRun(apiParamRequest({ maxPages: 3, maxItems: 50 }), deps);

      expect(surviving(outcome)).toEqual(PAGE1);
      expect(outcome.errors).toEqual([]);
    });
  });

  it('can re-detect api-param when a cached api-param config goes stale', async () => {
    // The bounded stale retry called `detectPagination(capture, agent)` with no
    // 4th argument, so its ladder was mechanical -> ai. A domain whose api-param
    // config went stale could therefore NEVER be re-detected as api-param, even
    // though the fresh capture holds everything needed — and the cheapest,
    // best-verified rung would be permanently lost to that domain. The cold call
    // passed the argument; the retry did not, and nothing explained why.
    const deps = apiParamDeps({
      // A config whose parameter the site has stopped honouring.
      cachedConfig: { ...API_CONFIG, apiTemplate: 'https://listing.example/api?kn=py&stale={N}' },
      pages: [[]],
      pagesAfterProbe: [['https://listing.example/p/400001']],
    });

    const outcome = await planRun(apiParamRequest({ maxPages: 2, maxItems: 50 }), deps);

    expect(deps.saved).toHaveLength(1);
    expect(deps.saved[0]?.config.strategy).toBe('api-param');
    expect(deps.saved[0]?.config.apiTemplate).toBe('https://listing.example/api?kn=py&offset={N}');
    const detailUrls = outcome.items.filter((i) => i.kind === 'detail').map((i) => i.url);
    expect(detailUrls).toContain('https://listing.example/p/400001');
    expect(deps.crawlCalls).toHaveLength(0);
  });

  it('caps the batch rather than firing max_pages requests in one burst', async () => {
    // `resolveBudget` puts no ceiling on `max_pages` at all — `max_items` has
    // HARD_ITEM_CEILING, `max_pages` has nothing — so `max_pages: 100` built 99
    // URLs and fetched every one of them SEQUENTIALLY from the page context,
    // with no per-request timeout, before Node inspected a single response. The
    // HTML walker cannot do this: it is a lazy generator that stops at the first
    // empty page. This one had no equivalent brake, against a corpus whose
    // binding constraint is anti-bot.
    const deps = apiParamDeps({
      cachedConfig: API_CONFIG,
      intercepted: [],
      pages: Array.from({ length: 200 }, (_, i) => [`https://listing.example/p/9${1000 + i}`]),
    });

    const outcome = await planRun(apiParamRequest({ maxPages: 100, maxItems: 5000 }), deps);

    expect(deps.fetchedUrls).toHaveLength(API_WALK_MAX_BATCH);
    // Not silently: an operator who asked for 100 pages and got 11 must be told.
    expect(outcome.warnings.some((w) => w.includes('api-param walk capped at'))).toBe(true);
  });

  it('refuses a cached config whose `from` is not an integer', async () => {
    // `step` gets `!step`, which catches 0, NaN and undefined. `from` had only
    // `?? 0`, so a string survived — and a string CONCATENATES rather than
    // NaN-ing: from '2' with step 2 builds `offset=22`, a plausible-looking URL
    // for a page nobody asked for, whose response would then be absorbed and its
    // config cached.
    const deps = apiParamDeps({
      cachedConfig: { ...API_CONFIG, from: '2' as unknown as number },
      intercepted: [],
    });

    const outcome = await planRun(apiParamRequest({ maxPages: 3, maxItems: 50 }), deps);

    expect(outcome.errors).toEqual([]);
    expect(outcome.items.filter((i) => i.kind === 'detail').map((i) => i.url)).toEqual(PAGE1);
    expect(deps.fetchedUrls).toEqual([]);
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
