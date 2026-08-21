// Tier 1: does browser.crawl() actually WALK pages 2..N, and does enumeration
// dedupe across them? setContentEvaluate cannot answer this — it never navigates
// — so until now nothing offline covered the multi-page path at all.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PlaywrightBrowser, type CrawlPage } from '@robot/browser';
import { serveFixturePages, type ServedSite } from '../__fixtures__/serve.js';
import { buildExtractionScript } from '../executor.js';
import { enumerateDetailUrls, DETAIL_URL_FIELD } from './enumerate-detail-urls.js';

const page = (links: string[]) =>
  `<html><body>${links.map((h) => `<div class="item"><a class="t" href="${h}">x</a></div>`).join('')}</body></html>`;

let browser: PlaywrightBrowser;
let site: ServedSite;

beforeAll(async () => {
  browser = new PlaywrightBrowser();
  await browser.launch({ headless: true });
  site = await serveFixturePages([
    { path: '/list?page=1', html: page(['/p/1', '/p/2']) },
    { path: '/list?page=2', html: page(['/p/3', '/p/4']) },
    // Page 3 repeats /p/4 — a real site's overlap between pages.
    { path: '/list?page=3', html: page(['/p/4', '/p/5']) },
    { path: '/list?page=4', html: page(['/p/6']) },
  ]);
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await site?.close();
});

const script = () => buildExtractionScript(
  // `attribute` is required by SelectorField's type even though this xpath
  // already resolves an attribute node directly (executor.ts:128-133 handles
  // that case via nodeType === 2, independent of what `attribute` says).
  { row_xpath: '//div[@class="item"]', fields: [{ name: DETAIL_URL_FIELD, xpath: './/a/@href', attribute: 'href', transform: 'absolute_url' }] },
  { [DETAIL_URL_FIELD]: 'url' },
);

async function walk(maxPages: number): Promise<CrawlPage[]> {
  const pages: CrawlPage[] = [];
  for await (const p of browser.crawl(`${site.baseUrl}/list?page=1`, {
    extractionScript: script(),
    maxPages,
    startPage: 2,
    paginationConfig: { strategy: 'url-pattern', urlTemplate: `${site.baseUrl}/list?page={N}` },
  })) {
    pages.push(p);
  }
  return pages;
}

/** Detail URLs a CrawlPage actually extracted, in row order. */
const urlsOf = (p: CrawlPage) => p.data.map((r) => r[DETAIL_URL_FIELD]);

describe('multi-page walking against served fixtures', () => {
  it('walks pages 2..maxPages and extracts each one', async () => {
    site.requests.length = 0;
    const pages = await walk(3);

    expect(pages.map((p) => p.pageNumber)).toEqual([2, 3]);

    // Content, not just shape: a length check alone can't tell a genuine page
    // 3 apart from page 2 fetched twice and mislabelled — both have 2 rows.
    // These come from DIFFERENT fixture pages, so if the walk is actually
    // stuck re-fetching page 2, "page 3" would show /p/3 and /p/4, not
    // /p/4 and /p/5.
    expect(urlsOf(pages[0]!)).toEqual([`${site.baseUrl}/p/3`, `${site.baseUrl}/p/4`]);
    expect(urlsOf(pages[1]!)).toEqual([`${site.baseUrl}/p/4`, `${site.baseUrl}/p/5`]);

    // pageNumber alone is just the loop's own counter (assigned by the caller,
    // not by what was actually navigated to) — it can't prove the crawler
    // asked the server for a different page. The request log can.
    expect(site.requests).toContain('/list?page=2');
    expect(site.requests).toContain('/list?page=3');
  }, 60_000);

  it('stops at maxPages instead of walking the whole site', async () => {
    site.requests.length = 0;
    await walk(3);

    // The walk must have genuinely advanced through pages 2 and 3 — otherwise
    // "page=4 was never requested" is true for the wrong reason (the crawl
    // never left page 2), not because the budget stopped it.
    expect(site.requests).toContain('/list?page=2');
    expect(site.requests).toContain('/list?page=3');

    // Page 4 exists and is reachable by the same template. The budget is the
    // only thing stopping the crawl, so if it is not honoured we fetch it.
    expect(site.requests.some((r) => r.includes('page=4'))).toBe(false);
  }, 60_000);

  it('dedupes detail URLs that appear on more than one page', async () => {
    const pages = await walk(3);
    const seen = new Set<string>();
    const urls: string[] = [];
    for (const p of pages) {
      const result = enumerateDetailUrls({ rows: p.data, pageUrl: p.url, pageNumber: p.pageNumber, seen, remaining: 50 });
      for (const item of result.items) { seen.add(item.url); urls.push(item.url); }
    }

    // The full, distinct set from both real pages: p/3, p/4 (page 2) plus
    // p/4 (repeat, dropped), p/5 (page 3). A stuck crawler that re-serves
    // page 2 as "page 3" would dedupe its own repeat away too and never
    // surface p/5 — passing the checks below for the wrong reason otherwise.
    expect(new Set(urls)).toEqual(new Set([
      `${site.baseUrl}/p/3`, `${site.baseUrl}/p/4`, `${site.baseUrl}/p/5`,
    ]));

    // /p/4 is on both page 2 and page 3; it must be planned exactly once.
    expect(urls.filter((u) => u.endsWith('/p/4'))).toHaveLength(1);
    expect(new Set(urls).size).toBe(urls.length);
  }, 60_000);
});
