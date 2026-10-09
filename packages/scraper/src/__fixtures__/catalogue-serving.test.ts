// Tier 1 catalogue-serving fixture gate (v2.5 task 11).
//
// Every prior v2.5 test that proves selection/displayed serving through
// `runExtraction` (extraction-orchestrator-selection.test.ts) does it against
// a hand-built PageCapture. That is honest coverage of the orchestrator, but
// it never runs against a REAL captured page — the fixture corpus that stands
// in for the AI branches Tier 1 cannot otherwise exercise. This file closes
// that gap for the newegg-gpu-listing fixture: two genuine XPath candidates,
// both resolvable against the fixture's frozen HTML, prove selection and the
// displayed-default survive the whole chain on real page data — not just
// `resolveFromCache` (which this fixture never reaches, since STEP 1.5b's
// override always assigns first).
//
// Known sharp edge (Task 7): `__fixtures__/replay.ts` builds its DomainCache
// with `as DomainCache`, a cast that quietly omits `candidateCatalogue` — the
// orchestrator guards every catalogue read against that (`cache.candidateCatalogue
// ?? {}`), so a replay through `runFixtureReplay` would never observe a
// selection/displayed override no matter what the catalogue said. This file
// does NOT go through `runFixtureReplay`; it calls `runExtraction` directly
// with an explicitly-typed `DomainCache` (every field set, `candidateCatalogue`
// included) so the override path is actually live.

import { describe, it, expect } from 'vitest';
import { PlaywrightBrowser, okVerdict } from '@robot/browser';
import type {
  CaptureOptions, CrawlOptions, CrawlPage, IBrowser, PageCapture, ScrollOptions,
} from '@robot/browser';
import { runExtraction } from '../extraction-orchestrator.js';
import type { DomainCache, FieldPathSet } from '../domain-cache.js';
import type { CandidateCatalogue } from '../candidate-catalogue.js';
import { loadFixture } from './load.js';
import type { Fixture } from './types.js';

/**
 * Same adapter as `__fixtures__/replay.ts`'s `FixtureBrowser`, duplicated
 * rather than imported: that class is not exported (replay.ts is
 * out-of-scope for this task), and its job here is identical — serve the
 * fixture's frozen HTML to `setContentEvaluate` so cached/override XPaths run
 * in real Chromium with no network.
 */
class FixtureBrowser implements IBrowser {
  constructor(private readonly html: string, private readonly inner: PlaywrightBrowser) {}

  async launch(): Promise<void> {
    await this.inner.launch({ headless: true });
  }

  async capture(): Promise<PageCapture> {
    throw new Error('FixtureBrowser cannot capture — the fixture supplies the capture');
  }

  async evaluate<T = unknown>(_url: string, script: string, _options?: CaptureOptions): Promise<T> {
    return this.inner.setContentEvaluate<T>(this.html, script);
  }

  async setContentEvaluate<T = unknown>(html: string, script: string): Promise<T> {
    return this.inner.setContentEvaluate<T>(html, script);
  }

  async close(): Promise<void> {
    await this.inner.close();
  }

  async *crawl(_startUrl: string, _options: CrawlOptions): AsyncGenerator<CrawlPage> {
    return;
  }

  // eslint-disable-next-line require-yield
  async *scrollPages(_startUrl: string, _options: ScrollOptions): AsyncGenerator<CrawlPage> {
    throw new Error('FixtureBrowser cannot scroll — fixture replay is a frozen snapshot');
  }
}

// Two REAL prices, on two REAL, distinctly-id'd item cells in the frozen
// newegg-gpu-listing HTML (verified against the fixture JSON):
//   item_cell_14-930-084_1_0 -> <strong>1,029</strong><sup>.99</sup>  (ASRock RX 7900 XTX)
//   item_cell_14-930-138_2_0 -> <strong>649</strong><sup>.99</sup>   (2nd card in the grid)
// Each XPath below resolves to the <strong> node alone (its textContent is
// the clean integer part — "1,029" / "649" — with no trailing range-arrow
// markup to confuse `validateFieldShape`'s number coercion).
const XPATH_FIRST = '//div[@id="item_cell_14-930-084_1_0"]//li[@class="price-current"]/strong';
const XPATH_SECOND = '//div[@id="item_cell_14-930-138_2_0"]//li[@class="price-current"]/strong';
const VALUE_FIRST = 1029;
const VALUE_SECOND = 649;

function makeCatalogue(): CandidateCatalogue {
  return {
    price: [
      { label: 'first-listed', source: 'xpath', path: XPATH_FIRST, sampleValue: VALUE_FIRST },
      { label: 'second-listed', source: 'xpath', path: XPATH_SECOND, sampleValue: VALUE_SECOND, displayed: true },
    ],
  };
}

function makeFieldPaths(): Record<string, FieldPathSet> {
  const now = new Date().toISOString();
  return {
    price: {
      paths: [
        { path: XPATH_FIRST, source: 'xpath', confidence: 0.8, hits: 0, misses: 0, lastValue: null, lastUsedAt: now },
        { path: XPATH_SECOND, source: 'xpath', confidence: 0.8, hits: 0, misses: 0, lastValue: null, lastUsedAt: now },
      ],
      conflictCount: 0,
    },
  };
}

function makeCache(): DomainCache {
  return {
    id: 'cache-newegg-gpu-listing',
    domain: 'www.newegg.com',
    pageType: 'listing',
    apiEndpoints: [],
    // Seeded with BOTH real candidate paths — exercises the pre-existing STEP
    // 1.5 cached-XPath tier (whichever it ranks first) BEFORE STEP 1.5b's
    // catalogue override runs and (per the assertions below) wins anyway.
    fieldPaths: makeFieldPaths(),
    popupSelectors: [],
    hasJsonLd: false,
    hasNextData: false,
    // Must be > 0 or STEP 1.5 (and the STEP 1.5b override nested inside it)
    // never runs at all — see replay.ts's identical note.
    totalRuns: 1,
    successfulRuns: 1,
    consecutiveFailures: 0,
    successRate: 100,
    paginationConfig: null,
    rowSelector: null,
    candidateCatalogue: makeCatalogue(),
  };
}

async function runPriceExtraction(fixture: Fixture, candidate?: { concept: string; label: string }) {
  // The fixture's REAL structuredData and interceptedRequests, not stand-ins —
  // verified (by inspecting the fixture JSON) to contain no json-ld/meta/api
  // key that mechanical extraction (STEP 1) could mistake for `price`, so
  // their presence here cannot let mechanical resolve the field before the
  // cache/catalogue tiers this test exists to prove ever run.
  const capture: PageCapture = {
    url: fixture.url,
    html: fixture.html,
    markdown: '',
    screenshot: Buffer.alloc(0),
    screenshotTiles: [],
    title: '',
    timestamp: 0,
    structuredData: fixture.structuredData,
    interceptedRequests: fixture.interceptedRequests,
    // A corpus fixture stores no verdict: it was saved because the page was usable.
    verdict: okVerdict(),
  };

  const browser = new FixtureBrowser(fixture.html, new PlaywrightBrowser());
  await browser.launch();

  try {
    return await runExtraction(
      {
        url: fixture.url,
        pageType: 'listing',
        fields: [{ name: 'price', type: 'number', tier: 'requested', ...(candidate ? { candidate } : {}) }],
      },
      {
        browser,
        agent: null,
        capture,
        lookupCache: async () => makeCache(),
        saveCache: async () => { /* a replay must never write to the database */ },
        acquireLock: async () => () => {},
      },
    );
  } finally {
    await browser.close();
  }
}

describe('Tier 1 catalogue-serving fixture gate (v2.5 task 11)', () => {
  const fixture = loadFixture('newegg-gpu-listing');

  it('no selection: the displayed candidate\'s value is served, end to end through the real fixture', async () => {
    const outcome = await runPriceExtraction(fixture);
    expect(outcome.data[0]?.price).toBe(VALUE_SECOND);
    expect(outcome.sources.price).toBe('xpath');
  }, 30_000);

  it('an explicit selection of the OTHER label overrides the displayed default', async () => {
    const outcome = await runPriceExtraction(fixture, { concept: 'price', label: 'first-listed' });
    expect(outcome.data[0]?.price).toBe(VALUE_FIRST);
    expect(outcome.sources.price).toBe('xpath');
  }, 30_000);
});
