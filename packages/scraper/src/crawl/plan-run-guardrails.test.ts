// packages/scraper/src/crawl/plan-run-guardrails.test.ts
//
// The guardrails phase 1 leans on but did not have: the item cap in detail
// mode, the inputs the budget cut off, the per-input breakdown spec §2.5
// promises, and the domain lock spec §3 calls the reason no other concurrency
// control is needed.

import { describe, it, expect } from 'vitest';
import type { IBrowser, CrawlOptions, CrawlPage, PageCapture } from '@robot/browser';
import { planRun } from './plan-run.js';
import { acquireDomainLock } from '../domain-lock.js';

const FAKE_CAPTURE = {
  url: 'https://example.com/c/shelves',
  html: '<html><body><a rel="next" href="/more">Next</a></body></html>',
  markdown: '',
  screenshot: Buffer.alloc(0),
  screenshotTiles: [],
  title: 'Shelves',
  timestamp: 0,
  structuredData: { ldJson: [], nextData: null, initialState: null, meta: {} },
  interceptedRequests: [],
} as unknown as PageCapture;

/** The real lock spaces same-domain requests 2s apart; tests that are not about
 *  the lock inject this so they do not pay the wall clock for it. */
const noopLock = async () => () => {};

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

const OUTCOME_SHAPE = {
  plan: { row_xpath: '//li', fields: [] },
  confidence: 0.9,
  sources: {},
  fieldCount: { found: 1, total: 1 },
  fieldsByTier: { requested: [], discovered: [] },
  cacheHit: false,
};
const rowsOf = (data: Array<Record<string, unknown>>) => ({ ...OUTCOME_SHAPE, data });

const LISTING_SOURCE = {
  listingMode: 'listing_to_detail' as const,
  inputStrategy: 'category' as const,
  urlTemplate: 'https://example.com/c/{slug}',
  budget: { max_pages: 2, max_items: 10, mode: 'first_n' },
};
const DETAIL_SOURCE = {
  listingMode: 'detail' as const,
  inputStrategy: 'direct' as const,
  urlTemplate: null,
};
const SCHEMA = [
  { name: 'title', type: 'string' },
  { name: 'category', type: 'string', origin: 'listing' as const },
];
const ONE_INPUT = { columns: [{ name: 'slug', primary: true }], rows: [{ slug: 'shelves' }] };
const TWO_INPUTS = { columns: [{ name: 'slug', primary: true }], rows: [{ slug: 'a' }, { slug: 'b' }] };
const urlRows = (n: number) => Array.from({ length: n }, (_, i) => ({ url: `https://example.com/p/${i}` }));
const NEVER_EXTRACT = async () => { throw new Error('detail-mode planning must not extract'); };

// ─── I1: the detail-mode branch must respect the item cap ────────────────────

describe('detail-mode item cap', () => {
  it('caps a detail-mode InputSet at the item cap and names the rows it dropped', async () => {
    const outcome = await planRun(
      {
        source: { ...DETAIL_SOURCE, budget: { max_items: 2, mode: 'first_n' } },
        schema: SCHEMA,
        inputSet: { columns: [{ name: 'url', primary: true }], rows: urlRows(5) },
      },
      { browser: new FakeBrowser(), agent: null, acquireLock: noopLock, extract: NEVER_EXTRACT },
    );
    expect(outcome.items).toHaveLength(2);
    expect(outcome.items.map((i) => i.url)).toEqual(['https://example.com/p/0', 'https://example.com/p/1']);
    expect(outcome.warnings).toContain('budget reached: 2 items; 3 input row(s) dropped');
  });

  it('applies the 5000 hard ceiling even when the budget asks for everything', async () => {
    const outcome = await planRun(
      {
        source: { ...DETAIL_SOURCE, budget: { mode: 'all', max_items: 999999 } },
        schema: SCHEMA,
        inputSet: { columns: [{ name: 'url', primary: true }], rows: urlRows(5003) },
      },
      { browser: new FakeBrowser(), agent: null, acquireLock: noopLock, extract: NEVER_EXTRACT },
    );
    expect(outcome.items).toHaveLength(5000);
    expect(outcome.warnings).toContain('budget reached: 5000 items; 3 input row(s) dropped');
  });

  it('reports the dropped rows in the per-input breakdown', async () => {
    const outcome = await planRun(
      {
        source: { ...DETAIL_SOURCE, budget: { max_items: 1, mode: 'first_n' } },
        schema: SCHEMA,
        inputSet: { columns: [{ name: 'url', primary: true }], rows: urlRows(3) },
      },
      { browser: new FakeBrowser(), agent: null, acquireLock: noopLock, extract: NEVER_EXTRACT },
    );
    expect(outcome.inputs).toEqual([
      { inputIndex: 0, itemCount: 1, status: 'planned' },
      { inputIndex: 1, itemCount: 0, status: 'skipped_budget' },
      { inputIndex: 2, itemCount: 0, status: 'skipped_budget' },
    ]);
  });
});

// ─── I2: inputs the budget cut off, and the per-input breakdown ──────────────

describe('per-input breakdown', () => {
  it('warns about and reports the inputs it never planned when the first exhausts the budget', async () => {
    let extractCalls = 0;
    const outcome = await planRun(
      {
        source: { ...LISTING_SOURCE, budget: { max_pages: 1, max_items: 1, mode: 'first_n' } },
        schema: SCHEMA,
        inputSet: TWO_INPUTS,
      },
      {
        browser: new FakeBrowser(),
        agent: null,
        acquireLock: noopLock,
        extract: async () => {
          extractCalls++;
          return rowsOf([{ detail_url: '/p/1', category: 'A' }, { detail_url: '/p/2', category: 'A' }]);
        },
      },
    );
    // Input b is never fetched...
    expect(extractCalls).toBe(1);
    // ...and that is stated rather than left silent.
    expect(outcome.warnings).toContain('budget reached: 1 items; 1 input(s) not planned');
    expect(outcome.inputs).toEqual([
      { inputIndex: 0, itemCount: 1, status: 'planned' },
      { inputIndex: 1, itemCount: 0, status: 'skipped_budget' },
    ]);
  });

  it('marks an input whose listing capture threw as errored, and the next one as planned', async () => {
    let call = 0;
    const outcome = await planRun(
      { source: LISTING_SOURCE, schema: SCHEMA, inputSet: TWO_INPUTS },
      {
        browser: new FakeBrowser(),
        agent: null,
        acquireLock: noopLock,
        extract: async () => {
          call++;
          if (call === 1) throw new Error('navigation timeout');
          return rowsOf([{ detail_url: '/p/1', category: 'A' }, { detail_url: '/p/2', category: 'A' }]);
        },
      },
    );
    expect(outcome.inputs).toEqual([
      { inputIndex: 0, itemCount: 0, status: 'error' },
      { inputIndex: 1, itemCount: 2, status: 'planned' },
    ]);
  });

  it('reports a row that never produced a URL at all as errored', async () => {
    const outcome = await planRun(
      {
        source: { ...DETAIL_SOURCE, budget: {} },
        schema: SCHEMA,
        inputSet: { columns: [{ name: 'url', primary: true }], rows: [{ url: 'nope' }, { url: 'https://example.com/p/9' }] },
      },
      { browser: new FakeBrowser(), agent: null, acquireLock: noopLock, extract: NEVER_EXTRACT },
    );
    expect(outcome.inputs).toEqual([
      { inputIndex: 0, itemCount: 0, status: 'error' },
      { inputIndex: 1, itemCount: 1, status: 'planned' },
    ]);
  });
});

// ─── I4: phase 1 fetches under the domain lock ───────────────────────────────

describe('domain lock', () => {
  it('holds the lock across the whole of an input’s fetching', async () => {
    const events: string[] = [];
    class TracingBrowser extends FakeBrowser {
      async capture(): Promise<PageCapture> { events.push('capture'); return FAKE_CAPTURE; }
      async *crawl(_url: string, _options: CrawlOptions): AsyncGenerator<CrawlPage> {
        events.push('crawl');
        yield { url: 'https://example.com/c/shelves?page=2', pageNumber: 2, data: [{ detail_url: '/p/3' }], totalRows: 1 };
      }
    }
    const domains: string[] = [];
    await planRun(
      { source: LISTING_SOURCE, schema: SCHEMA, inputSet: ONE_INPUT },
      {
        browser: new TracingBrowser(),
        agent: null,
        acquireLock: async (domain: string) => {
          domains.push(domain);
          events.push('acquire');
          return () => { events.push('release'); };
        },
        extract: async () => {
          events.push('extract');
          return rowsOf([{ detail_url: '/p/1', category: 'A' }]);
        },
      },
    );
    expect(domains).toEqual(['example.com']);
    // The lock brackets everything: no fetch happens outside it, and it is
    // released only once this input's pagination is finished.
    expect(events[0]).toBe('acquire');
    expect(events[events.length - 1]).toBe('release');
    expect(events).toContain('capture');
    expect(events).toContain('crawl');
    expect(events.filter((e) => e === 'release')).toHaveLength(1);
  });

  it('releases the lock even when the listing capture throws', async () => {
    const events: string[] = [];
    await planRun(
      { source: LISTING_SOURCE, schema: SCHEMA, inputSet: ONE_INPUT },
      {
        browser: new FakeBrowser(),
        agent: null,
        acquireLock: async () => { events.push('acquire'); return () => { events.push('release'); }; },
        extract: async () => { throw new Error('navigation timeout'); },
      },
    );
    expect(events).toEqual(['acquire', 'release']);
  });

  it('hands every extract call a lock override, so the inner acquire cannot wait on the outer one', async () => {
    const locks: unknown[] = [];
    await planRun(
      { source: { ...LISTING_SOURCE, budget: { max_pages: 1 } }, schema: SCHEMA, inputSet: ONE_INPUT },
      {
        browser: new FakeBrowser(),
        agent: null,
        acquireLock: noopLock,
        extract: async (request, deps) => {
          locks.push(deps.acquireLock);
          return request.pageType === 'listing'
            ? rowsOf([{ detail_url: '/p/1' }])
            : rowsOf([{ category: 'Shelves' }]);
        },
      },
    );
    // The row pass and the page-level pass — both must carry an override.
    expect(locks).toHaveLength(2);
    for (const lock of locks) expect(typeof lock).toBe('function');
  });

  it('does not deadlock against the REAL per-domain lock', async () => {
    // planRun holds acquireDomainLock('deadlock-probe.example') for the whole
    // input. runExtraction acquires that SAME lock internally, and
    // acquireDomainLock waits on any in-flight holder — so unless planRun
    // overrides the inner acquire, it waits on itself forever. No lock is
    // injected here on purpose: this exercises the real one, and the fake
    // extract reproduces runExtraction's own `acquireLock = acquireDomainLock`
    // default. A regression shows up as this test timing out.
    const outcome = await planRun(
      {
        source: {
          ...LISTING_SOURCE,
          urlTemplate: 'https://deadlock-probe.example/c/{slug}',
          budget: { max_pages: 1, max_items: 5 },
        },
        schema: SCHEMA,
        inputSet: ONE_INPUT,
      },
      {
        browser: new FakeBrowser(),
        agent: null,
        extract: async (request, deps) => {
          const acquire = deps.acquireLock ?? acquireDomainLock;
          const release = await acquire('deadlock-probe.example');
          release();
          return request.pageType === 'listing'
            ? rowsOf([{ detail_url: '/p/1' }])
            : rowsOf([{ category: 'Shelves' }]);
        },
      },
    );
    expect(outcome.items.filter((i) => i.kind === 'detail')).toHaveLength(1);
  }, 5000);
});
