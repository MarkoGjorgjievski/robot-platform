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

  it('yields each round only the rows that are new', async () => {
    // The labelling optimisation, observed from outside: page 1's two cards must
    // not reappear in round 2's batch.
    const pages = await walk('/scroll');
    const second = pages.find((p) => p.pageNumber === 2);
    expect(second?.data.map((r) => String(r[DETAIL_URL_FIELD]))).toEqual([`${site.baseUrl}/p/200001`]);
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
    const pages = await walk('/done');
    expect(urls(pages)).toEqual([]);
  }, 60_000);

  it('advances by clicking when a load-more selector is given', async () => {
    const found = urls(await walk('/button', { loadMoreSelector: '#more' }));
    expect(found.some((u) => u.endsWith('/p/200001'))).toBe(true);
  }, 60_000);

  it('stops when maxItems is reached', async () => {
    const found = urls(await walk('/scroll', { maxItems: 1 }));
    expect(found.length).toBeLessThanOrEqual(1);
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
    const pages = await walk('/endless');
    expect(pages.length).toBeLessThanOrEqual(50);
  }, 120_000);
});
