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

import type { IBrowser, PageCapture } from '@robot/browser';
import type { DiscoveredSchema, SchemaField } from '@robot/agent';
import {
  lookupDomainCache, resolveApiPathsFromCache, resolveFromCache,
  buildCachedXPathScript, type DomainCache,
} from './domain-cache.js';
import { normalizeUserFields } from './field-normalizer.js';
import { cachedFieldsFromCache, type CachedFieldSummary } from './cached-fields-from-cache.js';

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
};

export async function runAnalysis(
  request: { url: string; requestedFields?: string },
  deps: AnalysisDeps,
): Promise<AnalysisOutcome> {
  const { url, requestedFields } = request;
  const { browser, agent, lookupCache = lookupDomainCache, persistScreenshot } = deps;

  const domain = new URL(url).hostname.replace(/^www\./, '');
  const userFields = requestedFields ? normalizeUserFields(requestedFields) : [];

  // Try both page types — return whichever has more cached fields.
  const [detailCache, listingCache] = await Promise.all([
    lookupCache(domain, 'detail').catch(() => null),
    lookupCache(domain, 'listing').catch(() => null),
  ]);
  const cache: DomainCache | null = detailCache && listingCache
    ? (Object.keys(detailCache.fieldPaths).length >= Object.keys(listingCache.fieldPaths).length ? detailCache : listingCache)
    : detailCache ?? listingCache;

  if (cache && Object.keys(cache.fieldPaths).length > 0) {
    return analyzeFromCache({ url, cache, userFields, browser, persistScreenshot });
  }

  // Cache miss — capture and ask the model.
  if (!agent) throw new Error(`No cached schema for ${domain} and no agent available to discover one`);

  const capture: PageCapture = await browser.capture(
    url, { waitUntil: 'networkidle', interceptNetworkRequests: true },
  );

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
  };
}

/**
 * Known domain: replay the cached paths against a fresh capture so the wizard
 * shows values from the page in front of the user.
 *
 * Every failure here is non-fatal by design — a cache hit is still worth
 * returning without live examples, and refusing to answer because a screenshot
 * timed out would be worse than answering with stale examples.
 */
async function analyzeFromCache(args: {
  url: string;
  cache: DomainCache;
  userFields: SchemaField[];
  browser: IBrowser;
  persistScreenshot?: AnalysisDeps['persistScreenshot'];
}): Promise<AnalysisOutcome> {
  const { url, cache, userFields, browser, persistScreenshot } = args;
  const fieldNames = Object.keys(cache.fieldPaths);
  const domain = new URL(url).hostname.replace(/^www\./, '');

  const liveValues: Record<string, unknown> = {};
  let persisted: { id: string; url: string } | null = null;

  try {
    const capture = await browser.capture(url, { waitUntil: 'networkidle', interceptNetworkRequests: true });

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

    if (persistScreenshot) persisted = await persistScreenshot(capture.screenshot);
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
  };
}
