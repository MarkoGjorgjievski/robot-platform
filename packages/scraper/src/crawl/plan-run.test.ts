// packages/scraper/src/crawl/plan-run.test.ts
import { describe, it, expect } from 'vitest';
import type { IBrowser, CrawlOptions, CrawlPage, PageCapture } from '@robot/browser';
import { planRun } from './plan-run.js';

/** The real per-domain lock adds a 2s politeness delay between same-domain
 *  requests; tests inject this instead so they exercise the acquire/release
 *  contract without the wall clock. */
const noopLock = async () => () => {};

const FAKE_CAPTURE = {
  url: 'https://example.com/c/shelves',
  html: '<html></html>',
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
  constructor(private readonly pages: CrawlPage[] = []) {}
  async launch(): Promise<void> {}
  async capture(): Promise<PageCapture> { this.captures++; return FAKE_CAPTURE; }
  async evaluate<T>(): Promise<T> { throw new Error('not used'); }
  async setContentEvaluate<T>(): Promise<T> { throw new Error('not used'); }
  async close(): Promise<void> {}
  async *crawl(_url: string, options: CrawlOptions): AsyncGenerator<CrawlPage> {
    const from = options.startPage ?? 1;
    for (const page of this.pages) if (page.pageNumber >= from) yield page;
  }
}

const LISTING_SOURCE = {
  listingMode: 'listing_to_detail' as const,
  inputStrategy: 'category' as const,
  urlTemplate: 'https://example.com/c/{slug}',
  budget: { max_pages: 2, max_items: 10, mode: 'first_n' },
};

const SCHEMA = [
  { name: 'title', type: 'string' },
  { name: 'category', type: 'string', origin: 'listing' as const },
];

const INPUT_SET = {
  columns: [{ name: 'slug', primary: true }],
  rows: [{ slug: 'shelves' }],
};

/** Stands in for runExtraction: returns the listing rows the chain would resolve. */
function fakeExtract(rows: Array<Record<string, unknown>>) {
  return async () => ({
    data: rows,
    plan: { row_xpath: '//li', fields: [] },
    confidence: 0.9,
    sources: {},
    fieldCount: { found: 1, total: 1 },
    fieldsByTier: { requested: [], discovered: [] },
    cacheHit: false,
  });
}

describe('planRun', () => {
  it('emits one detail item per listing row, carrying that row\'s listing values', async () => {
    const outcome = await planRun(
      { source: LISTING_SOURCE, schema: SCHEMA, inputSet: INPUT_SET },
      {
        browser: new FakeBrowser(),
        agent: null, acquireLock: noopLock,
        extract: fakeExtract([
          { detail_url: '/p/1', category: 'Shelves' },
          { detail_url: '/p/2', category: 'Shelves' },
        ]),
      },
    );
    const details = outcome.items.filter((i) => i.kind === 'detail');
    expect(details.map((i) => i.url)).toEqual(['https://example.com/p/1', 'https://example.com/p/2']);
    expect(details[0]?.listingValues).toEqual({ category: 'Shelves' });
  });

  it('records the listing page it walked as its own item', async () => {
    const outcome = await planRun(
      { source: LISTING_SOURCE, schema: SCHEMA, inputSet: INPUT_SET },
      { browser: new FakeBrowser(), agent: null, acquireLock: noopLock, extract: fakeExtract([{ detail_url: '/p/1' }]) },
    );
    const listings = outcome.items.filter((i) => i.kind === 'listing');
    expect(listings).toHaveLength(1);
    expect(listings[0]).toMatchObject({ url: 'https://example.com/c/shelves', pageNumber: 1 });
  });

  it('walks page 2 through crawl() and keeps its URLs, stamped with their page number', async () => {
    const outcome = await planRun(
      { source: LISTING_SOURCE, schema: SCHEMA, inputSet: INPUT_SET },
      {
        browser: new FakeBrowser([
          { url: 'https://example.com/c/shelves?page=2', pageNumber: 2, data: [{ detail_url: '/p/3' }], totalRows: 1 },
        ]),
        agent: null, acquireLock: noopLock,
        extract: fakeExtract([{ detail_url: '/p/1' }]),
      },
    );
    const details = outcome.items.filter((i) => i.kind === 'detail');
    expect(details.map((i) => i.url)).toEqual(['https://example.com/p/1', 'https://example.com/p/3']);
    expect(details[1]?.pageNumber).toBe(2);
  });

  it('stops at the item cap and reports it', async () => {
    const outcome = await planRun(
      { source: { ...LISTING_SOURCE, budget: { max_pages: 2, max_items: 1, mode: 'first_n' } }, schema: SCHEMA, inputSet: INPUT_SET },
      { browser: new FakeBrowser(), agent: null, acquireLock: noopLock, extract: fakeExtract([{ detail_url: '/p/1' }, { detail_url: '/p/2' }]) },
    );
    expect(outcome.items.filter((i) => i.kind === 'detail')).toHaveLength(1);
    expect(outcome.warnings).toContain('budget reached: 1 items');
  });

  it('never fetches page 2 when page 1\'s rows exactly fill the item cap', async () => {
    class NoCrawlBrowser extends FakeBrowser {
      crawlCalls = 0;
      async *crawl(_url: string, _options: CrawlOptions): AsyncGenerator<CrawlPage> {
        this.crawlCalls++;
        throw new Error('browser.crawl must not be called when page 1 already fills the budget');
      }
    }
    const browser = new NoCrawlBrowser();
    const outcome = await planRun(
      { source: { ...LISTING_SOURCE, budget: { max_pages: 2, max_items: 2, mode: 'first_n' } }, schema: SCHEMA, inputSet: INPUT_SET },
      {
        browser,
        agent: null, acquireLock: noopLock,
        extract: fakeExtract([{ detail_url: '/p/1' }, { detail_url: '/p/2' }]),
      },
    );
    expect(browser.crawlCalls).toBe(0);
    expect(outcome.items.filter((i) => i.kind === 'detail')).toHaveLength(2);
    expect(outcome.warnings).toContain('budget reached: 2 items');
  });

  it('emits one detail item per input row for a detail-mode source, with no listing capture', async () => {
    const outcome = await planRun(
      {
        source: { listingMode: 'detail', inputStrategy: 'direct', urlTemplate: null, budget: {} },
        schema: SCHEMA,
        inputSet: { columns: [{ name: 'url', primary: true }], rows: [{ url: 'https://example.com/p/9' }] },
      },
      {
        browser: new FakeBrowser(),
        agent: null, acquireLock: noopLock,
        extract: async () => { throw new Error('detail-mode planning must not capture a listing page'); },
      },
    );
    expect(outcome.items).toEqual([
      {
        kind: 'detail',
        url: 'https://example.com/p/9',
        inputIndex: 0,
        inputValues: { url: 'https://example.com/p/9' },
        listingValues: {},
        pageNumber: null,
      },
    ]);
  });

  it('warns when a detail-mode source has listing-origin fields that can never resolve', async () => {
    const outcome = await planRun(
      {
        source: { listingMode: 'detail', inputStrategy: 'direct', urlTemplate: null, budget: {} },
        schema: SCHEMA,
        inputSet: { columns: [{ name: 'url', primary: true }], rows: [{ url: 'https://example.com/p/9' }] },
      },
      { browser: new FakeBrowser(), agent: null, acquireLock: noopLock, extract: async () => { throw new Error('unused'); } },
    );
    expect(outcome.warnings).toContain('1 listing-origin field(s) cannot resolve: this source has no listing phase');
  });

  it('reports a broken input row without losing the good ones', async () => {
    const outcome = await planRun(
      {
        source: { listingMode: 'detail', inputStrategy: 'direct', urlTemplate: null, budget: {} },
        schema: SCHEMA,
        inputSet: { columns: [{ name: 'url', primary: true }], rows: [{ url: 'nope' }, { url: 'https://example.com/p/9' }] },
      },
      { browser: new FakeBrowser(), agent: null, acquireLock: noopLock, extract: async () => { throw new Error('unused'); } },
    );
    expect(outcome.items).toHaveLength(1);
    expect(outcome.errors).toEqual([{ inputIndex: 0, message: 'not an absolute http(s) URL: nope' }]);
  });

  it('records a listing capture that failed as an error and keeps planning the other inputs', async () => {
    let call = 0;
    const outcome = await planRun(
      {
        source: LISTING_SOURCE,
        schema: SCHEMA,
        inputSet: { columns: [{ name: 'slug', primary: true }], rows: [{ slug: 'broken' }, { slug: 'shelves' }] },
      },
      {
        browser: new FakeBrowser(),
        agent: null, acquireLock: noopLock,
        extract: async () => {
          call++;
          if (call === 1) throw new Error('navigation timeout');
          return { data: [{ detail_url: '/p/1' }], plan: null, confidence: 0, sources: {}, fieldCount: { found: 0, total: 1 }, fieldsByTier: { requested: [], discovered: [] }, cacheHit: false };
        },
      },
    );
    expect(outcome.errors[0]).toEqual({ inputIndex: 0, message: 'listing capture failed: navigation timeout' });
    expect(outcome.items.filter((i) => i.kind === 'detail')).toHaveLength(1);
  });

  it('dedupes a URL that two different inputs both surface', async () => {
    const outcome = await planRun(
      {
        source: LISTING_SOURCE,
        schema: SCHEMA,
        inputSet: { columns: [{ name: 'slug', primary: true }], rows: [{ slug: 'a' }, { slug: 'b' }] },
      },
      { browser: new FakeBrowser(), agent: null, acquireLock: noopLock, extract: fakeExtract([{ detail_url: 'https://example.com/p/same' }]) },
    );
    expect(outcome.items.filter((i) => i.kind === 'detail')).toHaveLength(1);
  });
});
