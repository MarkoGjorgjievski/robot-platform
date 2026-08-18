import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure } from '../trpc';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { cachedFieldsFromCache } from './lib/cached-fields-from-cache.js';
import { domainIntelligence } from '@robot/db';

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

      if (cache && Object.keys(cache.fieldPaths).length > 0) {
        const fieldNames = Object.keys(cache.fieldPaths);

        // Capture the current URL so example values reflect THIS page, not a prior one.
        const { PlaywrightBrowser } = await import('@robot/browser');
        const {
          resolveApiPathsFromCache, buildCachedXPathScript, resolveFromCache,
        } = await import('@robot/scraper');

        const browser = new PlaywrightBrowser();
        await browser.launch({ headless: true });
        let liveValues: Record<string, unknown> = {};
        let screenshotFilename: string | null = null;
        let screenshotId: string | null = null;
        try {
          const capture = await browser.capture(url, { waitUntil: 'networkidle', interceptNetworkRequests: true });

          // API paths
          const apiRes = resolveApiPathsFromCache(cache.fieldPaths, capture.interceptedRequests, fieldNames);
          for (const [n, r] of Object.entries(apiRes.resolved)) liveValues[n] = r.value;

          // Cached XPaths
          const stillMissing = fieldNames.filter(n => liveValues[n] === undefined);
          const cachedXPath = buildCachedXPathScript(cache.fieldPaths, stillMissing);
          if (cachedXPath) {
            try {
              const xr = await browser.evaluate<{ data: Record<string, unknown>[] }>(
                url, cachedXPath.script, { waitUntil: 'domcontentloaded' },
              );
              if (xr.data.length > 0) for (const [n, v] of Object.entries(xr.data[0])) {
                if (v !== null && v !== undefined && v !== '') liveValues[n] = v;
              }
            } catch (err) {
              console.error('[analyze] cached XPath eval failed (non-fatal):', err);
            }
          }
          const cr = resolveFromCache(cache.fieldPaths, liveValues, fieldNames);
          for (const [n, r] of Object.entries(cr.resolved)) liveValues[n] = r.value;

          // Persist screenshot for the UI.
          screenshotId = randomUUID();
          screenshotFilename = `${screenshotId}.png`;
          const capturesDir = getCapturesDir();
          await mkdir(capturesDir, { recursive: true });
          await writeFile(join(capturesDir, screenshotFilename), capture.screenshot);
        } catch (err) {
          console.error('[analyze] capture failed (non-fatal, showing cache without live values):', err);
        } finally {
          await browser.close();
        }

        const cachedFields = cachedFieldsFromCache(cache.fieldPaths, liveValues);

        const userFields = requestedFields ? normalizeUserFields(requestedFields) : [];
        if (userFields.length > 0) {
          const cachedNames = new Set(cachedFields.map(f => f.name));
          for (const uf of userFields) {
            if (cachedNames.has(uf.name)) {
              const existing = cachedFields.find(f => f.name === uf.name);
              if (existing) existing.tier = 'requested';
            } else {
              cachedFields.push({
                name: uf.name, type: uf.type as string,
                description: uf.description || 'User requested (not yet cached)',
                required: true, example_value: undefined,
                tier: 'requested' as string | undefined, needsRediscovery: false,
              });
            }
          }
        }

        return {
          captureId: screenshotId,
          screenshotUrl: screenshotFilename ? `/captures/${screenshotFilename}` : null,
          url,
          title: `${domain}`,
          schema: {
            page_type: cache.pageType,
            description: `Known domain — ${cachedFields.length} fields available from ${cache.totalRuns} previous runs`,
            fields: cachedFields,
          },
          cached: true,
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
      // The extraction chain itself lives in @robot/scraper. This procedure is the
      // transport boundary: validate input, wire up the live collaborators, and map
      // failures onto TRPCError. See extraction-orchestrator.ts for the chain.
      const { PlaywrightBrowser } = await import('@robot/browser');
      const { SchemaAgent } = await import('@robot/agent');
      const { runExtraction } = await import('@robot/scraper');

      const browser = new PlaywrightBrowser();
      await browser.launch({ headless: true });

      try {
        return await runExtraction(
          {
            url: input.url,
            fields: input.fields,
            pageType: input.pageType,
            previousResults: input.previousResults,
          },
          { browser, agent: new SchemaAgent() },
        );
      } catch (err) {
        if (err instanceof TRPCError) throw err;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: err instanceof Error ? err.message : 'Extraction failed',
        });
      }
    }),

  // Persist a human-pinned row container selector. NOTE: `domain` must be the
  // SAME hostname form `extract` looks up with — `new URL(url).hostname`, i.e.
  // WITH any `www.` prefix. The override is matched by exact string, so a
  // mismatched form (e.g. stripped `www.`) silently won't apply. The v2.1
  // click-to-select UI must pass the hostname exactly as extract sees it.
  setRowSelector: publicProcedure
    .input(z.object({
      domain: z.string().min(1),
      pageType: z.enum(['detail', 'listing']),
      rowXpath: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const rowSelector = { xpath: input.rowXpath, source: 'human' as const, setAt: new Date().toISOString() };
      await ctx.db
        .insert(domainIntelligence)
        .values({ domain: input.domain, pageType: input.pageType, rowSelector })
        .onConflictDoUpdate({
          target: [domainIntelligence.domain, domainIntelligence.pageType],
          set: { rowSelector, updatedAt: new Date() },
        });
      return { ok: true as const };
    }),
});
