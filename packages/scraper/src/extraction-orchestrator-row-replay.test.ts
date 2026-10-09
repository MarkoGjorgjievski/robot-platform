// D1 fix (zero-items-rca.md): `detail_url` and every other row-scoped field
// used to be resolvable ONLY by a fresh, nondeterministic `agent.generateSelectors`
// call on every single listing plan, warm domain or not — both cached tiers
// (STEP 1.5) deliberately exclude row-scoped fields because they execute
// page-level (one row via FIRST_ORDERED_NODE_TYPE), which would have queued the
// wrong URL. This tier replays a VERIFIED row plan (persisted after a prior AI
// success) the same way STEP 3 itself extracts rows — `row_xpath` matches every
// row, each field's xpath is evaluated relative to its own row — so the
// exclusion's reason does not apply to it.

import { describe, it, expect } from 'vitest';
import type { IBrowser, PageCapture, CrawlPage, CrawlOptions, ScrollOptions } from '@robot/browser';
import type { ExtractionAgent } from './extraction-orchestrator.js';
import { runExtraction } from './extraction-orchestrator.js';
import type { DomainCache } from './domain-cache.js';

const CAPTURE: PageCapture = {
  url: 'https://example.com/c/shelves',
  html: '<html><body><p>Realistic on-page content so checkPageHealth sees a real page rather than an empty interstitial. This paragraph only exists to carry the fixture past the almost-no-content gate.</p></body></html>',
  markdown: '',
  screenshot: Buffer.alloc(0),
  screenshotTiles: [],
  verdict: { kind: 'ok', status: 200 },
  title: 'Shelves',
  timestamp: 0,
  structuredData: { ldJson: [], nextData: null, initialState: null, meta: {} },
  interceptedRequests: [],
};

const VERIFIED_CACHE: DomainCache = {
  id: 'cache-1',
  domain: 'example.com',
  pageType: 'listing',
  apiEndpoints: [],
  fieldPaths: {},
  popupSelectors: [],
  hasJsonLd: false,
  hasNextData: false,
  totalRuns: 3,
  successfulRuns: 3,
  consecutiveFailures: 0,
  successRate: 100,
  paginationConfig: null,
  rowSelector: {
    xpath: '//li',
    source: 'verified',
    setAt: new Date().toISOString(),
    fields: [{ name: 'detail_url', xpath: './/a/@href', attribute: 'href', transform: 'absolute_url' }],
    hits: 3,
    misses: 0,
  },
  candidateCatalogue: {},
};

class ScriptedBrowser implements IBrowser {
  setContentCalls = 0;
  constructor(private readonly responses: Array<{ data: Record<string, unknown>[] }>) {}
  async launch(): Promise<void> {}
  async capture(): Promise<PageCapture> { return CAPTURE; }
  async evaluate<T>(): Promise<T> { throw new Error('not used'); }
  async setContentEvaluate<T>(): Promise<T> {
    const response = this.responses[this.setContentCalls] ?? { data: [] };
    this.setContentCalls++;
    return response as T;
  }
  async close(): Promise<void> {}
  async *crawl(_url: string, _options: CrawlOptions): AsyncGenerator<CrawlPage> {}
  // eslint-disable-next-line require-yield
  async *scrollPages(_startUrl: string, _options: ScrollOptions): AsyncGenerator<CrawlPage> {
    throw new Error('not used');
  }
}

const DETAIL_URL_FIELDS = [
  { name: 'detail_url', type: 'url', rowScopedOnly: true },
];

describe('cached row-plan replay tier', () => {
  it('resolves row-scoped fields from a verified row plan and never calls the agent', async () => {
    const browser = new ScriptedBrowser([
      { data: [{ detail_url: 'https://example.com/p/1' }, { detail_url: 'https://example.com/p/2' }] },
    ]);
    let generateSelectorsCalls = 0;
    const agent: ExtractionAgent = {
      extractVariants: async () => { throw new Error('not used'); },
      extractFromApi: async () => { throw new Error('not used'); },
      generateSelectors: async () => { generateSelectorsCalls++; throw new Error('the AI rung must not run when the replay tier succeeds'); },
      retrySelectorGeneration: async () => { throw new Error('not used'); },
    };

    const outcome = await runExtraction(
      { url: 'https://example.com/c/shelves', fields: DETAIL_URL_FIELDS, pageType: 'listing' },
      {
        browser, agent, capture: CAPTURE,
        lookupCache: async () => VERIFIED_CACHE,
        saveCache: async () => {},
        acquireLock: async () => () => {},
      },
    );

    expect(generateSelectorsCalls).toBe(0);
    expect(browser.setContentCalls).toBe(1);
    expect(outcome.rows).toEqual([
      { detail_url: 'https://example.com/p/1' },
      { detail_url: 'https://example.com/p/2' },
    ]);
    expect(outcome.sources.detail_url).toBe('xpath');
  });

  it('falls through to the AI rung when the replay yields no rows, then persists the new plan', async () => {
    const browser = new ScriptedBrowser([
      { data: [] }, // replay miss
      { data: [{ detail_url: 'https://example.com/p/9' }] }, // AI-driven STEP 3 extraction
    ]);
    let generateSelectorsCalls = 0;
    const agent: ExtractionAgent = {
      extractVariants: async () => { throw new Error('not used'); },
      extractFromApi: async () => { throw new Error('not used'); },
      generateSelectors: async () => {
        generateSelectorsCalls++;
        return {
          row_xpath: '//div[@class="card"]',
          fields: [{ name: 'detail_url', xpath: './/a/@href', attribute: 'href', transform: 'absolute_url' }],
        };
      },
      retrySelectorGeneration: async () => { throw new Error('not used'); },
    };

    const savedPlans: Array<{ domain: string; pageType: string; plan: { rowXpath: string; fields: unknown[] } }> = [];
    const missesRecorded: Array<{ domain: string; pageType: string }> = [];

    const outcome = await runExtraction(
      { url: 'https://example.com/c/shelves', fields: DETAIL_URL_FIELDS, pageType: 'listing' },
      {
        browser, agent, capture: CAPTURE,
        lookupCache: async () => VERIFIED_CACHE,
        saveCache: async () => {},
        acquireLock: async () => () => {},
        saveVerifiedRowPlan: async (domain, pageType, plan) => { savedPlans.push({ domain, pageType, plan }); },
        recordRowPlanMiss: async (domain, pageType) => { missesRecorded.push({ domain, pageType }); },
      },
    );

    expect(generateSelectorsCalls).toBe(1);
    expect(outcome.rows).toEqual([{ detail_url: 'https://example.com/p/9' }]);
    expect(outcome.sources.detail_url).toBe('xpath');

    expect(missesRecorded).toEqual([{ domain: 'example.com', pageType: 'listing' }]);
    expect(savedPlans).toHaveLength(1);
    expect(savedPlans[0]?.domain).toBe('example.com');
    expect(savedPlans[0]?.plan.rowXpath).toBe('//div[@class="card"]');
    expect(savedPlans[0]?.plan.fields).toEqual([
      { name: 'detail_url', xpath: './/a/@href', attribute: 'href', transform: 'absolute_url' },
    ]);
  });
});

describe('row-plan replay survives a later STEP 3 call for a different field', () => {
  it('keeps the replay-resolved field in outcome.rows when STEP 3 resolves another field', async () => {
    // runListingAnalysis always requests detail_url alongside every base field
    // (analysis-orchestrator.ts:394-399) — the two prior tests above only ever
    // request detail_url alone, which is the gap that let this through: STEP 3
    // overwrites `extractedRows` wholesale with ITS OWN row extraction (scoped
    // to whatever IT was asked for), silently dropping detail_url from every
    // row even though STEP 2.5 just resolved it.
    const browser = new ScriptedBrowser([
      { data: [{ detail_url: 'https://example.com/p/1' }, { detail_url: 'https://example.com/p/2' }] }, // STEP 2.5 replay
      { data: [{ title: 'A' }, { title: 'B' }] }, // STEP 3, asked only for `title`
    ]);
    let generateSelectorsCalls = 0;
    const agent: ExtractionAgent = {
      extractVariants: async () => { throw new Error('not used'); },
      extractFromApi: async () => { throw new Error('not used'); },
      generateSelectors: async (_capture, fields) => {
        generateSelectorsCalls++;
        expect(fields.map((f) => f.name)).toEqual(['title']);
        return {
          row_xpath: '//div[@class="card"]',
          fields: [{ name: 'title', xpath: './/h2', attribute: 'textContent', transform: 'trim' }],
        };
      },
      retrySelectorGeneration: async () => { throw new Error('not used'); },
    };

    const outcome = await runExtraction(
      {
        url: 'https://example.com/c/shelves',
        fields: [...DETAIL_URL_FIELDS, { name: 'title', type: 'string' }],
        pageType: 'listing',
      },
      {
        browser, agent, capture: CAPTURE,
        lookupCache: async () => VERIFIED_CACHE,
        saveCache: async () => {},
        acquireLock: async () => () => {},
      },
    );

    expect(generateSelectorsCalls).toBe(1);
    expect(outcome.rows).toEqual([
      { detail_url: 'https://example.com/p/1', title: 'A' },
      { detail_url: 'https://example.com/p/2', title: 'B' },
    ]);
    // The returned plan matters too: planRun replays `page1.plan` to walk pages
    // 2+ (`buildExtractionScript(page1.plan, ...)`) — a plan missing the
    // detail_url field def would silently starve every later page as well.
    expect(outcome.plan?.fields.map((f) => f.name).sort()).toEqual(['detail_url', 'title']);
  });
});

describe('a successful replay records a hit on the persisted row plan', () => {
  it('calls recordRowPlanHit with the domain and page type', async () => {
    const browser = new ScriptedBrowser([
      { data: [{ detail_url: 'https://example.com/p/1' }] },
    ]);
    const agent: ExtractionAgent = {
      extractVariants: async () => { throw new Error('not used'); },
      extractFromApi: async () => { throw new Error('not used'); },
      generateSelectors: async () => { throw new Error('the AI rung must not run when the replay tier succeeds'); },
      retrySelectorGeneration: async () => { throw new Error('not used'); },
    };
    const hitsRecorded: Array<{ domain: string; pageType: string }> = [];

    await runExtraction(
      { url: 'https://example.com/c/shelves', fields: DETAIL_URL_FIELDS, pageType: 'listing' },
      {
        browser, agent, capture: CAPTURE,
        lookupCache: async () => VERIFIED_CACHE,
        saveCache: async () => {},
        acquireLock: async () => () => {},
        recordRowPlanHit: async (domain, pageType) => { hitsRecorded.push({ domain, pageType }); },
      },
    );

    expect(hitsRecorded).toEqual([{ domain: 'example.com', pageType: 'listing' }]);
  });
});

describe('honesty on a swallowed generateSelectors failure', () => {
  it('surfaces the failure into outcome.warnings instead of console-only', async () => {
    const browser = new ScriptedBrowser([]);
    const agent: ExtractionAgent = {
      extractVariants: async () => { throw new Error('not used'); },
      extractFromApi: async () => { throw new Error('not used'); },
      generateSelectors: async () => { throw new Error('vision call timed out'); },
      retrySelectorGeneration: async () => { throw new Error('not used'); },
    };

    const outcome = await runExtraction(
      { url: 'https://example.com/p/1', fields: [{ name: 'title', type: 'string' }], pageType: 'detail' },
      {
        browser, agent, capture: CAPTURE,
        lookupCache: async () => null,
        saveCache: async () => {},
        acquireLock: async () => () => {},
      },
    );

    expect(outcome.warnings ?? []).not.toEqual([]);
    expect((outcome.warnings ?? []).some((w) => w.includes('vision call timed out'))).toBe(true);
  });
});
