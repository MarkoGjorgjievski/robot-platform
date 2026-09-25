import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { eq, and, desc, sql, isNotNull, isNull } from 'drizzle-orm';
import { sources, datasets, projects, orgs, domains, inputSets, sourceVerifications, captures, type Database } from '@robot/db';
import {
  FIND_PRODUCT_PAGES_LIMIT, VERIFY_STALL_MS, EST_AI_COST_PER_FIELD_USD, CAPTURE_REUSE_MAX_AGE_MS, VERIFY_URL_MAX, fieldHash,
  suggestMarks, transferMarks, buildDomSearchScript, buildXPathProbeScript,
  type SchemaDefinitionField, type VerificationSet, type Transferred, type DomHit, type DomNeedle, type XPathProbeResult,
} from '@robot/scraper';
import { router, publicProcedure } from '../trpc';
import { slugify, uniqueSlug } from '../slug.js';
import { resolveOrg } from '../auth/session.js';
import { sourceInOrg, captureInOrg } from '../auth/scope.js';
import { planSource } from '../crawl/plan-source.js';
import { withBrowserSession } from '../browser-session.js';
import { httpUrl } from '../verify/http-url.js';
import { bindingInput, prepareBinding, host, markInput } from '../verify/binding-input.js';
import { contractFields, bindingFor } from '../contract.js';
import { rankProductLinks, describeListingPage } from '../verify/find-product-pages.js';
import { sourceDefinitionHash, loadFieldCurrency } from '../verify/current-certification.js';
import { runSourceVerification } from '../verify/run-source-verification.js';
import { startProofPageCapture, loadProofPageCaptures, latestProofPageCaptures, resolveStalledProofPage, type ProofPageMeta } from '../verify/proof-page-capture.js';
import { readCaptureFile } from '../verify/capture-store.js';
import { resolveInFlightVerification } from '../verify/in-flight.js';
import { requireCertification } from '../crawl/require-certification.js';

/** The transaction handle `ctx.db.transaction` hands its callback — named so `setInputPages` can take one as a parameter. */
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** The planner's input rows for a schema: the listing page when given, else the proof pages as detail rows. */
function inputRowsFor(urls: string[], listingUrl: string | undefined): { rows: Array<{ url: string }>; listingMode: 'listing_to_detail' | 'detail' } {
  return listingUrl
    ? { rows: [{ url: listingUrl }], listingMode: 'listing_to_detail' }
    : { rows: urls.map((url) => ({ url })), listingMode: 'detail' };
}

const LISTING_DEFAULT_BUDGET = { max_items: 40, max_pages: 3, mode: 'first_n' } as const;

/**
 * Is this budget one nobody chose?
 *
 * Empty is the easy case. The other one is exactly `LISTING_DEFAULT_BUDGET`,
 * which `updateBinding` writes by itself when a binding first names a listing
 * URL: the customer never picked 40 and 3, so the Extract tab must not open
 * its Run section on "custom 40 / custom 3" and present them as a decision.
 *
 * But `budgetFromForm` produces a byte-identical object when a customer
 * deliberately picks 40 products across 3 pages, and value-matching alone
 * cannot tell those two apart. Two markers in `parameters` can:
 *
 * - `inputMode` is set the first time the Extract tab saves pages. While the
 *   tab has never owned this Source's input, a stored 40/3 can only be the
 *   automatic starter; after that it is the customer's, and stays.
 * - `budgetChosen` is set by `sources.update` whenever a budget is written
 *   through it — the Settings tab's budget row (task 9) is a second writer of
 *   budgets that does not touch the input set, so it sets no `inputMode` and
 *   would otherwise have its 40/3 read back as the starter nobody chose and
 *   handed out as `null`.
 *
 * `budgetToForm(raw, { legacy })` in the app's `lib/site/extract-view.ts`
 * applies the same rule from the `inputMode` signal.
 */
function budgetIsUnchosen(budget: unknown, priorParameters: Record<string, unknown> | null | undefined): boolean {
  if (typeof budget !== 'object' || budget === null) return true;
  const b = budget as Record<string, unknown>;
  if (Object.keys(b).length === 0) return true;
  const p = priorParameters ?? {};
  if (typeof p.inputMode === 'string') return false;
  if (p.budgetChosen === true) return false;
  return (
    Object.keys(b).length === 3 &&
    b.max_items === LISTING_DEFAULT_BUDGET.max_items &&
    b.max_pages === LISTING_DEFAULT_BUDGET.max_pages &&
    b.mode === LISTING_DEFAULT_BUDGET.mode
  );
}

/**
 * The all/all starter budget both Extract-tab setters seed when a Source has
 * no budget the customer chose (see `budgetIsUnchosen`).
 *
 * Detail mode needs it just as much as listing mode does, and for a reason
 * that is easy to miss: `max_items` is NOT a pagination concept. In detail
 * mode `planRun` uses the resolved item cap as *the* cap on how many of the
 * saved product URLs get planned at all, dropping the rest into
 * `skipped_budget`. Leaving the column default `{}` on a detail Source
 * therefore resolved to `maxItems: 50` — a customer who pasted 500 URLs got
 * 50 of them, while the Run sentence said "all". The tab's promise is only
 * true if the stored budget says all.
 */
const ALL_BUDGET = { max_items: 'all', max_pages: 'all', mode: 'all' } as const;

const budgetShape = z.object({
  max_items: z.union([z.number().int().positive(), z.literal('all')]),
  max_pages: z.union([z.number().int().positive(), z.literal('all')]),
  mode: z.enum(['all', 'first_n']).optional(),
});

/** Keeps the first occurrence of each URL, comparing exact strings. */
const uniqueUrls = (urls: string[]): string[] => Array.from(new Set(urls));

/**
 * The shared body of `setListingPages`/`setProductUrls` (task 3, fix round
 * 1): reads the Source, the confirmed-mode lock, and the write (rows +
 * `parameters.inputMode` + `listingMode` + an optional budget seed) all run
 * inside the SAME transaction the caller opened — the read moved in here
 * from before the transaction so the parameters merge and the
 * budget-emptiness check see a snapshot that at least belongs to this write.
 * That NARROWS the lost-update window a pre-transaction read left open; it
 * does not close it: under PostgreSQL's default READ COMMITTED, with no
 * `FOR UPDATE` on the read, two concurrent saves can still both observe the
 * pre-state. The effects here are benign (the `parameters` merge is
 * idempotent, and the worst case is a duplicate budget seed of the same
 * value), so no row lock is taken.
 * Off-host handling is the one thing that differs between the two callers:
 * `offHost: 'reject'` throws BAD_REQUEST naming the offending URL (a listing
 * page's host IS the site being crawled); `'skip'` drops it and reports it
 * back instead.
 */
async function setInputPages(
  tx: Tx,
  sourceId: string,
  opts: {
    urls: string[];
    listingMode: 'listing_to_detail' | 'detail';
    inputMode: 'listing' | 'detail';
    offHost: 'reject' | 'skip';
    seedBudget?: Record<string, unknown>;
  },
): Promise<{ rows: Array<{ url: string }>; skipped: string[] }> {
  const source = await tx.query.sources.findFirst({
    where: eq(sources.id, sourceId),
    columns: { id: true, name: true, confirmedAt: true, listingMode: true, budget: true, parameters: true, inputSetId: true, verificationSet: true },
    with: { dataset: { columns: { projectId: true } } },
  });
  if (!source) {
    throw new TRPCError({ code: 'NOT_FOUND', message: `Source ${sourceId} not found` });
  }
  if (source.confirmedAt && source.listingMode && source.listingMode !== opts.listingMode) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: `Source ${sourceId} is confirmed; its listing mode is locked` });
  }

  const urls = uniqueUrls(opts.urls);
  const verificationSet = source.verificationSet as VerificationSet | null;
  const referenceHost = verificationSet?.urls?.[0] ? host(verificationSet.urls[0]) : host(urls[0]!);
  const accepted: string[] = [];
  const skipped: string[] = [];
  for (const url of urls) {
    if (host(url) === referenceHost) {
      accepted.push(url);
    } else if (opts.offHost === 'reject') {
      throw new TRPCError({ code: 'BAD_REQUEST', message: `${url} is not on the same website as this source's other pages` });
    } else {
      skipped.push(url);
    }
  }

  // Every URL was off-host, so `rows` would be `[]` — written straight over
  // whatever the customer had saved. Pasting the wrong site's export (or a
  // `shop.` list against `www.` proof pages) would silently empty the input
  // of a website that may be mid-extraction, with only the amber "N were
  // skipped" note as feedback. Nothing accepted means nothing to save.
  if (accepted.length === 0) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `No URLs on ${referenceHost}; nothing saved` });
  }

  const rows = accepted.map((url) => ({ url }));
  const priorParameters = (source.parameters as Record<string, unknown> | null) ?? {};
  const parameters = { ...priorParameters, inputMode: opts.inputMode };
  // The markers as they were BEFORE this write — read in the same transaction
  // as the budget they are judging. Once the Extract tab has owned the input
  // even once, or the Settings tab has saved a budget, the stored budget is the
  // customer's and is never reseeded.
  const budgetPatch = opts.seedBudget && budgetIsUnchosen(source.budget, priorParameters) ? { budget: opts.seedBudget } : {};

  if (source.inputSetId) {
    await tx.update(inputSets).set({ rows, updatedAt: new Date() }).where(eq(inputSets.id, source.inputSetId));
    await tx.update(sources).set({ listingMode: opts.listingMode, parameters, ...budgetPatch, updatedAt: new Date() }).where(eq(sources.id, sourceId));
  } else {
    if (!source.dataset?.projectId) {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: `Source ${sourceId} has no project to create an input set in` });
    }
    const [inputSet] = await tx
      .insert(inputSets)
      .values({ projectId: source.dataset.projectId, type: 'direct', name: source.name, columns: [{ name: 'url', primary: true }], rows })
      .returning({ id: inputSets.id });
    await tx
      .update(sources)
      .set({ inputSetId: inputSet!.id, listingMode: opts.listingMode, parameters, ...budgetPatch, updatedAt: new Date() })
      .where(eq(sources.id, sourceId));
  }

  return { rows, skipped };
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

  // TODO(cut-over, spec 2026-09-21 §2): the `orgSlug ?? 'default'` fallback exists only for the
  // old dashboard, which still names the org explicitly. Once it is retired, drop the fallback.
  listByProject: publicProcedure
    .input(z.object({ projectSlug: z.string(), orgSlug: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const org = await resolveOrg(ctx, input.orgSlug ?? 'default');
      const projectRow = await ctx.db.query.projects.findFirst({
        where: and(eq(projects.orgId, org.id), eq(projects.slug, input.projectSlug)),
        columns: { id: true },
      });
      // An unknown project must not read as "no websites" — a wrong URL should say so.
      if (!projectRow) throw new TRPCError({ code: 'NOT_FOUND', message: `Project ${input.projectSlug} not found` });

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
          // The Extract tab reads both off the row it already has (phase 4,
          // task 6): `budget` seeds the run sentence's two dropdowns, and
          // `parameters.inputMode` is the marker that says the customer's own
          // pages — not the three proof pages — own the input set now.
          budget: sources.budget,
          parameters: sources.parameters,
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
        .leftJoin(domains, eq(sources.domainId, domains.id))
        .leftJoin(inputSets, eq(sources.inputSetId, inputSets.id))
        .where(and(
          eq(projects.orgId, org.id),
          eq(projects.slug, input.projectSlug),
        ))
        .orderBy(sources.name);

      return results;
    }),

  /** The website loader for its page (spec 2026-09-21 §5): the row, its project and the contract, in one round trip. */
  // TODO(cut-over, spec 2026-09-21 §2): `input.orgSlug ?? 'default'` falls back to the seeded
  // `default` org for the old dashboard's session-less callers. Once it is retired, drop the fallback.
  get: publicProcedure
    .input(z.object({ projectSlug: z.string().min(1), sourceSlug: z.string().min(1), orgSlug: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const org = await resolveOrg(ctx, input.orgSlug ?? 'default');
      const project = await ctx.db.query.projects.findFirst({ where: and(eq(projects.orgId, org.id), eq(projects.slug, input.projectSlug)), columns: { id: true, name: true, slug: true } });
      if (!project) throw new TRPCError({ code: 'NOT_FOUND', message: `Project ${input.projectSlug} not found` });
      const row = await ctx.db
        .select({ source: sources, datasetSchema: datasets.schema })
        .from(sources)
        .innerJoin(datasets, eq(sources.datasetId, datasets.id))
        .where(and(eq(datasets.projectId, project.id), eq(sources.slug, input.sourceSlug)))
        .limit(1);
      const hit = row[0];
      if (!hit) throw new TRPCError({ code: 'NOT_FOUND', message: `Website ${input.sourceSlug} not found` });
      const s = hit.source;
      let hostname = '';
      try { hostname = s.urlTemplate ? new URL(s.urlTemplate).hostname : ''; } catch { hostname = ''; }
      // `budget` is `notNull().default({})`, so the column never reads null and
      // `{}` would be handed out cast to a shape it does not have. A budget
      // nobody chose is reported as the `null` the type promises — decided by
      // the same `budgetIsUnchosen` rule the Extract tab's setters apply, from
      // the same signals (`parameters.inputMode` / `parameters.budgetChosen`:
      // once the tab has owned this website's input, or a budget has been saved
      // through `sources.update`, even 40/3 is the customer's choice and stays).
      const parameters = (s.parameters ?? {}) as Record<string, unknown>;
      return {
        id: s.id, slug: s.slug, name: s.name, url: s.urlTemplate, hostname, datasetId: s.datasetId,
        listingMode: s.listingMode as 'listing_to_detail' | 'detail' | null, confirmedAt: s.confirmedAt, isActive: s.isActive,
        budget: budgetIsUnchosen(s.budget, parameters)
          ? null
          : (s.budget as { max_items: number | 'all'; max_pages: number | 'all'; mode?: 'all' | 'first_n' }),
        parameters,
        schemaDefinition: s.schemaDefinition, verificationSet: s.verificationSet, driftedFields: s.driftedFields as string[] | null,
        project, fields: contractFields(hit.datasetSchema), createdAt: s.createdAt,
      };
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
      // `budget` now comes from the Extract tab's run sentence (task 3).
      z.object({
        id: z.string().uuid(),
        isActive: z.boolean().optional(),
        listingMode: z.enum(['listing_to_detail', 'detail']).optional(),
        budget: budgetShape.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await sourceInOrg(ctx, input.id);
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

      // A budget written through here is a budget the customer chose, and it
      // has to say so in the row: this is the Settings tab's budget row, which
      // never touches the input set and so sets no `parameters.inputMode`.
      // Without the marker `budgetIsUnchosen` reads a saved 40/3 back as the
      // old flow's automatic starter and `sources.get` hands out `null` — the
      // Settings row then resets itself to all/all and the customer's Save
      // looks like it did nothing. Merged in SQL (`||` on jsonb) rather than
      // read-modify-written in JS, so every other key survives a concurrent
      // writer of `parameters` (`setInputPages`) instead of racing it.
      const parametersPatch =
        input.budget !== undefined
          ? { parameters: sql`${sources.parameters} || '{"budgetChosen":true}'::jsonb` }
          : {};

      const [source] = await ctx.db
        .update(sources)
        .set({ ...rest, ...parametersPatch, updatedAt: new Date() })
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
  // TODO(cut-over, spec 2026-09-21 §2): `resolveOrg(ctx, 'default')` falls back to the seeded
  // `default` org for the old dashboard's session-less callers. Once it is retired, drop the fallback.
  createInProject: publicProcedure
    .input(z.object({
      projectSlug: z.string().min(1),
      name: z.string().trim().min(1).max(255),
      url: httpUrl,
    }))
    .mutation(async ({ ctx, input }) => {
      const org = await resolveOrg(ctx, 'default');
      const project = await ctx.db.query.projects.findFirst({
        where: and(eq(projects.orgId, org.id), eq(projects.slug, input.projectSlug)),
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
      await sourceInOrg(ctx, input.sourceId);
      const [row] = await ctx.db
        .update(sources)
        .set({ name: input.name, updatedAt: new Date() })
        .where(eq(sources.id, input.sourceId))
        .returning({ id: sources.id, name: sources.name });
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: `Source ${input.sourceId} not found` });
      return row;
    }),

  // ─── Extract tab: the customer's pages as the source's input (phase 4, task 3) ──

  /**
   * The Extract tab's "listing pages" input: the given URLs become the
   * source's input set rows as-is (one row per URL — the crawler paginates
   * each), `listingMode` becomes `listing_to_detail`, and `parameters.inputMode`
   * is set to `'listing'` so `updateBinding`'s schema save (task 3, spec)
   * knows the pages here — not the proof pages — own the input from now on.
   * Refuses an off-host URL outright (unlike `setProductUrls`, which just
   * drops them) since a listing page's host IS the site being crawled.
   */
  setListingPages: publicProcedure
    .input(z.object({ sourceId: z.string().uuid(), urls: z.array(httpUrl).min(1).max(50) }))
    .mutation(async ({ ctx, input }) => {
      await sourceInOrg(ctx, input.sourceId);
      const { rows } = await ctx.db.transaction((tx) =>
        setInputPages(tx, input.sourceId, {
          urls: input.urls,
          listingMode: 'listing_to_detail',
          inputMode: 'listing',
          offHost: 'reject',
          seedBudget: ALL_BUDGET,
        }),
      );
      return { count: rows.length };
    }),

  /**
   * The Extract tab's "product URLs" input: same shape as `setListingPages`
   * but for a hand-picked list of detail pages and `listingMode: 'detail'`. An
   * off-host URL is not refused here — it is dropped into `skipped` so the
   * customer can paste a mixed list and see what didn't make it.
   *
   * The all/all budget is seeded here too, under the same "unchosen" rule.
   * A fixed URL list has nothing to page through, which is why this used to
   * seed nothing — but the item half of the budget is not about paging: it is
   * what caps how many of these URLs `planRun` plans at all. See `ALL_BUDGET`.
   */
  setProductUrls: publicProcedure
    .input(z.object({ sourceId: z.string().uuid(), urls: z.array(httpUrl).min(1).max(5000) }))
    .mutation(async ({ ctx, input }) => {
      await sourceInOrg(ctx, input.sourceId);
      const { rows, skipped } = await ctx.db.transaction((tx) =>
        setInputPages(tx, input.sourceId, {
          urls: input.urls,
          listingMode: 'detail',
          inputMode: 'detail',
          offHost: 'skip',
          seedBudget: ALL_BUDGET,
        }),
      );
      return { accepted: rows.length, skipped };
    }),

  /**
   * The pages this Source will actually be run against, as the Extract tab
   * needs them: the input set's row URLs, plus when that set was last
   * written.
   *
   * `updatedAt` is the input set's own, deliberately not the Source's. The
   * tab uses it for one decision — "were the pages changed since this
   * sample ran?" — and `sources.updated_at` is bumped by a rename, a
   * budget save, a schema save and a confirm as well, every one of which
   * would falsely mark a perfectly good sample stale. The input set's
   * timestamp moves if and only if the rows did.
   *
   * A Source with no input set yet reads as `{ urls: [], updatedAt: null }`
   * rather than throwing: that is the ordinary state of a website whose
   * pages have never been saved, which is exactly when the tab asks.
   */
  inputRows: publicProcedure
    .input(z.object({ sourceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await sourceInOrg(ctx, input.sourceId);
      const source = await ctx.db.query.sources.findFirst({
        where: eq(sources.id, input.sourceId),
        columns: { id: true },
        with: { inputSet: { columns: { rows: true, updatedAt: true } } },
      });
      if (!source) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Source ${input.sourceId} not found` });
      }
      if (!source.inputSet) return { urls: [], updatedAt: null };

      const rows = (source.inputSet.rows ?? []) as Array<Record<string, unknown>>;
      const urls = rows
        .map((row) => row.url)
        .filter((url): url is string => typeof url === 'string' && url.length > 0);
      return { urls, updatedAt: source.inputSet.updatedAt };
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
      await sourceInOrg(ctx, input.sourceId);
      const { sourceId, ...binding } = input;

      const source = await ctx.db.query.sources.findFirst({
        where: eq(sources.id, sourceId),
        columns: { id: true, schemaDefinition: true, verificationSet: true, inputSetId: true, name: true, confirmedAt: true, listingMode: true, budget: true, parameters: true },
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
      //
      // Extract tab phase 4, task 3: once `setListingPages`/`setProductUrls`
      // has set `parameters.inputMode`, the pages the customer set there own
      // the input — the proof pages no longer drive it, so both the derived
      // confirmed-mode precondition and the input-set sync below are skipped
      // entirely for this Source.
      const inputMode = (source.parameters as { inputMode?: string } | null)?.inputMode;
      const extractOwnsInput = inputMode === 'listing' || inputMode === 'detail';
      const { rows, listingMode } = inputRowsFor(binding.urls, binding.listingUrl);
      if (!extractOwnsInput && source.confirmedAt && source.listingMode && source.listingMode !== listingMode) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: `Source ${sourceId} is confirmed; its listing mode is locked` });
      }

      const { fields, verificationSet } = prepareBinding(binding, contract);

      return ctx.db.transaction(async (tx) => {
        const [updated] = await tx
          .update(sources)
          .set({ schemaDefinition: fields, verificationSet, updatedAt: new Date() })
          .where(eq(sources.id, sourceId))
          .returning();

        if (extractOwnsInput) {
          return updated;
        }

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
   * The Extract tab's per-row listing check — no AI, nothing saved, one page
   * load. Captures the page with `withBrowserSession` exactly as
   * `findProductPages` does, but also keeps the html around to feed
   * `describeListingPage` (find-product-pages.ts): the largest same-path-
   * template group's full size (not just the capped ranking), a sample of
   * it, and whether a pager was detected on the page.
   */
  checkListingPage: publicProcedure
    .input(z.object({ listingUrl: httpUrl }))
    .mutation(async ({ input }) => {
      const { anchors, html } = await withBrowserSession(async (browser) => {
        const capture = await browser.capture(input.listingUrl, { waitUntil: 'networkidle', interceptNetworkRequests: false });
        const anchors = await browser.setContentEvaluate<Array<{ href: string; text: string }>>(
          capture.html,
          `(() => Array.from(document.querySelectorAll('a[href]')).map(a => ({ href: a.getAttribute('href') || '', text: (a.textContent || '').trim().slice(0, 80) })))()`,
        );
        return { anchors, html: capture.html };
      });

      return describeListingPage(anchors, input.listingUrl, html);
    }),

  /** Start capturing one proof page for marking (spec 2026-09-18 §3.1). Poll `proofPageCapture`. */
  captureProofPage: publicProcedure
    .input(z.object({ sourceId: z.string().uuid(), url: httpUrl }))
    .mutation(async ({ ctx, input }) => {
      // The guard is the existence check for every caller that has a session:
      // it NOT_FOUNDs an id that names no source as readily as one in another
      // org, so the select that used to stand here was a second round trip for
      // an answer already in hand. (A session-less caller — the old dashboard,
      // which has no screen that reaches this — now hits the captures foreign
      // key instead of NOT_FOUND on an id that names nothing. Goes away with
      // the shim.)
      await sourceInOrg(ctx, input.sourceId);
      return startProofPageCapture(input.sourceId, input.url);
    }),

  /** Where one proof-page capture has got to: the row the stepper polls while its screenshot is taken. */
  proofPageCapture: publicProcedure
    .input(z.object({ captureId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await captureInOrg(ctx, input.captureId);
      const row = await ctx.db.query.captures.findFirst({ where: eq(captures.id, input.captureId), columns: { id: true, url: true, metadata: true } });
      const stored = row?.metadata as ProofPageMeta | undefined;
      if (!row || !stored || stored.kind !== 'proof-page') throw new TRPCError({ code: 'NOT_FOUND', message: `Proof-page capture ${input.captureId} not found` });
      // A capture the api-server died in the middle of is reported as the failure it is, never as still running.
      const meta = await resolveStalledProofPage(row.id, stored);
      return {
        url: meta.url, status: meta.status,
        tiles: meta.status === 'captured' ? meta.tiles : [],
        boxes: meta.status === 'captured' ? meta.boxes : [],
        pageHeight: meta.status === 'captured' ? meta.pageHeight : 0,
        capturedHeight: meta.status === 'captured' ? meta.capturedHeight : 0,
        contentHeight: meta.status === 'captured' ? meta.contentHeight : 0,
        ...(meta.status === 'failed' ? { error: meta.error } : {}),
        ...(meta.status === 'captured' ? { capturedAt: meta.capturedAt } : {}),
      };
    }),

  /** Where each product's capture stands, newest per URL: how a reloaded Verification tab finds the captures it already started. */
  proofPageCaptures: publicProcedure
    .input(z.object({ sourceId: z.string().uuid(), urls: z.array(httpUrl).min(1).max(VERIFY_URL_MAX) }))
    .query(async ({ ctx, input }) => {
      await sourceInOrg(ctx, input.sourceId);
      return latestProofPageCaptures(input.sourceId, input.urls);
    }),

  /**
   * Pre-highlights for the mark screen (spec 2026-09-18 §3.3): pure over the
   * stored capture, no browser, no model. `captureId` names the box map the
   * suggestions' indices point into, so a screen holding a newer capture can
   * tell the answer is stale instead of outlining the wrong element.
   */
  suggestMarks: publicProcedure
    .input(z.object({ captureId: z.string().uuid(), fieldKeys: z.array(z.string()).optional() }))
    .query(async ({ ctx, input }) => {
      await captureInOrg(ctx, input.captureId);
      const row = await ctx.db.query.captures.findFirst({ where: eq(captures.id, input.captureId), columns: { id: true, sourceId: true, metadata: true } });
      const meta = row?.metadata as ProofPageMeta | undefined;
      if (!row || !meta || meta.kind !== 'proof-page') throw new TRPCError({ code: 'NOT_FOUND', message: `Proof-page capture ${input.captureId} not found` });
      if (meta.status !== 'captured') throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'This page is not captured yet' });
      const capture = await readCaptureFile(row.id);
      if (!capture) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'This capture is no longer on disk; capture the page again' });
      const source = await ctx.db.query.sources.findFirst({ where: eq(sources.id, row.sourceId), columns: { id: true }, with: { dataset: { columns: { schema: true } } } });
      const fields = bindingFor(contractFields(source?.dataset?.schema)).filter((f) => !input.fieldKeys || input.fieldKeys.includes(f.key));
      return { captureId: row.id, fields: suggestMarks(capture, meta.boxes, fields) };
    }),

  /**
   * Page 1's paths run on the other proof pages (spec 2026-09-18 §3.4). Opens
   * a browser for the offline DOM search and XPath probe only — and only when
   * there is something to carry and somewhere to carry it to.
   *
   * Per target url: `null` when that page has no fresh proof-page capture,
   * otherwise the capture whose box map the `boxes` indices refer to and a
   * result per field (`null` where nothing resolved, or where page 1 has no
   * value to carry).
   */
  transferMarks: publicProcedure
    .input(z.object({
      sourceId: z.string().uuid(),
      fromUrl: httpUrl,
      toUrls: z.array(httpUrl).min(1).max(VERIFY_URL_MAX),
      from: z.record(z.string(), z.object({ value: z.string(), mark: markInput.optional() })).optional(),
      fieldKeys: z.array(z.string()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await sourceInOrg(ctx, input.sourceId);
      const source = await ctx.db.query.sources.findFirst({ where: eq(sources.id, input.sourceId), columns: { id: true, schemaDefinition: true, verificationSet: true } });
      if (!source) throw new TRPCError({ code: 'NOT_FOUND', message: `Source ${input.sourceId} not found` });
      const allFields = (source.schemaDefinition ?? []) as SchemaDefinitionField[];
      const fields = input.fieldKeys ? allFields.filter((f) => input.fieldKeys!.includes(f.key)) : allFields;
      const set = (source.verificationSet ?? { urls: [], expected: {} }) as VerificationSet;
      // The Verification tab saves drafts, but a tick transfers before its save lands, so it sends the answer on screen.
      const pageOne = (key: string) => input.from
        ? { value: input.from[key]?.value ?? '', mark: input.from[key]?.mark }
        : { value: set.expected[key]?.[input.fromUrl] ?? '', mark: set.marks?.[key]?.[input.fromUrl] };
      const pages = await loadProofPageCaptures(input.sourceId, [input.fromUrl, ...input.toUrls]);
      const from = pages[input.fromUrl];
      if (!from) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Mark page 1 first: it has no fresh capture' });
      // A target without a fresh capture is simply not tried — it comes back null, not an empty field map:
      // an index into a box map we do not have would be a silent wrong outline.
      const to = Object.fromEntries(input.toUrls.filter((u) => pages[u]).map((u) => [u, { capture: pages[u]!.capture, boxes: pages[u]!.meta.boxes }]));
      const out: Record<string, { captureId: string; fields: Record<string, Transferred | null> } | null> =
        Object.fromEntries(input.toUrls.map((u) => [u, pages[u] ? { captureId: pages[u]!.ref.captureId, fields: {} } : null]));
      // A field with a blank page-1 value has nothing to carry; when that is every field, no browser is opened.
      const carried = fields.filter((f) => pageOne(f.key).value.trim() !== '');
      for (const f of fields) {
        if (carried.includes(f)) continue;
        for (const u of input.toUrls) if (out[u]) out[u]!.fields[f.key] = null;
      }
      if (carried.length === 0 || Object.keys(to).length === 0) return out;
      await withBrowserSession(async (browser) => {
        const deps = {
          evalXPaths: (html: string, xps: string[]) => browser.setContentEvaluate<XPathProbeResult>(html, buildXPathProbeScript(xps)),
          runDomSearch: (html: string, needles: DomNeedle[], pageUrl: string) => browser.setContentEvaluate<DomHit[]>(html, buildDomSearchScript(needles, pageUrl)),
        };
        for (const field of carried) {
          const { value: expected, mark } = pageOne(field.key);
          const r = await transferMarks({ field, from: { url: input.fromUrl, capture: from.capture, expected, mark }, to }, deps);
          for (const u of input.toUrls) if (out[u]) out[u]!.fields[field.key] = r[u] ?? null;
        }
      });
      return out;
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
      await sourceInOrg(ctx, input.sourceId);
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
      await sourceInOrg(ctx, input.sourceId);
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
    .input(z.object({ sourceId: z.string().uuid(), onlyKeys: z.array(z.string()).optional() }))
    .query(async ({ ctx, input }) => {
      await sourceInOrg(ctx, input.sourceId);
      const source = await ctx.db.query.sources.findFirst({
        where: eq(sources.id, input.sourceId),
        columns: { schemaDefinition: true, verificationSet: true },
      });
      if (!source) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Source ${input.sourceId} not found` });
      }
      const allKeys = Array.isArray(source.schemaDefinition) ? (source.schemaDefinition as SchemaDefinitionField[]).map((f) => f.key) : [];
      const estimateKeys = input.onlyKeys ? input.onlyKeys.filter((k) => allKeys.includes(k)) : allKeys;
      const fields = estimateKeys.length;
      const aiAvailable = !!process.env.ANTHROPIC_API_KEY;

      // Fresh captures make a re-verify free of browser time and, when no
      // field needs AI, free of money too (spec 5.6 re-verify label).
      const urls = (source.verificationSet as VerificationSet | null)?.urls ?? [];
      const last = await ctx.db.query.sourceVerifications.findFirst({
        where: and(eq(sourceVerifications.sourceId, input.sourceId), isNotNull(sourceVerifications.completedAt), isNull(sourceVerifications.errorMessage)),
        orderBy: [desc(sourceVerifications.completedAt)],
        columns: { captures: true, results: true },
      });
      const refs = (last?.captures ?? {}) as Record<string, { captureId?: string; capturedAt?: string }>;
      const capturesFresh = urls.length > 0 && urls.every((url) => {
        const ref = refs[url];
        return !!ref?.captureId && !!ref.capturedAt && Date.now() - Date.parse(ref.capturedAt) < CAPTURE_REUSE_MAX_AGE_MS;
      });

      // A key reaches AI on a re-verify when its latest clean result has no
      // certified path, OR when its pages or expected values changed since
      // (its stored hash no longer matches): a field with a certified path
      // from pages 1–3 may still need AI on a newly added page four, and a
      // label reading "free" for it would be a lie (spec 2026-09-17 §6).
      const lastResults = (last?.results ?? {}) as Record<string, { certified?: unknown[]; fieldHash?: string }>;
      const definition = Array.isArray(source.schemaDefinition) ? (source.schemaDefinition as SchemaDefinitionField[]) : [];
      const set = source.verificationSet as VerificationSet | null;
      const aiFields = estimateKeys.filter((k) => {
        const r = lastResults[k];
        if ((r?.certified?.length ?? 0) === 0) return true;
        const f = definition.find((d) => d.key === k);
        return !!f && !!set && r!.fieldHash !== fieldHash(f, set);
      }).length;

      return {
        fields,
        aiFields,
        perFieldUsd: EST_AI_COST_PER_FIELD_USD,
        upperBoundUsd: aiAvailable ? aiFields * EST_AI_COST_PER_FIELD_USD : 0,
        aiAvailable,
        capturesFresh,
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
      await sourceInOrg(ctx, input.sourceId);
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
   * Poll a Source's latest verification run. Currency (spec 4.4) is decided
   * per field, at read time: `loadFieldCurrency` compares each stored
   * result's `fieldHash` against the present `fieldHash(field, set)` on the
   * latest completed, error-free run, and `current` here is true only when
   * every contract field is current. `definitionHash` still rides on each
   * row, but only for history — nothing reads it to decide currency.
   * Editing the binding (`updateBinding`) or the contract never touches past
   * rows, so a hash mismatch (not a stored flag) is what tells the
   * dashboard a field moved on since this run.
   *
   * `_stage` (written by `runSourceVerification`'s `onProgress`) is a
   * reserved key inside the `captures` jsonb column, not a real capture
   * ref — surfaced here as `stage` and stripped from the `captures` map so
   * callers never mistake it for one.
   */
  verificationStatus: publicProcedure
    .input(z.object({ sourceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await sourceInOrg(ctx, input.sourceId);
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
