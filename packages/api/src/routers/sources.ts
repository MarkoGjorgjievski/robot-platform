import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { sources, datasets, projects, orgs, domains, inputSets, sourceVerifications } from '@robot/db';
import type { Database } from '@robot/db';
import { FIND_PRODUCT_PAGES_LIMIT, type SchemaDefinitionField } from '@robot/scraper';
import { router, publicProcedure } from '../trpc';
import { scraperRouter } from './scraper';
import { planSource } from '../crawl/plan-source.js';
import { withBrowserSession } from '../browser-session.js';
import { schemaInput, prepareSchema } from '../verify/schema-input.js';
import { rankProductLinks } from '../verify/find-product-pages.js';

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
      message: 'No orgs found. Run `pnpm --filter @robot/db seed:scratch` first.',
    });
  }
  const scratch = await db.query.projects.findFirst({
    where: and(eq(projects.orgId, allOrgs[0]!.id), eq(projects.slug, SCRATCH_SLUG)),
  });
  if (!scratch) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: `No Scratch project for org ${allOrgs[0]!.slug}. Run seed:scratch first.`,
    });
  }
  return scratch.id;
}

/**
 * The insert half of find-or-create, isolated so it can be tested directly
 * against an already-conflicting row without needing genuine concurrency to
 * provoke it (two real racing callers are a flaky thing to assert against in
 * a test — this makes the exact conflict outcome deterministic).
 *
 * `INSERT ... ON CONFLICT (project_id, slug) DO NOTHING RETURNING` is atomic:
 * either this call's row wins and comes back from `returning()`, or it lost
 * to a row that already exists (inserted by this call a moment ago via
 * `getOrCreateScratchDataset`'s racing sibling, or literally any pre-existing
 * row at this `(projectId, 'scratch')` slug) and `returning()` comes back
 * empty — in which case the winner's row is fetched instead. Without
 * `onConflictDoNothing()`, the loser's insert throws a raw
 * `datasets_project_slug_idx` unique-constraint error instead of resolving.
 */
export async function insertScratchDatasetIfAbsent(db: Database, scratchProjectId: string): Promise<string> {
  const [created] = await db.insert(datasets).values({
    projectId: scratchProjectId,
    name: 'Scratch',
    slug: SCRATCH_SLUG,
    schema: [],
  }).onConflictDoNothing().returning({ id: datasets.id });
  if (created) return created.id;

  // Lost the race (or the row simply already existed): fetch it instead.
  const winner = await db.query.datasets.findFirst({
    where: and(eq(datasets.projectId, scratchProjectId), eq(datasets.slug, SCRATCH_SLUG)),
  });
  if (!winner) {
    // Only reachable if the winning row vanished between its insert
    // committing and this lookup (e.g. a concurrent delete) — genuinely
    // exceptional, not a normal race outcome.
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: `Scratch dataset insert conflicted for project ${scratchProjectId} but no row was found on lookup`,
    });
  }
  return winner.id;
}

/**
 * Find-or-create is a check-then-act: two concurrent `quickCreate` calls can
 * both pass the `findFirst` below before either dataset exists. The insert
 * that follows is conflict-safe (see `insertScratchDatasetIfAbsent`), so both
 * callers converge on the same dataset id rather than one of them failing.
 */
export async function getOrCreateScratchDataset(db: Database, scratchProjectId: string): Promise<string> {
  const existing = await db.query.datasets.findFirst({
    where: and(eq(datasets.projectId, scratchProjectId), eq(datasets.slug, SCRATCH_SLUG)),
  });
  if (existing) return existing.id;

  return insertScratchDatasetIfAbsent(db, scratchProjectId);
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
          // Set once a human confirmed a listing Source's probe run looked
          // right (spec §3) — the Set-up workspace and the run-detail confirm
          // gate both key off it. Null = unconfirmed.
          confirmedAt: sources.confirmedAt,
          // The schema-discovery payload `sources.analyze` persists (fields,
          // pageType, listing report, hints, blocked reason...) — the Set-up
          // workspace's own read model.
          selectorsJson: sources.selectorsJson,
          // How many rows this Source's InputSet holds — the "URL count" the
          // Set-up workspace's header shows, and the `crawl.execute` limit for
          // a detail Source's one-shot Extract. `coalesce` + `left join`: a
          // Source with no InputSet (none in practice today, but the column is
          // nullable) reads as 0 rather than a null propagating into NaN.
          urlCount: sql<number>`coalesce(jsonb_array_length(${inputSets.rows}), 0)::int`,
          isActive: sources.isActive,
          // Customer-defined schema (Task 1) + its last drift check — the
          // Set-up workspace's schema/verification surfaces read these.
          schemaDefinition: sources.schemaDefinition,
          verificationSet: sources.verificationSet,
          driftedFields: sources.driftedFields,
          createdAt: sources.createdAt,
          updatedAt: sources.updatedAt,
        })
        .from(sources)
        .innerJoin(datasets, eq(sources.datasetId, datasets.id))
        .innerJoin(projects, eq(datasets.projectId, projects.id))
        .innerJoin(orgs, eq(projects.orgId, orgs.id))
        .leftJoin(domains, eq(sources.domainId, domains.id))
        .leftJoin(inputSets, eq(sources.inputSetId, inputSets.id))
        .where(and(
          eq(orgs.slug, input.orgSlug),
          eq(projects.slug, input.projectSlug),
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
      // Only what a live caller actually sends: Source Config's mode toggle
      // (`listingMode` — Finding 5 / ruling R7, the minimal REAL "switch
      // mode") and `isActive`. The legacy column block (locale/currency/
      // proxyType/...) rode along here from the pre-Source model with no
      // caller ever sending it — dead surface, removed with it the
      // `parameters` read-modify-write merge that only existed for it.
      z.object({
        id: z.string().uuid(),
        isActive: z.boolean().optional(),
        listingMode: z.enum(['listing_to_detail', 'detail']).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...rest } = input;

      // Re-review residual #1 (fix-wave-report.md): `...rest` applied
      // `listingMode` unconditionally, so a confirmed Source's mode could be
      // flipped silently — misrouting source-setup.tsx's Extract branch
      // (detail vs. probe-then-confirm) for a Source already crawling for
      // real. Locked the same way `sources.delete`/`sources.confirm` lock
      // other actions on a confirmed Source: PRECONDITION_FAILED, and only
      // when the value would actually CHANGE — an update that merely
      // repeats the current mode (or omits `listingMode` altogether) must
      // keep working on a confirmed Source, since nothing about it is
      // actually being switched.
      if (input.listingMode !== undefined) {
        const existing = await ctx.db.query.sources.findFirst({
          where: eq(sources.id, id),
          columns: { listingMode: true, confirmedAt: true },
        });
        if (existing?.confirmedAt && existing.listingMode !== input.listingMode) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: `Source ${id} is confirmed; listingMode is locked after confirmation`,
          });
        }
      }

      const [source] = await ctx.db
        .update(sources)
        .set({ ...rest, updatedAt: new Date() })
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

  // ─── Customer-defined schema (customer schema verification, task 11) ─────

  /**
   * Create a Scratch Source from a customer-authored schema (3 verification
   * URLs + typed fields + expected values) rather than `quickCreate`'s bare
   * URL list. `prepareSchema` (schema-input.ts) assigns stable keys/concepts
   * and validates hostnames + expected values, throwing BAD_REQUEST with a
   * per-cell problem list on failure.
   *
   * Mirrors `quickCreate`'s Scratch InputSet + Source shape exactly, except:
   * when `listingUrl` is given, the InputSet plans from THAT single row (a
   * listing crawl plans from the listing, not the verification samples) and
   * the three product URLs live only in `verificationSet`.
   */
  createWithSchema: publicProcedure
    .input(schemaInput)
    .mutation(async ({ ctx, input }) => {
      const { fields, verificationSet } = prepareSchema(input);

      const firstUrl = new URL(input.urls[0]!);
      const name = `${firstUrl.hostname} ${firstUrl.pathname}`.slice(0, 255);

      const scratchProjectId = await getScratchProjectId(ctx.db);
      const scratchDatasetId = await getOrCreateScratchDataset(ctx.db, scratchProjectId);

      const rows = input.listingUrl ? [{ url: input.listingUrl }] : input.urls.map((url) => ({ url }));

      const [inputSet] = await ctx.db
        .insert(inputSets)
        .values({
          projectId: scratchProjectId,
          type: 'direct',
          name,
          columns: [{ name: 'url', primary: true }],
          rows,
        })
        .returning({ id: inputSets.id });

      const listingMode = input.listingUrl ? 'listing_to_detail' : 'detail';
      const sourceSlug = `${slugifyDomain(firstUrl.hostname)}-${shortRandomSuffix()}`;

      const [source] = await ctx.db
        .insert(sources)
        .values({
          datasetId: scratchDatasetId,
          name,
          slug: sourceSlug,
          country: 'us',
          inputStrategy: 'direct',
          urlTemplate: input.urls[0],
          listingMode,
          inputSetId: inputSet!.id,
          schemaDefinition: fields,
          verificationSet,
          // Same rule as quickCreate: only a listing Source gets a starter budget.
          ...(input.listingUrl ? { budget: LISTING_DEFAULT_BUDGET } : {}),
        })
        .returning({ id: sources.id });

      return { sourceId: source!.id, projectSlug: SCRATCH_SLUG, sourceSlug };
    }),

  /**
   * Re-derive a Source's schema definition + verification set from an edited
   * form. Refused while a verification is in flight (`completed_at IS NULL`)
   * — editing the schema out from under a running Verify would leave that
   * run's results describing a schema that no longer exists. `prepareSchema`
   * is given the Source's existing fields so a field re-submitted with its
   * prior `key` keeps that key (and its `concept`) rather than being treated
   * as brand new.
   */
  updateSchema: publicProcedure
    .input(schemaInput.extend({ sourceId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { sourceId, ...schema } = input;

      const source = await ctx.db.query.sources.findFirst({
        where: eq(sources.id, sourceId),
        columns: { id: true, schemaDefinition: true },
      });
      if (!source) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Source ${sourceId} not found` });
      }

      const inFlight = await ctx.db.query.sourceVerifications.findFirst({
        where: and(eq(sourceVerifications.sourceId, sourceId), isNull(sourceVerifications.completedAt)),
        columns: { id: true },
      });
      if (inFlight) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `Source ${sourceId} has a verification in flight; wait for it to complete before editing the schema`,
        });
      }

      const existing = (source.schemaDefinition as SchemaDefinitionField[] | null) ?? [];
      const { fields, verificationSet } = prepareSchema(schema, existing);

      const [updated] = await ctx.db
        .update(sources)
        .set({ schemaDefinition: fields, verificationSet, updatedAt: new Date() })
        .where(eq(sources.id, sourceId))
        .returning();

      return updated;
    }),

  /**
   * Guess which links on a listing page are product/detail pages — no AI, no
   * schema. Captures the page with `withBrowserSession` and harvests every
   * `<a href>` client-side (`setContentEvaluate`), then ranks them with the
   * pure `rankProductLinks` (find-product-pages.ts): same host, not the
   * listing itself, largest same-path-template group, in document order.
   * Feeds the "pick your verification URLs" step of the schema wizard.
   */
  findProductPages: publicProcedure
    .input(z.object({ listingUrl: z.string().url() }))
    .mutation(async ({ input }) => {
      const anchors = await withBrowserSession(async (browser) => {
        const capture = await browser.capture(input.listingUrl, { waitUntil: 'networkidle', interceptNetworkRequests: false });
        return browser.setContentEvaluate<Array<{ href: string; text: string }>>(
          capture.html,
          `(() => Array.from(document.querySelectorAll('a[href]')).map(a => ({ href: a.getAttribute('href') || '', text: (a.textContent || '').trim().slice(0, 80) })))()`,
        );
      });

      return { urls: rankProductLinks(anchors, input.listingUrl, FIND_PRODUCT_PAGES_LIMIT) };
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

      // Requested fields (repair-engine backfill asks, or a human via
      // `sources.requestFields`) ride along into schema discovery as a
      // newline-delimited "name: hint" string — `normalizeUserFields`
      // (`@robot/scraper`) splits each line back into {name, description}.
      const requested = (source.requestedFields as Array<{ name: string; hint?: string }> | null) ?? [];
      const requestedFields = requested.length
        ? requested.map((f) => (f.hint ? `${f.name}: ${f.hint}` : f.name)).join('\n')
        : undefined;

      const scraperCaller = scraperRouter.createCaller(ctx);
      const result = await scraperCaller.analyze({ url: source.urlTemplate, pageType, requestedFields });

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
   * Persist fields a human (or a repair run, in a future task) wants this
   * Source to pick up — merged by name into `sources.requestedFields`
   * (`Array<{name, hint?}>`). `sources.analyze` joins these into the
   * newline-delimited `requestedFields` string it forwards to
   * `scraper.analyze` → `runAnalysis` → `normalizeUserFields`.
   *
   * Merge-by-name: a repeat name REPLACES the existing entry wholly (new
   * hint). Dedupe is on the exact stored name (no case-folding/normalization
   * here — `normalizeUserFields` downstream is what canonicalizes names for
   * extraction).
   */
  requestFields: publicProcedure
    .input(
      z.object({
        sourceId: z.string().uuid(),
        fields: z.array(z.object({
          name: z.string().min(1).max(100),
          hint: z.string().max(500).optional(),
        })).min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const source = await ctx.db.query.sources.findFirst({
        where: eq(sources.id, input.sourceId),
        columns: { id: true, requestedFields: true },
      });
      if (!source) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Source ${input.sourceId} not found` });
      }

      const existing = (source.requestedFields as Array<{ name: string; hint?: string }> | null) ?? [];

      const byName = new Map(existing.map((f) => [f.name, f]));
      for (const field of input.fields) {
        byName.set(field.name, { name: field.name, hint: field.hint });
      }
      const requestedFields = Array.from(byName.values());

      const [updated] = await ctx.db
        .update(sources)
        .set({ requestedFields, updatedAt: new Date() })
        .where(eq(sources.id, source.id))
        .returning();

      return { requestedFields: updated!.requestedFields as Array<{ name: string; hint?: string }> };
    }),

  /**
   * Enable/disable a single field on a Source's own schema
   * (`selectorsJson.fields[].enabled`) — the Scratch-source schema
   * `effectiveSchema` falls back to when the Source's dataset has no schema
   * of its own. `effectiveSchema` and the dashboard's ResultsTable already
   * treat `enabled !== false` as "on", so this is the only write side needed.
   * Read-modify-write on the stored fields array.
   */
  setFieldEnabled: publicProcedure
    .input(
      z.object({
        sourceId: z.string().uuid(),
        field: z.string().min(1),
        enabled: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const source = await ctx.db.query.sources.findFirst({
        where: eq(sources.id, input.sourceId),
        columns: { id: true, selectorsJson: true },
      });
      if (!source) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Source ${input.sourceId} not found` });
      }

      const selectors = (source.selectorsJson ?? {}) as { fields?: Array<{ name: string; enabled?: boolean; [k: string]: unknown }> };
      const fields = selectors.fields ?? [];
      const idx = fields.findIndex((f) => f.name === input.field);
      if (idx === -1) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Field "${input.field}" not found on source ${input.sourceId}`,
        });
      }

      const updatedFields = fields.map((f, i) => (i === idx ? { ...f, enabled: input.enabled } : f));
      const selectorsJson = { ...selectors, fields: updatedFields };

      await ctx.db
        .update(sources)
        .set({ selectorsJson, updatedAt: new Date() })
        .where(eq(sources.id, source.id));

      return selectorsJson;
    }),

  /**
   * Confirm a Source's schema looks right and kick off a full crawl
   * (`probe: false`) — the "graduate from preview to real run" step. Reuses
   * `planSource`, the exact same planning logic `crawl.plan` calls, so a
   * confirm and a manual full plan can never drift apart.
   *
   * M3 (final-review-findings.md): `confirmedAt` is written AFTER
   * `planSource` succeeds, not before — writing it first left a confirmed
   * Source with no run whenever planning threw, and made confirm callable
   * over and over on an already-confirmed Source, each time planning another
   * full-budget run. Refusing a repeat confirm outright (PRECONDITION_FAILED,
   * the same guard `sources.delete` already uses for "confirmed") is what
   * makes this idempotent.
   */
  confirm: publicProcedure
    .input(z.object({ sourceId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const source = await ctx.db.query.sources.findFirst({
        where: eq(sources.id, input.sourceId),
        columns: { id: true, confirmedAt: true },
      });
      if (!source) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Source ${input.sourceId} not found` });
      }
      if (source.confirmedAt) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `Source ${input.sourceId} is already confirmed`,
        });
      }

      const result = await planSource(ctx.db, source.id, { probe: false });

      await ctx.db
        .update(sources)
        .set({ confirmedAt: new Date(), updatedAt: new Date() })
        .where(eq(sources.id, source.id));

      return { runId: result.runId };
    }),

  /**
   * Delete a Source and its own InputSet — the confirm gate's "something's
   * wrong" honest action (spec §3: "edit the URL(s), switch the Source to
   * detail mode, or delete"). Runs, captures and extractions cascade via
   * their FKs; the InputSet is deleted alongside it because `quickCreate`
   * creates one InputSet per Source (never shared), the exact assumption this
   * file's own test helper (`cleanupSource`) already relies on.
   *
   * Controller ruling R5: scoped to UNCONFIRMED sources only. The only caller
   * today is the probe confirm gate's "something's wrong" panel, which only
   * ever renders for an unconfirmed Source — a confirmed one (already
   * crawling, or already crawled, for real) refusing here is a deliberate
   * guard against a client bug or a future caller reaching this endpoint on
   * data that matters, not a UI-enforced-only rule.
   */
  delete: publicProcedure
    .input(z.object({ sourceId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const source = await ctx.db.query.sources.findFirst({
        where: eq(sources.id, input.sourceId),
        columns: { id: true, inputSetId: true, confirmedAt: true },
      });
      if (!source) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Source ${input.sourceId} not found` });
      }
      if (source.confirmedAt) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Confirmed sources cannot be deleted from the probe flow. Unconfirm/delete is a future operation.',
        });
      }

      await ctx.db.delete(sources).where(eq(sources.id, source.id));
      if (source.inputSetId) {
        await ctx.db.delete(inputSets).where(eq(inputSets.id, source.inputSetId));
      }

      return { deleted: true };
    }),
});
