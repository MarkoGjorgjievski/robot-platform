// D1 fix (zero-items-rca.md): the only control path through `planRun` that
// produced probe run f5b72f3a's signature — 1 listing item, 0 details, status
// `planned`, completely empty `runs.logs` — was page 1 absorbing 0 detail items
// and `planRun` `continue`-ing silently past it (the pre-fix `absorb(...) !==
// null` branch pushed no warning for the 'empty-page' stop reason). A 0-item
// listing plan must never be indistinguishable from a healthy one in
// `outcome.warnings` — which is what `runs.logs` renders.

import { describe, it, expect } from 'vitest';
import type { IBrowser, CrawlOptions, CrawlPage, PageCapture, ScrollOptions } from '@robot/browser';
import { planRun } from './plan-run.js';

const noopLock = async () => () => {};

const FAKE_CAPTURE = {
  url: 'https://example.com/c/shelves',
  html: '<html><body><a rel="next" href="/more">Next</a></body></html>',
  markdown: '',
  screenshot: Buffer.alloc(0),
  screenshotTiles: [],
  verdict: { kind: 'ok', status: 200 },
  title: 'Shelves',
  timestamp: 0,
  structuredData: { ldJson: [], nextData: null, initialState: null, meta: {} },
  interceptedRequests: [],
} as unknown as PageCapture;

class FakeBrowser implements IBrowser {
  async launch(): Promise<void> {}
  async capture(): Promise<PageCapture> { return FAKE_CAPTURE; }
  async evaluate<T>(): Promise<T> { throw new Error('not used'); }
  async setContentEvaluate<T>(): Promise<T> { throw new Error('not used'); }
  async close(): Promise<void> {}
  async *crawl(_url: string, _options: CrawlOptions): AsyncGenerator<CrawlPage> {}
  // eslint-disable-next-line require-yield
  async *scrollPages(_startUrl: string, _options: ScrollOptions): AsyncGenerator<CrawlPage> {
    throw new Error('not used');
  }
}

const LISTING_SOURCE = {
  listingMode: 'listing_to_detail' as const,
  inputStrategy: 'category' as const,
  urlTemplate: 'https://example.com/c/{slug}',
  budget: { max_pages: 2, max_items: 10, mode: 'first_n' },
};

const SCHEMA = [{ name: 'title', type: 'string' }];

const INPUT_SET = {
  columns: [{ name: 'slug', primary: true }],
  rows: [{ slug: 'shelves' }],
};

describe('planRun: a 0-item page-1 walk is never silent', () => {
  it('warns when page 1 resolves no detail_url on any row (the swallowed-AI-failure signature)', async () => {
    const outcome = await planRun(
      { source: LISTING_SOURCE, schema: SCHEMA, inputSet: INPUT_SET },
      {
        browser: new FakeBrowser(),
        agent: null, acquireLock: noopLock, lookupCache: async () => null, savePagination: async () => {},
        // Exactly run f5b72f3a's shape: no `rows`, `data` a single empty row,
        // `plan` null — the byte-identical outcome of a swallowed
        // agent.generateSelectors failure (zero-items-rca.md's H6).
        extract: async () => ({
          data: [{}],
          plan: null,
          confidence: 0,
          sources: {},
          fieldCount: { found: 0, total: 1 },
          fieldsByTier: { requested: [], discovered: [] },
          cacheHit: false,
        }),
      },
    );

    expect(outcome.items.filter((i) => i.kind === 'detail')).toHaveLength(0);
    expect(outcome.warnings.length).toBeGreaterThan(0);
    expect(outcome.warnings.some((w) => w.includes('shelves'))).toBe(true);
  });

  it('propagates a swallowed generateSelectors failure surfaced by runExtraction into its own warnings', async () => {
    const outcome = await planRun(
      { source: LISTING_SOURCE, schema: SCHEMA, inputSet: INPUT_SET },
      {
        browser: new FakeBrowser(),
        agent: null, acquireLock: noopLock, lookupCache: async () => null, savePagination: async () => {},
        extract: async () => ({
          data: [{}],
          plan: null,
          confidence: 0,
          sources: {},
          fieldCount: { found: 0, total: 1 },
          fieldsByTier: { requested: [], discovered: [] },
          cacheHit: false,
          warnings: ['XPath fallback (generateSelectors) failed: vision call timed out'],
        }),
      },
    );

    expect(outcome.warnings.some((w) => w.includes('vision call timed out'))).toBe(true);
  });
});
