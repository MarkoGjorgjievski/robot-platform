// packages/scraper/src/crawl/plan-run.ts
// Phase 1: walk listing pages and enumerate the work, spending nothing per
// detail page. The output is a work list you can look at before phase 2 turns
// it into page loads.
//
// The listing capture goes through the SAME runExtraction chain the rest of the
// pipeline uses, against a synthetic schema of `detail_url` plus every
// listing-origin field. Mechanical, cached-path, cached-XPath and AI tiers all
// apply unchanged, so a domain crawled before costs nothing here.

import type { IBrowser, PageCapture } from '@robot/browser';
import { runExtraction, type ExtractionAgent, type ExtractionOutcome } from '../extraction-orchestrator.js';
import { buildExtractionScript } from '../executor.js';
import { resolveBudget, itemCap } from './budget.js';
import { partitionSchemaByOrigin, type OriginField } from './partition-schema.js';
import { buildInputUrls, type InputSetColumn, type InputStrategy } from './build-input-urls.js';
import { enumerateDetailUrls, DETAIL_URL_FIELD } from './enumerate-detail-urls.js';

export type PlannedItem = {
  kind: 'listing' | 'detail';
  url: string;
  inputIndex: number;
  inputValues: Record<string, unknown>;
  listingValues: Record<string, unknown>;
  pageNumber: number | null;
};

export type PlanRunOutcome = {
  items: PlannedItem[];
  warnings: string[];
  errors: Array<{ inputIndex: number; message: string }>;
  cacheWarm: boolean;
};

export type PlanRunRequest = {
  source: {
    listingMode: string | null;
    inputStrategy: InputStrategy;
    urlTemplate: string | null;
    budget: unknown;
  };
  schema: OriginField[];
  inputSet: { columns: InputSetColumn[]; rows: Array<Record<string, unknown>> };
};

export type PlanRunDeps = {
  browser: IBrowser;
  agent: ExtractionAgent | null;
  /** Injected so tests can plan without a browser or an API key. */
  extract?: typeof runExtraction;
};

export async function planRun(request: PlanRunRequest, deps: PlanRunDeps): Promise<PlanRunOutcome> {
  const { source, schema, inputSet } = request;
  const extract = deps.extract ?? runExtraction;
  const budget = resolveBudget(source.budget);
  const cap = itemCap(budget);
  const partitions = partitionSchemaByOrigin(schema);

  const items: PlannedItem[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();

  const { urls, errors } = buildInputUrls({
    strategy: source.inputStrategy,
    urlTemplate: source.urlTemplate,
    columns: inputSet.columns,
    rows: inputSet.rows,
  });

  // Detail-mode sources have no listing phase: one item per input row.
  if (source.listingMode !== 'listing_to_detail') {
    if (partitions.listing.length > 0) {
      warnings.push(`${partitions.listing.length} listing-origin field(s) cannot resolve: this source has no listing phase`);
    }
    for (const start of urls) {
      if (seen.has(start.url)) continue;
      seen.add(start.url);
      items.push({
        kind: 'detail', url: start.url, inputIndex: start.inputIndex,
        inputValues: start.inputValues, listingValues: {}, pageNumber: null,
      });
    }
    return { items, warnings, errors, cacheWarm: false };
  }

  // The listing page is asked for the detail link plus every listing-origin field.
  const listingFields = [
    { name: DETAIL_URL_FIELD, type: 'url', description: 'Link to this row\'s detail page' },
    ...partitions.listing.map((f) => ({ name: f.name, type: f.type })),
  ];

  let cacheWarm = false;

  for (const start of urls) {
    if (items.filter((i) => i.kind === 'detail').length >= cap) break;

    // Captured ONCE and injected into the extraction. Task 10 adds a second,
    // document-mode pass over this same capture for page-level listing fields —
    // which is only free because the capture is not thrown away here.
    let page1: ExtractionOutcome;
    let capture: PageCapture | undefined;
    try {
      capture = await deps.browser.capture(start.url, {
        waitUntil: 'networkidle',
        interceptNetworkRequests: true,
      });
      page1 = await extract(
        { url: start.url, fields: listingFields, pageType: 'listing' },
        { browser: deps.browser, agent: deps.agent, capture },
      );
    } catch (err) {
      errors.push({ inputIndex: start.inputIndex, message: `listing capture failed: ${(err as Error).message}` });
      continue;
    }
    cacheWarm ||= page1.cacheHit;

    // Page-level listing fields: a value shown once for the whole page (the
    // category in a breadcrumb) is not per-row, so no row resolved it. A second
    // document-mode pass over the SAME capture costs no fetch.
    let pageLevelValues: Record<string, unknown> = {};
    const unresolved = partitions.listing.filter(
      (field) => !page1.data.some((row) => row[field.name] !== undefined && row[field.name] !== null),
    );
    if (unresolved.length > 0) {
      try {
        const pageLevel = await extract(
          {
            url: start.url,
            fields: unresolved.map((f) => ({ name: f.name, type: f.type })),
            pageType: 'detail',
          },
          { browser: deps.browser, agent: deps.agent, capture },
        );
        pageLevelValues = pageLevel.data[0] ?? {};
      } catch (err) {
        warnings.push(`page-level listing fields failed on ${start.url}: ${(err as Error).message}`);
      }
    }

    items.push({
      kind: 'listing', url: start.url, inputIndex: start.inputIndex,
      inputValues: start.inputValues, listingValues: {}, pageNumber: 1,
    });

    const absorb = (rows: Array<Record<string, unknown>>, pageUrl: string, pageNumber: number): 'stop' | 'continue' => {
      const detailCount = items.filter((i) => i.kind === 'detail').length;
      const result = enumerateDetailUrls({ rows, pageUrl, pageNumber, seen, remaining: cap - detailCount });
      for (const item of result.items) {
        seen.add(item.url);
        items.push({
          kind: 'detail', url: item.url, inputIndex: start.inputIndex,
          inputValues: start.inputValues,
          listingValues: { ...pageLevelValues, ...item.listingValues },
          pageNumber: item.pageNumber,
        });
      }
      if (result.stop === 'budget') {
        warnings.push(`budget reached: ${cap} items`);
        return 'stop';
      }
      return result.stop === null ? 'continue' : 'stop';
    };

    if (absorb(page1.data, start.url, 1) === 'stop') continue;
    if (budget.maxPages <= 1 || !page1.plan) continue;

    // Pages 2+ replay page 1's plan — no further AI, no re-fetch of page 1.
    // buildExtractionScript(plan, fieldTypes): the second argument is a
    // name → type map, so `detail_url` is collected as a URL, not a text node.
    const script = buildExtractionScript(page1.plan, { [DETAIL_URL_FIELD]: 'url' });
    try {
      for await (const page of deps.browser.crawl(start.url, {
        extractionScript: script,
        maxPages: budget.maxPages,
        startPage: 2,
      })) {
        items.push({
          kind: 'listing', url: page.url, inputIndex: start.inputIndex,
          inputValues: start.inputValues, listingValues: {}, pageNumber: page.pageNumber,
        });
        if (absorb(page.data, page.url, page.pageNumber) === 'stop') break;
      }
    } catch (err) {
      errors.push({ inputIndex: start.inputIndex, message: `pagination failed: ${(err as Error).message}` });
    }
  }

  return { items, warnings, errors, cacheWarm };
}
