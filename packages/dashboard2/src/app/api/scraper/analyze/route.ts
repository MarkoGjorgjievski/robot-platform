import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';

export const maxDuration = 120;
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const { url, requestedFields } = await request.json();

    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    const domain = new URL(url).hostname.replace(/^www\./, '');

    // ─── Check domain cache first ─────────────────────────────────────
    const { lookupDomainCache } = await import('@robot/scraper');

    // Try both 'detail' and 'listing' — return whichever has more data
    const [detailCache, listingCache] = await Promise.all([
      lookupDomainCache(domain, 'detail').catch(() => null),
      lookupDomainCache(domain, 'listing').catch(() => null),
    ]);

    const cache = detailCache && listingCache
      ? (Object.keys(detailCache.fieldPaths).length >= Object.keys(listingCache.fieldPaths).length ? detailCache : listingCache)
      : detailCache ?? listingCache;

    if (cache && Object.keys(cache.fieldPaths).length > 0 && cache.consecutiveFailures < 5) {
      // We know this domain — return cached fields instantly
      const cachedFields = Object.entries(cache.fieldPaths).map(([name, pathSet]) => {
        const bestPath = pathSet.paths.sort((a, b) => {
          const aRate = a.hits + a.misses > 0 ? a.hits / (a.hits + a.misses) : a.confidence;
          const bRate = b.hits + b.misses > 0 ? b.hits / (b.hits + b.misses) : b.confidence;
          return bRate - aRate;
        })[0];

        return {
          name,
          type: inferFieldType(name),
          description: `Cached field (${bestPath?.source ?? 'unknown'} source, ${Math.round((bestPath?.hits ?? 0) / Math.max(1, (bestPath?.hits ?? 0) + (bestPath?.misses ?? 0)) * 100)}% hit rate)`,
          required: true,
          example_value: bestPath?.lastValue != null ? String(bestPath.lastValue).slice(0, 200) : undefined,
          tier: undefined as string | undefined,
        };
      });

      // Merge requested fields with cached fields
      const { normalizeUserFields } = await import('@robot/scraper');
      const userFields = requestedFields ? normalizeUserFields(requestedFields) : [];

      if (userFields.length > 0) {
        const cachedNames = new Set(cachedFields.map((f: any) => f.name));
        for (const uf of userFields) {
          if (cachedNames.has(uf.name)) {
            const existing = cachedFields.find((f: any) => f.name === uf.name);
            if (existing) existing.tier = 'requested';
          } else {
            cachedFields.push({
              name: uf.name,
              type: uf.type as string,
              description: uf.description || 'User requested (not yet cached)',
              required: true,
              example_value: undefined,
              tier: 'requested' as string | undefined,
            });
          }
        }
      }

      console.log(`[analyze] Cache hit for ${domain}/${cache.pageType}: ${cachedFields.length} fields (${cache.totalRuns} runs, ${cache.successRate}% success)`);

      return NextResponse.json({
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
      });
    }

    // ─── No cache — run full analysis ─────────────────────────────────
    console.log(`[analyze] No cache for ${domain}, running full analysis`);

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

    // Save screenshot
    const screenshotId = randomUUID();
    const screenshotFilename = `${screenshotId}.png`;
    const capturesDir = join(process.cwd(), 'public', 'captures');
    await mkdir(capturesDir, { recursive: true });
    const screenshotPath = join(capturesDir, screenshotFilename);
    await writeFile(screenshotPath, capture.screenshot);

    // Log intercepted APIs
    if (capture.interceptedRequests.length > 0) {
      console.log(`[analyze] Intercepted ${capture.interceptedRequests.length} API responses:`);
      for (const req of capture.interceptedRequests.slice(0, 5)) {
        console.log(`  - ${req.method} ${req.url.slice(0, 100)} (${req.bodySize} bytes)`);
      }
    }

    // Discover schema
    const { normalizeUserFields } = await import('@robot/scraper');

    // Normalize user-provided fields (if any)
    const userFields = requestedFields ? normalizeUserFields(requestedFields) : [];

    // Discover schema (with requested fields for priority)
    const agent = new SchemaAgent();
    const schema = await agent.discoverSchema(capture, userFields.length > 0 ? userFields : undefined);

    // Ensure all requested fields appear in the schema
    if (userFields.length > 0) {
      const discoveredNames = new Set(schema.fields.map(f => f.name));
      for (const uf of userFields) {
        if (!discoveredNames.has(uf.name)) {
          schema.fields.push(uf);
        }
      }
      // Mark user's fields as requested
      for (const f of schema.fields) {
        if (userFields.some(uf => uf.name === f.name)) {
          f.tier = 'requested';
        }
      }
    }

    return NextResponse.json({
      captureId: screenshotId,
      screenshotUrl: `/captures/${screenshotFilename}`,
      url: capture.url,
      title: capture.title,
      schema,
      cached: false,
    });
  } catch (err) {
    console.error('Analyze error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Analysis failed' },
      { status: 500 }
    );
  }
}

function inferFieldType(fieldName: string): string {
  const name = fieldName.toLowerCase();
  if (name.includes('price') || name.includes('cost') || name.includes('discount_amount')) return 'price';
  if (name.includes('url') || name.includes('link') || name.includes('href')) return 'url';
  if (name.includes('image')) return 'image_url';
  if (name.includes('rating') || name.includes('count') || name.includes('number') || name.includes('review_count')) return 'number';
  if (name.includes('available') || name.includes('in_stock') || name.includes('is_')) return 'boolean';
  if (name.includes('date') || name.includes('time')) return 'date';
  if (name.includes('features') || name.includes('images') || name.includes('tags')) return 'array';
  return 'string';
}
