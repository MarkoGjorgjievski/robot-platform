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
});
