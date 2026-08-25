// Tier 1: does the scroll walk actually grow a real page in a real browser?
//
// Every other test in this cycle fakes the page. This one serves a listing whose
// JS appends cards on scroll and drives real Chromium against it, so the growth
// wait, the quiet-round rule and the stamping are the real ones.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PlaywrightBrowser, type CrawlPage } from '@robot/browser';
import { serveFixturePages, scrollFixturePage, loadMoreFixturePage, type ServedSite } from '../__fixtures__/serve.js';
import { buildExtractionScript } from '../executor.js';
import { DETAIL_URL_FIELD } from './enumerate-detail-urls.js';

const ROW_XPATH = '//div[@data-row]';
const script = () => buildExtractionScript(
  { row_xpath: ROW_XPATH, fields: [{ name: DETAIL_URL_FIELD, xpath: './/a/@href', attribute: 'href', transform: 'absolute_url' }] },
  { [DETAIL_URL_FIELD]: 'url' },
);

let browser: PlaywrightBrowser;
let site: ServedSite;

beforeAll(async () => {
  browser = new PlaywrightBrowser();
  await browser.launch({ headless: true });
  site = await serveFixturePages([
    { path: '/scroll', html: scrollFixturePage({ batches: [['/p/100001', '/p/100002'], ['/p/200001'], ['/p/300001']] }) },
    { path: '/virtual', html: scrollFixturePage({ batches: [['/p/100001'], ['/p/200001']], recycle: true }) },
    { path: '/button', html: loadMoreFixturePage({ batches: [['/p/100001'], ['/p/200001']] }) },
    { path: '/done', html: scrollFixturePage({ batches: [['/p/100001', '/p/100002']] }) },
    // An empty batch is a round that yields nothing — the stall the quiet-round
    // rule exists to survive.
    { path: '/stall', html: scrollFixturePage({ batches: [['/p/100001'], [], ['/p/400001']] }) },
    { path: '/endless', html: scrollFixturePage({ batches: [['/p/100001']], endless: true }) },
  ]);
}, 60_000);

afterAll(async () => {
  try { await browser?.close(); } finally { await site?.close(); }
});

async function walk(path: string, opts: { maxItems?: number; loadMoreSelector?: string } = {}): Promise<CrawlPage[]> {
  const out: CrawlPage[] = [];
  for await (const p of browser.scrollPages(`${site.baseUrl}${path}`, {
    extractionScript: script(), rowXpath: ROW_XPATH, ...opts,
  })) out.push(p);
  return out;
}

const urls = (pages: CrawlPage[]) => pages.flatMap((p) => p.data.map((r) => String(r[DETAIL_URL_FIELD])));

describe('the scroll walk against a real page', () => {
  it('enumerates batches that only exist after scrolling', async () => {
    const found = urls(await walk('/scroll'));
    expect(found.some((u) => u.endsWith('/p/200001'))).toBe(true);
    expect(found.some((u) => u.endsWith('/p/300001'))).toBe(true);
  }, 60_000);

  it('yields each row exactly once across the whole walk', async () => {
    // The labelling optimisation, observed from outside. Stated across rounds
    // rather than about round 2's contents: the first round now yields whatever
    // the page had already loaded, because the caller's page-1 view comes from a
    // DIFFERENT navigation and the overlap is a race (see plan-run.ts). What
    // stamping still guarantees is that no row is reported twice BY THE WALK.
    const found = urls(await walk('/scroll'));
    expect(found).toHaveLength(new Set(found).size);
    // And every card is seen, including those present before the first scroll —
    // the regression that cost a live run 72 of its 220 items.
    for (const path of ['/p/100001', '/p/100002', '/p/200001', '/p/300001']) {
      expect(found.some((u) => u.endsWith(path))).toBe(true);
    }
  }, 60_000);

  it('loses nothing when the page recycles cards out of the DOM', async () => {
    // Virtualized: the fixture clears the container each round, so the labels go
    // with it. Correctness has to come from the caller's dedupe, and the walk
    // still has to SEE every item at least once.
    const found = urls(await walk('/virtual'));
    expect(found.some((u) => u.endsWith('/p/100001'))).toBe(true);
    expect(found.some((u) => u.endsWith('/p/200001'))).toBe(true);
  }, 60_000);

  it('stops on a page that has nothing more, without hanging', async () => {
    // It reports the one screen it can see, then stops. It used to report
    // NOTHING: the generator stamped its whole initial view before the first
    // scroll and yielded only what arrived after, so a single-screen listing
    // contributed zero and the caller kept only whatever its own separate
    // capture had happened to load.
    const pages = await walk('/done');
    expect(urls(pages).map((u) => u.replace(site.baseUrl, ''))).toEqual(['/p/100001', '/p/100002']);
  }, 60_000);

  it('advances by clicking when a load-more selector is given', async () => {
    const found = urls(await walk('/button', { loadMoreSelector: '#more' }));
    expect(found.some((u) => u.endsWith('/p/200001'))).toBe(true);
  }, 60_000);

  it('stops walking once maxItems is reached', async () => {
    // The cap is checked at the TOP of a round, so a round always overshoots by
    // whatever its batch happened to contain — the generator cannot stop
    // mid-batch. The old assertion here was `length <= maxItems`, which held
    // only because round 2 happened to yield exactly one row; once the first
    // round started yielding the page's initial view too, it yielded three and
    // the accident showed. What is actually guaranteed is that the walk STOPS:
    // one round, and the listing's later batches are never reached.
    const pages = await walk('/scroll', { maxItems: 1 });
    expect(pages).toHaveLength(1);
    expect(urls(pages).some((u) => u.endsWith('/p/300001'))).toBe(false);
  }, 60_000);

  it('survives a round that yields nothing and keeps going', async () => {
    // THE quiet-round rule, and the reason it is 2 rather than 1. `/stall`
    // serves nothing on its first scroll and a real batch on its second. A
    // crawler that stopped at the first quiet round would silently truncate
    // this listing and look like it had finished.
    const found = urls(await walk('/stall'));
    expect(found.some((u) => u.endsWith('/p/400001'))).toBe(true);
  }, 60_000);

  it('bounds a listing that never goes quiet', async () => {
    // `/endless` appends a new card on every scroll, forever. Without
    // MAX_SCROLL_ROUNDS this test does not fail — it hangs, which is worse.
    //
    // The upper bound alone is not a teeth-check: with the up-then-down scroll
    // trigger reverted to a bottom-only scrollTo, growth stalls after round 2
    // (Chromium's scroll anchoring leaves the viewport already at the bottom,
    // so the next scrollTo moves nothing and fires no 'scroll' event), the walk
    // goes quiet at QUIET_ROUNDS and stops having yielded a single page — and
    // `pages.length <= 50` is satisfied by 1 just as happily as by 49. The lower
    // bound forces the walk to have actually run out MAX_SCROLL_ROUNDS rather
    // than gone quiet early.
    //
    // Measured directly against this fixture with the real (working) trigger:
    // rounds 2..50 all grow (endless never stops), so pages.length is 49 every
    // run. The floor is set well below that measured value — high enough that
    // the broken-trigger's 1 page cannot pass, comfortably below 49 to absorb
    // any timing slack in a real browser.
    const pages = await walk('/endless');
    expect(pages.length).toBeGreaterThanOrEqual(40);
    expect(pages.length).toBeLessThanOrEqual(50);
  }, 120_000);
});
