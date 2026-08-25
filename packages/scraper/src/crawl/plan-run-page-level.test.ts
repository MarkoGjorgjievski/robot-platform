// packages/scraper/src/crawl/plan-run-page-level.test.ts
import { describe, it, expect } from 'vitest';
import type { IBrowser, CrawlOptions, CrawlPage, PageCapture, ScrollOptions } from '@robot/browser';
import { planRun } from './plan-run.js';
import type { ExtractionDeps } from '../extraction-orchestrator.js';

/** The real per-domain lock adds a 2s politeness delay between same-domain
 *  requests; tests inject this instead so they exercise the acquire/release
 *  contract without the wall clock. */
const noopLock = async () => () => {};

const FAKE_CAPTURE = {
  url: 'https://example.com/c/shelves',
  html: '<html><body><h1>Shelves</h1><a rel="next" href="/more">Next</a></body></html>',
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
  /** Pages 2+, returned by crawl() — empty by default so existing single-page tests are unaffected. */
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

  // Reachable now: max_pages:1 (this file's REQUEST budget) routes straight to
  // the scroll fallback without detecting HTML/api-param pagination first.
  // Empty by default, same as crawl() above, so these page-level tests — none
  // of which are ABOUT pagination — see the same single-page outcome as before.
  // eslint-disable-next-line require-yield
  async *scrollPages(_startUrl: string, _options: ScrollOptions): AsyncGenerator<CrawlPage> {}
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
      agent: null, acquireLock: noopLock,
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
      agent: null, acquireLock: noopLock,
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
      agent: null, acquireLock: noopLock,
      extract: async (request) => {
        pageTypes.push(request.pageType ?? 'detail');
        if (pageTypes.length === 1) return { ...OUTCOME_SHAPE, data: [{ detail_url: '/p/1' }] };
        return { ...OUTCOME_SHAPE, data: [{ category: 'Shelves' }] };
      },
    });
    expect(pageTypes).toEqual(['listing', 'detail']);
  });

  it('lets a per-row value win over the page-level one for the same field', async () => {
    // Page 1's rows never carry `category` (so it lands in pageLevelValues via
    // the document-mode pass), but a row discovered on PAGE 2 — reached through
    // crawl(), replaying page 1's plan — DOES carry its own `category`. Because
    // `unresolved` is computed from page 1's aggregate only, this is the one
    // shape where a real same-page-load conflict between pageLevelValues and a
    // row's own listingValues is possible: page 1's items must fall back to the
    // page-level value, while page 2's item must keep its own.
    const PAGINATED_REQUEST = {
      ...REQUEST,
      source: { ...REQUEST.source, budget: { max_pages: 2 } },
    };
    const browser = new FakeBrowser([
      {
        url: 'https://example.com/c/shelves?page=2',
        pageNumber: 2,
        data: [{ detail_url: '/p/2', category: 'Bookcases' }],
        totalRows: 1,
      },
    ]);
    const outcome = await planRun(PAGINATED_REQUEST, {
      browser,
      agent: null, acquireLock: noopLock, lookupCache: async () => null, savePagination: async () => {},
      extract: async (request) =>
        request.pageType === 'listing'
          ? { ...OUTCOME_SHAPE, data: [{ detail_url: '/p/1', listing_price: '79' }] }
          : { ...OUTCOME_SHAPE, data: [{ category: 'Shelves' }] },
    });
    const details = outcome.items.filter((i) => i.kind === 'detail');
    expect(details[0]?.listingValues.category).toBe('Shelves'); // page 1: falls back to page-level
    expect(details[1]?.listingValues.category).toBe('Bookcases'); // page 2: keeps its own row value
  });

  it('skips the second pass entirely when every listing field resolved per row', async () => {
    let calls = 0;
    await planRun(REQUEST, {
      browser: new FakeBrowser(),
      agent: null, acquireLock: noopLock,
      extract: async () => {
        calls++;
        return { ...OUTCOME_SHAPE, data: [{ detail_url: '/p/1', category: 'Shelves', listing_price: '79' }] };
      },
    });
    expect(calls).toBe(1);
  });

  it('captures the listing page only once across both passes, and forwards that same capture to both extract() calls', async () => {
    const browser = new FakeBrowser();
    const seenCaptures: Array<PageCapture | undefined> = [];
    await planRun(REQUEST, {
      browser,
      agent: null, acquireLock: noopLock,
      extract: async (request, deps) => {
        seenCaptures.push(deps.capture);
        return request.pageType === 'listing'
          ? { ...OUTCOME_SHAPE, data: [{ detail_url: '/p/1' }] }
          : { ...OUTCOME_SHAPE, data: [{ category: 'Shelves' }] };
      },
    });
    expect(browser.captures).toBe(1);
    // Both the row pass and the document-mode pass must receive deps.capture —
    // a regression that drops it from the second call would still only fetch
    // the page once here (extract is mocked), but in production it would
    // trigger a real second page load inside runExtraction, defeating the
    // whole point of the task.
    expect(seenCaptures).toHaveLength(2);
    expect(seenCaptures[0]).toBeDefined();
    expect(seenCaptures[1]).toBe(seenCaptures[0]);
  });

  it('cache-isolates the document-mode pass so it cannot touch the detail partition', async () => {
    // The second pass says `pageType: 'detail'` only to get document-mode
    // extraction — but pageType is ALSO the domain-cache partition key. Without
    // the overrides below, a pass over a LISTING page bumps (domain,'detail')'s
    // run counts and consecutiveFailures, seeds a detail cache row from the
    // listing page's intercepted requests, and merges listing XPaths into the
    // detail partition's fieldPaths.
    const seen: Array<Pick<ExtractionDeps, 'lookupCache' | 'saveCache'>> = [];
    await planRun(REQUEST, {
      browser: new FakeBrowser(),
      agent: null, acquireLock: noopLock,
      extract: async (request, deps) => {
        seen.push({ lookupCache: deps.lookupCache, saveCache: deps.saveCache });
        return request.pageType === 'listing'
          ? { ...OUTCOME_SHAPE, data: [{ detail_url: '/p/1' }] }
          : { ...OUTCOME_SHAPE, data: [{ category: 'Shelves' }] };
      },
    });
    expect(seen).toHaveLength(2);

    // Pass 1 (row mode, pageType 'listing') is partitioned correctly, so it
    // keeps the normal cache — that learning is what makes run 2 free.
    expect(seen[0]?.lookupCache).toBeUndefined();
    expect(seen[0]?.saveCache).toBeUndefined();

    // Pass 2 is isolated: reads nothing, writes nothing.
    expect(seen[1]?.lookupCache).toBeTypeOf('function');
    expect(seen[1]?.saveCache).toBeTypeOf('function');
    await expect(seen[1]!.lookupCache!('example.com', 'detail')).resolves.toBeNull();
    await expect(
      seen[1]!.saveCache!({ domain: 'example.com', pageType: 'detail' } as never),
    ).resolves.toBeUndefined();
  });
});
