import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { eq, and, desc, sql, isNotNull, isNull, inArray, type SQL } from 'drizzle-orm';
import { sources, datasets, projects, inputSets, sourceVerifications, captures, jevReadings, type Database } from '@robot/db';
import {
  VERIFY_STALL_MS, estAiCostPerFieldUsd, CAPTURE_REUSE_MAX_AGE_MS, VERIFY_URL_MAX, fieldHash, isNotOnWebsite,
  suggestMarks, pageTextOf, visibleTextFromHtml,
  resolveVariantList, suggestEntryValues, normalizeVariantLink, normalizeVariantLinks,
  type SchemaDefinitionField, type VerificationSet, type Box, type VariantVerification,
} from '@robot/scraper';
import { BROWSER_UNAVAILABLE } from '@robot/browser';
import { router, protectedProcedure } from '../trpc';
import { slugify, uniqueSlug } from '../slug.js';
import { resolveOrg } from '../auth/session.js';
import { sourceInOrg, captureInOrg } from '../auth/scope.js';
import { planViaWorker } from '../crawl/plan-via-worker.js';
import { runAndWait, urlKey } from '../jobs/enqueue.js';
import { JobUnavailableError } from '../jobs/errors.js';
import type { transferMarksNow, detectVariantsNow, variantLinksNearNow } from '../jobs/handlers/interactive.js';
import { httpUrl } from '../verify/http-url.js';
import { bindingInput, prepareBinding, bindingProblemList, host, markInput, confirmedPathInput } from '../verify/binding-input.js';
import { refuseVerify, refusalProblems } from '../verify/verify-refusal.js';
import { contractFields, contractAxes, bindingFor, type VariantSetup } from '../contract.js';
import { entryFieldsFor } from '../verify/variant-fields.js';
import { unreadListingPage, type ListingPageCheck } from '../verify/find-product-pages.js';
import { reachabilityResult, type Reachability } from '../verify/reachability.js';
import { sourceDefinitionHash, loadFieldCurrency, loadVariantCurrency, notOnWebsiteKeys, loadCertificationState, runnableOf } from '../verify/current-certification.js';
import { customerDriftResults, forCustomer, latestRefreshes, needsAttention, websiteAttention } from '../verify/attention.js';
import { variantsRequired } from '../verify/variant-check.js';
import { isJobLive } from '../jobs/queue.js';
import { startProofPageCapture, loadProofPageCaptures, latestProofPageCaptures, resolveStalledProofPage, type ProofPageMeta } from '../verify/proof-page-capture.js';
import { readCaptureFile } from '../verify/capture-store.js';
import { resolveInFlightVerification, startVerificationRow } from '../verify/in-flight.js';
import { runFailure } from '../verify/run-failure.js';
import type { JevAnswers } from '../verify/jev-reading.js';
import { nextRunAt, parseSchedule, type Schedule, type ScheduleLast } from '../recurring/schedule.js';
import { checkWebhookUrl, webhookPrivateAllowed } from '../delivery/webhook-url.js';
import { newWebhookSecret } from '../delivery/signing.js';

/**
 * A reading still `running` this long after its row was written is reported
 * `failed` (read-time only, nothing written): its process died mid-reading (an
 * api-server restart), and a reading that never ends must not keep the tab polling.
 */
export const JEV_STUCK_MS = 2 * 60_000;
import { startDriftCheck, latestDriftCheck, latestDriftedRun } from '../verify/run-drift-check.js';
import { latestCoverageCheck } from '../verify/run-coverage-check.js';
import { requireCertification } from '../crawl/require-certification.js';
import { createAxis, lockDatasetSchema, lockSources } from './datasets.js';
import { syncAttentionSafely } from '../email/attention-sync.js';

/** An awaited job with no answer is a browser that could not start (the copy a crash showed before). */
async function unavailableAsError<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof JobUnavailableError) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: BROWSER_UNAVAILABLE });
    throw err;
  }
}

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

/** What the customer confirmed about a product's variants on one proof page (types.ts VariantAnswer, spec 2026-10-01 §3). */
const variantAnswerInput = z.object({
  count: z.number().int().min(0).max(500),
  labels: z.array(z.string().max(200)).max(500),
  list: z.object({ source: z.enum(['json-ld', 'api']), path: z.string().min(1).max(300) }).optional(),
  links: z.array(z.string().url()).max(500).optional(),
  spot: z.object({
    index: z.number().int().min(0),
    url: z.string().url().optional(),
    expected: z.record(z.string(), z.string().max(2000)),
    paths: z.record(z.string(), z.string().max(300)).optional(),
    fromProduct: z.array(z.string()).optional(),
  }).optional(),
});

/**
 * What is wrong with a links-method answer, if anything (variants plan 2 final review M2): a
 * product with variants lists exactly `count` distinct links, and its checked variant page, when
 * given, is one of them and not the product page itself. Links are compared in their one normal
 * form (`normalizeVariantLink`: absolute, no fragment). A missing checked page is not refused
 * here: certification already fails that product closed ("Take the … page's screenshot again").
 */
function linksAnswerProblem(productUrl: string, answer: z.infer<typeof variantAnswerInput>): string | null {
  if (answer.count === 0) return null;
  const links = answer.links ?? [];
  if (links.length !== answer.count || normalizeVariantLinks(links).length !== answer.count) {
    return `The answer lists ${links.length} links for ${answer.count} variants`;
  }
  const spotUrl = answer.spot?.url;
  if (spotUrl !== undefined) {
    const spot = normalizeVariantLink(spotUrl);
    if (!normalizeVariantLinks(links).includes(spot)) return 'The checked variant page is not one of the variant links';
    if (spot === normalizeVariantLink(productUrl)) return 'The checked variant page is the product page itself';
  }
  return null;
}

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

/**
 * The proof page's main heading (spec 2026-10-12 §B1): the first `<h1>` in
 * the capture's HTML, its whole visible text; only when the HTML has no `h1`,
 * the largest of the box map's `h1`/`h2`/`h3` by area; else none. Read from
 * the HTML because a box carries only its element's own text nodes, so an
 * `<h1><span>Widget A</span></h1>` has no `h1` box at all and a split
 * `Super Shock <em>Shadow</em>` box reads "Super Shock" (final review I3).
 */
function headingTextFrom(html: string, boxes: Box[]): string | null {
  // Scripts and styles out first: a template `<script>` can carry an `<h1>` the page never renders.
  const markup = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
  const h1 = /<h1(?:\s[^>]*)?>([\s\S]*?)<\/h1\s*>/i.exec(markup);
  if (h1) return visibleTextFromHtml(h1[1]!).trim();
  let best: Box | null = null;
  for (const b of boxes) {
    if (b.tag !== 'h1' && b.tag !== 'h2' && b.tag !== 'h3') continue;
    if (!best || b.rect.w * b.rect.h > best.rect.w * best.rect.h) best = b;
  }
  return best ? best.text.trim() : null;
}

export const sourcesRouter = router({
  /** The website loader for its page (spec 2026-09-21 §5): the row, its project and the contract, in one round trip. */
  get: protectedProcedure
    .input(z.object({ projectSlug: z.string().min(1), sourceSlug: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const org = resolveOrg(ctx);
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
      const attention = await websiteAttention(ctx.db, s.id);
      return {
        id: s.id, slug: s.slug, name: s.name, url: s.urlTemplate, hostname, datasetId: s.datasetId,
        listingMode: s.listingMode as 'listing_to_detail' | 'detail' | null, confirmedAt: s.confirmedAt, isActive: s.isActive,
        budget: budgetIsUnchosen(s.budget, parameters)
          ? null
          : (s.budget as { max_items: number | 'all'; max_pages: number | 'all'; mode?: 'all' | 'first_n' }),
        parameters,
        schemaDefinition: s.schemaDefinition, verificationSet: s.verificationSet, driftedFields: s.driftedFields as string[] | null,
        // Spec 2026-10-21 §3.5: a held field, a check's finding not refreshed, or a gone proof page — the "Needs attention" badge.
        needsAttention: needsAttention(attention),
        variantSetup: s.variantSetup as VariantSetup | null,
        // Recurring extraction (spec 2026-10-24 §3.5): the Settings tab's Schedule and Webhook rows.
        schedule: s.schedule as Schedule | null, nextRunAt: s.nextRunAt, scheduleLast: s.scheduleLast as ScheduleLast | null,
        webhookUrl: s.webhookUrl, webhookSecret: s.webhookSecret,
        project, fields: contractFields(hit.datasetSchema), createdAt: s.createdAt,
      };
    }),

  update: protectedProcedure
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
        // Spec 2026-10-24 §3.5: the shape here; the customer's sentence comes from parseSchedule / checkWebhookUrl below
        // (a zod refusal would reach the app as JSON).
        schedule: z.object({ days: z.array(z.number()), time: z.string(), timeZone: z.string() }).nullable().optional(),
        webhookUrl: z.string().max(10_000).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await sourceInOrg(ctx, input.id);
      const { id, schedule, webhookUrl, ...rest } = input;

      // Recurring extraction (spec 2026-10-24 §3.5): validated before anything is written; each refusal is one sentence.
      const recurring: { schedule?: Schedule | null; nextRunAt?: Date | null; webhookUrl?: string | null; webhookSecret?: SQL } = {};
      if (schedule !== undefined) {
        if (schedule === null) {
          recurring.schedule = null;
          recurring.nextRunAt = null;
        } else {
          const parsed = parseSchedule(schedule);
          if (!parsed.ok) throw new TRPCError({ code: 'BAD_REQUEST', message: parsed.message });
          recurring.schedule = parsed.schedule;
          recurring.nextRunAt = nextRunAt(parsed.schedule, new Date());
        }
      }
      if (webhookUrl !== undefined) {
        if (webhookUrl === null) {
          // The secret stays: links already sent keep opening.
          recurring.webhookUrl = null;
        } else {
          const checked = checkWebhookUrl(webhookUrl, { allowPrivate: webhookPrivateAllowed() });
          if (!checked.ok) throw new TRPCError({ code: 'BAD_REQUEST', message: checked.message });
          recurring.webhookUrl = checked.url;
          // Made on the first save only.
          recurring.webhookSecret = sql`coalesce(${sources.webhookSecret}, ${newWebhookSecret()})`;
        }
      }

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
        .set({ ...rest, ...parametersPatch, ...recurring, updatedAt: new Date() })
        .where(eq(sources.id, id))
        .returning();

      if (!source) {
        throw new Error(`Source with id ${id} not found`);
      }

      return source;
    }),

  /**
   * A new webhook signing secret (spec 2026-10-24 §3.4): posts are signed with it from now on, and every file link
   * signed with the old one stops opening. Not on the staff deny list — rotating is safe — and logged in staff mode.
   */
  rotateWebhookSecret: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await sourceInOrg(ctx, input.id);
      const [row] = await ctx.db
        .update(sources)
        .set({ webhookSecret: newWebhookSecret(), updatedAt: new Date() })
        .where(eq(sources.id, input.id))
        .returning({ webhookSecret: sources.webhookSecret });
      if (!row?.webhookSecret) throw new TRPCError({ code: 'NOT_FOUND', message: `Website ${input.id} not found` });
      return { webhookSecret: row.webhookSecret };
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
  createInProject: protectedProcedure
    .input(z.object({
      projectSlug: z.string().min(1),
      name: z.string().trim().min(1).max(255),
      url: httpUrl,
    }))
    .mutation(async ({ ctx, input }) => {
      const org = resolveOrg(ctx);
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

  rename: protectedProcedure
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
  setListingPages: protectedProcedure
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
  setProductUrls: protectedProcedure
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
  inputRows: protectedProcedure
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
  updateBinding: protectedProcedure
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

      const updated = await ctx.db.transaction(async (tx) => {
        // Variant answers (plan 2 task 3, Review Focus 1) never travel through `bindingInput` —
        // `prepareBinding` above never emits `variants` — so a concurrent `saveVariantAnswer`
        // committing between this procedure's dispatch and its write must not be silently
        // dropped by this write replacing the whole row. Re-read the row's `variants` under a
        // row lock, right before the write that would otherwise clobber it: a concurrent
        // `saveVariantAnswer` (which takes the same lock) either commits first and is seen
        // here, or blocks on this lock until this transaction commits and then carries forward
        // whatever this write leaves behind. Dropped along with the proof page it answered for
        // (Review Focus 2): only urls still in the new `urls` are kept.
        const [locked] = await tx.select({ verificationSet: sources.verificationSet }).from(sources).where(eq(sources.id, sourceId)).for('update');
        const priorVariants = (locked?.verificationSet as VerificationSet | null)?.variants;
        const variants = priorVariants
          ? Object.fromEntries(Object.entries(priorVariants).filter(([url]) => binding.urls.includes(url)))
          : undefined;
        const verificationSetToWrite: VerificationSet = variants && Object.keys(variants).length > 0 ? { ...verificationSet, variants } : verificationSet;

        const [row] = await tx
          .update(sources)
          .set({ schemaDefinition: fields, verificationSet: verificationSetToWrite, updatedAt: new Date() })
          .where(eq(sources.id, sourceId))
          .returning();

        if (extractOwnsInput) {
          return row;
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

        return row;
      });
      // Spec 2026-10-24 email §3.2: a changed proof page, expected value or mark can release a hold. Never throws.
      await syncAttentionSafely(ctx.db, sourceId);
      return updated;
    }),

  /**
   * The Extract tab's per-row listing check — no AI, nothing saved, one page
   * load: `listingCheckNow` (jobs/handlers/interactive.ts), run in the worker
   * (job `listing-check`, spec 2026-10-23 §4.4), which also keeps the host's
   * backoff after a wall.
   */
  checkListingPage: protectedProcedure
    .input(z.object({ listingUrl: httpUrl }))
    .mutation(async ({ input }): Promise<ListingPageCheck> => {
      try {
        return (await runAndWait('listing-check', { listingUrl: input.listingUrl }, { key: urlKey('listing', input.listingUrl) })) as ListingPageCheck;
      } catch (err) {
        // No answer from the worker reads as a browser that could not start — the answer a crash gave before.
        if (err instanceof JobUnavailableError) return { ...unreadListingPage({ kind: 'crashed' }, input.listingUrl), message: BROWSER_UNAVAILABLE };
        throw err;
      }
    }),

  /**
   * Add website's free reachability line (spec 2026-10-09 §A2): one page
   * load, one tile, no AI, nothing saved: `reachabilityNow`
   * (jobs/handlers/interactive.ts), run in the worker (job `reachability`,
   * spec 2026-10-23 §4.4), which also keeps the host's backoff after a wall.
   */
  reachability: protectedProcedure
    .input(z.object({ url: httpUrl }))
    .query(async ({ input }): Promise<Reachability> => {
      try {
        return (await runAndWait('reachability', { url: input.url }, { key: urlKey('reachability', input.url) })) as Reachability;
      } catch (err) {
        // No answer from the worker reads as a browser that could not start — the answer a crash gave before.
        if (err instanceof JobUnavailableError) return { ...reachabilityResult(input.url, { kind: 'crashed' }, null, 0), message: BROWSER_UNAVAILABLE };
        throw err;
      }
    }),

  /** Start capturing one proof page for marking (spec 2026-09-18 §3.1). Poll `proofPageCapture`. */
  captureProofPage: protectedProcedure
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
  proofPageCapture: protectedProcedure
    .input(z.object({ captureId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await captureInOrg(ctx, input.captureId);
      const row = await ctx.db.query.captures.findFirst({ where: eq(captures.id, input.captureId), columns: { id: true, url: true, metadata: true, jobId: true } });
      const stored = row?.metadata as ProofPageMeta | undefined;
      if (!row || !stored || stored.kind !== 'proof-page') throw new TRPCError({ code: 'NOT_FOUND', message: `Proof-page capture ${input.captureId} not found` });
      // A capture whose work died is reported as the failure it is, never as still running; one waiting in the queue is still capturing.
      const meta = await resolveStalledProofPage(row.id, stored, row.jobId);
      return {
        url: meta.url, status: meta.status,
        tiles: meta.status === 'captured' ? meta.tiles : [],
        boxes: meta.status === 'captured' ? meta.boxes : [],
        pageHeight: meta.status === 'captured' ? meta.pageHeight : 0,
        capturedHeight: meta.status === 'captured' ? meta.capturedHeight : 0,
        contentHeight: meta.status === 'captured' ? meta.contentHeight : 0,
        ...(meta.status === 'failed' ? { error: meta.error, ...(meta.verdict ? { verdict: meta.verdict } : {}) } : {}),
        ...(meta.status === 'captured' ? { capturedAt: meta.capturedAt, ...(meta.title ? { title: meta.title } : {}) } : {}),
      };
    }),

  /** Where each product's capture stands, newest per URL: how a reloaded Verification tab finds the captures it already started. */
  proofPageCaptures: protectedProcedure
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
  suggestMarks: protectedProcedure
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
      return {
        captureId: row.id,
        fields: suggestMarks(capture, meta.boxes, fields),
        headingText: headingTextFrom(capture.html, meta.boxes),
        // The whole text, uncapped: the run-time flag checks the full page, so
        // a cap would warn at Verify on a value the run calls shown (final review I2).
        pageText: pageTextOf(capture.html),
        // Spec 2026-10-14 §6: the Verification tab's row warning compares a proof page's named variant with the certified path's entry.
        pageVariant: capture.pageVariant ?? null,
      };
    }),

  /**
   * Jev at Verify, in shadow (spec 2026-10-16 §6): each capture's reading, keyed by
   * capture id, polled by the tab while one runs. A capture with no reading is absent;
   * `answers` only when `done`. A capture of another website (so of another org) is
   * NOT_FOUND, as `captureInOrg` would say, in one query for the whole list.
   */
  jevReadings: protectedProcedure
    .input(z.object({ sourceId: z.string().uuid(), captureIds: z.array(z.string().uuid()).max(VERIFY_URL_MAX) }))
    .query(async ({ ctx, input }) => {
      await sourceInOrg(ctx, input.sourceId);
      const out: Record<string, { status: 'running' | 'done' | 'failed'; answers: JevAnswers | null }> = {};
      // Shadow is ours to measure, not the customer's to read (Marko, 2026-10-16): only an
      // operator, or a staff session inside the customer's org, ever receives a reading.
      if (!ctx.isOperator && !ctx.session.staff) return out;
      if (input.captureIds.length === 0) return out;
      const owned = await ctx.db.query.captures.findMany({ where: inArray(captures.id, input.captureIds), columns: { id: true, sourceId: true } });
      const foreign = input.captureIds.find((id) => owned.find((c) => c.id === id)?.sourceId !== input.sourceId);
      if (foreign) throw new TRPCError({ code: 'NOT_FOUND', message: `Page capture ${foreign} not found` });
      const rows = await ctx.db.query.jevReadings.findMany({
        where: and(eq(jevReadings.sourceId, input.sourceId), inArray(jevReadings.captureId, input.captureIds)),
        columns: { captureId: true, status: true, answers: true, createdAt: true },
      });
      const stuckBefore = Date.now() - JEV_STUCK_MS;
      for (const r of rows) {
        const stored = r.status as 'running' | 'done' | 'failed';
        const status = stored === 'running' && r.createdAt.getTime() < stuckBefore ? 'failed' : stored;
        out[r.captureId] = { status, answers: status === 'done' ? (r.answers as JevAnswers) : null };
      }
      return out;
    }),

  /**
   * Page 1's paths run on the other proof pages (spec 2026-09-18 §3.4):
   * `transferMarksNow` (jobs/handlers/interactive.ts), run in the worker
   * (job `transfer-marks`, spec 2026-10-23 §4.4).
   */
  transferMarks: protectedProcedure
    .input(z.object({
      sourceId: z.string().uuid(),
      fromUrl: httpUrl,
      toUrls: z.array(httpUrl).min(1).max(VERIFY_URL_MAX),
      // `via`: the structured path the answer on screen was accepted from (spec 2026-09-29 C1): the carry tries it first.
      from: z.record(z.string(), z.object({ value: z.string(), mark: markInput.optional(), via: confirmedPathInput.optional() })).optional(),
      fieldKeys: z.array(z.string()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await sourceInOrg(ctx, input.sourceId);
      return (await unavailableAsError(runAndWait('transfer-marks', input))) as Awaited<ReturnType<typeof transferMarksNow>>;
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
  confirm: protectedProcedure
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

      // Planning runs in the worker (job `plan`, spec 2026-10-23 §4.4); the request waits for it.
      const result = await planViaWorker(ctx.db, source.id, { probe: false });

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
  delete: protectedProcedure
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
  verifyEstimate: protectedProcedure
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
        if (set && isNotOnWebsite(set, k)) return false; // spec 2026-10-17 §2: never searched, never AI
        const r = lastResults[k];
        if ((r?.certified?.length ?? 0) === 0) return true;
        const f = definition.find((d) => d.key === k);
        return !!f && !!set && r!.fieldHash !== fieldHash(f, set);
      }).length;

      const perFieldUsd = estAiCostPerFieldUsd(urls.length);
      return {
        fields,
        aiFields,
        perFieldUsd,
        upperBoundUsd: aiAvailable ? Math.round(aiFields * perFieldUsd * 100) / 100 : 0,
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
  verify: protectedProcedure
    // `free` (spec 2026-10-17 §8, §10 property 9): the address warning's re-verify never calls the AI, for any field in the run.
    .input(z.object({ sourceId: z.string().uuid(), onlyKeys: z.array(z.string()).optional(), free: z.boolean().optional() }))
    .mutation(async ({ ctx, input }) => {
      await sourceInOrg(ctx, input.sourceId);
      const source = await ctx.db.query.sources.findFirst({
        where: eq(sources.id, input.sourceId),
        columns: { id: true, schemaDefinition: true, verificationSet: true, variantSetup: true },
        with: { dataset: { columns: { schema: true, variantMode: true } } },
      });
      if (!source) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Source ${input.sourceId} not found` });
      }
      const hash = sourceDefinitionHash(source);
      if (!hash) {
        throw refuseVerify([{ reason: 'no_fields' }], [`Source ${input.sourceId} has no schema definition to verify`]);
      }

      // Draft saves (the Verification tab's autosave) can leave cells blank, so Verify checks the record itself.
      const set = source.verificationSet as VerificationSet | null;
      const defs = (source.schemaDefinition ?? []) as SchemaDefinitionField[];
      if (set) {
        const problems = bindingProblemList({
          urls: set.urls, ...(set.listing_url ? { listingUrl: set.listing_url } : {}),
          descriptions: Object.fromEntries(defs.map((d) => [d.key, d.description])),
          expected: set.expected, ...(set.marks ? { marks: set.marks } : {}),
          ...(set.absent ? { absent: set.absent } : {}), ...(set.defaults ? { defaults: set.defaults } : {}),
        }, contractFields(source.dataset?.schema));
        if (problems.length) throw refuseVerify(refusalProblems(problems), problems.map((p) => p.text));

        // Variants (spec 2026-10-01): a variants-only run (`onlyKeys: []`) checks nothing but the
        // answers, so it needs one for every product, even "No variants on this product". A run that
        // also verifies fields is never held back by them: an unanswered product fails inside the
        // variant result instead ("product {n} lists {k} {noun} — confirm them").
        if (input.onlyKeys?.length === 0
          && variantsRequired(source.dataset?.variantMode, source.variantSetup as VariantSetup | null) === 'yes'
          && set.urls.some((u) => !set.variants?.[u])) {
          throw refuseVerify([{ reason: 'variants' }], [], 'Confirm the variants of every product first');
        }
      }

      // Under the website row lock (fix wave 1, item 5): a refresh (verify/refresh-values.ts) takes the same
      // lock for its in-flight check and writes, so a Verify and a refresh never interleave. The row's `verify`
      // job is enqueued in that same transaction; the worker runs it (spec 2026-10-23 §4.4).
      const start = await startVerificationRow(ctx.db, input.sourceId, hash, undefined, {
        ...(input.onlyKeys ? { onlyKeys: input.onlyKeys } : {}), ...(input.free ? { free: true } : {}),
      });
      return start.status === 'in-progress' ? start : { verificationId: start.verificationId, status: 'started' as const };
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
   *
   * A newest run that failed or stalled (spec 2026-10-20 §3.3) is not handed
   * back: the newest completed, error-free run is, with `failedRun` naming
   * the failure. `errorMessage` is never in this answer; ops reads it from
   * the row.
   */
  verificationStatus: protectedProcedure
    .input(z.object({ sourceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await sourceInOrg(ctx, input.sourceId);
      const newest = await ctx.db.query.sourceVerifications.findFirst({
        where: eq(sourceVerifications.sourceId, input.sourceId),
        orderBy: [desc(sourceVerifications.startedAt)],
      });
      if (!newest) return null;
      // Spec 2026-10-20 §3.3, §5.3: a run that failed or stalled never replaces the last completed
      // results on screen. The tab gets the newest completed, error-free run and, beside it, the
      // failure; the raw error stays on the row, for ops, and is never in this answer.
      // A row whose job is still queued or running is in flight, however long it has waited (spec 2026-10-23 §4.5).
      const failure = runFailure(newest, Date.now(), await isJobLive(ctx.db, newest.jobId));
      const lastGood = failure
        ? await ctx.db.query.sourceVerifications.findFirst({
            where: and(eq(sourceVerifications.sourceId, input.sourceId), isNotNull(sourceVerifications.completedAt), isNull(sourceVerifications.errorMessage)),
            orderBy: [desc(sourceVerifications.startedAt)],
          })
        : undefined;
      const row = lastGood ?? newest;

      const source = await ctx.db.query.sources.findFirst({
        where: eq(sources.id, input.sourceId),
        columns: { schemaDefinition: true, verificationSet: true },
      });

      const currency = await loadFieldCurrency(ctx.db, input.sourceId);
      const { currentKeys, unchangedKeys } = currency;
      const runnable = runnableOf(await loadCertificationState(ctx.db, input.sourceId));
      const fieldCount = source && Array.isArray(source.schemaDefinition) ? source.schemaDefinition.length : 0;
      const v = await loadVariantCurrency(ctx.db, input.sourceId);
      const variants: null | { required: 'setup-missing' | 'yes'; current: boolean; passed: boolean; result: VariantVerification | null } =
        v.required === 'no' ? null : { required: v.required, current: v.current, passed: v.passed, result: v.result };

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
        // The newest run, when it failed or stalled (spec 2026-10-20 §3.3): the app says so in the Verify bar.
        failedRun: failure ? { id: newest.id, startedAt: newest.startedAt, stalled: failure === 'stalled' } : null,
        currentKeys,
        // Fields whose latest result still matches them, passed or failed: a failure there is real, not stale.
        unchangedKeys,
        // Spec 2026-10-21 §3.1: fields read from their last good result, and when that passed; runnable = every field current or held
        // (and the variants it needs) — `requireCertification`'s rule, so Extract unlocks exactly when a run may start.
        heldKeys: currency.heldKeys,
        held: Object.fromEntries(currency.heldKeys.map((k) => [k, { verifiedAt: currency.held[k]!.verifiedAt }])) as Record<string, { verifiedAt: Date }>,
        runnable,
        // Spec 2026-10-17 §2: fields currently passed as not on this website — the Extract sample's empty-cell note leaves them out.
        notOnWebsiteKeys: notOnWebsiteKeys(currency),
        current: fieldCount > 0 && currentKeys.length === fieldCount,
        // Variants (spec 2026-10-01): null when this website needs none; `current`/`passed` as `loadVariantCurrency` decides them.
        variants,
      };
    }),

  // ─── Drift repair (plan 2026-10-05, Task 2) ─────────────────────────────

  /**
   * Start the free drift check on demand, or get the one already running.
   * It is about the website's latest run that flagged drift (null when none);
   * it re-captures the proof pages and changes nothing but its own row and
   * those captures.
   */
  checkDrift: protectedProcedure
    .input(z.object({ sourceId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await sourceInOrg(ctx, input.sourceId);
      // Spec 2026-10-21 §3.3: an on-demand check is 'manual'; it still reads the drifted fields.
      return startDriftCheck(input.sourceId, await latestDriftedRun(input.sourceId), { trigger: 'manual' });
    }),

  /** The website's latest drift check (null when it never had one), with the date of the run it is about. */
  driftCheck: protectedProcedure
    .input(z.object({ sourceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await sourceInOrg(ctx, input.sourceId);
      const check = await latestDriftCheck(input.sourceId);
      // Why a check did not refresh a field is staff-only (spec 2026-10-21 §6).
      return check ? { ...check, results: customerDriftResults(check.results, ctx.isOperator || !!ctx.session.staff) } : null;
    }),

  /** The website's latest coverage check (spec 2026-10-10 §A5): per field the sampled pages it was empty on, the explanation, the page to offer, and the stage line. Null when it never had one. */
  coverage: protectedProcedure
    .input(z.object({ sourceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await sourceInOrg(ctx, input.sourceId);
      return latestCoverageCheck(input.sourceId);
    }),

  /**
   * What needs the customer on this website (spec 2026-10-21 §3.5), each field's live automatic refresh (§5), and
   * whether it runs. A customer session gets no refresh reason and no path a refresh read; staff get them whole.
   */
  attention: protectedProcedure
    .input(z.object({ sourceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await sourceInOrg(ctx, input.sourceId);
      const [attention, refreshes, state] = await Promise.all([
        websiteAttention(ctx.db, input.sourceId),
        latestRefreshes(ctx.db, input.sourceId),
        loadCertificationState(ctx.db, input.sourceId),
      ]);
      return { ...forCustomer({ ...attention, refreshes }, ctx.isOperator || !!ctx.session.staff), runnable: runnableOf(state) };
    }),

  // ─── Variants (spec 2026-10-01 §3): how a website exposes variants ──────

  /**
   * Inspects this website's proof-page captures for how it exposes variants:
   * `detectVariantsNow` (jobs/handlers/interactive.ts), run in the worker
   * (job `detect-variants`, spec 2026-10-23 §4.4).
   */
  detectVariants: protectedProcedure
    .input(z.object({ sourceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await sourceInOrg(ctx, input.sourceId);
      return (await unavailableAsError(runAndWait('detect-variants', { sourceId: input.sourceId }, { key: `detect-variants:${input.sourceId}` }))) as Awaited<ReturnType<typeof detectVariantsNow>>;
    }),

  /**
   * Confirms how this website exposes variants (spec 2026-10-01 §3): the
   * method the customer picked, plus where each axis the site shows maps to
   * a project axis. An axis entry either names an existing project axis
   * (`axisKey`) or asks for a new one to be minted on the fly
   * (`newAxisName`, via `createAxis` — the same minting `datasets.addAxis`
   * uses) — never both, never neither. `method: 'none'` always stores an
   * empty `axes` list, whatever the caller sent.
   *
   * The axis creation(s) and the `variant_setup` write happen in one
   * transaction, under the SAME locking protocol `deleteAxis` uses
   * (datasets.ts: `lockDatasetSchema` then `lockSources`, always in that
   * order): the dataset's schema row is locked first — `axisKey`s are
   * validated against that locked read, and it is also what `createAxis`
   * re-locks (a no-op re-lock within the same transaction, not a second
   * distinct acquisition) when minting a new axis — then the dataset's
   * source rows are locked the way `deleteAxis` locks them before checking
   * for a mapping to the axis it's about to delete. Taking both locks, in
   * this order, every time (not only when an axis is actually created) means
   * this call and a concurrent `deleteAxis` can never deadlock on each
   * other's locks: one always blocks behind the other instead of racing it.
   */
  setVariantSetup: protectedProcedure
    .input(z.object({
      sourceId: z.string().uuid(),
      method: z.enum(['list', 'links', 'none']),
      axes: z.array(z.object({
        from: z.string().min(1),
        axisKey: z.string().min(1).optional(),
        newAxisName: z.string().trim().min(1).max(100).optional(),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      await sourceInOrg(ctx, input.sourceId);
      const source = await ctx.db.query.sources.findFirst({
        where: eq(sources.id, input.sourceId),
        columns: { id: true, datasetId: true },
      });
      if (!source) throw new TRPCError({ code: 'NOT_FOUND', message: `Website ${input.sourceId} not found` });
      if (!source.datasetId) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: `Website ${input.sourceId} has no project to map axes in` });
      const datasetId = source.datasetId;

      const seenFrom = new Set<string>();
      for (const a of input.axes) {
        const hasKey = a.axisKey !== undefined;
        const hasNew = a.newAxisName !== undefined;
        if (hasKey === hasNew) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: `Axis mapping for "${a.from}" needs exactly one of axisKey or newAxisName` });
        }
        const from = a.from.trim();
        if (seenFrom.has(from)) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: `"${a.from}" is mapped more than once` });
        }
        seenFrom.add(from);
      }

      const variantSetup = await ctx.db.transaction(async (tx) => {
        // Always taken, in this order, even for `method: 'none'` or an empty
        // `axes` list — see the procedure doc comment.
        const schema = await lockDatasetSchema(tx, datasetId);
        const knownKeys = new Set(contractAxes(schema).map((a) => a.key));
        if (input.method !== 'none') {
          for (const a of input.axes) {
            if (a.axisKey !== undefined && !knownKeys.has(a.axisKey)) {
              throw new TRPCError({ code: 'BAD_REQUEST', message: `Axis ${a.axisKey} not found` });
            }
          }
        }
        const locked = await lockSources(tx, datasetId);

        // `from` is stored trimmed (plan 2 keys entry paths on it). Two entries
        // naming the same new column (case-insensitive — e.g. detected `color`
        // and `colour`, both "Colour") create it once and both map to it.
        const axes: Array<{ from: string; axisKey: string }> = [];
        const createdByName = new Map<string, string>();
        if (input.method !== 'none') {
          for (const a of input.axes) {
            const from = a.from.trim();
            if (a.newAxisName !== undefined) {
              const nameKey = a.newAxisName.toLowerCase();
              let axisKey = createdByName.get(nameKey);
              if (axisKey === undefined) {
                axisKey = (await createAxis(tx, datasetId, a.newAxisName)).key;
                createdByName.set(nameKey, axisKey);
              }
              axes.push({ from, axisKey });
            } else {
              axes.push({ from, axisKey: a.axisKey! });
            }
          }
        }

        const setup: VariantSetup = { method: input.method, axes, confirmedAt: new Date().toISOString() };
        // A different method makes the answers given for the old one meaningless (a list answer
        // has no links, a links answer no list): they are dropped here, under the row lock just
        // taken, so the Variants row asks for them again instead of showing them as confirmed.
        // The same method keeps them.
        const row = locked.find((r) => r.id === source.id);
        const previous = (row?.variantSetup as VariantSetup | null | undefined) ?? null;
        const set = (row?.verificationSet as VerificationSet | null | undefined) ?? null;
        const dropAnswers = previous?.method !== input.method && !!set?.variants;
        const { variants: _dropped, ...setWithoutVariants } = set ?? { urls: [], expected: {} };
        await tx
          .update(sources)
          .set({ variantSetup: setup, ...(dropAnswers ? { verificationSet: setWithoutVariants } : {}), updatedAt: new Date() })
          .where(eq(sources.id, source.id));
        return setup;
      });

      return variantSetup;
    }),

  /**
   * Saves what the customer confirmed about one proof page's variants (spec
   * 2026-10-01 §3): sets `verificationSet.variants[url]`, or deletes it when
   * `answer` is null ("No variants on this product" after having had some,
   * or the row being cleared). Row-locked (`SELECT … FOR UPDATE`) the same
   * way `updateBinding`'s carry-forward is, so this and a concurrent fields
   * autosave can never drop each other's write (Review Focus 1) — whichever
   * commits second re-reads the other's result under the lock. `url` must be
   * one of this website's current proof pages; otherwise the answer would
   * outlive the page it was about (Review Focus 2), so this refuses instead
   * of writing an orphan.
   */
  saveVariantAnswer: protectedProcedure
    .input(z.object({ sourceId: z.string().uuid(), url: httpUrl, answer: variantAnswerInput.nullable() }))
    .mutation(async ({ ctx, input }) => {
      await sourceInOrg(ctx, input.sourceId);
      return ctx.db.transaction(async (tx) => {
        const [locked] = await tx
          .select({ verificationSet: sources.verificationSet, variantSetup: sources.variantSetup, datasetId: sources.datasetId })
          .from(sources)
          .where(eq(sources.id, input.sourceId))
          .for('update');
        if (!locked) throw new TRPCError({ code: 'NOT_FOUND', message: `Website ${input.sourceId} not found` });
        const verificationSet = (locked.verificationSet as VerificationSet | null) ?? { urls: [], expected: {} };
        if (!verificationSet.urls.includes(input.url)) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: `That page is not one of this website's products` });
        }
        const setup = locked.variantSetup as VariantSetup | null;
        if (setup?.method === 'links' && input.answer) {
          const problem = linksAnswerProblem(input.url, input.answer);
          if (problem) throw new TRPCError({ code: 'BAD_REQUEST', message: problem });
        }
        // A column (an axis entry field) can never be "from the product page" (Global
        // Constraints, plan 2026-10-02 2b Task 2): it differs per variant by definition.
        const markedFromProduct = input.answer?.spot?.fromProduct;
        if (setup?.method === 'list' && markedFromProduct && markedFromProduct.length > 0) {
          const [ds] = locked.datasetId ? await tx.select({ schema: datasets.schema }).from(datasets).where(eq(datasets.id, locked.datasetId)) : [];
          const fields = entryFieldsFor(ds?.schema, setup);
          const badColumn = fields.find((f) => f.axisFrom !== undefined && markedFromProduct.includes(f.key));
          if (badColumn) throw new TRPCError({ code: 'BAD_REQUEST', message: `${badColumn.name} differs per variant — it must come from the list` });
        }
        const variants = { ...(verificationSet.variants ?? {}) };
        if (input.answer === null) delete variants[input.url];
        else variants[input.url] = input.answer;
        const next: VerificationSet = { ...verificationSet, variants };
        await tx.update(sources).set({ verificationSet: next, updatedAt: new Date() }).where(eq(sources.id, input.sourceId));
        return { variants };
      });
    }),

  /**
   * Lists one product's variants from a confirmed list ref (spec 2026-10-01
   * §3 "list" method step, the Variants row's expand): resolves the ref
   * against the page's fresh proof capture (`resolveVariantList`, same rules
   * certification uses) and suggests a value per entry field
   * (`suggestEntryValues`) for up to the first 50 entries. No browser — the
   * list lives in the page's structured data/intercepted JSON, already on
   * the stored capture. `null` when there is no fresh capture of `url`, or
   * the ref does not resolve to a list on it (the page changed shape, or the
   * customer picked the wrong ref) — the caller re-detects rather than
   * being shown an empty list as if it were real.
   */
  variantList: protectedProcedure
    .input(z.object({ sourceId: z.string().uuid(), url: httpUrl, list: z.object({ source: z.enum(['json-ld', 'api']), path: z.string().min(1).max(300) }) }))
    .query(async ({ ctx, input }) => {
      await sourceInOrg(ctx, input.sourceId);
      const source = await ctx.db.query.sources.findFirst({
        where: eq(sources.id, input.sourceId),
        columns: { id: true, variantSetup: true },
        with: { dataset: { columns: { schema: true } } },
      });
      if (!source) throw new TRPCError({ code: 'NOT_FOUND', message: `Website ${input.sourceId} not found` });

      const captureRecords = await loadProofPageCaptures(input.sourceId, [input.url]);
      const rec = captureRecords[input.url];
      if (!rec) return null;

      const entries = resolveVariantList(rec.capture, input.list);
      if (!entries) return null;

      const fields = entryFieldsFor(source.dataset?.schema, source.variantSetup as VariantSetup | null);
      const axisFields = fields.filter((f) => f.axisFrom !== undefined);
      const limited = entries.slice(0, 50);
      const suggestions = limited.map((entry) => suggestEntryValues(entry, fields, { pageUrl: input.url }));
      const labels = limited.map((entry, i) => {
        if (axisFields.length > 0) {
          const values = axisFields.map((f) => suggestions[i]![f.key]?.value ?? '');
          if (values.some((v) => v !== '')) return values.join('/');
        }
        const skuSuggestion = suggestEntryValues(entry, [{ key: 'sku', name: 'SKU', type: 'text', concept: 'sku' }], { pageUrl: input.url }).sku;
        if (skuSuggestion) return skuSuggestion.value;
        return `Variant ${i + 1}`;
      });

      return { count: entries.length, labels, suggestions };
    }),

  /**
   * Finds the links near an element the customer marks on a proof page's
   * screenshot: `variantLinksNearNow` (jobs/handlers/interactive.ts), run in
   * the worker (job `variant-links-near`, spec 2026-10-23 §4.4).
   */
  variantLinksNear: protectedProcedure
    .input(z.object({ sourceId: z.string().uuid(), url: httpUrl, xpath: z.string().min(1).max(2000) }))
    .query(async ({ ctx, input }) => {
      await sourceInOrg(ctx, input.sourceId);
      return (await unavailableAsError(runAndWait('variant-links-near', input))) as Awaited<ReturnType<typeof variantLinksNearNow>>;
    }),
});
