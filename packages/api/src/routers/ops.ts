import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { and, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { datasets, orgs, projects, runs, sessions, sourceVerifications, sources, staffActions, users, type Database } from '@robot/db';
import { lookupDomainCache, type FieldPathSet, type FieldVerification, type SchemaDefinitionField, type VerificationSet } from '@robot/scraper';
import { router, publicProcedure, protectedProcedure, opsProcedure } from '../trpc.js';
import { isCustomerSchema } from '../crawl/effective-schema.js';
import { loadFieldCurrency, loadFieldCurrencyBatch } from '../verify/current-certification.js';
import { latestDriftCheck } from '../verify/run-drift-check.js';
import { opsRefreshes } from '../verify/attention.js';
import { recordStaffAction, recordStaffStop } from '../auth/staff-actions.js';
import { networkOf } from '../proxy/browser-profile.js';
import { listStaffActivity } from '../auth/staff-activity.js';
import { queueEmailsSafely } from '../email/queue-emails.js';
import type { JevAgreement } from '../verify/jev-agreement.js';
import { monthBounds } from './usage.js';
import { NO_USAGE, usageByOrg, websitesByOrg } from '../metering/org-usage.js';
import { capStateOf, effectiveCap, percentUsed } from '../metering/cap-state.js';
import { jobQueueName } from '../jobs/queue.js';
import { queueOverview } from '../monitoring/queue-view.js';

/** The host for the quiet mono line under a website's name. Never throws: a
 * Source's `urlTemplate` is free text, and a malformed one just reads as no
 * host rather than failing the whole overview. */
function safeHost(url: string | null): string {
  if (!url) return '';
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/** `YYYY-MM` for "this month", in UTC — the same grain `usage.byProject` takes as input. */
function currentMonthKey(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

type LastRun = { status: string; createdAt: Date; resultCount: number | null };

/** The latest run per source, in one query (`selectDistinctOn`, the same shape `projects.get` reads `runs` with). */
async function lastRunsBySource(db: Database, sourceIds: string[]): Promise<Map<string, LastRun>> {
  if (sourceIds.length === 0) return new Map();
  const rows = await db
    .selectDistinctOn([runs.sourceId], { sourceId: runs.sourceId, status: runs.status, createdAt: runs.createdAt, resultCount: runs.resultCount })
    .from(runs)
    .where(inArray(runs.sourceId, sourceIds))
    .orderBy(runs.sourceId, desc(runs.createdAt), desc(runs.id));
  const out = new Map<string, LastRun>();
  for (const r of rows) {
    if (r.sourceId) out.set(r.sourceId, { status: r.status, createdAt: r.createdAt, resultCount: r.resultCount });
  }
  return out;
}

/**
 * What each website spent this month — the same two tables and rule
 * `usage.byProject` uses (`source_verifications.cost_usd` by the
 * verification's `started_at`, plus `runs.cost_usd` by the run's
 * `created_at`), grouped by source instead of by project.
 */
async function spendThisMonthBySource(db: Database, sourceIds: string[]): Promise<Map<string, number>> {
  if (sourceIds.length === 0) return new Map();
  const { start, end } = monthBounds(currentMonthKey(new Date()));

  const verificationSpend = await db
    .select({ sourceId: sourceVerifications.sourceId, usd: sql<string>`coalesce(sum(${sourceVerifications.costUsd}), 0)` })
    .from(sourceVerifications)
    .where(and(inArray(sourceVerifications.sourceId, sourceIds), gte(sourceVerifications.startedAt, start), lt(sourceVerifications.startedAt, end)))
    .groupBy(sourceVerifications.sourceId);

  const runSpend = await db
    .select({ sourceId: runs.sourceId, usd: sql<string>`coalesce(sum(${runs.costUsd}), 0)` })
    .from(runs)
    .where(and(inArray(runs.sourceId, sourceIds), gte(runs.createdAt, start), lt(runs.createdAt, end)))
    .groupBy(runs.sourceId);

  const spend = new Map<string, number>();
  for (const r of [...verificationSpend, ...runSpend]) {
    if (!r.sourceId) continue;
    spend.set(r.sourceId, (spend.get(r.sourceId) ?? 0) + Number(r.usd));
  }
  // Four decimals in the column, four decimals out — same rounding `usage.byProject` applies,
  // so summing two tables' floats never turns 0.03 + 0.02 into 0.049999….
  const round = (n: number) => Math.round(n * 10_000) / 10_000;
  for (const [id, usd] of spend) spend.set(id, round(usd));
  return spend;
}

/**
 * Operators (ops mode, 2026-10-06): staff who answer "which customer websites
 * need us, and why?" from their own shell, read-only except for `enterOrg` and
 * `leaveOrg` (staff access, spec 2026-10-07 §2.2), which touch only the
 * caller's own session and the staff activity log — never a customer's data.
 * `me` is the one public entry point the app's shell needs before it can
 * decide what to show — it never throws for a signed-out visitor, it just says no.
 */
export const opsRouter = router({
  me: publicProcedure.query(({ ctx }) => ({ isOperator: ctx.isOperator })),

  /**
   * Every customer-schema website across every org (plan "Ops design", Global
   * Constraints), one row per website, for the overview table. The operator's
   * own org memberships never scope this — ops answers for every customer,
   * not only the ones the operator happens to belong to (Review Focus 2).
   * Legacy (non-customer-schema) sources are left out (`isCustomerSchema`).
   *
   * Batched: one query for the sources+project+org join, one batched field-
   * currency read (`loadFieldCurrencyBatch`), one batched last-run read and
   * one batched spend read — never a per-source loop beyond those batches.
   */
  websites: opsProcedure.query(async ({ ctx }) => {
    const db = ctx.db;
    const siteRows = await db
      .select({
        sourceId: sources.id,
        sourceName: sources.name,
        sourceSlug: sources.slug,
        url: sources.urlTemplate,
        schemaDefinition: sources.schemaDefinition,
        verificationSet: sources.verificationSet,
        driftedFields: sources.driftedFields,
        orgId: orgs.id,
        orgName: orgs.name,
        orgSlug: orgs.slug,
        projectName: projects.name,
        projectSlug: projects.slug,
      })
      .from(sources)
      .innerJoin(datasets, eq(sources.datasetId, datasets.id))
      .innerJoin(projects, eq(datasets.projectId, projects.id))
      .innerJoin(orgs, eq(projects.orgId, orgs.id));

    const customerRows = siteRows.filter((r) => isCustomerSchema({ schemaDefinition: r.schemaDefinition }));
    if (customerRows.length === 0) return [];

    const sourceIds = customerRows.map((r) => r.sourceId);
    const [currencyBySource, lastRunBySource, spendBySource] = await Promise.all([
      loadFieldCurrencyBatch(db, customerRows.map((r) => ({ id: r.sourceId, schemaDefinition: r.schemaDefinition, verificationSet: r.verificationSet }))),
      lastRunsBySource(db, sourceIds),
      spendThisMonthBySource(db, sourceIds),
    ]);

    return customerRows.map((r) => {
      const fields = r.schemaDefinition as SchemaDefinitionField[];
      const driftedKeys = Array.isArray(r.driftedFields) ? (r.driftedFields as string[]) : [];
      const lastRun = lastRunBySource.get(r.sourceId) ?? null;

      return {
        sourceId: r.sourceId,
        org: { id: r.orgId, name: r.orgName, slug: r.orgSlug },
        project: { name: r.projectName, slug: r.projectSlug },
        website: { name: r.sourceName, slug: r.sourceSlug, host: safeHost(r.url) },
        fields: fields.length,
        currentFields: currencyBySource.get(r.sourceId)?.currentKeys.length ?? 0,
        // Spec 2026-10-21 §6: "{c} of {n} fields · {h} held".
        held: currencyBySource.get(r.sourceId)?.heldKeys.length ?? 0,
        drifted: driftedKeys.length,
        driftedFieldNames: driftedKeys.map((key) => fields.find((f) => f.key === key)?.name ?? key),
        lastRun: lastRun ? { status: lastRun.status, at: lastRun.createdAt.toISOString(), rows: lastRun.resultCount } : null,
        spentThisMonthUsd: spendBySource.get(r.sourceId) ?? 0,
      };
    });
  }),

  /**
   * One website's approved paths, readable (plan "Ops design"): every
   * contract field, with its own latest result's certified paths in try
   * order, named with the customer's own field name — never the internal
   * concept — and each path's real run hit rate from the domain store.
   * Never "cache" in the output: the store is "approved paths" wording
   * lives in the app.
   *
   * Reviewer fix round 1 (critical): a field's paths used to come from
   * `loadCurrentCertification`, whose `cert` is null unless EVERY contract
   * field is current (spec 4.4) — a website with even one unverified field
   * showed NOTHING approved for any field, including ones that were
   * perfectly current. Each field now reads its own latest result directly
   * from `loadFieldCurrency`'s one run, independent of every other field:
   * `state: 'current'` (passed, hash matches — in `currentKeys`), `'changed'`
   * (a result exists and its hash no longer matches — the field, its proof
   * pages or its expected values changed since that result ran), `'failed'`
   * (a result exists, its hash still matches, but it didn't pass — final
   * review M6, labelled "Didn't pass verification" rather than "Changed
   * since verified") with its stale paths still shown and flagged, or
   * `'none'` (no result at all — "Not verified yet").
   */
  website: opsProcedure.input(z.object({ sourceId: z.string().uuid() })).query(async ({ ctx, input }) => {
    const db = ctx.db;
    const [row] = await db
      .select({
        sourceId: sources.id,
        sourceName: sources.name,
        sourceSlug: sources.slug,
        url: sources.urlTemplate,
        schemaDefinition: sources.schemaDefinition,
        verificationSet: sources.verificationSet,
        driftedFields: sources.driftedFields,
        proxyUrl: sources.proxyUrl,
        country: sources.country,
        orgId: orgs.id,
        orgName: orgs.name,
        orgSlug: orgs.slug,
        projectName: projects.name,
        projectSlug: projects.slug,
      })
      .from(sources)
      .innerJoin(datasets, eq(sources.datasetId, datasets.id))
      .innerJoin(projects, eq(datasets.projectId, projects.id))
      .innerJoin(orgs, eq(projects.orgId, orgs.id))
      .where(eq(sources.id, input.sourceId))
      .limit(1);

    if (!row || !isCustomerSchema({ schemaDefinition: row.schemaDefinition })) {
      throw new TRPCError({ code: 'NOT_FOUND', message: `Website ${input.sourceId} is not in ops` });
    }

    const fields = row.schemaDefinition as SchemaDefinitionField[];
    const [fieldCurrency, lastRunBySource, drift, refreshes] = await Promise.all([
      // The one read every field's state, paths and the strip's "Verified"
      // count (plan "Ops design": "as in the table") all come from — partial
      // counts allowed, never an all-or-nothing gate.
      loadFieldCurrency(db, row.sourceId),
      lastRunsBySource(db, [row.sourceId]),
      latestDriftCheck(row.sourceId),
      opsRefreshes(db, row.sourceId),
    ]);
    const results = (fieldCurrency.latest?.results ?? {}) as Record<string, FieldVerification>;
    // Jev at Verify, in shadow (spec 2026-10-16 §7, §8): the same verification row's agreement, per field.
    const agreementRow = fieldCurrency.latest
      ? await db.query.sourceVerifications.findFirst({ where: eq(sourceVerifications.id, fieldCurrency.latest.id), columns: { verifyAgreement: true } })
      : null;
    const agreement = (agreementRow?.verifyAgreement ?? null) as JevAgreement | null;

    // Hostname for the domain store's stats: `verificationSet.urls[0]`
    // directly (same derivation `loadCertificationState` uses for the
    // whole-site cert), never gated on every field being current — a
    // partially verified website still has proof pages, and its current
    // fields' stats must still surface (reviewer fix round 1).
    const hostname = safeHost((row.verificationSet as { urls?: string[] } | null)?.urls?.[0] ?? null);
    // One read of the domain store for the whole page — never one per path
    // (M3's hostname is the only key a verified-path stat is ever booked
    // under, so there is exactly one row to read, whatever the field count).
    const domainCache = hostname ? await lookupDomainCache(hostname, 'detail') : null;
    const fieldPaths = (domainCache?.fieldPaths ?? {}) as Record<string, FieldPathSet>;

    const driftedKeys = Array.isArray(row.driftedFields) ? (row.driftedFields as string[]) : [];
    const lastRun = lastRunBySource.get(row.sourceId) ?? null;
    const set = row.verificationSet as VerificationSet | null;

    return {
      sourceId: row.sourceId,
      org: { id: row.orgId, name: row.orgName, slug: row.orgSlug },
      project: { name: row.projectName, slug: row.projectSlug },
      website: { name: row.sourceName, slug: row.sourceSlug, host: safeHost(row.url) },
      // Spec 2026-10-24 proxy §2.3: own, the default or none, and the country — never the address.
      network: ((n) => ({ proxy: n.proxy, country: n.country ? { code: n.country, name: n.countryName! } : null }))(networkOf({ proxyUrl: row.proxyUrl, country: row.country })),
      verified: { current: fieldCurrency.currentKeys.length, total: fields.length },
      fields: fields.map((f) => {
        const result = results[f.key];
        // Final review M6: 'changed' used to cover two different situations —
        // the field, a proof page or an expected value changed since the
        // verification ran (the stored result's fieldHash no longer matches),
        // and the binding is untouched but the result simply failed on this
        // run. `unchangedKeys` (same fieldHash, pass or fail) is what tells
        // them apart: a result present but NOT in it is a true hash mismatch
        // ('changed'); a result present and IN it, but not in `currentKeys`
        // (which requires every cell to pass), failed without the binding
        // moving ('failed'). The app labels them "Changed since verified"
        // and "Didn't pass verification" respectively.
        // Spec 2026-10-21 §6: a field the latest Verify did not pass, read from its hold — runs use the hold's paths, so they are the ones shown.
        const hold = fieldCurrency.held[f.key];
        const state: 'current' | 'held' | 'changed' | 'failed' | 'none' = fieldCurrency.currentKeys.includes(f.key)
          ? 'current'
          : hold
            ? 'held'
            : result
              ? (fieldCurrency.unchangedKeys.includes(f.key) ? 'failed' : 'changed')
              : 'none';
        const certified = hold ? hold.result.certified : result?.certified ?? [];
        const stats = fieldPaths[f.concept]?.paths ?? [];
        const def = (set?.defaults?.[f.key] ?? '').trim();
        return {
          key: f.key,
          name: f.name,
          type: f.type,
          state,
          ...(hold ? { heldSince: hold.verifiedAt.toISOString() } : {}),
          ...(def ? { defaultValue: def } : {}),
          ...(result?.defaultOnly ? { defaultOnly: true as const } : {}),
          ...(result?.notOnWebsite ? { notOnWebsite: true as const } : {}),
          // "Jev agreed on 5 of 6 proof pages": absent when Jev was never asked about this field.
          ...((): { jevAgreement?: { agreed: number; asked: number } } => {
            if (!agreement) return {};
            const cells = Object.values(agreement.pages).map((p) => p.fields[f.key]).filter((c): c is NonNullable<typeof c> => !!c);
            return cells.length ? { jevAgreement: { agreed: cells.filter((c) => c.agree).length, asked: cells.length } } : {};
          })(),
          paths: certified.map((p) => {
            // A verified stat's identity is (origin, path) — `sameVerified` in
            // domain-cache.ts, matched here by source + path alone (Review
            // Focus 3: a pruned or never-run path just has no match, never an error).
            const stat = stats.find((s) => s.source === 'verified' && s.origin === p.source && s.path === p.path);
            // Spec 2026-10-20 one-source §3.5: certify names the response each
            // API path reads (`container`). `stat.lastUrl` is the product
            // *page* the path last hit on and is never used for it (final
            // review I2). A result certified before the change has none, and
            // `oneSourceWarning` reads that as one shared response.
            return {
              source: p.source,
              path: p.path,
              ...(p.provenOn ? { provenOn: p.provenOn } : {}),
              ...(p.container ? { container: p.container } : {}),
              uses: (stat?.hits ?? 0) + (stat?.misses ?? 0),
              hits: stat?.hits ?? 0,
            };
          }),
        };
      }),
      drift: drift ? { status: drift.status, results: drift.results } : null,
      driftedFieldNames: driftedKeys.map((key) => fields.find((f) => f.key === key)?.name ?? key),
      driftRunAt: drift?.runAt ? drift.runAt.toISOString() : null,
      lastRun: lastRun ? { status: lastRun.status, at: lastRun.createdAt.toISOString(), rows: lastRun.resultCount } : null,
      proofUrls: (row.verificationSet as { urls?: string[] } | null)?.urls ?? [],
      // Spec 2026-10-21 §6: every automatic update, newest first, named with the customer's field name.
      refreshes: refreshes.map((r) => ({ at: r.at.toISOString(), key: r.key, name: fields.find((f) => f.key === r.key)?.name ?? r.key, pages: r.pages })),
    };
  }),

  /**
   * Staff access (spec 2026-10-07 §2.2): the caller's own session enters the website's organisation.
   * Re-entering the org the session is already in changes nothing — not the log, and not the
   * 8 hours, which only a fresh entry restarts. Otherwise one transaction closes any open or
   * expired entry elsewhere, moves the session and logs the start, so the log never shows two
   * open entries and never a start without its session.
   */
  enterOrg: opsProcedure.input(z.object({ sourceId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const [row] = await ctx.db
      .select({ orgId: projects.orgId, orgName: orgs.name, projectId: projects.id, projectSlug: projects.slug, siteSlug: sources.slug })
      .from(sources)
      .innerJoin(datasets, eq(sources.datasetId, datasets.id))
      .innerJoin(projects, eq(datasets.projectId, projects.id))
      .innerJoin(orgs, eq(projects.orgId, orgs.id))
      .where(eq(sources.id, input.sourceId))
      .limit(1);
    if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Website not found' });
    const out = { path: `/projects/${row.projectSlug}/sites/${row.siteSlug}`, orgName: row.orgName };
    if (ctx.session.staff?.orgId === row.orgId) return out;
    const actor = { userId: ctx.session.user.id, actorEmail: ctx.session.user.email, action: 'ops.leaveOrg' };
    await ctx.db.transaction(async (tx) => {
      if (ctx.session.staff) {
        await recordStaffStop(tx, { ...actor, orgId: ctx.session.staff.orgId, summary: 'Stopped working as staff' });
      } else if (ctx.session.staffExpired) {
        await recordStaffStop(tx, { ...actor, orgId: ctx.session.staffExpired.orgId, summary: 'Staff session ended after 8 hours' });
      }
      await tx.update(sessions).set({ staffOrgId: row.orgId, staffEnteredAt: new Date() }).where(eq(sessions.token, ctx.session.token));
      const { id: staffActionId } = await recordStaffAction(tx, { orgId: row.orgId, userId: ctx.session.user.id, actorEmail: ctx.session.user.email, action: 'ops.enterOrg', summary: 'Started working as staff', projectId: row.projectId, sourceId: input.sourceId });
      // Spec 2026-10-24 email §3.1, §4.5: the org's owners and admins hear that our team is working there — never the
      // operator. In this transaction; a queueing failure is its own savepoint and never refuses the entry.
      await queueEmailsSafely(tx, { kind: 'staff-access', staffActionId, orgId: row.orgId, actorUserId: ctx.session.user.id, sourceId: input.sourceId });
    });
    return out;
  }),

  /** Any signed-in session with staff columns set may leave — also after the 8 hours, which logs the expiry. */
  leaveOrg: protectedProcedure.mutation(async ({ ctx }) => {
    const raw = await ctx.db.query.sessions.findFirst({ where: eq(sessions.token, ctx.session.token), columns: { staffOrgId: true } });
    if (raw?.staffOrgId) {
      const staffOrgId = raw.staffOrgId;
      const summary = ctx.session.staff ? 'Stopped working as staff' : ctx.session.staffExpired ? 'Staff session ended after 8 hours' : null;
      await ctx.db.transaction(async (tx) => {
        await tx.update(sessions).set({ staffOrgId: null, staffEnteredAt: null }).where(eq(sessions.token, ctx.session.token));
        if (summary) await recordStaffStop(tx, { orgId: staffOrgId, userId: ctx.session.user.id, actorEmail: ctx.session.user.email, action: 'ops.leaveOrg', summary });
      });
    }
    return { ok: true as const };
  }),

  /** Reading the staff activity log (spec 2026-10-07 §2.4): every org, filterable by customer, staff member or website. */
  staffActivity: opsProcedure
    .input(z.object({
      orgId: z.string().uuid().optional(), userId: z.string().uuid().optional(), sourceId: z.string().uuid().optional(),
      page: z.number().int().min(0).default(0), pageSize: z.number().int().min(1).max(50).default(50),
    }))
    .query(({ ctx, input }) => listStaffActivity(ctx.db, input, { offset: input.page * input.pageSize, limit: input.pageSize })),

  /** The distinct orgs and staff actors that appear in the log, for the ops filters. */
  staffActivityFilters: opsProcedure.query(async ({ ctx }) => {
    const customers = await ctx.db.selectDistinct({ id: orgs.id, name: orgs.name }).from(staffActions).innerJoin(orgs, eq(staffActions.orgId, orgs.id)).orderBy(orgs.name);
    const staff = await ctx.db.selectDistinct({ userId: staffActions.userId, email: staffActions.actorEmail, name: users.name })
      .from(staffActions).leftJoin(users, eq(staffActions.userId, users.id)).orderBy(staffActions.actorEmail);
    return { customers, staff };
  }),

  /**
   * Organisations (spec 2026-10-24 metering §2.4): one row per org — its websites, the month's pages, runs and AI
   * spend, its effective monthly AI limit ("default" when it is ORG_AI_CAP_USD's), % used, and Jev spend (never against
   * the limit). A past month's % is against the limit as it stands now. Highest % first; no limit last. `orgId`
   * narrows it to one org (the staff Settings panel). Batched: the usage queries group every org at once (unscoped
   * when no `orgId` is given, so no id list grows with the org count), plus one website count.
   */
  orgs: opsProcedure
    .input(z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'YYYY-MM').optional(), orgId: z.string().uuid().optional() }).default({}))
    .query(async ({ ctx, input }) => {
      const month = input.month ?? currentMonthKey(new Date());
      const list = await ctx.db.select({ id: orgs.id, name: orgs.name, slug: orgs.slug, aiCapUsd: orgs.aiCapUsd })
        .from(orgs).where(input.orgId ? eq(orgs.id, input.orgId) : undefined);
      const ids = list.map((o) => o.id);
      const [usage, sites] = await Promise.all([
        usageByOrg(ctx.db, month, input.orgId ? ids : undefined),
        websitesByOrg(ctx.db, ids),
      ]);
      const rows = list.map((o) => {
        const setting = effectiveCap(o.aiCapUsd);
        const used = usage.get(o.id) ?? NO_USAGE;
        const state = capStateOf(setting.capUsd, used.aiUsd);
        return {
          org: { id: o.id, name: o.name, slug: o.slug },
          websites: sites.get(o.id) ?? 0,
          pages: used.pages, runs: used.runs, aiUsd: used.aiUsd, jevUsd: used.jevUsd,
          capUsd: setting.capUsd, capIsDefault: setting.isDefault, ownCapUsd: setting.ownCapUsd, defaultCapUsd: setting.defaultCapUsd,
          remainingUsd: state.remainingUsd, reached: state.reached, percentUsed: percentUsed(setting.capUsd, used.aiUsd),
        };
      });
      rows.sort((a, b) => (b.percentUsed ?? -1) - (a.percentUsed ?? -1) || a.org.name.localeCompare(b.org.name));
      return { month, rows };
    }),

  /**
   * The queue (spec 2026-10-25 monitoring §2.5): every worker's heartbeat, this api-server's JOB_QUEUE by type and
   * status, what needs attention (the watchdog's backlog / silent / dead-worker) and the last 20 failures, redacted.
   * Read-only; refreshed by the app every 15 s.
   */
  queue: opsProcedure.query(() => queueOverview(jobQueueName())),
});
