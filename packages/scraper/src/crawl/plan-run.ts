// packages/scraper/src/crawl/plan-run.ts
// Phase 1: walk listing pages and enumerate the work, spending nothing per
// detail page. The output is a work list you can look at before phase 2 turns
// it into page loads.
//
// The listing capture goes through the SAME runExtraction chain the rest of the
// pipeline uses, against a synthetic schema of `detail_url` plus every
// listing-origin field. Mechanical, cached-path, cached-XPath and AI tiers all
// apply unchanged, so a domain crawled before costs nothing here.

import type { IBrowser, PageCapture, PaginationConfig } from '@robot/browser';
import { runExtraction, type ExtractionAgent, type ExtractionDeps, type ExtractionOutcome } from '../extraction-orchestrator.js';
import { buildExtractionScript } from '../executor.js';
import { acquireDomainLock } from '../domain-lock.js';
import { lookupDomainCache, savePaginationConfig } from '../domain-cache.js';
import { resolveBudget, itemCap } from './budget.js';
import { partitionSchemaByOrigin, type OriginField } from './partition-schema.js';
import { buildInputUrls, type InputSetColumn, type InputStrategy } from './build-input-urls.js';
import { enumerateDetailUrls, DETAIL_URL_FIELD, type StopReason } from './enumerate-detail-urls.js';
import { detectPagination, type PaginationAgent } from './detect-pagination.js';
import { fetchInPage } from './api-param-fetch.js';
import { getPath } from './api-identifiers.js';

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
  /** Reads the stored pagination config. Injectable so tests need no database. */
  lookupCache?: typeof lookupDomainCache;
  /** Writes a pagination config that a walk has just verified. */
  savePagination?: typeof savePaginationConfig;
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

/**
 * Below this share of page 1's yield, a walk is REPORTED as suspicious.
 *
 * Reported, not refused. `gained > 0` stays the caching gate deliberately:
 * `absorb` hands `remaining: cap - detailCount()` to `enumerateDetailUrls`, so a
 * perfectly working pager legitimately returns one or two items once the item
 * budget is nearly full — which is exactly this repo's default `{max_items: 8,
 * max_pages: 2}` shape. Turning this ratio into a gate would refuse correct
 * configs, the cache would never warm, and the feature would deliver nothing.
 *
 * The number it exists for: AbeBooks, 2026-08-21. Page 1 yielded 30, pages 2+3
 * yielded 2 and 1, because `deriveTemplate` paged the `ds` filter while pinning
 * `p=1` — the real pager. 3/30 = 0.1. Three stray items past dedupe satisfied
 * `gained > 0`, so a broken template was cached in total silence: the only
 * warning in this block fires on `gained === 0`, and this pager leaks.
 */
const THIN_WALK_SHARE = 0.25;

/** The raw URL strings at `itemsPath[].urlPath`, in order. */
function collectRowUrls(json: unknown, itemsPath: string, urlPath: string): string[] {
  const items = getPath(json, itemsPath);
  if (!Array.isArray(items)) return [];
  const out: string[] = [];
  for (const item of items) {
    const raw = getPath(item, urlPath);
    if (typeof raw === 'string' && raw.length > 0) out.push(raw);
  }
  return out;
}

export async function planRun(request: PlanRunRequest, deps: PlanRunDeps): Promise<PlanRunOutcome> {
  const { source, schema, inputSet } = request;
  const extract = deps.extract ?? runExtraction;
  const acquireLock = deps.acquireLock ?? acquireDomainLock;
  const lookupCache = deps.lookupCache ?? lookupDomainCache;
  const savePagination = deps.savePagination ?? savePaginationConfig;
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

      /**
       * Returns the RAW stop reason, not a boolean. Callers need to tell
       * `'budget'` apart from the others: a walk cut short by the item cap is
       * expected to gain few items and must never be reported as a thin walk
       * (see THIN_WALK_SHARE). Collapsing this to 'stop' | 'continue' is what
       * forced that distinction to be re-inferred, badly, further down.
       */
      const absorb = (rows: Array<Record<string, unknown>>, pageUrl: string, pageNumber: number): StopReason => {
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
        if (result.stop === 'budget') warnings.push(`budget reached: ${cap} items`);
        return result.stop;
      };

      if (absorb(listingRows, start.url, 1) !== null) {
        report(start.inputIndex, 'planned', detailCount() - detailsBefore);
        continue;
      }

      if (budget.maxPages <= 1 || !page1.plan) {
        report(start.inputIndex, 'planned', detailCount() - detailsBefore);
        continue;
      }

      // Page 1's own yield for THIS input, counted after its absorb and before
      // any walk: the honest basis a walk's gain is compared against. Not the
      // extracted row count — dedupe and the item cap both sit between the rows
      // and the work list, and it is the work list that matters.
      const page1Gain = detailCount() - detailsBefore;

      // Decide HOW this listing paginates before paying for a page load. crawl()
      // would otherwise re-navigate to page 1 just to inspect markup we already
      // captured — and on a page with no pagination at all (a category page with
      // a carousel and nothing else) that load buys nothing.
      // A config this domain has already proven beats re-rolling detection: it is
      // the same answer every run, and on a domain where mechanical detection
      // fails it also skips the AI call. Looked up under 'listing' because that
      // is the only page type that paginates.
      const paginationDomain = new URL(start.url).hostname;
      // The cache is advisory here exactly as it is everywhere else in this
      // codebase: a lookup failure (DB blip, malformed stored JSON, connection
      // drop mid-run) must degrade to "treat this domain as cold" for THIS
      // input only, not abort the whole plan and silently drop every input
      // after it.
      let cachedPagination: PaginationConfig | null = null;
      try {
        cachedPagination = (await lookupCache(paginationDomain, 'listing'))?.paginationConfig ?? null;
      } catch (err) {
        warnings.push(`pagination cache lookup failed on ${start.url}: ${(err as Error).message} — treating as cold`);
      }
      const page1Urls = listingRows
        .map((row) => row[DETAIL_URL_FIELD])
        .filter((u): u is string => typeof u === 'string');
      const pagination = capture
        ? await detectPagination(capture, deps.agent as PaginationAgent | null, cachedPagination, {
            browser: deps.browser, page1Urls,
          })
        : { config: null, source: 'none' as const };
      // api-param is the cheapest, best-verified rung, so a miss is worth
      // surfacing regardless of what (if anything) answered instead — this is
      // the raw material for tuning `api-param-candidates.ts`'s heuristics from
      // real traffic, and it is otherwise invisible: `detectPagination` only
      // reports which tier WON, not what api-param tried and rejected.
      if (pagination.apiParamAttempt) {
        const { endpoint, tried } = pagination.apiParamAttempt;
        warnings.push(
          `api-param pagination not verified on ${start.url}: probed ${endpoint} `
          + `with candidate(s) ${tried.join(', ') || '(none)'} — none returned a genuinely different page`,
        );
      }
      if (!pagination.config) {
        warnings.push(`no pagination detected on ${start.url} — planned page 1 only`);
        report(start.inputIndex, 'planned', detailCount() - detailsBefore);
        continue;
      }

      // Pages 2+ replay page 1's plan — no further AI.
      // buildExtractionScript(plan, fieldTypes): the second argument is a
      // name → type map, so `detail_url` is collected as a URL, not a text node.
      const script = buildExtractionScript(page1.plan, { [DETAIL_URL_FIELD]: 'url' }, start.url);

      /**
       * Walk pages 2..maxPages with `config`; answer how many NEW items it added
       * and whether the item budget is what ended it. `budgetStopped` is carried
       * out rather than guessed at: it is the difference between "this pager is
       * broken" and "we asked for 8 items and got them".
       */
      const walkHtmlPages = async (config: PaginationConfig): Promise<{ gained: number; budgetStopped: boolean }> => {
        const before = detailCount();
        let budgetStopped = false;
        for await (const page of deps.browser.crawl(start.url, {
          extractionScript: script,
          maxPages: budget.maxPages,
          startPage: 2,
          paginationConfig: config,
        })) {
          items.push({
            kind: 'listing', url: page.url, inputIndex: start.inputIndex,
            inputValues: start.inputValues, listingValues: {}, pageNumber: page.pageNumber,
          });
          const stop = absorb(page.data, page.url, page.pageNumber);
          if (stop !== null) {
            budgetStopped = stop === 'budget';
            break;
          }
        }
        return { gained: detailCount() - before, budgetStopped };
      };

      /**
       * Walk an api-param config: fetch pages 2..maxPages as JSON in ONE page
       * context, and feed each page's URLs through the same `absorb` the HTML
       * walk uses — so dedupe, the item cap and the stop reasons behave
       * identically no matter which strategy produced the URLs.
       */
      const walkApiPages = async (config: PaginationConfig): Promise<{ gained: number; budgetStopped: boolean }> => {
        const before = detailCount();
        const { apiTemplate, step, itemsPath, urlPath } = config;
        if (!apiTemplate || !step || itemsPath === undefined || urlPath === undefined) {
          return { gained: 0, budgetStopped: false };
        }
        // Where the pager STARTS, not zero. `templateFor` builds `apiTemplate`
        // by overwriting the paging parameter wholesale, which discards the
        // value page 1 held — so `from` is carried on the config beside it, and
        // `from + step` is exactly the URL `probeUrl` verified. Defaulted to 0
        // for configs cached before the field existed.
        const from = config.from ?? 0;
        const urls: string[] = [];
        for (let page = 2; page <= budget.maxPages; page++) {
          urls.push(apiTemplate.replace('{N}', String(from + step * (page - 1))));
        }
        const bodies = await fetchInPage(deps.browser, start.url, urls);

        let budgetStopped = false;
        for (let i = 0; i < bodies.length; i++) {
          const body = bodies[i]!;
          if (body.error !== null || body.json === null) break;
          const pageUrls = collectRowUrls(body.json, itemsPath, urlPath);
          if (pageUrls.length === 0) break;
          const pageNumber = i + 2;
          items.push({
            kind: 'listing', url: body.url, inputIndex: start.inputIndex,
            inputValues: start.inputValues, listingValues: {}, pageNumber,
          });
          const stop = absorb(pageUrls.map((u) => ({ [DETAIL_URL_FIELD]: u })), body.url, pageNumber);
          if (stop !== null) {
            budgetStopped = stop === 'budget';
            break;
          }
        }
        return { gained: detailCount() - before, budgetStopped };
      };

      const walkPages = (config: PaginationConfig) =>
        (config.strategy === 'api-param' ? walkApiPages(config) : walkHtmlPages(config));

      try {
        let { gained, budgetStopped } = await walkPages(pagination.config);
        let winning = pagination.config;
        let winningSource = pagination.source;
        /** The config this run is about to overwrite, if any. */
        let replacing: PaginationConfig | null = null;

        // A CACHED config that produced nothing means the site changed its pager
        // since we learned it. Re-detect from this run's own capture and try once
        // more — bounded at one retry, because a second failure is a site we
        // cannot page today, not a reason to keep fetching.
        //
        // A freshly detected config that failed gets no retry: re-detecting would
        // read the same capture and reach the same answer.
        if (gained === 0 && pagination.source === 'cache') {
          // Non-null: we only get here after `pagination.config` was truthy
          // (checked above), which only happens once `capture` was truthy —
          // `detectPagination` above was called with this same `capture`.
          const fresh = await detectPagination(capture!, deps.agent as PaginationAgent | null);
          if (fresh.config) {
            // Deliberately NOT short-circuited when `fresh.config` is identical
            // to the config that just failed. That happens when the walk failed
            // for a reason unrelated to the pager (a transient hiccup, a page
            // that loaded slowly), and re-walking it is the cheapest way to tell
            // that apart from a genuinely dead config. The cost is bounded — one
            // extra walk, once — and the alternative is caching a "this domain
            // is unpageable" conclusion drawn from a single bad afternoon.
            ({ gained, budgetStopped } = await walkPages(fresh.config));
            winning = fresh.config;
            winningSource = fresh.source;
            // The stored config is about to be replaced, not merely written.
            replacing = pagination.config;
          }
        }

        // Verification, not trust: a config is worth remembering only once a walk
        // it drove has actually produced new URLs. A cached config that worked is
        // already stored, so re-writing it would be noise.
        if (gained > 0 && winningSource !== 'cache') {
          // Spec §4 accepts one-config-per-domain collisions on the explicit
          // premise that "the thrash is visible". It was not: the retry above
          // reassigns `gained`, so the `gained === 0` warning below is skipped
          // and the overwrite happened in silence. (`savePaginationConfig`'s
          // console.log is not a warning — it never reaches `outcome.warnings`,
          // so it never reaches `runs.logs`.) Say what is being lost.
          if (replacing) {
            warnings.push(
              `pagination config for ${paginationDomain} rewritten on ${start.url}: `
              + `the cached ${replacing.strategy} config produced no new items, `
              + `replacing it with a re-detected ${winningSource}: ${winning.strategy} config that gained ${gained}`,
            );
          }
          // The write is bookkeeping that happens AFTER the walk: every detail
          // URL is already in `items` and already planned. A DB blip here must
          // degrade to a warning, exactly as the cache READ above does — not
          // relabel a completed input as an error and hand phase 2 a lie.
          try {
            await savePagination(paginationDomain, winning);
          } catch (err) {
            warnings.push(
              `pagination cache save failed on ${start.url}: ${(err as Error).message} `
              + `— the walk's items are planned; the config was not stored`,
            );
          }
        }
        if (gained === 0) {
          warnings.push(
            `pagination (${winningSource}: ${winning.strategy}) produced no new items on ${start.url}`,
          );
        } else if (!budgetStopped && page1Gain > 0 && gained < page1Gain * THIN_WALK_SHARE) {
          // Not a refusal — the config above is already cached. This is the
          // evidence a future fix to `deriveTemplate` will be built from, so it
          // names everything needed to reproduce: which page, how much page 1
          // gave, how little the walk added, and which strategy did it.
          warnings.push(
            `pagination (${winningSource}: ${winning.strategy}) gained only ${gained} new item(s) on ${start.url} `
            + `where page 1 yielded ${page1Gain}, and the item budget was not what stopped it `
            + `— pages 2+ are likely re-serving page 1; the config was cached anyway, review it`,
          );
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
