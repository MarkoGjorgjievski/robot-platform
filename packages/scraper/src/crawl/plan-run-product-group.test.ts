// The listing walk must find the product links the finder finds.
//
// Allbirds, 2026-10-08: "Find products" (the finder, `largestProductGroup`)
// saw 150 product links on /collections/mens; the Extract tab's Sample, which
// plans with `planRun`, walked the same page and planned 1 — the extraction
// chain's AI row selector matched a single stray `<li>`, and nothing checked
// its rows against the page's own product links. The fixture is that page's
// real anchors; the extraction outcome is the one the Sample got.

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import type { IBrowser, CrawlOptions, CrawlPage, PageCapture, ScrollOptions } from '@robot/browser';
import { planRun } from './plan-run.js';
import { largestProductGroup, LISTING_ANCHORS_SCRIPT } from './product-link-group.js';
import type { ExtractionOutcome } from '../extraction-orchestrator.js';

const FIXTURE = JSON.parse(
  readFileSync(new URL('./__fixtures__/allbirds-mens-listing-anchors.json', import.meta.url), 'utf8'),
) as { url: string; anchors: Array<{ href: string; text: string }> };
const LISTING = FIXTURE.url;
const GROUP = largestProductGroup(FIXTURE.anchors, LISTING);
const FIRST = 'https://www.allbirds.com/products/mens-runner-nz-slip-on-mushroom';
const PROOF_PAGES = [
  FIRST,
  'https://www.allbirds.com/products/mens-cruiser-medium-grey',
  'https://www.allbirds.com/products/mens-tree-runner-nz-medium-grey',
];

const CAPTURE = {
  url: LISTING, html: '<html><body>allbirds listing</body></html>', markdown: '', screenshot: Buffer.alloc(0),
  screenshotTiles: [], title: 'Mens', timestamp: 0,
  structuredData: { ldJson: [], nextData: null, initialState: null, meta: {} }, interceptedRequests: [],
} as unknown as PageCapture;

class FakeBrowser implements IBrowser {
  async launch(): Promise<void> {}
  async capture(): Promise<PageCapture> { return CAPTURE; }
  async evaluate<T>(): Promise<T> { throw new Error('not used'); }
  async setContentEvaluate<T>(_html: string, script: string): Promise<T> {
    if (script === LISTING_ANCHORS_SCRIPT) return FIXTURE.anchors as T;
    throw new Error('unexpected script');
  }
  async close(): Promise<void> {}
  async *crawl(_url: string, _options: CrawlOptions): AsyncGenerator<CrawlPage> {}
  async *scrollPages(_startUrl: string, _options: ScrollOptions): AsyncGenerator<CrawlPage> {}
}

const sourceWith = (maxItems: number, strategy: 'direct' | 'search') => ({
  listingMode: 'listing_to_detail' as const,
  inputStrategy: strategy,
  // A search input lands on the same listing here, so only the strategy differs.
  urlTemplate: strategy === 'search' ? 'https://www.allbirds.com/collections/{q}' : null,
  budget: { mode: 'first_n', max_items: maxItems, max_pages: 3 },
});
const inputSetFor = (strategy: 'direct' | 'search') => (strategy === 'search'
  ? { columns: [{ name: 'q', primary: true }], rows: [{ q: 'mens' }] }
  : { columns: [{ name: 'url', primary: true }], rows: [{ url: LISTING }] });

const outcomeWithRows = (rows: Array<Record<string, unknown>>): ExtractionOutcome => ({
  data: rows.length > 0 ? [rows[0]!] : [{}],
  rows,
  plan: rows.length > 0
    ? {
      row_xpath: '//div[@id="shopify-section-template--16476858417232__collection-product-grid"]//li[.//a[contains(@href,"/products/")]]',
      page_type: 'listing',
      fields: [{ name: 'detail_url', xpath: ".//a[contains(@href,'/products/')][1]/@href", attribute: 'href', transform: 'absolute_url' }],
    }
    : null,
  confidence: rows.length > 0 ? 0.85 : 0,
  sources: {},
  fieldCount: { found: rows.length > 0 ? 1 : 0, total: 1 },
  fieldsByTier: { requested: [], discovered: [] },
  cacheHit: true,
} as unknown as ExtractionOutcome);

type PlanOpts = {
  knownDetailUrls?: string[];
  maxItems?: number;
  strategy?: 'direct' | 'search';
  schema?: Array<{ name: string; type: string; origin?: 'listing' | 'detail' }>;
};

const plan = (rows: Array<Record<string, unknown>>, opts: PlanOpts = {}) => planRun(
  {
    source: sourceWith(opts.maxItems ?? 40, opts.strategy ?? 'direct'),
    schema: opts.schema ?? [{ name: 'title', type: 'string' }],
    inputSet: inputSetFor(opts.strategy ?? 'direct'),
    ...(opts.knownDetailUrls ? { knownDetailUrls: opts.knownDetailUrls } : {}),
  },
  {
    browser: new FakeBrowser(), agent: null,
    acquireLock: async () => () => {}, lookupCache: async () => null, savePagination: async () => {},
    extract: async () => outcomeWithRows(rows),
  },
);

const details = (o: Awaited<ReturnType<typeof planRun>>) => o.items.filter((i) => i.kind === 'detail').map((i) => i.url);
const STRAY = 'https://www.allbirds.com/pages/our-story';

describe('planRun: the listing walk agrees with the finder (Allbirds /collections/mens)', () => {
  it('the finder sees 150 product links on the fixture', () => {
    expect(GROUP).toHaveLength(150);
    expect(GROUP.slice(0, 3)).toEqual(PROOF_PAGES);
  });

  it('a row selector that matched one product still plans the budget from the page\'s product links', async () => {
    const outcome = await plan([{ detail_url: FIRST }]);
    expect(details(outcome)).toEqual(GROUP.slice(0, 40));
    expect(outcome.warnings.some((w) => w.includes('150 product link'))).toBe(true);
    // No listing-origin field in the schema, so no listing-field note.
    expect(outcome.warnings.some((w) => w.includes('listing fields not available'))).toBe(false);
  });

  it('a stray row of another shape is rescued when the verified proof pages corroborate the group', async () => {
    const outcome = await plan([{ detail_url: STRAY }], { knownDetailUrls: PROOF_PAGES });
    expect(details(outcome)).toEqual(GROUP.slice(0, 40));
  });

  it('zero rows on a search input stays "nothing found", even with proof pages that match the group', async () => {
    const outcome = await plan([], { knownDetailUrls: PROOF_PAGES, strategy: 'search' });
    expect(details(outcome)).toEqual([]);
  });

  it('zero rows on a direct listing whose proof pages confirm the group plans from the group (a stale selector)', async () => {
    const outcome = await plan([], { knownDetailUrls: PROOF_PAGES });
    expect(details(outcome)).toEqual(GROUP.slice(0, 40));
    expect(outcome.warnings.some((w) => w.includes('found 0 product link(s) but the page has 150'))).toBe(true);
  });

  it('zero rows on a direct listing with no proof pages invents nothing', async () => {
    const outcome = await plan([]);
    expect(details(outcome)).toEqual([]);
  });

  it('an uncorroborated group is left alone — the extraction\'s rows stand', async () => {
    const outcome = await plan([{ detail_url: STRAY }]);
    expect(details(outcome)).toEqual([STRAY]);
  });

  it('proof pages on another host do not corroborate the group', async () => {
    const outcome = await plan([{ detail_url: STRAY }], {
      knownDetailUrls: PROOF_PAGES.map((u) => u.replace('www.allbirds.com', 'www.example.com')),
    });
    expect(details(outcome)).toEqual([STRAY]);
  });

  it('says which links carry no listing fields when the schema has listing-origin fields', async () => {
    const outcome = await plan(
      [{ detail_url: FIRST, card_price: '$105' }],
      { schema: [{ name: 'title', type: 'string' }, { name: 'card_price', type: 'string', origin: 'listing' }] },
    );
    const planned = outcome.items.filter((i) => i.kind === 'detail');
    expect(planned).toHaveLength(40);
    expect(planned[0]!.listingValues.card_price).toBe('$105');
    expect(planned[1]!.listingValues.card_price).toBeUndefined();
    expect(outcome.warnings.some((w) => w.includes('listing fields not available for 149 links added from the page'))).toBe(true);
  });

  it('rows that already cover the group plan unchanged — same order, same count, no warning', async () => {
    const reversed = [...GROUP].reverse();
    const outcome = await plan(reversed.map((u) => ({ detail_url: u })), { maxItems: 500 });
    expect(details(outcome)).toEqual(reversed);
    expect(outcome.warnings.some((w) => w.includes('planned from the page'))).toBe(false);
  });
});
