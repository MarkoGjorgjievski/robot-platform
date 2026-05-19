import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure } from '../trpc';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { SchemaChange, PathSource } from '@robot/scraper';
import { validateFieldShape } from '@robot/scraper';
import type { SchemaField } from '@robot/agent';
import { buildResultRows } from './lib/build-result-rows.js';
import { cachedFieldsFromCache } from './lib/cached-fields-from-cache.js';
import { collectAiAnalysisSources } from './lib/collect-ai-analysis-sources.js';

// ─── Shared field shape ─────────────────────────────────────────────────────

const fieldInputSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  description: z.string().optional(),
  tier: z.enum(['requested', 'discovered']).optional(),
  source: z.string().optional(),
  api_path: z.string().optional(),
  example_value: z.string().optional(),
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function getCapturesDir(): string {
  // api-server sets CAPTURES_DIR before procedures run; fall back to a sensible default.
  return process.env.CAPTURES_DIR ?? join(process.cwd(), 'public', 'captures');
}

// ─── Procedures ─────────────────────────────────────────────────────────────

export const scraperRouter = router({
  analyze: publicProcedure
    .input(
      z.object({
        url: z.string().url(),
        requestedFields: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { url, requestedFields } = input;
      const domain = new URL(url).hostname.replace(/^www\./, '');

      const { lookupDomainCache, normalizeUserFields } = await import('@robot/scraper');

      // Try both page types — return whichever has more cached fields
      const [detailCache, listingCache] = await Promise.all([
        lookupDomainCache(domain, 'detail').catch(() => null),
        lookupDomainCache(domain, 'listing').catch(() => null),
      ]);

      const cache = detailCache && listingCache
        ? (Object.keys(detailCache.fieldPaths).length >= Object.keys(listingCache.fieldPaths).length ? detailCache : listingCache)
        : detailCache ?? listingCache;

      if (cache && Object.keys(cache.fieldPaths).length > 0 && cache.consecutiveFailures < 5) {
        const cachedFields = cachedFieldsFromCache(cache.fieldPaths);

        const userFields = requestedFields ? normalizeUserFields(requestedFields) : [];
        if (userFields.length > 0) {
          const cachedNames = new Set(cachedFields.map(f => f.name));
          for (const uf of userFields) {
            if (cachedNames.has(uf.name)) {
              const existing = cachedFields.find(f => f.name === uf.name);
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
          captureId: null,
          screenshotUrl: null,
          url,
          title: `${domain} (cached)`,
          schema: {
            page_type: cache.pageType,
            description: `Known domain — ${cachedFields.length} fields available from ${cache.totalRuns} previous runs`,
            fields: cachedFields,
          },
          cached: true,
          cacheStats: {
            totalRuns: cache.totalRuns,
            successRate: cache.successRate,
            consecutiveFailures: cache.consecutiveFailures,
          },
        };
      }

      // Cache miss — capture + discover
      const { PlaywrightBrowser } = await import('@robot/browser');
      const { SchemaAgent } = await import('@robot/agent');

      const browser = new PlaywrightBrowser();
      await browser.launch({ headless: true });
      let capture;
      try {
        capture = await browser.capture(url, { waitUntil: 'networkidle', interceptNetworkRequests: true });
      } finally {
        await browser.close();
      }

      const screenshotId = randomUUID();
      const screenshotFilename = `${screenshotId}.png`;
      const capturesDir = getCapturesDir();
      await mkdir(capturesDir, { recursive: true });
      await writeFile(join(capturesDir, screenshotFilename), capture.screenshot);

      const userFields = requestedFields ? normalizeUserFields(requestedFields) : [];
      const agent = new SchemaAgent();
      const schema = await agent.discoverSchema(capture, userFields.length > 0 ? userFields : undefined);

      if (userFields.length > 0) {
        const discoveredNames = new Set(schema.fields.map(f => f.name));
        for (const uf of userFields) {
          if (!discoveredNames.has(uf.name)) schema.fields.push(uf);
        }
        for (const f of schema.fields) {
          if (userFields.some(uf => uf.name === f.name)) f.tier = 'requested';
        }
      }

      return {
        captureId: screenshotId,
        screenshotUrl: `/captures/${screenshotFilename}`,
        url: capture.url,
        title: capture.title,
        schema,
        cached: false,
      };
    }),

  extract: publicProcedure
    .input(
      z.object({
        url: z.string().url(),
        fields: z.array(fieldInputSchema).min(1),
        captureId: z.string().nullable().optional(),
        pageType: z.enum(['detail', 'listing']).optional(),
        previousResults: z.record(z.unknown()).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { url, fields, pageType, previousResults } = input;

      const { PlaywrightBrowser } = await import('@robot/browser');
      const { SchemaAgent } = await import('@robot/agent');
      const { buildExtractionScript } = await import('@robot/scraper/executor');
      const {
        extractFromStructuredData,
        lookupDomainCache,
        saveDomainCache,
        resolveFromCache,
        resolveApiPathsFromCache,
        buildCachedXPathScript,
        getByDotPath,
        acquireDomainLock,
        detectSchemaChanges,
        formatSchemaChanges,
        validateExtractedData,
        calculateFieldCoverage,
        getMissingFields,
      } = await import('@robot/scraper');

      const domain = new URL(url).hostname;
      const resolvedPageType = pageType ?? 'detail';
      const fieldNames = fields.map((f) => f.name);

      const cache = await lookupDomainCache(domain, resolvedPageType);
      const releaseLock = await acquireDomainLock(domain);

      try {
        const browser = new PlaywrightBrowser();
        await browser.launch({ headless: true });

        let capture;
        try {
          capture = await browser.capture(url, { waitUntil: 'networkidle', interceptNetworkRequests: true });
        } catch (err) {
          await browser.close();
          throw err;
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

        let finalData: Record<string, unknown> = {};
        let fieldResults: Record<string, { value: unknown; source: any; path: string; confidence: number }> = {};

        const fieldByName = new Map(schemaFields.map(f => [f.name, f]));
        function tryAssign(name: string, value: unknown, source: PathSource, path: string, confidence: number): boolean {
          if (finalData[name] !== undefined) return false;
          const type = fieldByName.get(name)?.type ?? 'string';
          const v = validateFieldShape(value, type, { fieldName: name });
          if (!v.ok) {
            console.log(`[extract] Rejected ${name}=${JSON.stringify(value).slice(0, 60)} (source=${source}): ${v.reason}`);
            return false;
          }
          finalData[name] = v.normalized;
          fieldResults[name] = { value: v.normalized, source, path, confidence };
          return true;
        }

        // STEP 0.5: AI-discovered API paths
        const apiFields = schemaFields.filter((f) => f.api_path && f.source === 'api');
        if (apiFields.length > 0 && capture.interceptedRequests.length > 0) {
          const apiBodies = capture.interceptedRequests
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
        const missingAfterApiPaths = schemaFields.filter((f) => finalData[f.name] === undefined);
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
            capture.interceptedRequests,
          );
          for (const [name, source] of Object.entries(mechanicalResult.sources)) {
            tryAssign(name, mechanicalResult.data[name], source as PathSource, mechanicalResult.paths[name] ?? '', 0.8);
          }
          console.log(`[extract] Mechanical: ${Object.keys(mechanicalResult.data).length} additional fields`);
        }

        // Seed previousResults
        // WHY: 'previous' is not a valid PathSource; this is carry-over data from a prior run,
        // not a scraper source — kept outside tryAssign to preserve the 'previous' source tag.
        if (previousResults && typeof previousResults === 'object') {
          for (const [name, value] of Object.entries(previousResults)) {
            if (value !== null && value !== undefined && finalData[name] === undefined) {
              const type = fieldByName.get(name)?.type ?? 'string';
              const v = validateFieldShape(value, type, { fieldName: name });
              if (v.ok) {
                finalData[name] = v.normalized;
                fieldResults[name] = { value: v.normalized, source: 'previous' as any, path: '', confidence: 0.9 };
              } else {
                console.log(`[extract] Rejected previousResults ${name}=${JSON.stringify(value).slice(0, 60)}: ${v.reason}`);
              }
            }
          }
        }

        console.log(`[extract] Total after paths + mechanical: ${Object.keys(finalData).length}/${fields.length} fields`);

        // STEP 1.5: Cached paths
        if (cache && cache.totalRuns > 0 && cache.consecutiveFailures < 5) {
          const missingForCache = fieldNames.filter((n) => finalData[n] === undefined);
          if (missingForCache.length > 0 && capture.interceptedRequests.length > 0) {
            const apiCacheResult = resolveApiPathsFromCache(
              cache.fieldPaths,
              capture.interceptedRequests,
              missingForCache,
            );
            for (const [name, resolved] of Object.entries(apiCacheResult.resolved)) {
              tryAssign(name, resolved.value, resolved.source as PathSource, '', resolved.confidence);
            }
            if (Object.keys(apiCacheResult.resolved).length > 0) {
              console.log(`[extract] Cached API paths resolved: ${Object.keys(apiCacheResult.resolved).length} fields`);
            }
          }

          const stillMissing = fieldNames.filter((n) => finalData[n] === undefined);
          if (stillMissing.length > 0) {
            const cachedXPath = buildCachedXPathScript(cache.fieldPaths, stillMissing);
            if (cachedXPath) {
              try {
                const xpathResult = await browser.evaluate<{ data: Record<string, unknown>[]; fieldCount: number }>(
                  url, cachedXPath.script, { waitUntil: 'domcontentloaded' }
                );
                if (xpathResult.data.length > 0) {
                  for (const [name, value] of Object.entries(xpathResult.data[0])) {
                    tryAssign(name, value, 'xpath-cached', '', 0.85);
                  }
                  console.log(`[extract] Cached XPaths resolved: ${xpathResult.fieldCount} fields`);
                }
              } catch (err) {
                console.error('[extract] Cached XPath execution failed (non-fatal):', err);
              }
            }
          }

          const cacheResult = resolveFromCache(cache.fieldPaths, finalData, fieldNames);
          if (cacheResult.overallConfidence > 0) {
            for (const [name, resolved] of Object.entries(cacheResult.resolved)) {
              tryAssign(name, resolved.value, resolved.source as PathSource, '', resolved.confidence);
            }
          }

          const totalFromCache = fieldNames.filter((n) => finalData[n] !== undefined).length;
          console.log(`[extract] After cache: ${totalFromCache}/${fields.length} fields (${cache.totalRuns} previous runs, ${cache.successRate}% success)`);
        } else if (cache) {
          console.log(`[extract] Cache exists but ${cache.consecutiveFailures} consecutive failures — skipping, running full chain`);
        } else {
          console.log(`[extract] No cache for ${domain}/${resolvedPageType}`);
        }

        // STEP 2: AI API analysis
        const missingAfterCache = schemaFields.filter((f) => finalData[f.name] === undefined);
        const agent = new SchemaAgent();
        const apisToTry = collectAiAnalysisSources({
          interceptedRequests: capture.interceptedRequests,
          structuredData: capture.structuredData,
        });
        if (missingAfterCache.length > 0 && apisToTry.length > 0) {
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

        // STEP 3: XPath fallback
        const missingAfterApi = schemaFields.filter((f) => finalData[f.name] === undefined);
        let plan = null;
        if (missingAfterApi.length > 0) {
          console.log(`[extract] ${missingAfterApi.length} fields still missing, XPath fallback`);
          try {
            plan = await agent.generateSelectors(capture, missingAfterApi, resolvedPageType);
            const script = buildExtractionScript(plan);
            const xpathResult = await browser.evaluate<{ data: Record<string, unknown>[] }>(
              url, script, { waitUntil: 'networkidle' }
            );
            if (xpathResult.data.length > 0) {
              for (const fieldDef of plan.fields) {
                const value = xpathResult.data[0][fieldDef.name];
                tryAssign(fieldDef.name, value, 'xpath', fieldDef.xpath, 0.7);
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
                  const retryScript = buildExtractionScript(retryPlan);
                  const retryResult = await browser.evaluate<{ data: Record<string, unknown>[] }>(
                    url, retryScript, { waitUntil: 'networkidle' }
                  );
                  if (retryResult.data.length > 0) {
                    for (const fieldDef of retryPlan.fields) {
                      const value = retryResult.data[0][fieldDef.name];
                      tryAssign(fieldDef.name, value, 'xpath', fieldDef.xpath, 0.7);
                    }
                    plan = retryPlan;
                  }
                } catch (retryErr) {
                  console.error('[extract] XPath retry failed (non-fatal):', retryErr);
                }
              }
            }
          } catch (err) {
            console.error('[extract] XPath fallback failed (non-fatal):', err);
          }
        }

        await browser.close();

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
          await saveDomainCache({
            domain,
            pageType: resolvedPageType,
            interceptedRequests: capture.interceptedRequests,
            fieldResults,
            discoveredFieldNames: schemaFields.map(f => f.name),
            overallConfidence: confidence,
            hasJsonLd: capture.structuredData.ldJson.length > 0,
            hasNextData: capture.structuredData.nextData !== null,
          });
          console.log(`[extract] Saved domain intelligence for ${domain}`);
        } catch (err) {
          console.error('[extract] Cache save failed (non-fatal):', err);
        }

        // STEP 5: Quality validation
        const { data: cleanedData, issues: qualityIssues } = validateExtractedData(
          [finalData],
          schemaFields,
        );

        const { requested: requestedResults, discovered: discoveredResults } = buildResultRows({
          schemaFields: schemaFields.map(f => ({ name: f.name, type: f.type, tier: f.tier! })),
          finalData,
          sources,
        });

        return {
          data: cleanedData,
          plan,
          confidence,
          sources,
          fieldCount: { found: foundFields, total: fields.length },
          fieldsByTier: {
            requested: requestedResults,
            discovered: discoveredResults,
          },
          cacheHit: cache !== null && cache.consecutiveFailures < 5,
          schemaChanges: schemaChanges.length > 0 ? schemaChanges : undefined,
          qualityIssues: qualityIssues.length > 0 ? qualityIssues : undefined,
        };
      } catch (err) {
        if (err instanceof TRPCError) throw err;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: err instanceof Error ? err.message : 'Extraction failed',
        });
      } finally {
        releaseLock();
      }
    }),
});
