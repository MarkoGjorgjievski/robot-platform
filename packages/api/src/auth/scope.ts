// The org guards for per-website and per-run procedures (spec 2026-09-21 §6 as
// restated): a source or run outside the caller's org is NOT_FOUND — the same
// word as for one that does not exist, so a guessed id learns nothing. A caller
// with no session is UNAUTHORIZED; the old dashboard's session-less pass-through
// was removed at cut-over.
import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { sources, datasets, projects, runs, captures } from '@robot/db';
import type { Context } from '../trpc.js';

const notFound = (what: string, id: string) => new TRPCError({ code: 'NOT_FOUND', message: `${what} ${id} not found` });

export async function sourceInOrg(ctx: Pick<Context, 'db' | 'session'>, sourceId: string) {
  const s = await findSourceInOrg(ctx, sourceId);
  if (!s) throw notFound('Website', sourceId);
  return s;
}

/** The website inside the caller's org, or null — so a run or capture guard can refuse in its own words. */
async function findSourceInOrg(ctx: Pick<Context, 'db' | 'session'>, sourceId: string) {
  if (!ctx.session) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sign in first' });
  const orgId = ctx.session.org.id;
  const row = await ctx.db
    .select({ id: sources.id, datasetId: sources.datasetId, projectId: projects.id, orgId: projects.orgId })
    .from(sources)
    .innerJoin(datasets, eq(sources.datasetId, datasets.id))
    .innerJoin(projects, eq(datasets.projectId, projects.id))
    .where(eq(sources.id, sourceId))
    .limit(1);
  const s = row[0];
  return s && s.orgId === orgId ? s : null;
}

/**
 * A run is reached through its source, so a run whose `sourceId` is null — a
 * legacy row from before sources owned runs — is NOT_FOUND for every signed-in
 * caller. Nothing the new app lists can produce one.
 */
export async function runInOrg(ctx: Pick<Context, 'db' | 'session'>, runId: string) {
  if (!ctx.session) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sign in first' });
  const run = await ctx.db.query.runs.findFirst({ where: eq(runs.id, runId), columns: { id: true, sourceId: true } });
  // Another org's run reads exactly as a missing one: its own words and id, never its website's (spec 2026-10-24 §2.1).
  if (!run || !run.sourceId || !(await findSourceInOrg(ctx, run.sourceId))) throw notFound('Run', runId);
  return run;
}

/** A proof-page capture is reached through its website. Addressed by id alone. */
export async function captureInOrg(ctx: Pick<Context, 'db' | 'session'>, captureId: string) {
  if (!ctx.session) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sign in first' });
  const row = await ctx.db.query.captures.findFirst({ where: eq(captures.id, captureId), columns: { id: true, sourceId: true } });
  if (!row || !row.sourceId || !(await findSourceInOrg(ctx, row.sourceId))) throw notFound('Page capture', captureId);
  return { id: row.id, sourceId: row.sourceId };
}
