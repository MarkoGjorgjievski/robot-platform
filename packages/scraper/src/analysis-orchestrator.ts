// Schema discovery: what fields can we get from this URL, and what do they look
// like on the page right now?
//
// Lifted out of `scraperRouter.analyze` for the same reasons the extraction chain
// was (see extraction-orchestrator.ts): the router owned real business logic, and
// none of it could be exercised without a live browser, a database and an API key.
//
// Two paths, and the split matters:
//
//   cache hit   we already know this domain's fields. Capture the page anyway and
//               replay the cached paths, so the examples shown in the wizard come
//               from THIS page rather than from whatever was scraped last month.
//               Costs a capture, costs no AI.
//   cache miss  ask the model to propose a schema. The expensive path.
//
// Screenshot persistence is injected: where captures live is an api-server concern
// (CAPTURES_DIR), not something the scraper should decide.

import { checkPageHealth, detectPaginationFromHtml, type IBrowser, type PageCapture } from '@robot/browser';
import type { DiscoveredSchema, SchemaField } from '@robot/agent';
import {
  lookupDomainCache, saveDomainCache, resolveApiPathsFromCache, resolveFromCache,
  buildCachedXPathScript, type DomainCache, type FieldPathSet,
} from './domain-cache.js';
import { normalizeUserFields } from './field-normalizer.js';
import { cachedFieldsFromCache, type CachedFieldSummary } from './cached-fields-from-cache.js';
import { runExtraction, type ExtractionAgent, type ExtractionFieldInput } from './extraction-orchestrator.js';
import { DETAIL_URL_FIELD } from './crawl/enumerate-detail-urls.js';

/** The AI collaborator, declared structurally so a test can pass a stub. */
export type AnalysisAgent = {
  discoverSchema(capture: PageCapture, userFields?: SchemaField[]): Promise<DiscoveredSchema>;
};

export type AnalysisDeps = {
  /**
   * The caller owns this browser's entire lifecycle — `runAnalysis` neither
   * launches it nor closes it, on the cache-hit path or the cache-miss path,
   * including when either path errors.
   *
   * Why: this mirrors the rule on `ExtractionDeps.browser` in
   * extraction-orchestrator.ts, fixed after a shared browser reused across
   * Phase 2's item loop got closed mid-loop and every item after the first
   * failed with "Browser not launched." `runAnalysis` currently only has
   * single-use callers, but closing here would silently reintroduce the same
   * trap for a future caller that reuses a browser across calls — so the
   * caller closes it, in `@robot/api`'s `withBrowserSession` (browser-session.ts).
   */
  browser: IBrowser;
  agent: AnalysisAgent | null;
  lookupCache?: typeof lookupDomainCache;
  /**
   * The listing flow runs the real extraction chain (`runExtraction`), which
   * defaults this to the production `saveDomainCache` — a successful listing
   * analyze legitimately warms the listing cache. Injectable so a test can
   * stub it and never touch the database.
   */
  saveCache?: typeof saveDomainCache;
  /**
   * Persist the screenshot and return how to address it, or null to skip.
   * Keeps filesystem layout out of the scraper package.
   */
  persistScreenshot?: (screenshot: Buffer) => Promise<{ id: string; url: string } | null>;
};

export type AnalysisOutcome = {
  captureId: string | null;
  screenshotUrl: string | null;
  url: string;
  title: string;
  schema: { page_type: string; description: string; fields: Array<CachedFieldSummary | SchemaField> };
  cached: boolean;
  /**
   * False when the live capture failed and everything shown (the field
   * examples) comes from earlier runs rather than this URL. The UI must say
   * so — on 2026-08-26 a Newegg category page silently showed a Samsung
   * SSD's cached values as its "examples".
   */
  liveExamples: boolean;
  /**
   * Set when the capture came back but was a bot-check / error interstitial
   * (checkPageHealth). A block page is a reason, never evidence: it must not
   * vote on the page type and its "values" must not be shown as this page's.
   */
  blockedReason?: string;
  /**
   * Present only for `pageType: 'listing'` analyzes that reached extraction
   * (i.e. not blocked). `rowsFound` and `sampleDetailUrls` come from the SAME
   * capture the schema examples were drawn from — see `runListingAnalysis`.
   */
  listing?: {
    rowsFound: number;
    paginationStrategy: string | null;
    sampleDetailUrls: string[];
  };
};

export async function runAnalysis(
  request: { url: string; pageType: 'detail' | 'listing'; requestedFields?: string },
  deps: AnalysisDeps,
): Promise<AnalysisOutcome> {
  const { url, pageType, requestedFields } = request;
  const { browser, agent, lookupCache = lookupDomainCache, saveCache, persistScreenshot } = deps;

  const domain = new URL(url).hostname.replace(/^www\./, '');
  const userFields = requestedFields ? normalizeUserFields(requestedFields) : [];

  // The caller declares what THIS url is — no arbitration, no live-resolution
  // vote between page types. See docs/handoff.md (mvp-simplification task 4)
  // for why the old dual-lookup-and-arbitrate logic was deleted.
  const cache = await lookupCache(domain, pageType).catch(() => null);

  // Listing gets its own flow (mvp-simplification task 5): one capture, then
  // the REAL extraction chain (row selectors, cross-page cache, everything
  // `runExtraction` already does) rather than the detail-shaped cached-path
  // replay below — a listing needs its ROWS, not one page-level record.
  if (pageType === 'listing') {
    return runListingAnalysis({ url, cache, userFields, browser, agent, saveCache, persistScreenshot });
  }

  if (cache && Object.keys(cache.fieldPaths).length > 0) {
    return analyzeFromCache({ url, cache, userFields, browser, persistScreenshot });
  }

  // Cache miss — capture and ask the model.
  if (!agent) throw new Error(`No cached schema for ${domain} and no agent available to discover one`);

  const capture: PageCapture = await browser.capture(
    url, { waitUntil: 'networkidle', interceptNetworkRequests: true },
  );

  // A model asked to describe a bot-check interstitial will confidently
  // describe a bot-check interstitial. Refuse with the reason instead.
  const health = checkPageHealth(capture.html, capture.title, url);
  if (!health.healthy) {
    throw new Error(`Cannot analyze ${url}: ${health.reason}`);
  }

  const persisted = persistScreenshot ? await persistScreenshot(capture.screenshot) : null;
  const schema = await agent.discoverSchema(capture, userFields.length > 0 ? userFields : undefined);

  // A field the user explicitly asked for is 'requested' even if discovery also
  // found it, and is added outright if discovery missed it.
  if (userFields.length > 0) {
    const discoveredNames = new Set(schema.fields.map((f) => f.name));
    for (const uf of userFields) {
      if (!discoveredNames.has(uf.name)) schema.fields.push(uf);
    }
    for (const f of schema.fields) {
      if (userFields.some((uf) => uf.name === f.name)) f.tier = 'requested';
    }
  }

  return {
    captureId: persisted?.id ?? null,
    screenshotUrl: persisted?.url ?? null,
    url: capture.url,
    title: capture.title,
    schema,
    cached: false,
    liveExamples: true,
  };
}

/** Replay the declared page type's cached paths against a fresh capture,
 *  so the wizard's examples come from THIS page rather than the cache. */
async function resolveLiveValues(
  cache: DomainCache, capture: PageCapture, browser: IBrowser, url: string,
): Promise<Record<string, unknown>> {
  const fieldNames = Object.keys(cache.fieldPaths);
  const liveValues: Record<string, unknown> = {};

  const apiRes = resolveApiPathsFromCache(cache.fieldPaths, capture.interceptedRequests, fieldNames);
  for (const [n, r] of Object.entries(apiRes.resolved)) liveValues[n] = r.value;

  const stillMissing = fieldNames.filter((n) => liveValues[n] === undefined);
  const cachedXPath = buildCachedXPathScript(cache.fieldPaths, stillMissing);
  if (cachedXPath) {
    try {
      const xr = await browser.evaluate<{ data: Record<string, unknown>[] }>(
        url, cachedXPath.script, { waitUntil: 'domcontentloaded' },
      );
      if (xr.data.length > 0) {
        for (const [n, v] of Object.entries(xr.data[0]!)) {
          if (v !== null && v !== undefined && v !== '') liveValues[n] = v;
        }
      }
    } catch (err) {
      console.error('[analyze] cached XPath eval failed (non-fatal):', err);
    }
  }

  const cr = resolveFromCache(cache.fieldPaths, liveValues, fieldNames);
  for (const [n, r] of Object.entries(cr.resolved)) liveValues[n] = r.value;

  return liveValues;
}

/**
 * Known domain: replay the cached paths against a fresh capture so the wizard
 * shows values from the page in front of the user.
 *
 * The page type is not decided here — the caller declared it (`request.pageType`
 * in `runAnalysis`), and `cache` is already the one cache for that declared
 * type. This function's only job is to replay it against a live capture.
 *
 * Every failure here is non-fatal by design — a cache hit is still worth
 * returning without live examples, and refusing to answer because a screenshot
 * timed out would be worse than answering with stale examples. But degraded
 * answers say so: `liveExamples: false`.
 */
async function analyzeFromCache(args: {
  url: string;
  cache: DomainCache;
  userFields: SchemaField[];
  browser: IBrowser;
  persistScreenshot?: AnalysisDeps['persistScreenshot'];
}): Promise<AnalysisOutcome> {
  const { url, cache, userFields, browser, persistScreenshot } = args;
  const domain = new URL(url).hostname.replace(/^www\./, '');

  let liveValues: Record<string, unknown> = {};
  let persisted: { id: string; url: string } | null = null;
  let liveExamples = false;
  let blockedReason: string | undefined;

  try {
    const capture = await browser.capture(url, { waitUntil: 'networkidle', interceptNetworkRequests: true });

    // A bot-check interstitial captures "successfully" and then poisons
    // everything downstream: nothing resolves, and stale examples ship
    // looking live (2026-08-26, Newegg /p/pl). The screenshot IS still
    // persisted — seeing the block page is how the operator understands
    // what happened.
    const health = checkPageHealth(capture.html, capture.title, url);
    if (!health.healthy) {
      blockedReason = health.reason;
      if (persistScreenshot) persisted = await persistScreenshot(capture.screenshot);
    } else {
      liveValues = await resolveLiveValues(cache, capture, browser, url);
      liveExamples = true;

      if (persistScreenshot) persisted = await persistScreenshot(capture.screenshot);
    }
  } catch (err) {
    console.error('[analyze] capture failed (non-fatal, showing cache without live values):', err);
  }

  const cachedFields = cachedFieldsFromCache(cache.fieldPaths, liveValues);

  if (userFields.length > 0) {
    const cachedNames = new Set(cachedFields.map((f) => f.name));
    for (const uf of userFields) {
      if (cachedNames.has(uf.name)) {
        const existing = cachedFields.find((f) => f.name === uf.name);
        if (existing) existing.tier = 'requested';
      } else {
        cachedFields.push({
          name: uf.name,
          type: uf.type as string,
          description: uf.description || 'User requested (not yet cached)',
          required: true,
          example_value: undefined,
          example_source: 'cached',
          tier: 'requested' as string | undefined,
          needsRediscovery: false,
        });
      }
    }
  }

  return {
    captureId: persisted?.id ?? null,
    screenshotUrl: persisted?.url ?? null,
    url,
    title: domain,
    schema: {
      page_type: cache.pageType,
      description: `Known domain — ${cachedFields.length} fields available from ${cache.totalRuns} previous runs`,
      fields: cachedFields,
    },
    cached: true,
    liveExamples,
    blockedReason,
  };
}

// ─── Listing analyze (mvp-simplification task 5) ──────────────────────────
//
// A listing page's schema is not "one record" — it's a ROW SHAPE plus how
// many rows the page actually delivered and where its next page lives. This
// reuses the real extraction chain (`runExtraction`) rather than replaying
// cached page-level paths the way `analyzeFromCache` does for a detail page:
// a listing's fields need row-scoped selectors, which only `runExtraction`'s
// STEP 3 XPath fallback generates.

/**
 * Copied from `plan-run.ts`'s listing-fields block (the crawler's own
 * "ask the listing page for the detail link" field) rather than re-derived,
 * so the two callers steer the model with the exact same description. See
 * that block for why `rowScopedOnly` matters: without it, a page-level tier
 * can answer with the listing page's own canonical URL, the field counts as
 * "resolved", and row selectors are never generated.
 */
const DETAIL_URL_FIELD_DEF: ExtractionFieldInput = {
  name: DETAIL_URL_FIELD,
  type: 'url',
  description:
    'The hyperlink (href) on THIS result row that opens the item\'s own product/detail page. '
    + 'The row container must be the repeating result tile in the main results grid — one per item. '
    + 'Never a navigation, footer, breadcrumb, category, help, policy, advert or "compare" link, '
    + 'and never the current page\'s own URL.',
  rowScopedOnly: true,
};

/** A field description shape common to both a cache hit (`CachedFieldSummary`,
 *  via `cachedFieldsFromCache`) and a cache miss (`SchemaField`, via
 *  `agent.discoverSchema`) — just enough to build an extraction request. */
type ListingBaseField = { name: string; type: string; description: string; tier?: 'requested' | 'discovered' };

async function runListingAnalysis(args: {
  url: string;
  cache: DomainCache | null;
  userFields: SchemaField[];
  browser: IBrowser;
  agent: AnalysisAgent | null;
  saveCache?: typeof saveDomainCache;
  persistScreenshot?: AnalysisDeps['persistScreenshot'];
}): Promise<AnalysisOutcome> {
  const { url, cache, userFields, browser, agent, saveCache, persistScreenshot } = args;
  const domain = new URL(url).hostname.replace(/^www\./, '');
  const usedCache = cache !== null && Object.keys(cache.fieldPaths).length > 0;

  // ONE capture — health-checked exactly like the detail path, BEFORE any
  // field discovery. A model (or the cache-replay below) asked to describe a
  // bot-check interstitial is worse than useless; refuse with the reason
  // instead, and never let a block page vote on the schema.
  const capture: PageCapture = await browser.capture(
    url, { waitUntil: 'networkidle', interceptNetworkRequests: true },
  );

  const health = checkPageHealth(capture.html, capture.title, url);
  if (!health.healthy) {
    const persisted = persistScreenshot ? await persistScreenshot(capture.screenshot) : null;
    return {
      captureId: persisted?.id ?? null,
      screenshotUrl: persisted?.url ?? null,
      url: capture.url,
      title: capture.title,
      schema: {
        page_type: 'listing',
        description: `Cannot analyze: ${health.reason}`,
        fields: usedCache ? cachedFieldsFromCache(cache!.fieldPaths) : [],
      },
      cached: usedCache,
      liveExamples: false,
      blockedReason: health.reason,
      // No listing report — a block page has no rows worth counting.
    };
  }

  let baseFields: ListingBaseField[];
  if (usedCache) {
    baseFields = cachedFieldsFromCache(cache!.fieldPaths)
      .map((f) => ({ name: f.name, type: f.type, description: f.description, tier: f.tier as 'requested' | 'discovered' | undefined }));
  } else {
    if (!agent) throw new Error(`No cached schema for ${domain} and no agent available to discover one`);
    const discovered = await agent.discoverSchema(capture, userFields.length > 0 ? userFields : undefined);
    baseFields = discovered.fields.map((f) => ({ name: f.name, type: f.type, description: f.description, tier: f.tier }));
  }

  // ALWAYS ensure the row-scoped detail link — see DETAIL_URL_FIELD_DEF.
  const extractionFields: ExtractionFieldInput[] = [
    DETAIL_URL_FIELD_DEF,
    ...baseFields
      .filter((f) => f.name !== DETAIL_URL_FIELD)
      .map((f) => ({ name: f.name, type: f.type, description: f.description, tier: f.tier })),
  ];

  const persisted = persistScreenshot ? await persistScreenshot(capture.screenshot) : null;

  // The SAME capture goes into `runExtraction` — no second navigation. The
  // agent object also satisfies `ExtractionAgent`: in production it's the one
  // `SchemaAgent` instance implementing both interfaces; `AnalysisAgent`'s
  // narrower declared type is only what THIS file's cache-hit/miss branches
  // need, so the extraction-side methods are asserted through rather than
  // re-declared here.
  const outcome = await runExtraction(
    { url, fields: extractionFields, pageType: 'listing' },
    {
      browser,
      agent: agent as unknown as ExtractionAgent | null,
      capture,
      lookupCache: async () => cache,
      saveCache,
    },
  );

  const rows = outcome.rows ?? [];
  const rowsFound = rows.length;
  const sampleDetailUrls = rows.slice(0, 5)
    .map((r) => r[DETAIL_URL_FIELD])
    .filter((v): v is string => typeof v === 'string');
  const paginationStrategy = detectPaginationFromHtml(capture.html, url)?.strategy ?? null;

  // The schema shown to the user: the listing fields with examples from the
  // FIRST row's values as the live values, so `example_source` badges read
  // 'live' rather than 'cached' — reusing `cachedFieldsFromCache` for both
  // cache-hit and cache-miss fields keeps this consistent with the detail
  // flow's own example plumbing instead of inventing a second one.
  const row0 = rows[0] ?? {};
  const displayFieldPaths: Record<string, FieldPathSet> = {};
  for (const f of extractionFields) {
    displayFieldPaths[f.name] = cache?.fieldPaths[f.name] ?? { paths: [], conflictCount: 0 };
  }
  const displayFields = cachedFieldsFromCache(displayFieldPaths, row0);

  return {
    captureId: persisted?.id ?? null,
    screenshotUrl: persisted?.url ?? null,
    url: capture.url,
    title: capture.title,
    schema: {
      page_type: 'listing',
      description: usedCache
        ? `Known domain — ${displayFields.length} fields available from ${cache!.totalRuns} previous runs`
        : `Discovered ${displayFields.length} fields from the live page`,
      fields: displayFields,
    },
    cached: usedCache,
    liveExamples: true,
    listing: { rowsFound, paginationStrategy, sampleDetailUrls },
  };
}
