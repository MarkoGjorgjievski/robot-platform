// The first live crawl queued the category page ITSELF as a detail item.
// The log said `Sources: {"detail_url":"json-ld"}` — an upstream tier answered
// the per-row link field with the page's own URL, so row extraction never ran.
//
// This replays the REAL captured listing page, so the tier that answered live
// is the tier under test here.
import { describe, it, expect } from 'vitest';
import type { IBrowser, PageCapture } from '@robot/browser';
import type { ExtractionPlan, SchemaField } from '@robot/agent';
import { loadFixture } from '../__fixtures__/load.js';
import { runExtraction, type ExtractionAgent } from '../extraction-orchestrator.js';

const fixture = loadFixture('newegg-gpu-listing');

const CAPTURE = {
  url: fixture.url,
  html: fixture.html,
  markdown: '',
  screenshot: Buffer.alloc(0),
  screenshotTiles: [],
  title: 'GPUs',
  timestamp: 0,
  structuredData: fixture.structuredData,
  interceptedRequests: fixture.interceptedRequests,
} as unknown as PageCapture;

const PRODUCT_ROWS = [
  { detail_url: 'https://www.newegg.com/p/N82E16814137857' },
  { detail_url: 'https://www.newegg.com/p/N82E16814932663' },
];

class RowBrowser implements IBrowser {
  async launch(): Promise<void> {}
  async capture(): Promise<PageCapture> { return CAPTURE; }
  async evaluate<T>(): Promise<T> { return { data: PRODUCT_ROWS, fieldCount: 1 } as T; }
  async setContentEvaluate<T>(): Promise<T> { return { data: [], fieldCount: 0 } as T; }
  async close(): Promise<void> {}
  async *crawl(): AsyncGenerator<never> {}
}

/** Answers every field with the page's own URL — what the live model did. */
function selfUrlAgent(): ExtractionAgent {
  return {
    async extractFromApi(_body: string, _url: string, fields: SchemaField[]) {
      return {
        fields: fields.map((f) => ({ name: f.name, value: fixture.url, json_path: 'url', confidence: 0.9 })),
      };
    },
    async generateSelectors(_c: PageCapture, fields: SchemaField[]): Promise<ExtractionPlan> {
      return {
        row_xpath: '//div[@class="item-cell"]',
        fields: fields.map((f) => ({ name: f.name, xpath: './/a', attribute: 'href', transform: 'absolute_url' })),
      };
    },
    async retrySelectorGeneration(): Promise<ExtractionPlan> { return { row_xpath: '//div', fields: [] }; },
    async extractVariants() { return { variants: [], path_hint: '' }; },
  };
}

const OFFLINE = {
  lookupCache: async () => null,
  saveCache: async () => {},
  acquireLock: async () => () => {},
};

describe('detail_url discovery on a real captured listing page', () => {
  it('ignores an upstream tier that answers with the listing page itself', async () => {
    const outcome = await runExtraction(
      { url: fixture.url, pageType: 'listing', fields: [{ name: 'detail_url', type: 'url', rowScopedOnly: true }] },
      { browser: new RowBrowser(), agent: selfUrlAgent(), capture: CAPTURE, ...OFFLINE },
    );
    expect(outcome.data[0]?.detail_url).not.toBe(fixture.url);
    expect(outcome.sources.detail_url).toBe('xpath');
  });

  it('returns one row per product link, not a single collapsed row', async () => {
    const outcome = await runExtraction(
      { url: fixture.url, pageType: 'listing', fields: [{ name: 'detail_url', type: 'url', rowScopedOnly: true }] },
      { browser: new RowBrowser(), agent: selfUrlAgent(), capture: CAPTURE, ...OFFLINE },
    );
    expect(outcome.rows?.map((r) => r.detail_url)).toEqual(PRODUCT_ROWS.map((r) => r.detail_url));
  });

  it('leaves the single-row `data` contract untouched for existing consumers', async () => {
    const outcome = await runExtraction(
      { url: fixture.url, pageType: 'listing', fields: [{ name: 'detail_url', type: 'url', rowScopedOnly: true }] },
      { browser: new RowBrowser(), agent: selfUrlAgent(), capture: CAPTURE, ...OFFLINE },
    );
    expect(outcome.data).toHaveLength(1);
  });
});

describe('the tier response, not just its request', () => {
  it('rejects a row-scoped value a tier volunteered without being asked', async () => {
    // The live failure exactly: the model returned `detail_url` from the
    // AI-on-structured-data tier even though that tier was never asked for it.
    const volunteering: ExtractionAgent = {
      ...selfUrlAgent(),
      async extractFromApi() {
        return { fields: [{ name: 'detail_url', value: fixture.url, json_path: 'url', confidence: 0.99 }] };
      },
      async generateSelectors(): Promise<ExtractionPlan> {
        return { row_xpath: '//div', fields: [] };
      },
    };
    const outcome = await runExtraction(
      {
        url: fixture.url,
        pageType: 'listing',
        fields: [
          { name: 'detail_url', type: 'url', rowScopedOnly: true },
          { name: 'category_name', type: 'string' },
        ],
      },
      { browser: new RowBrowser(), agent: volunteering, capture: CAPTURE, ...OFFLINE },
    );
    expect(outcome.sources.detail_url).toBeUndefined();
    expect(outcome.data[0]?.detail_url ?? null).toBeNull();
  });
});
