import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure } from '../trpc';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
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
      // Schema discovery lives in @robot/scraper. This procedure validates input,
      // wires the live collaborators, and decides where screenshots go — the one
      // part that genuinely belongs to the HTTP host.
      const { PlaywrightBrowser } = await import('@robot/browser');
      const { SchemaAgent } = await import('@robot/agent');
      const { runAnalysis } = await import('@robot/scraper');

      const browser = new PlaywrightBrowser();
      await browser.launch({ headless: true });

      try {
        return await runAnalysis(input, {
          browser,
          agent: new SchemaAgent(),
          persistScreenshot: async (screenshot) => {
            const id = randomUUID();
            const filename = `${id}.png`;
            const dir = getCapturesDir();
            await mkdir(dir, { recursive: true });
            await writeFile(join(dir, filename), screenshot);
            return { id, url: `/captures/${filename}` };
          },
        });
      } catch (err) {
        if (err instanceof TRPCError) throw err;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: err instanceof Error ? err.message : 'Analysis failed',
        });
      }
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

      // This procedure launches its own single-use browser, so it owns closing
      // it. `runExtraction` never closes a browser it was given (see the
      // invariant documented on `ExtractionDeps.browser`) — that guard used to
      // live in the orchestrator and broke Phase 2's shared-browser crawl loop,
      // so it moved out to whoever actually launches the browser.
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
      } finally {
        await browser.close();
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
