// packages/scraper/src/crawl/plan-run-page-level.test.ts
import { describe, it, expect } from 'vitest';
import type { IBrowser, CrawlOptions, CrawlPage, PageCapture } from '@robot/browser';
import { planRun } from './plan-run.js';

const FAKE_CAPTURE = {
  url: 'https://example.com/c/shelves',
  html: '<html><h1>Shelves</h1></html>',
  markdown: '',
  screenshot: Buffer.alloc(0),
  screenshotTiles: [],
  title: 'Shelves',
  timestamp: 0,
  structuredData: { ldJson: [], nextData: null, initialState: null, meta: {} },
  interceptedRequests: [],
} as unknown as PageCapture;

class FakeBrowser implements IBrowser {
  captures = 0;
  async launch(): Promise<void> {}
  async capture(): Promise<PageCapture> { this.captures++; return FAKE_CAPTURE; }
  async evaluate<T>(): Promise<T> { throw new Error('not used'); }
  async setContentEvaluate<T>(): Promise<T> { throw new Error('not used'); }
  async close(): Promise<void> {}
  async *crawl(_url: string, _options: CrawlOptions): AsyncGenerator<CrawlPage> {}
}

const REQUEST = {
  source: {
    listingMode: 'listing_to_detail' as const,
    inputStrategy: 'category' as const,
    urlTemplate: 'https://example.com/c/{slug}',
    budget: { max_pages: 1 },
  },
  schema: [
    { name: 'title', type: 'string' },
    { name: 'category', type: 'string', origin: 'listing' as const },
    { name: 'listing_price', type: 'price', origin: 'listing' as const },
  ],
  inputSet: { columns: [{ name: 'slug', primary: true }], rows: [{ slug: 'shelves' }] },
};

const OUTCOME_SHAPE = {
  plan: { row_xpath: '//li', fields: [] },
  confidence: 0.9,
  sources: {},
  fieldCount: { found: 1, total: 1 },
  fieldsByTier: { requested: [], discovered: [] },
  cacheHit: false,
};

describe('page-level listing fields', () => {
  it('fills a listing field no row resolved from a document-mode pass, for every row', async () => {
    const calls: Array<{ pageType: string; fields: string[] }> = [];
    const outcome = await planRun(REQUEST, {
      browser: new FakeBrowser(),
      agent: null,
      extract: async (request) => {
        calls.push({ pageType: request.pageType ?? 'detail', fields: request.fields.map((f) => f.name) });
        // First call: the row pass resolves per-row price but no category.
        if (calls.length === 1) {
          return {
            ...OUTCOME_SHAPE,
            data: [
              { detail_url: '/p/1', listing_price: '79' },
              { detail_url: '/p/2', listing_price: '49' },
            ],
          };
        }
        // Second call: the document-mode pass finds the category in the header.
        return { ...OUTCOME_SHAPE, data: [{ category: 'Shelves' }] };
      },
    });

    const details = outcome.items.filter((i) => i.kind === 'detail');
    expect(details[0]?.listingValues).toEqual({ listing_price: '79', category: 'Shelves' });
    expect(details[1]?.listingValues).toEqual({ listing_price: '49', category: 'Shelves' });
  });

  it('asks the second pass only for the fields the rows left unresolved', async () => {
    const calls: Array<string[]> = [];
    await planRun(REQUEST, {
      browser: new FakeBrowser(),
      agent: null,
      extract: async (request) => {
        calls.push(request.fields.map((f) => f.name));
        if (calls.length === 1) return { ...OUTCOME_SHAPE, data: [{ detail_url: '/p/1', listing_price: '79' }] };
        return { ...OUTCOME_SHAPE, data: [{ category: 'Shelves' }] };
      },
    });
    expect(calls[1]).toEqual(['category']);
  });

  it('runs the second pass in document mode, not row mode', async () => {
    const pageTypes: string[] = [];
    await planRun(REQUEST, {
      browser: new FakeBrowser(),
      agent: null,
      extract: async (request) => {
        pageTypes.push(request.pageType ?? 'detail');
        if (pageTypes.length === 1) return { ...OUTCOME_SHAPE, data: [{ detail_url: '/p/1' }] };
        return { ...OUTCOME_SHAPE, data: [{ category: 'Shelves' }] };
      },
    });
    expect(pageTypes).toEqual(['listing', 'detail']);
  });

  it('lets a per-row value win over the page-level one for the same field', async () => {
    const outcome = await planRun(REQUEST, {
      browser: new FakeBrowser(),
      agent: null,
      extract: async (request) =>
        request.pageType === 'listing'
          ? { ...OUTCOME_SHAPE, data: [{ detail_url: '/p/1', category: 'Bookcases', listing_price: '79' }] }
          : { ...OUTCOME_SHAPE, data: [{ category: 'Shelves' }] },
    });
    expect(outcome.items.find((i) => i.kind === 'detail')?.listingValues.category).toBe('Bookcases');
  });

  it('skips the second pass entirely when every listing field resolved per row', async () => {
    let calls = 0;
    await planRun(REQUEST, {
      browser: new FakeBrowser(),
      agent: null,
      extract: async () => {
        calls++;
        return { ...OUTCOME_SHAPE, data: [{ detail_url: '/p/1', category: 'Shelves', listing_price: '79' }] };
      },
    });
    expect(calls).toBe(1);
  });

  it('captures the listing page only once across both passes', async () => {
    const browser = new FakeBrowser();
    await planRun(REQUEST, {
      browser,
      agent: null,
      extract: async (request) =>
        request.pageType === 'listing'
          ? { ...OUTCOME_SHAPE, data: [{ detail_url: '/p/1' }] }
          : { ...OUTCOME_SHAPE, data: [{ category: 'Shelves' }] },
    });
    expect(browser.captures).toBe(1);
  });
});
