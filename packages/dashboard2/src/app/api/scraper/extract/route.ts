import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 120;
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const { url, fields, captureId, pageType } = await request.json();

    if (!url || !fields) {
      return NextResponse.json({ error: 'URL and fields are required' }, { status: 400 });
    }

    const { PlaywrightBrowser } = await import('@robot/browser');
    const { SchemaAgent } = await import('@robot/agent');
    const { buildExtractionScript } = await import('@robot/scraper/executor');
    const { extractFromStructuredData, lookupDomainCache, saveDomainCache, resolveFromCache, resolveApiPathsFromCache, buildCachedXPathScript, acquireDomainLock, detectSchemaChanges, formatSchemaChanges, validateExtractedData, calculateFieldCoverage, getMissingFields } = await import('@robot/scraper');

    const domain = new URL(url).hostname;
    const resolvedPageType = pageType ?? 'detail';
    const fieldNames = fields.map((f: { name: string }) => f.name);

    // ─── STEP 0: Check domain cache ────────────────────────────────────
    const cache = await lookupDomainCache(domain, resolvedPageType);

    // Acquire domain lock (prevents concurrent requests to same domain)
    const releaseLock = await acquireDomainLock(domain);

    // Capture the page (always needed for fresh data)
    const browser = new PlaywrightBrowser();
    await browser.launch({ headless: true });

    let capture;
    try {
      capture = await browser.capture(url, { waitUntil: 'networkidle', interceptNetworkRequests: true });
    } catch (err) {
      await browser.close();
      releaseLock();
      throw err;
    }

    const schemaFields = fields.map((f: { name: string; type: string; description?: string }) => ({
      name: f.name,
      type: f.type,
      description: f.description ?? '',
      required: true,
    }));

    // ─── STEP 1: Mechanical extraction (always runs — free) ────────────
    const mechanicalResult = extractFromStructuredData(
      capture.structuredData,
      schemaFields,
      capture.interceptedRequests,
    );

    let finalData: Record<string, unknown> = { ...mechanicalResult.data };
    let fieldResults: Record<string, { value: unknown; source: any; path: string; confidence: number }> = {};

    // Track what mechanical found
    for (const [name, source] of Object.entries(mechanicalResult.sources)) {
      fieldResults[name] = {
        value: finalData[name],
        source,
        path: name, // mechanical uses field name as key
        confidence: 0.8,
      };
    }

    console.log(`[extract] Mechanical: ${Object.keys(finalData).length}/${fields.length} fields`);

    // ─── STEP 1.5: Try cached paths (free) ─────────────────────────────
    if (cache && cache.totalRuns > 0 && cache.consecutiveFailures < 5) {
      // 1.5a: Resolve cached API dot-notation paths against fresh API responses
      const missingForCache = fieldNames.filter((n: string) => finalData[n] === undefined);
      if (missingForCache.length > 0 && capture.interceptedRequests.length > 0) {
        const apiCacheResult = resolveApiPathsFromCache(
          cache.fieldPaths,
          capture.interceptedRequests,
          missingForCache,
        );
        for (const [name, resolved] of Object.entries(apiCacheResult.resolved)) {
          if (finalData[name] === undefined && resolved.value !== null && resolved.value !== undefined) {
            finalData[name] = resolved.value;
            fieldResults[name] = {
              value: resolved.value,
              source: resolved.source,
              path: '',
              confidence: resolved.confidence,
            };
          }
        }
        if (Object.keys(apiCacheResult.resolved).length > 0) {
          console.log(`[extract] Cached API paths resolved: ${Object.keys(apiCacheResult.resolved).length} fields`);
        }
      }

      // 1.5b: Run cached XPaths on the live page
      const stillMissing = fieldNames.filter((n: string) => finalData[n] === undefined);
      if (stillMissing.length > 0) {
        const cachedXPath = buildCachedXPathScript(cache.fieldPaths, stillMissing);
        if (cachedXPath) {
          try {
            const xpathResult = await browser.evaluate<{ data: Record<string, unknown>[]; fieldCount: number }>(
              url, cachedXPath.script, { waitUntil: 'domcontentloaded' }
            );
            if (xpathResult.data.length > 0) {
              for (const [name, value] of Object.entries(xpathResult.data[0])) {
                if (finalData[name] === undefined && value !== null && value !== undefined) {
                  finalData[name] = value;
                  fieldResults[name] = {
                    value,
                    source: 'xpath-cached',
                    path: '',
                    confidence: 0.85,
                  };
                }
              }
              console.log(`[extract] Cached XPaths resolved: ${xpathResult.fieldCount} fields`);
            }
          } catch (err) {
            console.error('[extract] Cached XPath execution failed (non-fatal):', err);
          }
        }
      }

      // 1.5c: Cross-validate with mechanical data
      const cacheResult = resolveFromCache(cache.fieldPaths, finalData, fieldNames);
      if (cacheResult.overallConfidence > 0) {
        for (const [name, resolved] of Object.entries(cacheResult.resolved)) {
          if (finalData[name] === undefined && resolved.value !== null && resolved.value !== undefined) {
            finalData[name] = resolved.value;
            fieldResults[name] = {
              value: resolved.value,
              source: resolved.source,
              path: '',
              confidence: resolved.confidence,
            };
          }
        }
      }

      const totalFromCache = fieldNames.filter((n: string) => finalData[n] !== undefined).length;
      console.log(`[extract] After cache: ${totalFromCache}/${fields.length} fields (${cache.totalRuns} previous runs, ${cache.successRate}% success)`);
    } else if (cache) {
      console.log(`[extract] Cache exists but ${cache.consecutiveFailures} consecutive failures — skipping, running full chain`);
    } else {
      console.log(`[extract] No cache for ${domain}/${resolvedPageType}`);
    }

    // ─── STEP 2: AI API analysis (for missing fields) ──────────────────
    const missingAfterCache = schemaFields.filter(
      (f: { name: string }) => finalData[f.name] === undefined
    );

    const agent = new SchemaAgent();

    if (missingAfterCache.length > 0 && capture.interceptedRequests.length > 0) {
      console.log(`[extract] ${missingAfterCache.length} fields missing, AI analyzing API responses`);

      // Try the top 3 API responses (largest first, most likely to contain product data)
      const apisToTry = capture.interceptedRequests
        .filter(r => r.responseBody && r.bodySize > 500)
        .slice(0, 3);

      for (const api of apisToTry) {
        const stillMissing = schemaFields.filter(
          (f: { name: string }) => finalData[f.name] === undefined
        );
        if (stillMissing.length === 0) break;

        try {
          const apiResult = await agent.extractFromApi(
            api.responseBody!,
            api.url,
            stillMissing,
          );

          for (const field of apiResult.fields) {
            if (field.value !== null && field.value !== undefined && field.confidence > 0.3) {
              if (finalData[field.name] === undefined) {
                finalData[field.name] = field.value;
                fieldResults[field.name] = {
                  value: field.value,
                  source: 'api-ai',
                  path: field.json_path,
                  confidence: field.confidence,
                };
              }
            }
          }
        } catch (err) {
          console.error(`[extract] AI API extraction failed for ${api.url.slice(0, 80)} (non-fatal):`, err);
        }
      }

      console.log(`[extract] After AI API: ${Object.keys(finalData).length}/${fields.length} fields`);
    }

    // ─── STEP 3: XPath fallback (for still-missing fields) ─────────────
    const missingAfterApi = schemaFields.filter(
      (f: { name: string }) => finalData[f.name] === undefined
    );

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
            if (finalData[fieldDef.name] === undefined && value !== null && value !== undefined) {
              finalData[fieldDef.name] = value;
              fieldResults[fieldDef.name] = {
                value,
                source: 'xpath',
                path: fieldDef.xpath,
                confidence: 0.7,
              };
            }
          }
        }

        // Coverage-based retry for listing pages
        const isListing = resolvedPageType === 'listing' || resolvedPageType === 'search_results' || resolvedPageType === 'table';
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
                  if (finalData[fieldDef.name] === undefined && value !== null && value !== undefined) {
                    finalData[fieldDef.name] = value;
                    fieldResults[fieldDef.name] = {
                      value,
                      source: 'xpath',
                      path: fieldDef.xpath,
                      confidence: 0.7,
                    };
                  }
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
    releaseLock();

    // ─── STEP 4: Calculate confidence + save to cache ──────────────────
    const foundFields = Object.keys(finalData).length;
    const confidence = fields.length > 0 ? foundFields / fields.length : 0;

    const sources: Record<string, string> = {};
    for (const [name, result] of Object.entries(fieldResults)) {
      sources[name] = result.source;
    }

    console.log(`[extract] Done: ${foundFields}/${fields.length} fields, confidence=${Math.round(confidence * 100)}%`);
    console.log(`[extract] Sources: ${JSON.stringify(sources)}`);

    // ─── Schema evolution detection ───────────────────────────────────
    let schemaChanges: Array<{ type: string; fieldName: string; detail: string }> = [];
    if (cache && Object.keys(cache.fieldPaths).length > 0) {
      schemaChanges = detectSchemaChanges(cache.fieldPaths, fieldNames, finalData);
      if (schemaChanges.length > 0) {
        console.log(`[extract] ${formatSchemaChanges(schemaChanges)}`);
      }
    }

    // Save to domain intelligence cache (non-blocking)
    try {
      await saveDomainCache({
        domain,
        pageType: resolvedPageType,
        interceptedRequests: capture.interceptedRequests,
        fieldResults,
        overallConfidence: confidence,
        hasJsonLd: capture.structuredData.ldJson.length > 0,
        hasNextData: capture.structuredData.nextData !== null,
      });
      console.log(`[extract] Saved domain intelligence for ${domain}`);
    } catch (err) {
      console.error('[extract] Cache save failed (non-fatal):', err);
    }

    // ─── STEP 5: Data quality validation ───────────────────────────────
    const { data: cleanedData, issues: qualityIssues } = validateExtractedData(
      [finalData],
      schemaFields,
    );

    return NextResponse.json({
      data: cleanedData,
      plan,
      confidence,
      sources,
      fieldCount: { found: foundFields, total: fields.length },
      cacheHit: cache !== null && cache.consecutiveFailures < 5,
      schemaChanges: schemaChanges.length > 0 ? schemaChanges : undefined,
      qualityIssues: qualityIssues.length > 0 ? qualityIssues : undefined,
    });
  } catch (err) {
    console.error('Extract error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Extraction failed' },
      { status: 500 }
    );
  }
}
