import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { eq, and } from 'drizzle-orm';
import { sources, datasets, projects, orgs, domains, inputSets } from '@robot/db';
import type { Database } from '@robot/db';
import { router, publicProcedure } from '../trpc';
import { scraperRouter } from './scraper';
import { planSource } from '../crawl/plan-source.js';

// ─── Scratch resolution (mvp-simplification task 7) ────────────────────────
//
// `quickCreate` needs the Scratch project's OWN dataset — resolved by slug
// 'scratch', not just "any dataset in the Scratch project". The Scratch
// project can already carry unrelated datasets (e.g. seeded corpus fixtures),
// and attaching a Scratch source to one of those would give it a real,
// non-empty schema — defeating `effectiveSchema`'s selectorsJson fallback,
// which only kicks in when the dataset schema is empty.

const SCRATCH_SLUG = 'scratch';

function slugifyDomain(domain: string): string {
  return domain
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function shortRandomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

const LISTING_DEFAULT_BUDGET = { max_items: 40, max_pages: 3, mode: 'first_n' } as const;

async function getScratchProjectId(db: Database): Promise<string> {
  const allOrgs = await db.select().from(orgs).orderBy(orgs.createdAt).limit(1);
  if (allOrgs.length === 0) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'No orgs found. Run `pnpm --filter @robot/db seed:sandbox` first.',
    });
  }
  const scratch = await db.query.projects.findFirst({
    where: and(eq(projects.orgId, allOrgs[0]!.id), eq(projects.slug, SCRATCH_SLUG)),
  });
  if (!scratch) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: `No Scratch project for org ${allOrgs[0]!.slug}. Run seed:sandbox first.`,
    });
  }
  return scratch.id;
}

async function getOrCreateScratchDataset(db: Database, scratchProjectId: string): Promise<string> {
  const existing = await db.query.datasets.findFirst({
    where: and(eq(datasets.projectId, scratchProjectId), eq(datasets.slug, SCRATCH_SLUG)),
  });
  if (existing) return existing.id;

  const [created] = await db.insert(datasets).values({
    projectId: scratchProjectId,
    name: 'Scratch',
    slug: SCRATCH_SLUG,
    schema: [],
  }).returning({ id: datasets.id });
  return created!.id;
}

export const sourcesRouter = router({
  listByDataset: publicProcedure
    .input(z.object({ datasetId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const results = await ctx.db
        .select({
          id: sources.id,
          datasetId: sources.datasetId,
          domainId: sources.domainId,
          domainName: domains.name,
          name: sources.name,
          slug: sources.slug,
          country: sources.country,
          locale: sources.locale,
          currency: sources.currency,
          dataCenter: sources.dataCenter,
          proxyType: sources.proxyType,
          loginPool: sources.loginPool,
          maximumInputs: sources.maximumInputs,
          runnerFramework: sources.runnerFramework,
          schemaValues: sources.schemaValues,
          variant: sources.variant,
          robotTemplate: sources.robotTemplate,
          parameters: sources.parameters,
          isActive: sources.isActive,
          sourceType: sources.sourceType,
          urlPattern: sources.urlPattern,
          selectorsJson: sources.selectorsJson,
          aiStatus: sources.aiStatus,
          createdAt: sources.createdAt,
          updatedAt: sources.updatedAt,
        })
        .from(sources)
        .leftJoin(domains, eq(sources.domainId, domains.id))
        .where(eq(sources.datasetId, input.datasetId))
        .orderBy(sources.name);

      return results;
    }),

  getBySlug: publicProcedure
    .input(
      z.object({
        orgSlug: z.string(),
        projectSlug: z.string(),
        datasetSlug: z.string(),
        sourceSlug: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          sourceId: sources.id,
          orgId: orgs.id,
          orgName: orgs.name,
          datasetId: datasets.id,
          datasetName: datasets.name,
          datasetSchema: datasets.schema,
          domainId: sources.domainId,
          domainName: domains.name,
        })
        .from(sources)
        .innerJoin(datasets, eq(sources.datasetId, datasets.id))
        .innerJoin(projects, eq(datasets.projectId, projects.id))
        .innerJoin(orgs, eq(projects.orgId, orgs.id))
        .leftJoin(domains, eq(sources.domainId, domains.id))
        .where(
          and(
            eq(orgs.slug, input.orgSlug),
            eq(projects.slug, input.projectSlug),
            eq(datasets.slug, input.datasetSlug),
            eq(sources.slug, input.sourceSlug),
          ),
        )
        .limit(1);

      const row = rows[0];
      if (!row) {
        throw new Error(
          `Source not found: ${input.orgSlug}/${input.projectSlug}/${input.datasetSlug}/${input.sourceSlug}`,
        );
      }

      const [source] = await ctx.db
        .select()
        .from(sources)
        .where(eq(sources.id, row.sourceId))
        .limit(1);

      if (!source) {
        throw new Error(
          `Source not found: ${input.orgSlug}/${input.projectSlug}/${input.datasetSlug}/${input.sourceSlug}`,
        );
      }

      return {
        ...source,
        orgId: row.orgId,
        orgName: row.orgName,
        datasetId: row.datasetId,
        datasetName: row.datasetName,
        datasetSchema: row.datasetSchema,
        domainName: row.domainName,
      };
    }),

  listByProject: publicProcedure
    .input(z.object({ orgSlug: z.string(), projectSlug: z.string() }))
    .query(async ({ ctx, input }) => {
      const results = await ctx.db
        .select({
          id: sources.id,
          slug: sources.slug,
          name: sources.name,
          datasetId: sources.datasetId,
          datasetSlug: datasets.slug,
          datasetName: datasets.name,
          domainName: domains.name,
          urlTemplate: sources.urlTemplate,
          inputStrategy: sources.inputStrategy,
          listingMode: sources.listingMode,
          isActive: sources.isActive,
          isSandbox: sources.isSandbox,
          createdAt: sources.createdAt,
          updatedAt: sources.updatedAt,
        })
        .from(sources)
        .innerJoin(datasets, eq(sources.datasetId, datasets.id))
        .innerJoin(projects, eq(datasets.projectId, projects.id))
        .innerJoin(orgs, eq(projects.orgId, orgs.id))
        .leftJoin(domains, eq(sources.domainId, domains.id))
        .where(and(
          eq(orgs.slug, input.orgSlug),
          eq(projects.slug, input.projectSlug),
          eq(sources.isSandbox, false),
        ))
        .orderBy(sources.name);

      return results;
    }),

  create: publicProcedure
    .input(
      z.object({
        datasetId: z.string().uuid().nullish(),
        domainId: z.string().uuid().nullish(),
        name: z.string().min(1).max(255),
        slug: z.string().min(1).max(255),
        country: z.string().min(1).max(10),
        locale: z.string().max(10).nullish(),
        currency: z.string().max(10).nullish(),
        dataCenter: z.string().max(10).nullish(),
        proxyType: z.string().max(50).nullish(),
        loginPool: z.string().max(100).nullish(),
        maximumInputs: z.number().int().positive().nullish(),
        runnerFramework: z.string().max(50).nullish(),
        schemaValues: z.record(z.string()).optional().default({}),
        variant: z.string().max(50).optional(),
        robotTemplate: z.string().max(255).optional(),
        parameters: z.record(z.unknown()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [source] = await ctx.db.insert(sources).values(input).returning();
      return source;
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        isActive: z.boolean().optional(),
        domainId: z.string().uuid().nullish(),
        name: z.string().min(1).max(255).optional(),
        slug: z.string().min(1).max(255).optional(),
        country: z.string().min(1).max(10).optional(),
        locale: z.string().max(10).nullish(),
        currency: z.string().max(10).nullish(),
        dataCenter: z.string().max(10).nullish(),
        proxyType: z.string().max(50).nullish(),
        loginPool: z.string().max(100).nullish(),
        maximumInputs: z.number().int().positive().nullish(),
        runnerFramework: z.string().max(50).nullish(),
        variant: z.string().max(50).optional(),
        robotTemplate: z.string().max(255).optional(),
        parameters: z.record(z.unknown()).optional(),
        schemaValues: z.record(z.string()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, parameters, ...rest } = input;

      // If parameters is provided, merge with existing (don't replace)
      // This prevents one tab's save from clobbering another tab's data
      let mergedParams = parameters;
      if (parameters) {
        const existing = await ctx.db.query.sources.findFirst({
          where: eq(sources.id, id),
          columns: { parameters: true },
        });
        const currentParams = (existing?.parameters ?? {}) as Record<string, unknown>;
        mergedParams = { ...currentParams, ...parameters };
      }

      const [source] = await ctx.db
        .update(sources)
        .set({ ...rest, ...(mergedParams !== undefined ? { parameters: mergedParams } : {}), updatedAt: new Date() })
        .where(eq(sources.id, id))
        .returning();

      if (!source) {
        throw new Error(`Source with id ${id} not found`);
      }

      return source;
    }),

  // ─── Scratch quick-start (mvp-simplification task 7) ─────────────────────

  /**
   * Create a Scratch Source + one-row-per-url InputSet from a bare list of
   * URLs, with zero manual configuration — the fast path into the wizard.
   * Attaches to the Scratch project's own dataset (created empty on first
   * use), so the Source starts with no dataset schema and `sources.analyze`
   * is what gives it one (via `selectorsJson`, read back through
   * `effectiveSchema`).
   */
  quickCreate: publicProcedure
    .input(
      z.object({
        mode: z.enum(['listing', 'detail']),
        urls: z.array(z.string().url()).min(1).max(50),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { mode, urls } = input;
      const firstUrl = new URL(urls[0]!);
      const hostname = firstUrl.hostname;
      const name = `${hostname} ${firstUrl.pathname}`.slice(0, 255);

      const scratchProjectId = await getScratchProjectId(ctx.db);
      const scratchDatasetId = await getOrCreateScratchDataset(ctx.db, scratchProjectId);

      const [inputSet] = await ctx.db
        .insert(inputSets)
        .values({
          projectId: scratchProjectId,
          type: 'direct',
          name,
          columns: [{ name: 'url', primary: true }],
          rows: urls.map((url) => ({ url })),
        })
        .returning({ id: inputSets.id });

      const listingMode = mode === 'listing' ? 'listing_to_detail' : 'detail';
      const sourceSlug = `${slugifyDomain(hostname)}-${shortRandomSuffix()}`;

      const [source] = await ctx.db
        .insert(sources)
        .values({
          datasetId: scratchDatasetId,
          name,
          slug: sourceSlug,
          country: 'us',
          inputStrategy: 'direct',
          urlTemplate: urls[0],
          listingMode,
          inputSetId: inputSet!.id,
          // Detail sources keep whatever the schema default (`{}`) is —
          // only listing sources get a starter budget.
          ...(mode === 'listing' ? { budget: LISTING_DEFAULT_BUDGET } : {}),
        })
        .returning({ id: sources.id });

      return { sourceId: source!.id, projectSlug: SCRATCH_SLUG, sourceSlug };
    }),

  /**
   * Run schema discovery on a Source's URL and persist the result to
   * `selectorsJson` — the same payload shape `sandbox.ts`'s analyze used to
   * write (this is that logic's new home; sandbox.ts itself is retired in
   * task 11), plus `listing` and `hints` pass-through.
   */
  analyze: publicProcedure
    .input(z.object({ sourceId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const source = await ctx.db.query.sources.findFirst({ where: eq(sources.id, input.sourceId) });
      if (!source) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Source ${input.sourceId} not found` });
      }
      if (!source.urlTemplate) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Source has no URL' });
      }

      const pageType = source.listingMode === 'listing_to_detail' ? 'listing' : 'detail';

      const scraperCaller = scraperRouter.createCaller(ctx);
      const result = await scraperCaller.analyze({ url: source.urlTemplate, pageType });

      const schemaPayload = {
        fields: result.schema.fields,
        pageType: result.schema.page_type,
        cached: result.cached,
        // False = the capture failed: examples (and, on dual-cache domains,
        // even the page type) come from earlier runs, not this URL.
        liveExamples: result.liveExamples,
        // Set when the site served a bot-check/error interstitial instead of
        // the page.
        blockedReason: result.blockedReason ?? null,
        captureId: result.captureId,
        screenshotUrl: result.screenshotUrl,
        // Listing report (rowsFound/paginationStrategy/sampleDetailUrls) and
        // soft page-type hints, pass-through from runAnalysis — sandbox.ts's
        // analyze predates both and never carried them.
        listing: result.listing ?? null,
        hints: result.hints,
      };

      await ctx.db
        .update(sources)
        .set({ selectorsJson: schemaPayload, updatedAt: new Date() })
        .where(eq(sources.id, source.id));

      return schemaPayload;
    }),

  /**
   * Confirm a Source's schema looks right and kick off a full crawl
   * (`probe: false`) — the "graduate from preview to real run" step. Reuses
   * `planSource`, the exact same planning logic `crawl.plan` calls, so a
   * confirm and a manual full plan can never drift apart.
   */
  confirm: publicProcedure
    .input(z.object({ sourceId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const source = await ctx.db.query.sources.findFirst({
        where: eq(sources.id, input.sourceId),
        columns: { id: true },
      });
      if (!source) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Source ${input.sourceId} not found` });
      }

      await ctx.db
        .update(sources)
        .set({ confirmedAt: new Date(), updatedAt: new Date() })
        .where(eq(sources.id, source.id));

      const result = await planSource(ctx.db, source.id, { probe: false });
      return { runId: result.runId };
    }),
});
