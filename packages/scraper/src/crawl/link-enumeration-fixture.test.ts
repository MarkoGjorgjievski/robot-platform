// Tier 1: can the extraction machinery actually pull per-row product links off a
// real listing page? Every other listing test stubs the browser or greps the HTML
// by hand, so none of them answer this. Here the REAL generated script runs in
// real Chromium against the frozen capture.
//
// This isolates the two halves of link discovery: the machinery (proved here,
// deterministically and for free) and the AI's choice of row selector (which
// only a live run can judge). When a live crawl returns footer links, this test
// says which half to go and fix.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PlaywrightBrowser } from '@robot/browser';
import { loadFixture } from '../__fixtures__/load.js';
import { buildExtractionScript } from '../executor.js';
import { enumerateDetailUrls, DETAIL_URL_FIELD } from './enumerate-detail-urls.js';

const fixture = loadFixture('newegg-gpu-listing');

/** The row container a correct selector-generation pass should land on. */
const PRODUCT_ROW_XPATH = '//div[contains(@class,"item-container")]';

let browser: PlaywrightBrowser;
beforeAll(async () => {
  browser = new PlaywrightBrowser();
  await browser.launch({ headless: true });
}, 60_000);
afterAll(async () => { await browser?.close(); });

describe('link enumeration through the real executor', () => {
  it('extracts one product link per row container', async () => {
    const script = buildExtractionScript(
      {
        row_xpath: PRODUCT_ROW_XPATH,
        fields: [{ name: DETAIL_URL_FIELD, xpath: './/a[@class="item-title"]', attribute: 'href', transform: 'absolute_url' }],
      },
      { [DETAIL_URL_FIELD]: 'url' },
    );
    const result = await browser.setContentEvaluate<{ data: Record<string, unknown>[] }>(fixture.html, script);

    expect(result.data.length).toBe(12);
    const urls = result.data.map((r) => r[DETAIL_URL_FIELD]).filter(Boolean) as string[];
    expect(urls.length).toBe(12);
    // Newegg uses two product-id shapes (/p/N82E16814… and /p/27N-0042-…), but a
    // product URL always carries /p/ and a category URL (/Category/ID-38) never does.
    for (const url of urls) expect(url).toContain('/p/');
  }, 60_000);

  it('feeds those rows into a deduped, budget-capped work list', async () => {
    const script = buildExtractionScript(
      {
        row_xpath: PRODUCT_ROW_XPATH,
        fields: [{ name: DETAIL_URL_FIELD, xpath: './/a[@class="item-title"]', attribute: 'href', transform: 'absolute_url' }],
      },
      { [DETAIL_URL_FIELD]: 'url' },
    );
    const result = await browser.setContentEvaluate<{ data: Record<string, unknown>[] }>(fixture.html, script);

    const enumerated = enumerateDetailUrls({
      rows: result.data,
      pageUrl: fixture.url,
      pageNumber: 1,
      seen: new Set<string>(),
      remaining: 5,
    });
    expect(enumerated.items).toHaveLength(5);
    expect(enumerated.stop).toBe('budget');
    for (const item of enumerated.items) {
      expect(item.url.startsWith('https://www.newegg.com/')).toBe(true);
      expect(item.url).toContain('/p/');
    }
    expect(new Set(enumerated.items.map((i) => i.url)).size).toBe(5);
  }, 60_000);
});
