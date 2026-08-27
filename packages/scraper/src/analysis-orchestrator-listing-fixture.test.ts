// Tier 1 style: does `runAnalysis({ pageType: 'listing' })` actually count rows
// and detect pagination on a REAL captured listing page? Every other listing
// test (analysis-orchestrator-listing.test.ts) stubs `setContentEvaluate` to
// return canned rows, so none of them prove the row selectors this test's
// agent stub returns actually MATCH the real page — only that the plumbing
// around whatever the executor returns is wired correctly.
//
// Fixture-vs-stub decision (see task-5-report.md for the full reasoning): the
// two real corpus fixtures used here (`abebooks-search-listing`,
// `newegg-gpu-listing`) carry NO `fieldPaths`/`expected` goldens — they were
// captured for pagination-detector-real-pages.test.ts, not for Tier 1's
// field-replay harness (`__fixtures__/replay.ts`, which also always passes
// `agent: null` and so never reaches row extraction at all). Real row
// extraction needs an agent-generated plan, so this test supplies one: an
// `ExtractionAgent` stub whose `generateSelectors` returns a row_xpath and
// detail_url xpath HAND-VERIFIED against each fixture's actual markup
// (below). Chosen over "stub the extract dependency and assert only the
// report plumbing" because working selectors were cheap to find (a few
// greps) and prove something stubbing a row count cannot: that
// `runListingAnalysis` drives the REAL production executor script, in REAL
// Chromium (`setContentEvaluate`), against a REAL captured page, the same way
// `link-enumeration-fixture.test.ts` already does for the crawler's own link
// enumeration.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PlaywrightBrowser } from '@robot/browser';
import type { CaptureOptions, CrawlOptions, CrawlPage, IBrowser, PageCapture, ScrollOptions } from '@robot/browser';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { runAnalysis } from './analysis-orchestrator.js';
import type { AnalysisAgent } from './analysis-orchestrator.js';
import { DETAIL_URL_FIELD } from './crawl/enumerate-detail-urls.js';

const CORPUS = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'corpus');
type CorpusFixture = {
  url: string; html: string;
  structuredData: PageCapture['structuredData'];
  interceptedRequests: PageCapture['interceptedRequests'];
};
const load = (name: string): CorpusFixture =>
  JSON.parse(readFileSync(join(CORPUS, `${name}.json`), 'utf-8')) as CorpusFixture;

/** Serves one prepared capture; every `evaluate`/`setContentEvaluate` runs the
 *  REAL generated script, in REAL Chromium, against the frozen fixture HTML —
 *  mirroring `__fixtures__/replay.ts`'s `FixtureBrowser`. */
class FixtureBrowser implements IBrowser {
  captureCalls = 0;
  constructor(private readonly capture_: PageCapture, private readonly inner: PlaywrightBrowser) {}
  async launch(): Promise<void> { await this.inner.launch({ headless: true }); }
  async capture(): Promise<PageCapture> { this.captureCalls++; return this.capture_; }
  async evaluate<T = unknown>(_url: string, script: string, _options?: CaptureOptions): Promise<T> {
    return this.inner.setContentEvaluate<T>(this.capture_.html, script);
  }
  async setContentEvaluate<T = unknown>(html: string, script: string): Promise<T> {
    return this.inner.setContentEvaluate<T>(html, script);
  }
  async close(): Promise<void> { await this.inner.close(); }
  async *crawl(_startUrl: string, _options: CrawlOptions): AsyncGenerator<CrawlPage> { return; }
  // eslint-disable-next-line require-yield
  async *scrollPages(_startUrl: string, _options: ScrollOptions): AsyncGenerator<CrawlPage> {
    throw new Error('FixtureBrowser cannot scroll — fixture replay is a frozen snapshot');
  }
}

function makeCapture(fixture: CorpusFixture): PageCapture {
  return {
    url: fixture.url, html: fixture.html, markdown: '',
    screenshot: Buffer.alloc(0), screenshotTiles: [], title: '', timestamp: 0,
    structuredData: fixture.structuredData, interceptedRequests: fixture.interceptedRequests,
  };
}

/** No content fields to discover — this test proves row extraction, not
 *  schema discovery, so `detail_url` (always ensured by `runListingAnalysis`)
 *  is the only field in play. */
function agentWithPlan(plan: { row_xpath: string; fields: Array<{ name: string; xpath: string; attribute: string; transform: 'absolute_url' }> }): AnalysisAgent {
  return {
    async discoverSchema() {
      return { page_type: 'listing' as const, description: 'x', fields: [] };
    },
    // Extra methods below make this object also satisfy `ExtractionAgent`,
    // which `runListingAnalysis` needs — see the type note in
    // analysis-orchestrator.ts next to the `agent as unknown as ExtractionAgent` cast.
    async generateSelectors() { return plan; },
    async extractVariants() { throw new Error('extractVariants must not be called'); },
    async extractFromApi() { throw new Error('extractFromApi must not be called'); },
    async retrySelectorGeneration() { throw new Error('retrySelectorGeneration must not be called'); },
  } as AnalysisAgent;
}

describe('runAnalysis — listing, real corpus fixtures (Tier 1 style)', () => {
  let inner: PlaywrightBrowser;
  beforeAll(async () => {
    inner = new PlaywrightBrowser();
    await inner.launch({ headless: true });
  }, 60_000);
  afterAll(async () => { await inner.close(); });

  it('AbeBooks: real rows off the real page, and its own declared next-page link — not a guessed selector', async () => {
    const fixture = load('abebooks-search-listing');
    const capture = makeCapture(fixture);
    const browser = new FixtureBrowser(capture, inner);
    await browser.launch();

    // Verified against the fixture's actual markup: 30 <li data-srp-item-role="listing">
    // rows, each carrying <a data-test-id="listing-title-link" href="...">.
    const agent = agentWithPlan({
      row_xpath: '//li[@data-srp-item-role="listing"]',
      fields: [{ name: DETAIL_URL_FIELD, xpath: './/a[@data-test-id="listing-title-link"]', attribute: 'href', transform: 'absolute_url' }],
    });

    const out = await runAnalysis(
      { url: fixture.url, pageType: 'listing' },
      { browser, agent, lookupCache: async () => null, saveCache: async () => {} },
    );

    expect(out.listing).toBeDefined();
    expect(out.listing!.rowsFound).toBe(30);
    expect(out.listing!.paginationStrategy).toBe('url-pattern');
    expect(out.listing!.sampleDetailUrls).toHaveLength(5);
    for (const url of out.listing!.sampleDetailUrls) expect(url).toContain('abebooks.com');
    expect(browser.captureCalls).toBe(1);
  }, 60_000);

  it('Newegg: real rows off the real page, and no pagination markup at all — reports none rather than a guess', async () => {
    const fixture = load('newegg-gpu-listing');
    const capture = makeCapture(fixture);
    const browser = new FixtureBrowser(capture, inner);
    await browser.launch();

    // Verified against the fixture's actual markup: 12 <div class~="item-container">
    // tiles, each carrying <a class="item-title" href="...">.
    const agent = agentWithPlan({
      row_xpath: '//div[contains(@class,"item-container")]',
      fields: [{ name: DETAIL_URL_FIELD, xpath: './/a[@class="item-title"]', attribute: 'href', transform: 'absolute_url' }],
    });

    const out = await runAnalysis(
      { url: fixture.url, pageType: 'listing' },
      { browser, agent, lookupCache: async () => null, saveCache: async () => {} },
    );

    expect(out.listing).toBeDefined();
    expect(out.listing!.rowsFound).toBe(12);
    expect(out.listing!.paginationStrategy).toBeNull();
    expect(browser.captureCalls).toBe(1);
  }, 60_000);
});
