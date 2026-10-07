// The staff activity log (spec 2026-10-07 §2.4): append-only rows the customer can read.
import { and, desc, eq, sql } from 'drizzle-orm';
import { datasets, projects, runs, sources, staffActions, type Database } from '@robot/db';
import { resolveBudget } from '@robot/scraper';
import type { SessionInfo } from '../trpc.js';
import { contractAxes, contractFields } from '../contract.js';

export type StaffActionRow = {
  orgId: string; userId: string; actorEmail: string; action: string; summary: string;
  projectId?: string | null; sourceId?: string | null; runId?: string | null;
};

/** The database or a transaction on it — `ops.enterOrg` writes its rows in one. */
export type StaffDb = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * `at` is `clock_timestamp()`, not the column's `now()` default: `now()` is the
 * transaction's start, so the "Stopped" and "Started" rows `ops.enterOrg` writes
 * in one transaction would tie and could list in either order.
 */
export async function recordStaffAction(db: StaffDb, row: StaffActionRow): Promise<void> {
  await db.insert(staffActions).values({ ...row, at: sql`clock_timestamp()` });
}

/**
 * Closes a staff visit (final review, 2026-10-07): the "Stopped…" row carries the
 * website and project of the user's most recent "Started working as staff" row in
 * that org, so a website's activity shows both halves of the visit.
 */
export async function recordStaffStop(db: StaffDb, row: Omit<StaffActionRow, 'projectId' | 'sourceId' | 'runId'>): Promise<void> {
  const [start] = await db
    .select({ projectId: staffActions.projectId, sourceId: staffActions.sourceId })
    .from(staffActions)
    .where(and(eq(staffActions.userId, row.userId), eq(staffActions.orgId, row.orgId), eq(staffActions.action, 'ops.enterOrg')))
    .orderBy(desc(staffActions.at))
    .limit(1);
  await recordStaffAction(db, { ...row, projectId: start?.projectId ?? null, sourceId: start?.sourceId ?? null });
}

export type Target = {
  website: { id: string; name: string; projectId: string } | null;
  project: { id: string; name: string } | null;
};
type DescribeArgs = { db: Database; input: any; result: any; before: any; target: Target };
export type StaffAction = {
  before?: (db: Database, input: any) => Promise<unknown>;
  describe: (c: DescribeArgs) => string | Promise<string>;
  runId?: (input: any, result: any) => string | undefined;
  coalesceMinutes?: number;
};

const site = (t: Target) => t.website?.name ?? 'a website';
const proj = (t: Target) => t.project?.name ?? 'a project';
const renamed = (kind: string, from: string | undefined, to: string) => (from ? `Renamed ${kind} ${from} to ${to}` : `Renamed ${kind} to ${to}`);

async function fieldName(db: Database, datasetId: string, key: string): Promise<string | undefined> {
  const ds = await db.query.datasets.findFirst({ where: eq(datasets.id, datasetId), columns: { schema: true } });
  return [...contractFields(ds?.schema), ...contractAxes(ds?.schema)].find((f) => f.key === key)?.name;
}
async function fieldNames(db: Database, sourceId: string): Promise<Record<string, string>> {
  const src = await db.query.sources.findFirst({ where: eq(sources.id, sourceId), columns: { datasetId: true } });
  if (!src?.datasetId) return {};
  const ds = await db.query.datasets.findFirst({ where: eq(datasets.id, src.datasetId), columns: { schema: true } });
  return Object.fromEntries(contractFields(ds?.schema).map((f) => [f.key, f.name]));
}
const VARIANT_MODES: Record<string, string> = { ignore: 'one row per product', row_per_variant: 'one row per variant', nested: 'variants in one row' };

export const STAFF_ACTIONS: Record<string, StaffAction | null> = {
  // ─ Never logged ─
  'auth.signIn': null, // no session yet
  'auth.signOut': null, // logged by the procedure itself, before the session row goes
  'auth.setTheme': null, // the staff member's own account
  'auth.updateName': null, // the staff member's own account
  'auth.switchOrg': null, // deny-listed: never succeeds in staff mode
  'orgs.create': null, // deny-listed
  'orgs.rename': null, // deny-listed
  'orgs.delete': null, // deny-listed
  'orgs.members.setRole': null, // deny-listed
  'orgs.members.remove': null, // deny-listed
  'projects.delete': null, // deny-listed
  'sources.delete': null, // deny-listed
  'datasets.deleteField': null, // deny-listed
  'datasets.deleteAxis': null, // deny-listed
  'ops.enterOrg': null, // writes its own row
  'ops.leaveOrg': null, // writes its own row

  // ─ Runs ─
  'crawl.plan': {
    before: async (db, i) => {
      const src = await db.query.sources.findFirst({ where: eq(sources.id, i.sourceId), columns: { budget: true } });
      const b = resolveBudget(src?.budget);
      return { budget: b.mode === 'all' ? 'all' : b.maxItems };
    },
    describe: ({ input, before, target }) => input.probe
      ? `Tried a sample on ${site(target)}`
      : `Planned an extraction on ${site(target)} (budget ${before?.budget ?? '?'} products)`,
    runId: (_i, r) => r?.runId,
  },
  'crawl.probeAndSample': { describe: ({ target }) => `Ran a sample on ${site(target)}`, runId: (_i, r) => r?.runId },
  'crawl.execute': {
    describe: ({ input, target }) => input.retryFailed ? `Retried the failed pages of a run on ${site(target)}` : `Ran an extraction on ${site(target)}`,
    runId: (i) => i.runId,
  },
  'crawl.cancel': { describe: ({ target }) => `Cancelled a run on ${site(target)}`, runId: (i) => i.runId },
  'crawl.backfill': { describe: ({ target }) => `Filled in missing values on ${site(target)}`, runId: (i, r) => r?.backfillRunId ?? i.runId },

  // ─ Fields (the project's dataset) ─
  'datasets.addField': { describe: ({ input, target }) => `Added field ${input.name} to ${proj(target)}` },
  'datasets.renameField': {
    before: (db, i) => fieldName(db, i.datasetId, i.key).then((name) => ({ name })),
    describe: ({ input, before }) => renamed('field', before?.name, input.name),
  },
  'datasets.retypeField': {
    before: (db, i) => fieldName(db, i.datasetId, i.key).then((name) => ({ name })),
    describe: ({ input, before }) => `Changed field ${before?.name ?? input.key} to ${input.type}`,
  },
  'datasets.setVariantMode': { describe: ({ input, target }) => `Set variants on ${proj(target)} to ${VARIANT_MODES[input.mode] ?? input.mode}` },
  'datasets.setFieldLevel': {
    before: (db, i) => fieldName(db, i.datasetId, i.key).then((name) => ({ name })),
    describe: ({ input, before }) => {
      const f = before?.name ?? input.key;
      return input.level === null ? `Reset where ${f} is read` : `Set ${f} to be read per ${input.level}`;
    },
  },
  'datasets.addAxis': { describe: ({ input }) => `Added variant column ${input.name}` },
  'datasets.renameAxis': {
    before: (db, i) => fieldName(db, i.datasetId, i.key).then((name) => ({ name })),
    describe: ({ input, before }) => renamed('variant column', before?.name, input.name),
  },

  // ─ Projects ─
  'projects.create': { describe: ({ input }) => `Created project ${input.name}` },
  'projects.rename': {
    before: async (db, i) => db.query.projects.findFirst({ where: eq(projects.id, i.projectId), columns: { name: true } }),
    describe: ({ input, before }) => renamed('project', before?.name, input.name),
  },

  // ─ Websites ─
  'sources.createInProject': { describe: ({ input }) => `Added website ${input.name}` },
  'sources.rename': {
    before: async (db, i) => db.query.sources.findFirst({ where: eq(sources.id, i.sourceId), columns: { name: true } }),
    describe: ({ input, before }) => renamed('website', before?.name, input.name),
  },
  'sources.update': { describe: ({ target }) => `Changed ${site(target)}'s settings` },
  'sources.setListingPages': { describe: ({ target }) => `Changed the listing pages of ${site(target)}` },
  'sources.setProductUrls': { describe: ({ input, target }) => `Changed the product list of ${site(target)} (${input.urls.length} URLs)` },
  'sources.updateBinding': { describe: ({ target }) => `Edited the Verification answers on ${site(target)}`, coalesceMinutes: 10 },
  'sources.checkListingPage': { describe: ({ input }) => `Checked listing page ${input.listingUrl}` },
  'sources.captureProofPage': { describe: ({ target }) => `Captured a proof page on ${site(target)}` },
  'sources.transferMarks': { describe: ({ target }) => `Carried answers to other proof pages on ${site(target)}` },
  'sources.confirm': { describe: ({ target }) => `Confirmed the setup of ${site(target)}` },
  'sources.verify': {
    before: (db, i) => (i.onlyKeys?.length ? fieldNames(db, i.sourceId).then((names) => ({ fieldNames: names })) : Promise.resolve(undefined)),
    describe: ({ input, before, target }) => input.onlyKeys?.length
      ? `Re-verified ${input.onlyKeys.map((k: string) => before?.fieldNames?.[k] ?? k).join(', ')} on ${site(target)}`
      : `Verified ${site(target)}`,
  },
  'sources.checkDrift': { describe: ({ target }) => `Checked ${site(target)} for changes` },
  'sources.setVariantSetup': { describe: ({ target }) => `Set up variants on ${site(target)}` },
  'sources.saveVariantAnswer': { describe: ({ target }) => `Answered a variant question on ${site(target)}` },
};

/** Which website / project an input or result points at. */
export async function resolveTarget(db: Database, input: any, result: any): Promise<Target> {
  const i = (input ?? {}) as Record<string, unknown>;
  let sourceId = (i.sourceId ?? result?.sourceId) as string | undefined;
  if (!sourceId && typeof i.id === 'string') sourceId = i.id; // sources.update
  if (!sourceId && typeof i.runId === 'string') {
    sourceId = (await db.query.runs.findFirst({ where: eq(runs.id, i.runId), columns: { sourceId: true } }))?.sourceId ?? undefined;
  }
  let projectId = i.projectId as string | undefined;
  if (!projectId && typeof i.datasetId === 'string') {
    projectId = (await db.query.datasets.findFirst({ where: eq(datasets.id, i.datasetId), columns: { projectId: true } }))?.projectId;
  }
  if (!projectId && typeof result?.id === 'string' && typeof result?.datasetId === 'string') projectId = result.id; // projects.create
  const sourceRow = sourceId
    ? await db.query.sources.findFirst({
      where: eq(sources.id, sourceId),
      columns: { id: true, name: true },
      with: { dataset: { columns: { projectId: true } } },
    })
    : null;
  const website: Target['website'] = sourceRow ? { id: sourceRow.id, name: sourceRow.name, projectId: sourceRow.dataset?.projectId ?? '' } : null;
  projectId ??= website?.projectId || undefined;
  const project = projectId
    ? (await db.query.projects.findFirst({ where: eq(projects.id, projectId), columns: { id: true, name: true } })) ?? null
    : null;
  return { website, project };
}

export async function beforeStaffMutation(db: Database, path: string, input: unknown): Promise<unknown> {
  const action = STAFF_ACTIONS[path];
  if (!action?.before) return undefined;
  try { return await action.before(db, input); } catch { return undefined; }
}

/** Writes the row for one successful staff-mode mutation. Never throws (ruling R3). */
export async function logStaffMutation(a: { db: Database; session: SessionInfo; path: string; input: unknown; result: unknown; before: unknown }): Promise<void> {
  const staff = a.session.staff;
  const action = STAFF_ACTIONS[a.path];
  if (!staff || action === null) return;
  try {
    const target = await resolveTarget(a.db, a.input, a.result);
    const summary = action
      ? await action.describe({ db: a.db, input: a.input, result: a.result, before: a.before, target })
      : `Made a change on ${target.website?.name ?? target.project?.name ?? 'this organisation'}`;
    if (action?.coalesceMinutes && target.website) {
      const since = new Date(Date.now() - action.coalesceMinutes * 60_000);
      const recent = await a.db.query.staffActions.findFirst({
        where: (t, { and, eq: e, gt }) => and(e(t.userId, a.session.user.id), e(t.sourceId, target.website!.id), e(t.action, a.path), gt(t.at, since)),
        columns: { id: true },
      });
      if (recent) return;
    }
    await recordStaffAction(a.db, {
      orgId: staff.orgId, userId: a.session.user.id, actorEmail: a.session.user.email, action: a.path, summary,
      projectId: target.project?.id ?? null, sourceId: target.website?.id ?? null, runId: action?.runId?.(a.input, a.result) ?? null,
    });
  } catch (err) {
    console.error(`[staff-actions] could not log ${a.path} in org ${staff.orgId}`, err);
  }
}
