import { describe, it, expect } from 'vitest';
import { planRun } from './plan-run.js';
import { DETAIL_URL_FIELD } from './enumerate-detail-urls.js';
import { scrollDeps, scrollRequest, SCROLL_CONFIG, PAGE1 } from './plan-run-scroll.fixtures.js';

const detailUrls = (o: Awaited<ReturnType<typeof planRun>>) =>
  o.items.filter((i) => i.kind === 'detail').map((i) => i.url);

describe('planRun — the scroll fallback', () => {
  it('scrolls where it would otherwise have given up', async () => {
    const deps = scrollDeps({ rounds: [['https://listing.example/p/200001']] });

    const outcome = await planRun(scrollRequest({ maxPages: 3, maxItems: 50 }), deps);

    expect(deps.scrollCalls).toHaveLength(1);
    expect(detailUrls(outcome)).toContain('https://listing.example/p/200001');
    // The give-up warning must NOT be pushed when the scroll worked.
    expect(outcome.warnings.some((w) => w.includes('no pagination detected'))).toBe(false);
  });

  it('caches a dom-scroll config once the walk gained', async () => {
    const deps = scrollDeps({ rounds: [['https://listing.example/p/200001']] });

    await planRun(scrollRequest({ maxPages: 3, maxItems: 50 }), deps);

    expect(deps.saved).toHaveLength(1);
    expect(deps.saved[0]?.config.strategy).toBe('dom-scroll');
  });

  it('caches NOTHING and still warns when the scroll gained nothing', async () => {
    // A listing that genuinely has one screen. This is the common case, and it
    // must end exactly as it did before this feature existed.
    const deps = scrollDeps({ rounds: [[]] });

    const outcome = await planRun(scrollRequest({ maxPages: 3, maxItems: 50 }), deps);

    expect(deps.saved).toEqual([]);
    expect(outcome.warnings.some((w) => w.includes('no pagination detected'))).toBe(true);
    expect(detailUrls(outcome)).toEqual(PAGE1);
  });

  it('never routes a dom-scroll config through browser.crawl', async () => {
    // crawl()'s navigateToPage has `default: return false`, so a misrouted
    // dom-scroll config would silently walk zero pages rather than erroring.
    const deps = scrollDeps({ cachedConfig: SCROLL_CONFIG, rounds: [['https://listing.example/p/200001']] });

    await planRun(scrollRequest({ maxPages: 3, maxItems: 50 }), deps);

    expect(deps.crawlCalls).toHaveLength(0);
    expect(deps.scrollCalls).toHaveLength(1);
  });

  it('passes the load-more selector when the page has one', async () => {
    const deps = scrollDeps({
      html: '<html><body><div id="results"><div data-row><a href="/p/100001">x</a></div></div><button id="more">Load more</button></body></html>',
      rounds: [['https://listing.example/p/200001']],
    });

    await planRun(scrollRequest({ maxPages: 3, maxItems: 50 }), deps);

    expect(deps.scrollCalls[0]?.loadMoreSelector).toBe('#more');
    expect(deps.saved[0]?.config.loadMoreSelector).toBe('#more');
  });

  it('feeds scroll rows through the same dedupe as every other walk', async () => {
    // Round 2 re-serves one of page 1's URLs — the virtualized case, where a
    // recycled card is extracted twice. It must be planned once.
    const deps = scrollDeps({ rounds: [[PAGE1[0]!, 'https://listing.example/p/200001']] });

    const outcome = await planRun(scrollRequest({ maxPages: 3, maxItems: 50 }), deps);

    expect(detailUrls(outcome).filter((u) => u === PAGE1[0])).toHaveLength(1);
  });

  // ── The max_pages: 1 problem ────────────────────────────────────────────
  //
  // `max_pages: 1` is exactly the budget an operator sets for a listing that
  // scroll-loads — pages are meaningless there, so 1 is the natural value.
  // The pre-existing early return at the top of the listing-mode branch used
  // to `continue` before pagination was even detected once `maxPages <= 1`,
  // which meant a scroll listing configured this way could never be
  // discovered. This proves the fallback still fires in that configuration.
  it('reaches the scroll fallback even when max_pages is 1', async () => {
    const deps = scrollDeps({ rounds: [['https://listing.example/p/200001']] });

    const outcome = await planRun(scrollRequest({ maxPages: 1, maxItems: 50 }), deps);

    expect(deps.scrollCalls).toHaveLength(1);
    expect(detailUrls(outcome)).toContain('https://listing.example/p/200001');
    expect(deps.saved).toHaveLength(1);
    expect(deps.saved[0]?.config.strategy).toBe('dom-scroll');
  });

  // ── The budget is PLANNED items, not yielded rows ───────────────────────
  //
  // A virtualized listing — spec §4's central case — recycles its cards, so
  // rows already extracted come back UNSTAMPED and are re-yielded by design.
  // `absorb`'s dedupe is what turns rows into planned items, and it lives in
  // Node where the generator cannot see it. Handing the generator the item cap
  // therefore spends the budget on rows the run will throw away: ask for 10 and
  // silently get 5, with no 'budget reached' warning and no thin-walk warning
  // either (the fallback `continue`s before that check). Silent
  // under-delivery, on exactly the listings this feature exists for.
  it('spends the item budget on planned items, not on re-served rows', async () => {
    // Eight rounds, three rows each: both of page 1's URLs recycled back plus
    // one genuinely new product. 24 raw rows carry 8 new items.
    const recycled = Array.from({ length: 8 }, (_, i) => [
      PAGE1[0]!, PAGE1[1]!, `https://listing.example/p/20000${i + 1}`,
    ]);
    const deps = scrollDeps({ rounds: recycled });

    // 2 from page 1 + 8 from the walk is exactly the cap. A row-counted budget
    // would stop the generator after round 3 (9 rows yielded >= 8 remaining),
    // having planned 5.
    const outcome = await planRun(scrollRequest({ maxPages: 3, maxItems: 10 }), deps);

    // Nothing was handed to the generator to count rows against — the option
    // exists on ScrollOptions and PlaywrightBrowser honours it, so the only
    // thing keeping this walk honest is that planRun does not set it.
    expect(deps.scrollCalls[0]).not.toHaveProperty('maxItems');
    expect(detailUrls(outcome)).toHaveLength(10);
    expect(detailUrls(outcome)).toContain('https://listing.example/p/200008');
    // The cap is what ended it, and `absorb` said so — which is also what
    // keeps this walk out of the thin-walk warning.
    expect(outcome.warnings).toContain('budget reached: 10 items');
  });

  // ── A scroll walk that throws ───────────────────────────────────────────
  //
  // `scrollPages` is a live Playwright walk: `context.newPage()`,
  // `navigateWithFallback`, `dismissPopups`, three `page.evaluate` calls and
  // `page.close()` in its `finally` are all unguarded, so a rate-limited site
  // (this project's binding corpus constraint) or an SPA that route-changes on
  // scroll throws straight out of the generator.
  //
  // Both call sites `continue` BEFORE the try/catch further down that turns a
  // pagination failure into a per-input error. Unwrapped, that throw rejects
  // `planRun` itself — and `packages/api/src/routers/crawl.ts` marks the run
  // failed without ever reaching `insert(runItems)`, so every EARLIER input's
  // detail URLs are discarded. One rate-limited category page out of forty
  // costs the whole run. Before this branch, that input produced a warning and
  // the run completed.
  //
  // Two tests, not one: the two call sites are reached by different paths
  // (max_pages <= 1 short-circuits before detection; max_pages > 1 arrives at
  // the give-up branch after it), so guarding one leaves the other naked.

  it('turns a scroll failure into a per-input error rather than rejecting the run (max_pages: 3)', async () => {
    const deps = scrollDeps({ scrollThrows: 'net::ERR_TIMED_OUT' });

    const outcome = await planRun(scrollRequest({ maxPages: 3, maxItems: 50 }), deps);

    expect(outcome.errors).toHaveLength(1);
    expect(outcome.errors[0]?.inputIndex).toBe(0);
    expect(outcome.errors[0]?.message).toContain('pagination failed');
    expect(outcome.errors[0]?.message).toContain('net::ERR_TIMED_OUT');
    // The same shape the main path produces: the input is reported as an
    // error, and page 1's own work survives.
    expect(outcome.inputs).toEqual([{ inputIndex: 0, itemCount: PAGE1.length, status: 'error' }]);
    expect(detailUrls(outcome)).toEqual(PAGE1);
    expect(deps.saved).toEqual([]);
  });

  it('turns a scroll failure into a per-input error rather than rejecting the run (max_pages: 1)', async () => {
    const deps = scrollDeps({ scrollThrows: 'net::ERR_TIMED_OUT' });

    const outcome = await planRun(scrollRequest({ maxPages: 1, maxItems: 50 }), deps);

    expect(outcome.errors).toHaveLength(1);
    expect(outcome.errors[0]?.inputIndex).toBe(0);
    expect(outcome.errors[0]?.message).toContain('pagination failed');
    expect(outcome.errors[0]?.message).toContain('net::ERR_TIMED_OUT');
    expect(outcome.inputs).toEqual([{ inputIndex: 0, itemCount: PAGE1.length, status: 'error' }]);
    expect(detailUrls(outcome)).toEqual(PAGE1);
    expect(deps.saved).toEqual([]);
  });
});
