// The extraction chain: capture → mechanical → cache → AI → DOM → save.
//
// Lifted verbatim out of `extractRouter.extract`, where it was a ~420-line
// mega-procedure that owned the whole chain AND the tRPC boundary — the densest
// business logic in the repo sitting in the thinnest-should-be layer, and the
// hardest thing here to change safely. docs/ideas.md called for this move "the
// next time extract needs a non-trivial change"; it had five in one day.
//
// Two things this buys beyond tidiness:
//
//   * The v2 listing→detail crawler can reuse the chain instead of duplicating it.
//   * The Tier 1 fixture harness can replay THIS code rather than its own
//     reimplementation of it. `__fixtures__/replay.ts` grew a parallel copy of the
//     chain — its own tryAssign, its own ordering — so the "deterministic gate"
//     was green against a lookalike while page-corroboration and array-field
//     handling, both added to the real chain, went entirely untested.
//
// Deliberately transport-agnostic: it throws plain Errors and knows nothing about
// tRPC. Mapping failures onto TRPCError stays in the router.

import { checkPageHealth, type PageCapture, type IBrowser } from '@robot/browser';
import type { SchemaField, ExtractionPlan } from '@robot/agent';
import { buildExtractionScript } from './executor.js';
import { extractFromStructuredData } from './structured-extractor.js';
import { validateFieldShape } from './shape-validator.js';
import { corroborateValue, visibleTextFromHtml } from './corroborate-value.js';
import {
  lookupDomainCache, saveDomainCache,
  resolveApiPathsFromCache, buildCachedXPathScript, getByDotPath,
  saveCandidateCatalogue, findConcept, collectApiJsonBodies,
  saveVerifiedRowPlan, recordRowPlanMiss, recordRowPlanHit,
  EXTRACTION_SUCCESS_THRESHOLD,
  type PathSource, type DomainCache, type FieldPathSet, type RowFieldPath,
} from './domain-cache.js';
import type { CandidateCatalogue, Candidate } from './candidate-catalogue.js';
import type { CatalogueEvidence } from './catalogue-discovery.js';
import { acquireDomainLock } from './domain-lock.js';
import { detectSchemaChanges, formatSchemaChanges, type SchemaChange } from './schema-evolution.js';
import { validateExtractedData } from './data-quality.js';
import { calculateFieldCoverage, getMissingFields } from './field-coverage.js';
import { buildResultRows, type ResultRow } from './build-result-rows.js';
import { collectAiAnalysisSources } from './collect-ai-analysis-sources.js';

/** The vision model sometimes emits a not-found sentinel as a field's "value"
 *  (e.g. "UNKNOWN", "N/A", "—") when it cannot see the value on the page. Those
 *  must not be accepted as resolved — treat them as not-found. */
const AI_PLACEHOLDER_RE =
  /^(-+|n\/?a|none|null|undefined|unknown|<unknown>|not\s+(found|available|specified|listed|provided))$/i;
export function isAiPlaceholder(value: unknown): boolean {
  return typeof value === 'string' && AI_PLACEHOLDER_RE.test(value.trim());
}

export type ExtractionFieldInput = {
  name: string;
  type: string;
  description?: string;
  tier?: 'requested' | 'discovered';
  source?: string;
  api_path?: string;
  /**
   * Resolvable ONLY by row-scoped DOM extraction, never by a page-level tier.
   *
   * A per-row link is the motivating case. The first live crawl queued a
   * category page as if it were a product, because an upstream tier answered
   * `detail_url` with the page's own canonical URL — which then counted as
   * "resolved" and stopped the chain before row selectors were ever generated.
   */
  rowScopedOnly?: boolean;
  /** The customer's explicit candidate choice for this field (v2.5 serving order). */
  candidate?: { concept: string; label: string };
};

/**
 * The AI collaborator. Declared structurally rather than importing SchemaAgent so
 * a fixture run can pass a stub (or nothing) without constructing a real agent —
 * which would demand an API key and spend money.
 */
export type ExtractionAgent = {
  extractVariants(capture: PageCapture, screenshot: Buffer): Promise<{ variants: unknown[]; path_hint: string }>;
  extractFromApi(body: string, url: string, fields: SchemaField[]): Promise<{ fields: Array<{ name: string; value: unknown; json_path: string; confidence: number }> }>;
  generateSelectors(capture: PageCapture, fields: SchemaField[], pageType: string, tile?: Buffer): Promise<ExtractionPlan>;
  retrySelectorGeneration(capture: PageCapture, fields: SchemaField[], pageType: string, feedback: { missingFields: string[]; rowCount: number; previousRowXpath: string }): Promise<ExtractionPlan>;
};

/**
 * Injectable collaborators. Every one defaults to the production implementation,
 * so the router calls `runExtraction(request)` and gets exactly what the inline
 * chain used to do. Fixture replay overrides them to run offline.
 */
export type ExtractionDeps = {
  /**
   * The caller owns this browser's entire lifecycle — `runExtraction` neither
   * launches it nor closes it, on any path, including capture failure.
   *
   * Why: Phase 2's `startExecution` launches ONE browser and reuses it across
   * an entire crawl item loop via `extractItem`, which injects no `capture`.
   * `runExtraction` used to close the browser itself whenever `deps.capture`
   * was absent — a guard that conflated "I captured this page myself" with
   * "I own this browser." Item 1 succeeded, closed the shared browser, and
   * every subsequent item failed with "Browser not launched." Single-shot
   * callers that launch their own browser (e.g. `scraper.ts`'s `extract`
   * procedure) are responsible for closing it themselves, typically in a
   * `finally` around the call.
   */
  browser: IBrowser;
  agent: ExtractionAgent | null;
  lookupCache?: typeof lookupDomainCache;
  saveCache?: typeof saveDomainCache;
  /** Persists a listing walk's proven row plan (D1 fix, zero-items-rca.md). */
  saveVerifiedRowPlan?: typeof saveVerifiedRowPlan;
  /** Charges a miss against the persisted row plan when a replay finds nothing. */
  recordRowPlanMiss?: typeof recordRowPlanMiss;
  /** Charges a hit against the persisted row plan when a replay succeeds. */
  recordRowPlanHit?: typeof recordRowPlanHit;
  acquireLock?: typeof acquireDomainLock;
  /** Skip the live capture and use this instead (fixture replay). */
  capture?: PageCapture;
  /**
   * The AI-native discovery pass (Task 5's `discoverCandidateCatalogue`),
   * injected rather than imported — importing it directly would give
   * @robot/scraper an agent dependency it doesn't otherwise have, purely for
   * tests. Undefined skips discovery entirely (e.g. no ANTHROPIC_API_KEY).
   */
  discoverCatalogue?: (evidence: CatalogueEvidence) => Promise<CandidateCatalogue>;
  saveCatalogue?: (domain: string, pageType: string, catalogue: CandidateCatalogue) => Promise<void>;
};

export type ExtractionRequest = {
  url: string;
  fields: ExtractionFieldInput[];
  pageType?: 'detail' | 'listing';
  previousResults?: Record<string, unknown>;
};

export type ExtractionOutcome = {
  data: Record<string, unknown>[];
  plan: ExtractionPlan | null;
  confidence: number;
  sources: Record<string, string>;
  fieldCount: { found: number; total: number };
  fieldsByTier: { requested: ResultRow[]; discovered: ResultRow[] };
  cacheHit: boolean;
  /**
   * Every row row-scoped extraction produced, when it ran. `data` deliberately
   * stays a single row — it is what the dashboard, the judge and the export all
   * read — so a listing consumer that needs all N rows reads this instead.
   */
  rows?: Record<string, unknown>[];
  schemaChanges?: SchemaChange[];
  qualityIssues?: ReturnType<typeof validateExtractedData>['issues'];
  /**
   * Non-fatal problems worth a human's attention, e.g. a swallowed
   * `agent.generateSelectors` failure (D1 fix, zero-items-rca.md) — those used
   * to reach only `console.error`, so a 0-item listing plan built on top of one
   * had nothing in `runs.logs` to explain why. `planRun` folds these into its
   * own `warnings`, which `plan-source.ts` already writes to `runs.logs`.
   */
  warnings?: string[];
};

export async function runExtraction(
  request: ExtractionRequest,
  deps: ExtractionDeps,
): Promise<ExtractionOutcome> {
  const { url, fields, pageType, previousResults } = request;
  const {
    browser, agent,
    lookupCache = lookupDomainCache,
    saveCache = saveDomainCache,
    saveVerifiedRowPlan: saveRowPlan = saveVerifiedRowPlan,
    recordRowPlanMiss: recordRowMiss = recordRowPlanMiss,
    recordRowPlanHit: recordRowHit = recordRowPlanHit,
    acquireLock = acquireDomainLock,
  } = deps;
  const warnings: string[] = [];

  const domain = new URL(url).hostname;
  const resolvedPageType = pageType ?? 'detail';
  const fieldNames = fields.map((f) => f.name);
  // Fields that only row-scoped DOM extraction may answer. Every page-level tier
  // below skips them, so they stay "missing" until STEP 3 generates row selectors.
  const rowScoped = new Set(fields.filter((f) => f.rowScopedOnly).map((f) => f.name));
  const pageLevel = <T extends { name: string }>(list: T[]): T[] => list.filter((f) => !rowScoped.has(f.name));

  const cache: DomainCache | null = await lookupCache(domain, resolvedPageType);
  const releaseLock = await acquireLock(domain);

  try {
    let capture: PageCapture;
    if (deps.capture) {
      capture = deps.capture;
    } else {
      capture = await browser.capture(url, { waitUntil: 'networkidle', interceptNetworkRequests: true });
    }

    // Extracting a bot-check interstitial produces a confident wall of
    // nothing (2026-08-26: Newegg's Cloudflare page, 1 row, 28% confidence,
    // all dashes). checkPageHealth existed since v1.0 but was wired only into
    // the legacy pipeline — a blocked page now fails the run WITH its reason,
    // which is what run status and the sandbox error banner display.
    const health = checkPageHealth(capture.html, capture.title, capture.url ?? url);
    if (!health.healthy) {
      throw new Error(`Page blocked or unusable: ${health.reason}`);
    }

    const schemaFields: SchemaField[] = fields.map((f) => ({
      name: f.name,
      type: f.type as SchemaField['type'],
      description: f.description ?? '',
      required: true,
      tier: f.tier ?? 'discovered',
      source: f.source as SchemaField['source'],
      api_path: f.api_path,
    }));

    const finalData: Record<string, unknown> = {};
    const fieldResults: Record<string, { value: unknown; source: PathSource; path: string; confidence: number }> = {};
    // Stored paths the cached tiers tried against THIS page that produced
    // nothing usable (unresolved, or rejected by tryAssign). Threaded into
    // `saveCache` so each takes a miss — without it, a poisoned path's record
    // stays spotless forever and the prune can never retire it (W2,
    // abebooks-poisoned-titles-rca.md). Only the cached replay tiers charge
    // here: they are the only tiers exercising paths the cache already owns.
    const attemptedFailures: Record<string, Array<{ source: PathSource; path: string }>> = {};
    const chargeCachedMiss = (name: string, source: PathSource, path: string) => {
      (attemptedFailures[name] ??= []).push({ source, path });
    };

    const fieldByName = new Map(schemaFields.map((f) => [f.name, f]));
    // Rendered page text, computed once, used to corroborate values that came
    // from intercepted API responses rather than from the page itself.
    const pageText = visibleTextFromHtml(capture.html ?? '');
    // NOTE: intercepted responses are NOT entity-filtered. See filterRequestsForPage
    // in entity-match.ts for why the identifier rule is unsafe across API namespaces.
    const interceptedRequests = capture.interceptedRequests;
    // Schema types by field name, handed to buildExtractionScript so array-typed
    // fields collect every matching node instead of just the first.
    const fieldTypes: Record<string, string> = Object.fromEntries(
      schemaFields.map((f) => [f.name, f.type ?? 'string']),
    );

    // `path` is optional because a selector field may legitimately carry no xpath
    // — the AI saw a value but produced no working selector (v1.1b reverse-search),
    // or the model omitted it despite the tool schema. Such a field never yields a
    // `value` here, so the guard below returns first and no path-less entry is
    // ever recorded.
    // `override` exists ONLY for the v2.5 selection/displayed xpath-candidate
    // step below (task 7 fix round): an explicit customer selection, or the
    // vision-verified displayed default, replacing whatever an earlier tier
    // already assigned. Every other caller leaves it false — first-wins is
    // still the rule everywhere else in the chain.
    function tryAssign(name: string, value: unknown, source: PathSource, path: string | undefined, confidence: number, override = false): boolean {
      if (finalData[name] !== undefined && !override) return false;
      // Absent values are "not found", not "rejected" — skip silently. (Guards
      // against JSON.stringify(undefined) returning undefined → .slice crash.)
      if (value === undefined || value === null) return false;
      // A row-scoped field takes ONLY a row-extraction value. Filtering each
      // tier's request list is not enough: the AI-on-API tier assigns whatever
      // the model returns, and live it volunteered `detail_url` — the listing
      // page's own canonical URL — for a field it was never asked about.
      if (rowScoped.has(name) && source !== 'xpath') {
        console.log(`[extract] Rejected ${name} from ${source}: row-scoped fields come only from row extraction`);
        return false;
      }
      const type = fieldByName.get(name)?.type ?? 'string';
      const v = validateFieldShape(value, type, { fieldName: name });
      if (!v.ok) {
        console.log(`[extract] Rejected ${name}=${String(JSON.stringify(value)).slice(0, 60)} (source=${source}): ${v.reason}`);
        return false;
      }
      // A name-like value from an intercepted API must be findable in the rendered
      // page. Intercepted responses are separate documents and can describe a
      // different entity (recommendations, config, other sellers). Rejecting here
      // lets the chain fall through to the page's own sources.
      const c = corroborateValue({ value: v.normalized, fieldName: name, source, pageText });
      if (!c.ok) {
        console.log(`[extract] Rejected ${name}=${String(JSON.stringify(value)).slice(0, 60)} (source=${source}): ${c.reason}`);
        return false;
      }
      finalData[name] = v.normalized;
      fieldResults[name] = { value: v.normalized, source, path: path ?? '', confidence };
      return true;
    }

    // STEP 0.4: v2.5 selection / displayed-default serving (task 7 fix round).
    //
    // The v2.5 spec promises two rungs above the statistical ranking: the
    // customer's own candidate selection, and (absent one) the vision-verified
    // "displayed" candidate. The first pass (commit 7dba85d) implemented this
    // ONLY inside `resolveFromCache`, whose lookup is entirely field-name-keyed
    // (`allExtractedData[fieldName]`) — every writer here goes through
    // `tryAssign`, which writes `finalData[name]` once and never again, so by
    // the time `resolveFromCache` ran every candidate for a field resolved to
    // the SAME already-decided value. The hoist reordered a list nobody read.
    //
    // The fix: serve at the seams that actually hold PER-CANDIDATE evidence.
    // Running here, before every other tier (including mechanical), means
    // `tryAssign`'s first-wins guard now protects whatever this resolves —
    // no override needed for api/json-ld/meta candidates. An xpath-sourced
    // candidate has no evidence yet (nothing has rendered/executed against the
    // page), so it is deferred to STEP 1.5b below, which runs against the
    // captured HTML and uses an explicit override instead.
    //
    // `servedBySelection` is threaded through to STEP 1.5b so the xpath step
    // never re-touches a field this step already resolved.
    const servedBySelection = new Set<string>();
    if (cache && Object.keys(cache.candidateCatalogue ?? {}).length > 0) {
      const catalogue = cache.candidateCatalogue;
      const apiBodies = collectApiJsonBodies(interceptedRequests);
      const NON_XPATH_SOURCES = new Set(['api', 'api-ai', 'json-ld', 'meta']);
      const resolveCandidateValue = (candidate: Candidate): unknown => {
        switch (candidate.source) {
          case 'api':
          case 'api-ai': {
            for (const body of apiBodies) {
              const value = getByDotPath(body, candidate.path);
              if (value !== undefined && value !== null && value !== '') return value;
            }
            return undefined;
          }
          case 'json-ld': {
            for (const block of capture.structuredData.ldJson) {
              const value = getByDotPath(block, candidate.path);
              if (value !== undefined && value !== null && value !== '') return value;
            }
            return undefined;
          }
          case 'meta':
            return capture.structuredData.meta[candidate.path];
          default:
            return undefined;
        }
      };

      // 1. Explicit selections — first, so first-wins locks them in.
      for (const field of pageLevel(fields)) {
        if (!field.candidate) continue;
        const concept = findConcept(catalogue, field.name, field.candidate);
        const chosen = concept?.find((c) => c.label === field.candidate!.label);
        if (!chosen || !NON_XPATH_SOURCES.has(chosen.source)) continue;
        const value = resolveCandidateValue(chosen);
        if (value === undefined) continue;
        if (tryAssign(field.name, value, chosen.source as PathSource, chosen.path, 0.95)) {
          servedBySelection.add(field.name);
        }
      }

      // 2. Displayed-default — only for fields with no explicit selection, and
      // never for a field the selection pass above already served. Also never
      // for a field an operator pin (or a human-sourced path) already claims:
      // spec §6.1/§12 — pins keep winning absent an explicit selection, and
      // this pass runs BEFORE mechanical/cache, so if it minted the displayed
      // value here, tryAssign's first-wins guard would lock it in and the
      // pin's own value (served later, in ranked order, by STEP 1.5) would
      // never get a chance.
      for (const field of pageLevel(fields)) {
        if (field.candidate || servedBySelection.has(field.name)) continue;
        if (cache.fieldPaths[field.name]?.paths.some((p) => p.pinned || p.source === 'human')) continue;
        const concept = findConcept(catalogue, field.name);
        const chosen = concept?.find((c) => c.displayed === true);
        if (!chosen || !NON_XPATH_SOURCES.has(chosen.source)) continue;
        const value = resolveCandidateValue(chosen);
        if (value === undefined) continue;
        if (tryAssign(field.name, value, chosen.source as PathSource, chosen.path, 0.95)) {
          servedBySelection.add(field.name);
        }
      }
    }

    // STEP 0.5: AI-discovered API paths
    const apiFields = pageLevel(schemaFields.filter((f) => f.api_path && f.source === 'api'));
    if (apiFields.length > 0 && interceptedRequests.length > 0) {
      const apiBodies = interceptedRequests
        .filter((r) => r.parsedJson && typeof r.parsedJson === 'object')
        .map((r) => r.parsedJson);
      for (const field of apiFields) {
        for (const body of apiBodies) {
          const value = getByDotPath(body, field.api_path!);
          if (tryAssign(field.name, value, 'api', field.api_path!, 0.95)) break;
        }
      }
      console.log(`[extract] AI-discovered API paths resolved: ${Object.keys(finalData).length}/${apiFields.length} fields`);
    }

    // STEP 1: Mechanical extraction
    const missingAfterApiPaths = pageLevel(schemaFields.filter((f) => finalData[f.name] === undefined));
    if (missingAfterApiPaths.length > 0) {
      const fieldsWithHints = missingAfterApiPaths.map((f) => ({
        name: f.name,
        type: f.type,
        description: f.description,
        sourceHint: f.source as 'api' | 'json-ld' | 'meta' | 'page' | undefined,
      }));
      const mechanicalResult = extractFromStructuredData(
        capture.structuredData,
        fieldsWithHints,
        interceptedRequests,
        // The REQUESTED url, not capture.url. If our own dismissal pass navigated
        // away, capture.url is the page we drifted to and its structured data will
        // match it perfectly — the comparison has to be against what was asked for.
        url,
      );
      for (const [name, source] of Object.entries(mechanicalResult.sources)) {
        tryAssign(name, mechanicalResult.data[name], source as PathSource, mechanicalResult.paths[name] ?? '', 0.8);
      }
      console.log(`[extract] Mechanical: ${Object.keys(mechanicalResult.data).length} additional fields`);
    }

    // Seed previousResults
    // WHY: 'previous' is not a valid PathSource; this is carry-over data from a
    // prior run, not a scraper source — kept outside tryAssign to preserve the
    // 'previous' source tag.
    if (previousResults && typeof previousResults === 'object') {
      for (const [name, value] of Object.entries(previousResults)) {
        if (value !== null && value !== undefined && finalData[name] === undefined) {
          const type = fieldByName.get(name)?.type ?? 'string';
          const v = validateFieldShape(value, type, { fieldName: name });
          if (v.ok) {
            finalData[name] = v.normalized;
            fieldResults[name] = { value: v.normalized, source: 'previous' as PathSource, path: '', confidence: 0.9 };
          } else {
            console.log(`[extract] Rejected previousResults ${name}=${JSON.stringify(value).slice(0, 60)}: ${v.reason}`);
          }
        }
      }
    }

    console.log(`[extract] Total after paths + mechanical: ${Object.keys(finalData).length}/${fields.length} fields`);

    // STEP 1.5: Cached paths
    if (cache && cache.totalRuns > 0) {
      const missingForCache = fieldNames.filter((n) => finalData[n] === undefined && !rowScoped.has(n));
      if (missingForCache.length > 0 && interceptedRequests.length > 0) {
        const apiCacheResult = resolveApiPathsFromCache(cache.fieldPaths, interceptedRequests, missingForCache);
        for (const [name, resolved] of Object.entries(apiCacheResult.resolved)) {
          // The winning path travels with the value so the save can credit the
          // hit to the exact stored path (W1); a rejection (shape or
          // corroboration) charges it a miss instead — the serving firewall
          // held, now the ledger learns it too (W2).
          if (!tryAssign(name, resolved.value, resolved.source as PathSource, resolved.path, resolved.confidence)) {
            chargeCachedMiss(name, resolved.source as PathSource, resolved.path);
          }
        }
        for (const [name, failures] of Object.entries(apiCacheResult.failed)) {
          for (const failure of failures) chargeCachedMiss(name, failure.source, failure.path);
        }
        if (Object.keys(apiCacheResult.resolved).length > 0) {
          console.log(`[extract] Cached API paths resolved: ${Object.keys(apiCacheResult.resolved).length} fields`);
        }
      }

      const stillMissing = fieldNames.filter((n) => finalData[n] === undefined && !rowScoped.has(n));
      if (stillMissing.length > 0) {
        const cachedXPath = buildCachedXPathScript(cache.fieldPaths, stillMissing);
        if (cachedXPath) {
          try {
            // Against the HTML we already captured — `evaluate` would open a new
            // page and re-navigate, doubling page loads on exactly the warm path
            // a crawl spends most of its time in.
            const xpathResult = await browser.setContentEvaluate<{ data: Record<string, unknown>[]; fieldCount: number }>(
              capture.html ?? '', cachedXPath.script,
            );
            // Iterate the CHOSEN paths, not just the values that came back:
            // a stored xpath that matched nothing is a per-path observation
            // and takes a miss (W2). A hit carries the stored path (still
            // under the 'xpath-cached' serving label — the save maps it back
            // to the stored identity), so its stats finally move (W1).
            const xpathRow = xpathResult.data[0] ?? {};
            for (const [name, sel] of Object.entries(cachedXPath.chosen)) {
              const value = xpathRow[name];
              if (value === undefined || value === null || value === '') {
                chargeCachedMiss(name, sel.source, sel.path);
                continue;
              }
              if (!tryAssign(name, value, 'xpath-cached', sel.path, 0.85)) {
                chargeCachedMiss(name, sel.source, sel.path);
              }
            }
            if (xpathResult.data.length > 0) {
              console.log(`[extract] Cached XPaths resolved: ${xpathResult.fieldCount} fields`);
            }
          } catch (err) {
            // A script-execution failure is a browser hiccup, not evidence
            // about any particular path — charge nothing.
            console.error('[extract] Cached XPath execution failed (non-fatal):', err);
          }
        }
      }

      // STEP 1.5b: v2.5 selection / displayed-default candidates whose SOURCE
      // is xpath (task 7 fix round). STEP 0.4 above only resolves api/api-ai/
      // json-ld/meta candidates because it runs before any page evaluation —
      // an xpath candidate has nothing to execute against yet at that point.
      // This runs it against the HTML already captured, reusing
      // `buildCachedXPathScript`'s script builder via a synthetic one-path
      // field-path map rather than duplicating its DOM-query logic.
      //
      // Precedence: an explicit selection's override always wins, even over a
      // value an earlier tier already assigned. A displayed-default override
      // is weaker — it must never touch a field STEP 0.4 already served
      // (`servedBySelection`), whether that was via an explicit selection or
      // via its own api/json-ld/meta displayed-default resolution.
      // `candidateCatalogue` is typed as required on `DomainCache`, but the
      // Tier 1 fixture-replay harness (`__fixtures__/replay.ts`) builds a
      // partial cache via `as DomainCache` that omits it — so it is
      // `undefined` at runtime there. Guard the same way STEP 0.4 does.
      if (cache.candidateCatalogue && Object.keys(cache.candidateCatalogue).length > 0) {
        const xpathOverrideTargets: Record<string, FieldPathSet> = {};
        for (const field of pageLevel(fields)) {
          let chosen: Candidate | undefined;
          if (field.candidate) {
            const concept = findConcept(cache.candidateCatalogue, field.name, field.candidate);
            chosen = concept?.find((c) => c.label === field.candidate!.label);
          } else if (
            !servedBySelection.has(field.name) &&
            // Same pin/human guard as STEP 0.4's displayed pass above (spec
            // §6.1/§12): absent an explicit selection, a pin keeps winning —
            // the displayed default must not be minted ahead of it here either.
            !cache.fieldPaths[field.name]?.paths.some((p) => p.pinned || p.source === 'human')
          ) {
            const concept = findConcept(cache.candidateCatalogue, field.name);
            chosen = concept?.find((c) => c.displayed === true);
          }
          if (chosen && chosen.source === 'xpath') {
            xpathOverrideTargets[field.name] = {
              paths: [{
                path: chosen.path, source: 'xpath', confidence: 0.95,
                hits: 0, misses: 0, lastValue: null, lastUsedAt: new Date().toISOString(),
              }],
              conflictCount: 0,
            };
          }
        }
        const xpathOverrideNames = Object.keys(xpathOverrideTargets);
        if (xpathOverrideNames.length > 0) {
          const overrideScript = buildCachedXPathScript(xpathOverrideTargets, xpathOverrideNames);
          if (overrideScript) {
            try {
              const overrideResult = await browser.setContentEvaluate<{ data: Record<string, unknown>[]; fieldCount: number }>(
                capture.html ?? '', overrideScript.script,
              );
              if (overrideResult.data.length > 0) {
                for (const [name, value] of Object.entries(overrideResult.data[0]!)) {
                  if (tryAssign(name, value, 'xpath', xpathOverrideTargets[name]!.paths[0]!.path, 0.95, true)) {
                    servedBySelection.add(name);
                  }
                }
                console.log(`[extract] Selection/displayed xpath override resolved: ${overrideResult.fieldCount} field(s)`);
              }
            } catch (err) {
              console.error('[extract] Selection/displayed xpath override failed (non-fatal):', err);
            }
          }
        }
      }

      // No final `resolveFromCache` pass here: its lookup is field-name-keyed
      // against `finalData`, which only ever contains fields `tryAssign`
      // already accepted — so it could only re-offer values that first-wins
      // then rejected. Serving from the cache happens at the seams that hold
      // per-candidate evidence: STEP 0.4/1.5b (selection/displayed), the
      // cached API-path tier, and the cached-XPath tier above. (The analyze
      // wizard still uses `resolveFromCache` against its own liveValues.)

      const totalFromCache = fieldNames.filter((n) => finalData[n] !== undefined).length;
      console.log(`[extract] After cache: ${totalFromCache}/${fields.length} fields (${cache.totalRuns} previous runs, ${cache.successRate}% success)`);
    } else if (cache) {
      console.log(`[extract] Cache exists but has no successful runs yet for ${domain}/${resolvedPageType}`);
    } else {
      console.log(`[extract] No cache for ${domain}/${resolvedPageType}`);
    }

    // STEP 1.6: AI variants fallback — runs when a variant_array field is
    // requested AND mechanical + cache produced no value for it.
    const variantFields = schemaFields.filter((f) => f.type === 'variant_array' && finalData[f.name] === undefined);
    if (agent && variantFields.length > 0) {
      for (const vf of variantFields) {
        try {
          const { variants, path_hint } = await agent.extractVariants(capture, capture.screenshot);
          if (variants.length > 0) {
            if (tryAssign(vf.name, variants, 'ai-discovered-variants', path_hint, 0.6)) {
              console.log(`[extract] AI variants fallback: ${variants.length} variants for ${vf.name} (hint: ${path_hint.slice(0, 60)})`);
            }
          }
        } catch (err) {
          console.error(`[extract] AI variants fallback failed for ${vf.name} (non-fatal):`, err);
        }
      }
    }

    // STEP 2: AI API analysis
    const missingAfterCache = pageLevel(schemaFields.filter((f) => finalData[f.name] === undefined));
    const apisToTry = collectAiAnalysisSources({
      interceptedRequests: interceptedRequests,
      structuredData: capture.structuredData,
    });
    if (agent && missingAfterCache.length > 0 && apisToTry.length > 0) {
      console.log(`[extract] ${missingAfterCache.length} fields missing, AI analyzing API responses`);
      for (const api of apisToTry) {
        const stillMissing = schemaFields.filter((f) => finalData[f.name] === undefined);
        if (stillMissing.length === 0) break;
        try {
          const apiResult = await agent.extractFromApi(api.responseBody, api.url, stillMissing);
          for (const field of apiResult.fields) {
            if (field.confidence > 0.3) {
              const source: PathSource = api.url.startsWith('inline://') ? 'json-ld' : 'api-ai';
              tryAssign(field.name, field.value, source, field.json_path, field.confidence);
            }
          }
        } catch (err) {
          console.error(`[extract] AI API extraction failed for ${api.url.slice(0, 80)} (non-fatal):`, err);
        }
      }
      console.log(`[extract] After AI API: ${Object.keys(finalData).length}/${fields.length} fields`);
    }

    let plan: ExtractionPlan | null = null;
    // The full row set, kept for listing consumers. `finalData` only ever holds
    // row 0 — right for a detail page, useless for a crawler enumerating links.
    let extractedRows: Record<string, unknown>[] | undefined;
    // A snapshot of STEP 2.5's own result, kept separately from `plan`/
    // `extractedRows` above. `runListingAnalysis` always requests detail_url
    // alongside every base field (analysis-orchestrator.ts:394-399), so a STEP
    // 2.5 hit for detail_url plus a STILL-missing OTHER field is the common
    // case, not an edge case — and STEP 3/3.5 below both overwrite `plan`/
    // `extractedRows` wholesale with THEIR OWN row extraction (scoped to
    // whatever THEY were asked for). Without this snapshot that silently drops
    // the replay-resolved field from every row, reintroducing the zero-items
    // failure this fix exists to close via a different call site. See the
    // merge right before STEP 4.
    let resolvedByReplayPlan: ExtractionPlan | null = null;
    let resolvedByReplayRows: Record<string, unknown>[] | undefined;

    // STEP 2.5: cached row-plan replay (D1 fix, zero-items-rca.md).
    //
    // Every row-scoped field (`detail_url` foremost) used to be resolvable
    // ONLY by a fresh, nondeterministic `agent.generateSelectors` call below,
    // on every single listing plan, warm domain or not — STEP 1.5's two
    // cached tiers deliberately exclude row-scoped fields (`missingForCache`/
    // `stillMissing` above both filter `!rowScoped.has(n)`) because they
    // execute PAGE-LEVEL: `buildCachedXPathScript`'s generated script takes
    // FIRST_ORDERED_NODE_TYPE, i.e. one match from the whole document. Caching
    // a row-scoped field's xpath into `fieldPaths` and letting that tier serve
    // it would resolve exactly one row's value as if it were the page's own —
    // which is how the first live crawl queued a category page as if it were
    // a product (see the comment on `rowScoped` above).
    //
    // A `cache.rowSelector` with `source: 'verified'` sidesteps that: it was
    // persisted (below, after STEP 3 succeeds) as a `{ row_xpath, fields }`
    // pair proven to work, and is replayed here the SAME way STEP 3 replays
    // an AI-generated plan — `buildExtractionScript` matches every row via
    // `row_xpath` and evaluates each field's xpath relative to its own row —
    // so the page-level exclusion's reason does not apply to it. A hit here
    // means STEP 3's `agent.generateSelectors` call is skipped entirely
    // (`missingAfterApi` below no longer lists these fields); a miss falls
    // through to it unchanged.
    const missingRowScoped = fields.filter((f) => f.rowScopedOnly && finalData[f.name] === undefined);
    if (cache?.rowSelector?.fields && missingRowScoped.length > 0) {
      const replayFields = cache.rowSelector.fields.filter(
        (rf) => missingRowScoped.some((f) => f.name === rf.name),
      );
      if (replayFields.length > 0) {
        const replayPlan = {
          row_xpath: cache.rowSelector.xpath,
          page_type: resolvedPageType,
          fields: replayFields.map((rf) => ({
            name: rf.name, xpath: rf.xpath, attribute: rf.attribute, transform: rf.transform,
          })),
        } as ExtractionPlan;
        try {
          const replayScript = buildExtractionScript(replayPlan, fieldTypes, capture.url ?? url);
          const replayResult = await browser.setContentEvaluate<{ data: Record<string, unknown>[] }>(
            capture.html ?? '', replayScript,
          );
          if (replayResult.data.length > 0) {
            extractedRows = resolvedByReplayRows = replayResult.data;
            plan = resolvedByReplayPlan = replayPlan;
            const replayRow = replayResult.data[0]!;
            for (const rf of replayFields) {
              tryAssign(rf.name, replayRow[rf.name], 'xpath', rf.xpath, 0.85);
            }
            console.log(`[extract] Row-plan replay resolved ${replayResult.data.length} row(s) for ${replayFields.map((f) => f.name).join(', ')} — AI selector generation skipped`);
            try {
              await recordRowHit(domain, resolvedPageType);
            } catch (err) {
              console.error('[extract] recordRowPlanHit failed (non-fatal):', err);
            }
          } else {
            console.log('[extract] Row-plan replay matched no rows — falling through to AI selector generation');
            try {
              await recordRowMiss(domain, resolvedPageType);
            } catch (err) {
              console.error('[extract] recordRowPlanMiss failed (non-fatal):', err);
            }
          }
        } catch (err) {
          console.error('[extract] Row-plan replay failed (non-fatal):', err);
          try {
            await recordRowMiss(domain, resolvedPageType);
          } catch (missErr) {
            console.error('[extract] recordRowPlanMiss failed (non-fatal):', missErr);
          }
        }
      }
    }

    // STEP 3: XPath fallback. Variant arrays don't come from DOM XPath (they're
    // handled by the JSON-LD walker + AI variants fallback above); excluding them
    // here avoids the XPath agent returning stringified JSON that the shape
    // validator then rightly rejects.
    const missingAfterApi = schemaFields.filter((f) => finalData[f.name] === undefined && f.type !== 'variant_array');
    if (agent && missingAfterApi.length > 0) {
      console.log(`[extract] ${missingAfterApi.length} fields still missing, XPath fallback`);
      try {
        plan = await agent.generateSelectors(capture, missingAfterApi, resolvedPageType);
        // An operator's click-to-select pin anchors the AI plan's row
        // container — but only a HUMAN pin. A 'verified' entry is STEP 2.5's
        // own row_xpath, and reaching here at all means that xpath either
        // matched nothing (replay miss) or was never asked to run (this
        // field wasn't in `missingRowScoped`) — forcing the fresh AI plan
        // back onto it would reassert the very selector that just failed, or
        // one irrelevant to what the AI was asked for.
        if (cache?.rowSelector?.source === 'human') {
          plan.row_xpath = cache.rowSelector.xpath;
        }
        const script = buildExtractionScript(plan, fieldTypes, capture.url ?? url);
        // Run against the capture the selectors were generated FROM. Re-navigating
        // executed them against a different render: a category page whose load
        // fell back to domcontentloaded had not painted its product grid, so a
        // correct selector matched nothing — and it cost a second page load.
        const xpathResult = await browser.setContentEvaluate<{ data: Record<string, unknown>[] }>(
          capture.html ?? '', script,
        );
        extractedRows = xpathResult.data;
        const xpathRow = xpathResult.data.length > 0 ? xpathResult.data[0]! : {};
        for (const fieldDef of plan.fields) {
          const domValue = xpathRow[fieldDef.name];
          const assigned = tryAssign(fieldDef.name, domValue, 'xpath', fieldDef.xpath, 0.7);
          // The xpath missed but the AI reported a value it saw on the page — use
          // it. Empty path → not cached as a reusable selector, just delivered for
          // this run.
          if (!assigned && fieldDef.value !== undefined && fieldDef.value !== null
              && fieldDef.value !== '' && !isAiPlaceholder(fieldDef.value)) {
            tryAssign(fieldDef.name, fieldDef.value, 'ai-vision', '', 0.5);
          }
        }

        const isListing =
          resolvedPageType === 'listing' ||
          (resolvedPageType as string) === 'search_results' ||
          (resolvedPageType as string) === 'table';
        if (isListing && xpathResult.data.length > 0) {
          const coverage = calculateFieldCoverage(xpathResult.data, schemaFields);
          if (coverage < 0.5) {
            const missing = getMissingFields(xpathResult.data, schemaFields);
            console.log(`[extract] Low field coverage (${Math.round(coverage * 100)}%), retrying — missing: ${missing.join(', ')}`);
            try {
              const retryPlan = await agent.retrySelectorGeneration(capture, schemaFields, resolvedPageType, {
                missingFields: missing,
                rowCount: xpathResult.data.length,
                previousRowXpath: plan.row_xpath,
              });
              const retryScript = buildExtractionScript(retryPlan, fieldTypes, capture.url ?? url);
              const retryResult = await browser.evaluate<{ data: Record<string, unknown>[] }>(
                url, retryScript, { waitUntil: 'networkidle' },
              );
              if (retryResult.data.length > 0) {
                for (const fieldDef of retryPlan.fields) {
                  const value = retryResult.data[0]![fieldDef.name];
                  tryAssign(fieldDef.name, value, 'xpath', fieldDef.xpath, 0.7);
                }
                plan = retryPlan;
                // The retry plan won, so its rows are the ones a listing consumer wants.
                extractedRows = retryResult.data;
              }
            } catch (retryErr) {
              console.error('[extract] XPath retry failed (non-fatal):', retryErr);
            }
          }
        }
      } catch (err) {
        // D1 fix (zero-items-rca.md): this used to be console-only. `detail_url`
        // has exactly one producer — this call — so a swallowed failure here
        // silently zeroed a listing plan (probe f5b72f3a: 30 items one run, 0
        // the next, `runs.logs` empty). Surfaced into `outcome.warnings` so
        // `planRun` (which folds a listing extraction's warnings into its own)
        // and `plan-source.ts` (which writes those into `runs.logs`) can both
        // say why, instead of a clean `'planned'` with nothing to explain it.
        const message = err instanceof Error ? err.message : String(err);
        warnings.push(`XPath fallback (generateSelectors) failed: ${message}`);
        console.error('[extract] XPath fallback failed (non-fatal):', err);
      }

      // Persist the row plan this walk just proved works (D1 fix,
      // zero-items-rca.md) — row_xpath plus the row-relative xpath for every
      // row-scoped field it actually resolved, so the NEXT walk on this
      // domain replays it (STEP 2.5 above) instead of paying for another
      // agent.generateSelectors call. Reads the FINAL `plan`/`extractedRows`
      // (post-retry, if the low-coverage retry above ran and won), and is a
      // no-op when nothing row-scoped resolved — e.g. a detail-page plan, or
      // a listing plan whose row selectors never touched detail_url.
      if (plan?.row_xpath && extractedRows && extractedRows.length > 0) {
        const rowScopedResolved: RowFieldPath[] = plan.fields
          .filter((f): f is typeof f & { xpath: string } =>
            rowScoped.has(f.name) && typeof f.xpath === 'string' && f.xpath.length > 0)
          .map((f) => ({ name: f.name, xpath: f.xpath, attribute: f.attribute, transform: f.transform }));
        if (rowScopedResolved.length > 0) {
          try {
            await saveRowPlan(domain, resolvedPageType, { rowXpath: plan.row_xpath, fields: rowScopedResolved });
          } catch (err) {
            console.error('[extract] saveVerifiedRowPlan failed (non-fatal):', err);
          }
        }
      }
    }

    // STEP 3.5: Escalate to lower screenshot tiles for still-missing fields.
    // Tile 0 (above-fold) was used above; lower tiles are sent only when needed,
    // capped by capture (MAX_TILES). Cost is paid once per page-shape, then cached.
    const tiles = capture.screenshotTiles ?? [capture.screenshot];
    if (agent) {
      for (let t = 1; t < tiles.length; t++) {
        const stillMissing = schemaFields.filter((f) => finalData[f.name] === undefined && f.type !== 'variant_array');
        if (stillMissing.length === 0) break;
        try {
          const tilePlan = await agent.generateSelectors(capture, stillMissing, resolvedPageType, tiles[t]);
          // Same human-only guard as STEP 3's call above.
          if (cache?.rowSelector?.source === 'human') {
            tilePlan.row_xpath = cache.rowSelector.xpath;
          }
          const tileScript = buildExtractionScript(tilePlan, fieldTypes, capture.url ?? url);
          const tileResult = await browser.setContentEvaluate<{ data: Record<string, unknown>[] }>(
            capture.html ?? '', tileScript,
          );
          // Tile escalation is row extraction too — a listing consumer needs its
          // rows, not just row 0. Without this a field first resolved here left
          // `rows` empty and the crawler enumerated nothing.
          if (tileResult.data.length > 0) extractedRows = tileResult.data;
          const tileRow = tileResult.data.length > 0 ? tileResult.data[0]! : {};
          for (const fieldDef of tilePlan.fields) {
            const assigned = tryAssign(fieldDef.name, tileRow[fieldDef.name], 'xpath', fieldDef.xpath, 0.7);
            if (!assigned && fieldDef.value !== undefined && fieldDef.value !== null
                && fieldDef.value !== '' && !isAiPlaceholder(fieldDef.value)) {
              tryAssign(fieldDef.name, fieldDef.value, 'ai-vision', '', 0.5);
            }
          }
          console.log(`[extract] Tile ${t} escalation: ${schemaFields.filter((f) => finalData[f.name] !== undefined).length}/${schemaFields.length} resolved`);
        } catch (err) {
          console.error(`[extract] Tile ${t} escalation failed (non-fatal):`, err);
        }
      }
    }

    // Merge STEP 2.5's replay-resolved row-scoped fields back into whatever
    // STEP 3/3.5 ended up producing (D1 fix follow-up). Both of those steps
    // overwrite `extractedRows` wholesale with THEIR OWN row extraction —
    // right when they are the only tier that ran, wrong the moment STEP 2.5
    // already resolved a row-scoped field for a DIFFERENT still-missing
    // field's sake. `runListingAnalysis` always requests detail_url alongside
    // every base field, so that combination is the common case, not an edge
    // one.
    //
    // Reference equality on `extractedRows` (not a length/emptiness check)
    // detects an overwrite regardless of which later step did it, and
    // regardless of whether the later extraction found 0 rows. Merged
    // row-wise BY INDEX: both extractions ran against the same captured page,
    // so document order lines up even when the two row selectors' match
    // counts differ slightly. STEP 3/3.5's own keys are never at risk of
    // being clobbered here — the two field sets are disjoint by construction,
    // since STEP 2.5 only ever replays fields that were already resolved
    // (and therefore excluded from what STEP 3/3.5 were asked for).
    if (resolvedByReplayRows && resolvedByReplayRows.length > 0 && extractedRows !== resolvedByReplayRows) {
      const laterRows = extractedRows ?? [];
      const merged: Record<string, unknown>[] = [];
      for (let i = 0; i < Math.max(resolvedByReplayRows.length, laterRows.length); i++) {
        merged.push({ ...(resolvedByReplayRows[i] ?? {}), ...(laterRows[i] ?? {}) });
      }
      extractedRows = merged;
      // `plan` matters too: planRun replays `page1.plan` to walk pages 2+
      // (`buildExtractionScript(page1.plan, ...)`) — a plan missing the
      // row-scoped field's def would silently starve every later page as
      // well. Only merge if a later step actually produced its own plan
      // object (an exception before `plan = await agent.generateSelectors`
      // completed leaves `plan` as `resolvedByReplayPlan` already).
      if (resolvedByReplayPlan && plan && plan !== resolvedByReplayPlan) {
        const newFieldNames = new Set(plan.fields.map((f) => f.name));
        plan = {
          ...plan,
          fields: [...plan.fields, ...resolvedByReplayPlan.fields.filter((f) => !newFieldNames.has(f.name))],
        };
      }
    }

    // STEP 4: Confidence + save cache
    const foundFields = Object.keys(finalData).length;
    const confidence = fields.length > 0 ? foundFields / fields.length : 0;
    const sources: Record<string, string> = {};
    for (const [name, result] of Object.entries(fieldResults)) {
      sources[name] = result.source;
    }
    console.log(`[extract] Done: ${foundFields}/${fields.length} fields, confidence=${Math.round(confidence * 100)}%`);
    console.log(`[extract] Sources: ${JSON.stringify(sources)}`);

    let schemaChanges: SchemaChange[] = [];
    if (cache && Object.keys(cache.fieldPaths).length > 0) {
      schemaChanges = detectSchemaChanges(cache.fieldPaths, fieldNames, finalData);
      if (schemaChanges.length > 0) {
        console.log(`[extract] ${formatSchemaChanges(schemaChanges)}`);
      }
    }

    try {
      await saveCache({
        domain,
        pageType: resolvedPageType,
        url: capture.url ?? url,
        interceptedRequests: interceptedRequests,
        fieldResults,
        discoveredFieldNames: schemaFields.map((f) => f.name),
        attemptedFailures,
        overallConfidence: confidence,
        hasJsonLd: capture.structuredData.ldJson.length > 0,
        hasNextData: capture.structuredData.nextData !== null,
      });
      console.log(`[extract] Saved domain intelligence for ${domain}`);
    } catch (err) {
      console.error('[extract] Cache save failed (non-fatal):', err);
    }

    // v2.5 catalogue discovery: one labelled pass per domain, only when the
    // catalogue is cold, only after a successful extraction, and NEVER able to
    // fail the run — the catalogue is an enrichment, not a dependency.
    //
    // `cache` is null when this is the domain+pageType's first-ever extraction
    // — no domain_intelligence row existed when `lookupCache` ran above. That
    // is the emptiest possible catalogue state (spec §4), not a reason to skip:
    // treat "no row" the same as "row with an empty catalogue".
    //
    // Runs after `saveCache` above, not before: `saveCandidateCatalogue` is
    // update-only and silently no-ops without an existing domain_intelligence
    // row (Task 2). `saveCache` just upserted that row (whether `cache` was
    // null or not), so by the time we get here the row this write needs is
    // guaranteed to exist — that ordering is load-bearing.
    //
    // "Only after a successful extraction" is enforced by `confidence >=
    // EXTRACTION_SUCCESS_THRESHOLD` — the same bar `saveDomainCache` uses to
    // decide `isSuccess`. Without it a failed run (few or no fields resolved)
    // would still spend an AI call cataloguing whatever thin evidence it did
    // capture, and could poison a cold catalogue with candidates drawn from a
    // page that never really loaded.
    if (
      deps.discoverCatalogue &&
      (!cache || Object.keys(cache.candidateCatalogue ?? {}).length === 0) &&
      confidence >= EXTRACTION_SUCCESS_THRESHOLD
    ) {
      try {
        const catalogue = await deps.discoverCatalogue({
          apiBodies: collectApiJsonBodies(interceptedRequests),
          jsonLdBlocks: capture.structuredData.ldJson,
          meta: capture.structuredData.meta,
          fieldResults: Object.entries(fieldResults).map(([name, r]) => ({
            name, value: r.value, source: r.source, path: r.path,
          })),
        });
        if (Object.keys(catalogue).length > 0) {
          await (deps.saveCatalogue ?? saveCandidateCatalogue)(domain, resolvedPageType, catalogue);
        } else {
          // Say so, loudly. Three dogfood runs on 2026-08-26 burned an AI call
          // each and wrote nothing, and the only symptom was an absence — the
          // exact silent-empty failure the project's "no silent caps" rule
          // exists to prevent.
          console.warn(
            `[extract] catalogue discovery for ${domain}/${resolvedPageType} returned no valid candidates — nothing saved`,
          );
        }
      } catch (err) {
        console.error('[extract] catalogue discovery failed (non-fatal):', err);
      }
    }

    // STEP 5: Quality validation
    const { data: cleanedData, issues: qualityIssues } = validateExtractedData([finalData], schemaFields);

    // Build the per-field rows from the CLEANED row, not the raw one. `fieldsByTier`
    // is the output everything actually reads — the dashboard renders it and the
    // Tier 2 judge scores it — so building it from finalData meant every auto-fix
    // (HTML stripping, price normalisation) was computed and then discarded. The
    // 2026-08-18 dogfood shows the result: `specifications` reported with its
    // `<b>`/`<br/>` markup intact.
    const cleanedRow = cleanedData[0] ?? finalData;
    const { requested: requestedResults, discovered: discoveredResults } = buildResultRows({
      schemaFields: schemaFields.map((f) => ({ name: f.name, type: f.type, tier: f.tier! })),
      finalData: cleanedRow,
      sources,
    });

    return {
      data: cleanedData,
      plan,
      confidence,
      sources,
      fieldCount: { found: foundFields, total: fields.length },
      fieldsByTier: { requested: requestedResults, discovered: discoveredResults },
      cacheHit: cache !== null && cache.totalRuns > 0 && Object.keys(cache.fieldPaths).length > 0,
      rows: extractedRows,
      schemaChanges: schemaChanges.length > 0 ? schemaChanges : undefined,
      qualityIssues: qualityIssues.length > 0 ? qualityIssues : undefined,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  } finally {
    releaseLock();
  }
}
