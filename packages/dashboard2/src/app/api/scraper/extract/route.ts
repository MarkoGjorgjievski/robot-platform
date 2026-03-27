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
    const { extractFromStructuredData, lookupDomainCache, saveDomainCache, resolveFromCache } = await import('@robot/scraper');

    const domain = new URL(url).hostname;
    const resolvedPageType = pageType ?? 'detail';
    const fieldNames = fields.map((f: { name: string }) => f.name);

    // ─── STEP 0: Check domain cache ────────────────────────────────────
    const cache = await lookupDomainCache(domain, resolvedPageType);

    // Capture the page (always needed for fresh data)
    const browser = new PlaywrightBrowser();
    await browser.launch({ headless: true });

    let capture;
    try {
      capture = await browser.capture(url, { waitUntil: 'networkidle', interceptNetworkRequests: true });
    } catch (err) {
      await browser.close();
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
      const cacheResult = resolveFromCache(cache.fieldPaths, finalData, fieldNames);

      if (cacheResult.overallConfidence > 0) {
        for (const [name, resolved] of Object.entries(cacheResult.resolved)) {
          if (finalData[name] === undefined && resolved.value !== null && resolved.value !== undefined) {
            finalData[name] = resolved.value;
            fieldResults[name] = {
              value: resolved.value,
              source: 'xpath-cached',
              path: '',
              confidence: resolved.confidence,
            };
          }
        }
        console.log(`[extract] Cache resolved: ${Object.keys(cacheResult.resolved).length} additional fields (${cache.totalRuns} previous runs, ${cache.successRate}% success)`);
      }
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
      console.log(`[extract] ${missingAfterCache.length} fields missing, AI analyzing API response`);

      const topApi = capture.interceptedRequests[0];
      if (topApi?.responseBody) {
        try {
          const apiResult = await agent.extractFromApi(
            topApi.responseBody,
            topApi.url,
            missingAfterCache,
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

          console.log(`[extract] After AI API: ${Object.keys(finalData).length}/${fields.length} fields`);
        } catch (err) {
          console.error('[extract] AI API extraction failed (non-fatal):', err);
        }
      }
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
          for (let i = 0; i < plan.fields.length; i++) {
            const fieldDef = plan.fields[i];
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
      } catch (err) {
        console.error('[extract] XPath fallback failed (non-fatal):', err);
      }
    }

    await browser.close();

    // ─── STEP 4: Calculate confidence + save to cache ──────────────────
    const foundFields = Object.keys(finalData).length;
    const confidence = fields.length > 0 ? foundFields / fields.length : 0;

    const sources: Record<string, string> = {};
    for (const [name, result] of Object.entries(fieldResults)) {
      sources[name] = result.source;
    }

    console.log(`[extract] Done: ${foundFields}/${fields.length} fields, confidence=${Math.round(confidence * 100)}%`);
    console.log(`[extract] Sources: ${JSON.stringify(sources)}`);

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

    return NextResponse.json({
      data: [finalData],
      plan,
      confidence,
      sources,
      fieldCount: { found: foundFields, total: fields.length },
      cacheHit: cache !== null && cache.consecutiveFailures < 5,
    });
  } catch (err) {
    console.error('Extract error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Extraction failed' },
      { status: 500 }
    );
  }
}
