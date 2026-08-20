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
import { runExtraction, type ExtractionAgent, type ExtractionDeps, type ExtractionOutcome } from '../extraction-orchestrator.js';
import { buildExtractionScript } from '../executor.js';
import { acquireDomainLock } from '../domain-lock.js';
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

/**
 * Spec §2.5's "per-input breakdown". One entry per InputSet row, so an operator
 * can see WHICH inputs produced the work list — and, just as importantly, which
 * ones produced nothing and why. Deliberately a flat array of plain objects.
 */
export type PlanInputReport = {
  inputIndex: number;
  /** Detail items this input contributed to the work list. */
  itemCount: number;
  status: 'planned' | 'skipped_budget' | 'error';
};

export type PlanRunOutcome = {
  items: PlannedItem[];
  warnings: string[];
  errors: Array<{ inputIndex: number; message: string }>;
  cacheWarm: boolean;
  inputs: PlanInputReport[];
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
  /**
   * The per-domain lock + politeness delay. Injectable so tests do not pay the
   * 2s spacing; defaults to the real one.
   */
  acquireLock?: typeof acquireDomainLock;
};

/**
 * Handed to every `extract` call planRun makes, because planRun ALREADY HOLDS
 * the per-domain lock around its own fetching. `acquireDomainLock` waits on any
 * in-flight holder, so an inner acquire of the same domain would wait on us —
 * a self-deadlock, not a slow test.
 */
const NOOP_LOCK: typeof acquireDomainLock = async () => () => {};

/**
 * Cache isolation for the page-level (document-mode) pass only.
 *
 * WHY: that pass runs with `pageType: 'detail'` purely to get document-mode
 * rather than row-mode extraction behaviour — but `pageType` is ALSO the
 * domain-intelligence partition key (`lookupCache(domain, pageType)` /
 * `saveCache({ domain, pageType })`). Left alone, a pass over a LISTING page
 * would bump `(domain,'detail')`'s run counts and consecutiveFailures, seed a
 * detail cache row from the listing page's intercepted requests, and merge
 * listing XPaths into the detail partition's fieldPaths — corrupting the
 * cross-customer cache this project treats as its core asset.
 *
 * The first (row-mode, `pageType: 'listing'`) pass keeps its normal caching:
 * that one is partitioned correctly and its learning is exactly what makes the
 * second run free.
 */
const CACHE_ISOLATED: Pick<ExtractionDeps, 'lookupCache' | 'saveCache'> = {
  lookupCache: async () => null,
  saveCache: async () => {},
};

export async function planRun(request: PlanRunRequest, deps: PlanRunDeps): Promise<PlanRunOutcome> {
  const { source, schema, inputSet } = request;
  const extract = deps.extract ?? runExtraction;
  const acquireLock = deps.acquireLock ?? acquireDomainLock;
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

  // buildInputUrls emits exactly one of (url, error) per InputSet row, so
  // seeding from both covers every input index.
  const reports = new Map<number, PlanInputReport>();
  for (const err of errors) reports.set(err.inputIndex, { inputIndex: err.inputIndex, itemCount: 0, status: 'error' });
  const report = (inputIndex: number, status: PlanInputReport['status'], itemCount: number) => {
    reports.set(inputIndex, { inputIndex, itemCount, status });
  };
  const inputBreakdown = () => [...reports.values()].sort((a, b) => a.inputIndex - b.inputIndex);
  const detailCount = () => items.filter((i) => i.kind === 'detail').length;

  // Detail-mode sources have no listing phase: one item per input row.
  if (source.listingMode !== 'listing_to_detail') {
    if (partitions.listing.length > 0) {
      warnings.push(`${partitions.listing.length} listing-origin field(s) cannot resolve: this source has no listing phase`);
    }
    // The cap applies here too. Without it a 20,000-row InputSet becomes 20,000
    // work items — spec §1.3: an unset budget must never mean an unbounded
    // number of requests, and the 5000 hard ceiling applies regardless.
    let dropped = 0;
    for (const start of urls) {
      if (seen.has(start.url)) {
        report(start.inputIndex, 'planned', 0);
        continue;
      }
      if (items.length >= cap) {
        dropped++;
        report(start.inputIndex, 'skipped_budget', 0);
        continue;
      }
      seen.add(start.url);
      items.push({
        kind: 'detail', url: start.url, inputIndex: start.inputIndex,
        inputValues: start.inputValues, listingValues: {}, pageNumber: null,
      });
      report(start.inputIndex, 'planned', 1);
    }
    if (dropped > 0) {
      warnings.push(`budget reached: ${cap} items; ${dropped} input row(s) dropped`);
    }
    return { items, warnings, errors, cacheWarm: false, inputs: inputBreakdown() };
  }

  // The listing page is asked for the detail link plus every listing-origin field.
  const listingFields = [
    // rowScopedOnly: a per-row link can only come from row extraction. Without it
    // a page-level tier answers with the listing page's own canonical URL, the
    // field counts as resolved, and row selectors are never generated — the first
    // live crawl queued the category page itself as if it were a product.
    {
      name: DETAIL_URL_FIELD,
      type: 'url',
      // The description is the only steer the selector model gets for this field,
      // and a vague one costs a whole crawl: asked for "link to the detail page",
      // a live run returned the site's privacy-policy link from the footer. Name
      // the repeating container and rule out chrome explicitly.
      description:
        'The hyperlink (href) on THIS result row that opens the item\'s own product/detail page. '
        + 'The row container must be the repeating result tile in the main results grid — one per item. '
        + 'Never a navigation, footer, breadcrumb, category, help, policy, advert or "compare" link, '
        + 'and never the current page\'s own URL.',
      rowScopedOnly: true,
    },
    ...partitions.listing.map((f) => ({ name: f.name, type: f.type })),
  ];

  let cacheWarm = false;

  for (let i = 0; i < urls.length; i++) {
    const start = urls[i]!;

    if (detailCount() >= cap) {
      // Silently dropping the tail is how a 12-category order quietly becomes a
      // 1-category one. Name it, and mark every un-walked input in the breakdown.
      const skipped = urls.slice(i);
      for (const rest of skipped) report(rest.inputIndex, 'skipped_budget', 0);
      warnings.push(`budget reached: ${cap} items; ${skipped.length} input(s) not planned`);
      break;
    }

    const detailsBefore = detailCount();

    // The domain lock (plus its 2s politeness spacing) is the ONLY concurrency
    // control phase 1 has — spec §3 leans on it. runExtraction acquires it
    // internally, but planRun fetches before and after calling it (the capture
    // below, and browser.crawl's pages 2..N), so the lock has to be held out
    // here, across the whole of this input's fetching, and stubbed out on the
    // inner calls (see NOOP_LOCK).
    const release = await acquireLock(new URL(start.url).hostname);
    try {
      // Captured ONCE and injected into the extraction. The second,
      // document-mode pass below reuses this same capture — which is only free
      // because the capture is not thrown away here.
      let page1: ExtractionOutcome;
      let capture: PageCapture | undefined;
      try {
        capture = await deps.browser.capture(start.url, {
          waitUntil: 'networkidle',
          interceptNetworkRequests: true,
        });
        page1 = await extract(
          { url: start.url, fields: listingFields, pageType: 'listing' },
          { browser: deps.browser, agent: deps.agent, capture, acquireLock: NOOP_LOCK },
        );
      } catch (err) {
        errors.push({ inputIndex: start.inputIndex, message: `listing capture failed: ${(err as Error).message}` });
        report(start.inputIndex, 'error', 0);
        continue;
      }
      cacheWarm ||= page1.cacheHit;

      // `data` is always a single row — right for a detail page, useless here.
      // `rows` carries every row the row-scoped extraction produced, which is
      // what a listing page's links actually live in.
      const listingRows = page1.rows ?? page1.data;

      // Page-level listing fields: a value shown once for the whole page (the
      // category in a breadcrumb) is not per-row, so no row resolved it. A second
      // document-mode pass over the SAME capture costs no fetch — and is
      // cache-isolated, because its pageType is a lie told to the row/document
      // switch that the cache would otherwise believe (see CACHE_ISOLATED).
      let pageLevelValues: Record<string, unknown> = {};
      const unresolved = partitions.listing.filter(
        (field) => !listingRows.some((row) => row[field.name] !== undefined && row[field.name] !== null),
      );
      if (unresolved.length > 0) {
        try {
          const pageLevel = await extract(
            {
              url: start.url,
              fields: unresolved.map((f) => ({ name: f.name, type: f.type })),
              pageType: 'detail',
            },
            { browser: deps.browser, agent: deps.agent, capture, acquireLock: NOOP_LOCK, ...CACHE_ISOLATED },
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
        const result = enumerateDetailUrls({ rows, pageUrl, pageNumber, seen, remaining: cap - detailCount() });
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

      if (absorb(listingRows, start.url, 1) === 'stop') {
        report(start.inputIndex, 'planned', detailCount() - detailsBefore);
        continue;
      }
      if (budget.maxPages <= 1 || !page1.plan) {
        report(start.inputIndex, 'planned', detailCount() - detailsBefore);
        continue;
      }

      // Pages 2+ replay page 1's plan — no further AI.
      // buildExtractionScript(plan, fieldTypes): the second argument is a
      // name → type map, so `detail_url` is collected as a URL, not a text node.
      const script = buildExtractionScript(page1.plan, { [DETAIL_URL_FIELD]: 'url' }, start.url);
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
        report(start.inputIndex, 'planned', detailCount() - detailsBefore);
      } catch (err) {
        errors.push({ inputIndex: start.inputIndex, message: `pagination failed: ${(err as Error).message}` });
        report(start.inputIndex, 'error', detailCount() - detailsBefore);
      }
    } finally {
      release();
    }
  }

  return { items, warnings, errors, cacheWarm, inputs: inputBreakdown() };
}
