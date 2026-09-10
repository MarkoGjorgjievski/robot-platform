import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { eq, and, desc, sql } from 'drizzle-orm';
import { sources, datasets, projects, orgs, domains, inputSets, sourceVerifications } from '@robot/db';
import { FIND_PRODUCT_PAGES_LIMIT, VERIFY_STALL_MS, EST_AI_COST_PER_FIELD_USD, type SchemaDefinitionField, type VerificationSet } from '@robot/scraper';
import { router, publicProcedure } from '../trpc';
import { slugify, uniqueSlug } from '../slug.js';
import { planSource } from '../crawl/plan-source.js';
import { withBrowserSession } from '../browser-session.js';
import { httpUrl } from '../verify/http-url.js';
import { bindingInput, prepareBinding } from '../verify/binding-input.js';
import { contractFields, bindingFor } from '../contract.js';
import { rankProductLinks } from '../verify/find-product-pages.js';
import { sourceDefinitionHash, loadFieldCurrency } from '../verify/current-certification.js';
import { runSourceVerification } from '../verify/run-source-verification.js';
import { resolveInFlightVerification } from '../verify/in-flight.js';
import { requireCertification } from '../crawl/require-certification.js';

/** The planner's input rows for a schema: the listing page when given, else the proof pages as detail rows. */
function inputRowsFor(urls: string[], listingUrl: string | undefined): { rows: Array<{ url: string }>; listingMode: 'listing_to_detail' | 'detail' } {
  return listingUrl
    ? { rows: [{ url: listingUrl }], listingMode: 'listing_to_detail' }
    : { rows: urls.map((url) => ({ url })), listingMode: 'detail' };
}

const LISTING_DEFAULT_BUDGET = { max_items: 40, max_pages: 3, mode: 'first_n' } as const;

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
          // The schema-discovery payload (fields, pageType, listing report,
          // hints, blocked reason...) written by the deleted `sources.analyze`
          // procedure (removed 2026-09; no live writer) — legacy data on
          // Sources created before the verification-first flow, still read
          // by `effectiveSchema`'s legacy branch and the legacy export path.
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

  // ─── Project-scoped creation (mvp-flow phase 1, spec 5.4) ────────────────

  /**
   * "Add website": a named source in the project's dataset, seeded with a
   * binding row (empty description) for every contract field already on the
   * project — or `null` when the project has no fields yet. The three proof
   * pages and the descriptions are filled in on its tabs afterwards;
   * `updateBinding` creates the input set the first time it has URLs to put
   * in it.
   */
  createInProject: publicProcedure
    .input(z.object({
      projectSlug: z.string().min(1),
      name: z.string().trim().min(1).max(255),
      url: httpUrl,
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await ctx.db.query.projects.findFirst({
        where: eq(projects.slug, input.projectSlug),
        with: { datasets: { orderBy: (d, { asc }) => [asc(d.createdAt)], limit: 1, columns: { id: true, schema: true } } },
      });
      if (!project) throw new TRPCError({ code: 'NOT_FOUND', message: `Project ${input.projectSlug} not found` });

      let datasetId = project.datasets[0]?.id;
      let datasetSchema: unknown = project.datasets[0]?.schema;
      if (!datasetId) {
        const [ds] = await ctx.db.insert(datasets).values({ projectId: project.id, name: project.name, slug: project.slug, schema: [] }).returning({ id: datasets.id, schema: datasets.schema });
        datasetId = ds!.id;
        datasetSchema = ds!.schema;
      }

      const sourceSlug = await uniqueSlug(slugify(input.name), async (s) =>
        !!(await ctx.db.query.sources.findFirst({ where: and(eq(sources.datasetId, datasetId!), eq(sources.slug, s)), columns: { id: true } })),
      );

      const contract = contractFields(datasetSchema);
      const schemaDefinition = contract.length > 0 ? bindingFor(contract) : null;

      const [source] = await ctx.db
        .insert(sources)
        .values({
          datasetId,
          name: input.name,
          slug: sourceSlug,
          country: 'us',
          inputStrategy: 'direct',
          urlTemplate: input.url,
          schemaDefinition,
        })
        .returning({ id: sources.id });

      return { sourceId: source!.id, projectSlug: project.slug, sourceSlug };
    }),

  rename: publicProcedure
    .input(z.object({ sourceId: z.string().uuid(), name: z.string().trim().min(1).max(255) }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .update(sources)
        .set({ name: input.name, updatedAt: new Date() })
        .where(eq(sources.id, input.sourceId))
        .returning({ id: sources.id, name: sources.name });
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: `Source ${input.sourceId} not found` });
      return row;
    }),

  // ─── Customer schema verification (task 12) ──────────────────────────────

  /**
   * Write a website's binding (spec 4.2): the three proof pages, the optional
   * listing page, where each contract field lives on this website, and the
   * expected values. Name and type are never accepted here — they come from
   * the project's contract (`datasets.addField`/`renameField`/`retypeField`);
   * this procedure only ever writes descriptions + expected values for the
   * contract as it stands. Refused while a verification is in flight
   * (`completed_at IS NULL`) — editing the binding out from under a running
   * Verify would leave that run's results describing a binding that no
   * longer exists.
   */
  updateBinding: publicProcedure
    .input(bindingInput)
    .mutation(async ({ ctx, input }) => {
      const { sourceId, ...binding } = input;

      const source = await ctx.db.query.sources.findFirst({
        where: eq(sources.id, sourceId),
        columns: { id: true, schemaDefinition: true, verificationSet: true, inputSetId: true, name: true, confirmedAt: true, listingMode: true, budget: true },
        with: { dataset: { columns: { projectId: true, schema: true } }, inputSet: { columns: { rows: true } } },
      });
      if (!source) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Source ${sourceId} not found` });
      }

      const contract = contractFields(source.dataset?.schema);
      if (contract.length === 0) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Add fields to the project before describing this website' });
      }

      // Same stall rule `verify` applies (correction round, item 2): a
      // genuinely in-flight run still refuses the save — its results are
      // about to land against the definition being edited — but a crash
      // leftover is closed out and the save proceeds. Without this, one
      // dead api-server locked a Source's schema out of editing for good.
      const inFlight = await resolveInFlightVerification(ctx.db, sourceId);
      if (inFlight) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `Source ${sourceId} has a verification in flight; wait for it to complete before editing the schema`,
        });
      }

      // Keep the planner's input in step with the schema (phase 1 plan, Task 5):
      // a listing URL means one listing row and listing mode; none means the
      // three product pages as detail rows. Checked BEFORE any write below —
      // a confirmed Source's listing mode is locked (fix round 1, finding 1:
      // this must refuse before the schema write commits, not after).
      const { rows, listingMode } = inputRowsFor(binding.urls, binding.listingUrl);
      if (source.confirmedAt && source.listingMode && source.listingMode !== listingMode) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: `Source ${sourceId} is confirmed; its listing mode is locked` });
      }

      const { fields, verificationSet } = prepareBinding(binding, contract);

      return ctx.db.transaction(async (tx) => {
        const [updated] = await tx
          .update(sources)
          .set({ schemaDefinition: fields, verificationSet, updatedAt: new Date() })
          .where(eq(sources.id, sourceId))
          .returning();

        // Updated in place so a source keeps its input set id across edits —
        // but only when the binding flow authored the rows it's about to
        // replace (final review, finding 1). A legacy source may hold an
        // arbitrary number of listing/detail URLs in its input set; without
        // this check, the first binding save silently replaced them with the
        // three proof pages.
        if (source.inputSetId && source.inputSet) {
          const previousVerificationSet = source.verificationSet as VerificationSet | null;
          const authoredRows = inputRowsFor(previousVerificationSet?.urls ?? [], previousVerificationSet?.listing_url).rows;
          const flowOwnsInputSet = JSON.stringify(source.inputSet.rows) === JSON.stringify(authoredRows);

          if (flowOwnsInputSet) {
            await tx.update(inputSets).set({ rows, updatedAt: new Date() }).where(eq(inputSets.id, source.inputSetId));

            // Fix round 1, finding 2: reset the budget on a mode change — a
            // detail switch drops any listing budget, and a listing switch
            // gets the starter budget only if none is already set.
            const budgetPatch =
              source.listingMode === listingMode
                ? {}
                : listingMode === 'detail'
                  ? { budget: {} }
                  : Object.keys((source.budget as object | null) ?? {}).length === 0
                    ? { budget: LISTING_DEFAULT_BUDGET }
                    : {};
            await tx.update(sources).set({ listingMode, ...budgetPatch }).where(eq(sources.id, sourceId));
          }
        } else if (source.dataset?.projectId) {
          const [inputSet] = await tx
            .insert(inputSets)
            .values({ projectId: source.dataset.projectId, type: 'direct', name: source.name, columns: [{ name: 'url', primary: true }], rows })
            .returning({ id: inputSets.id });
          await tx
            .update(sources)
            .set({ inputSetId: inputSet!.id, listingMode, ...(binding.listingUrl ? { budget: LISTING_DEFAULT_BUDGET } : {}) })
            .where(eq(sources.id, sourceId));
        }

        return updated;
      });
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
    .input(z.object({ listingUrl: httpUrl }))
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
      await requireCertification(ctx.db, input.sourceId);
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
   * their FKs; the InputSet is deleted alongside it because a Source's
   * InputSet is never shared with another Source.
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

  /**
   * A rough, pre-flight cost ceiling for a Verify run — every field asking
   * AI (the most expensive path per field) — so the dashboard can warn
   * before spending anything. `aiAvailable` tells it whether AI fallback can
   * even run at all (no key = mechanical/XPath-only verification).
   */
  verifyEstimate: publicProcedure
    .input(z.object({ sourceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const source = await ctx.db.query.sources.findFirst({
        where: eq(sources.id, input.sourceId),
        columns: { schemaDefinition: true },
      });
      if (!source) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Source ${input.sourceId} not found` });
      }
      const fields = Array.isArray(source.schemaDefinition) ? (source.schemaDefinition as SchemaDefinitionField[]).length : 0;
      return {
        fields,
        upperBoundUsd: fields * EST_AI_COST_PER_FIELD_USD,
        aiAvailable: !!process.env.ANTHROPIC_API_KEY,
        // The dashboard must not hardcode the stall window (C1): it decides
        // whether an in-flight verification is genuinely running or is a
        // crash leftover using the SAME threshold `sources.verify` applies
        // server-side when it closes a stalled row out and starts a fresh one.
        stallMs: VERIFY_STALL_MS,
      };
    }),

  /**
   * Kick off a verification run — the fire-and-forget shape `startExecution`
   * established (crawl/start-execution.ts): insert the row, `void` the
   * actual work, and return immediately so the dashboard can poll
   * `verificationStatus`.
   *
   * Stall rule (the D2 lesson): a `completed_at IS NULL` row younger than
   * `VERIFY_STALL_MS` is genuinely in flight and is handed back as-is — a
   * double-click or a re-mount must not start a second run. One OLDER than
   * that is a crash leftover (an api-server restart mid-verify); it is
   * closed out with `errorMessage: 'stalled'` so it can never wedge this
   * Source, and a fresh verification starts in its place.
   */
  verify: publicProcedure
    .input(z.object({ sourceId: z.string().uuid(), onlyKeys: z.array(z.string()).optional() }))
    .mutation(async ({ ctx, input }) => {
      const source = await ctx.db.query.sources.findFirst({
        where: eq(sources.id, input.sourceId),
        columns: { id: true, schemaDefinition: true, verificationSet: true },
      });
      if (!source) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Source ${input.sourceId} not found` });
      }
      const hash = sourceDefinitionHash(source);
      if (!hash) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `Source ${input.sourceId} has no schema definition to verify`,
        });
      }

      const inFlight = await resolveInFlightVerification(ctx.db, input.sourceId);
      if (inFlight) {
        return { verificationId: inFlight.id, status: 'in-progress' as const };
      }

      const [row] = await ctx.db
        .insert(sourceVerifications)
        .values({ sourceId: input.sourceId, definitionHash: hash })
        .returning({ id: sourceVerifications.id });

      void runSourceVerification(input.sourceId, row!.id, { onlyKeys: input.onlyKeys }).catch((err) => {
        console.error(`[sources.verify] verification ${row!.id} failed:`, err);
      });

      return { verificationId: row!.id, status: 'started' as const };
    }),

  /**
   * Poll a Source's latest verification run. `current` is decided at read
   * time by comparing the row's `definitionHash` against the Source's
   * present definition — `updateSchema` never touches past rows, so a hash
   * mismatch (not a stored flag) is what tells the dashboard the schema
   * moved on since this run.
   *
   * `_stage` (written by `runSourceVerification`'s `onProgress`) is a
   * reserved key inside the `captures` jsonb column, not a real capture
   * ref — surfaced here as `stage` and stripped from the `captures` map so
   * callers never mistake it for one.
   */
  verificationStatus: publicProcedure
    .input(z.object({ sourceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const row = await ctx.db.query.sourceVerifications.findFirst({
        where: eq(sourceVerifications.sourceId, input.sourceId),
        orderBy: [desc(sourceVerifications.startedAt)],
      });
      if (!row) return null;

      const source = await ctx.db.query.sources.findFirst({
        where: eq(sources.id, input.sourceId),
        columns: { schemaDefinition: true, verificationSet: true },
      });

      const { currentKeys } = await loadFieldCurrency(ctx.db, input.sourceId);
      const fieldCount = source && Array.isArray(source.schemaDefinition) ? source.schemaDefinition.length : 0;

      const captures = { ...(row.captures as Record<string, unknown>) };
      const stage = (captures._stage as string | undefined) ?? null;
      delete captures._stage;

      return {
        id: row.id,
        startedAt: row.startedAt,
        completedAt: row.completedAt,
        allPassed: row.allPassed,
        results: row.results,
        captures,
        stage,
        aiCalls: row.aiCalls,
        costUsd: row.costUsd,
        errorMessage: row.errorMessage,
        currentKeys,
        current: fieldCount > 0 && currentKeys.length === fieldCount,
      };
    }),
});
