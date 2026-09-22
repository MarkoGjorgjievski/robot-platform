// The org guards for per-website and per-run procedures (spec 2026-09-21 §6 as
// restated): a source or run outside the caller's org is NOT_FOUND — the same
// word as for one that does not exist, so a guessed id learns nothing.
//
// TODO(cut-over, spec 2026-09-21 §2): a caller with NO session is the old
// dashboard, and passes unscoped. These procedures are addressed by id alone —
// the old dashboard never names an org on them — so there is no slug to fall
// back to the way `projects.*` and `sources.get` do, and scoping them to the
// seeded `default` org instead would lock the old app (and every session-less
// CLI and test) out of anything outside it. Guarding only session callers is
// therefore the whole of the new rule with none of the old app's behaviour
// changed. Drop the early return — and with it the `| null` in the return
// type — when the old dashboard is retired.
import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { sources, datasets, projects, runs } from '@robot/db';
import type { Context } from '../trpc.js';

const notFound = (what: string, id: string) => new TRPCError({ code: 'NOT_FOUND', message: `${what} ${id} not found` });

export async function sourceInOrg(ctx: Pick<Context, 'db' | 'session'>, sourceId: string) {
  if (!ctx.session) return null;
  const orgId = ctx.session.org.id;
  const row = await ctx.db
    .select({ id: sources.id, datasetId: sources.datasetId, projectId: projects.id, orgId: projects.orgId })
    .from(sources)
    .innerJoin(datasets, eq(sources.datasetId, datasets.id))
    .innerJoin(projects, eq(datasets.projectId, projects.id))
    .where(eq(sources.id, sourceId))
    .limit(1);
  const s = row[0];
  if (!s || s.orgId !== orgId) throw notFound('Website', sourceId);
  return s;
}

/**
 * A run is reached through its source, so a run whose `sourceId` is null — a
 * legacy row from before sources owned runs — is NOT_FOUND for every signed-in
 * caller. Nothing the new app lists can produce one.
 */
export async function runInOrg(ctx: Pick<Context, 'db' | 'session'>, runId: string) {
  if (!ctx.session) return null;
  const run = await ctx.db.query.runs.findFirst({ where: eq(runs.id, runId), columns: { id: true, sourceId: true } });
  if (!run || !run.sourceId) throw notFound('Run', runId);
  await sourceInOrg(ctx, run.sourceId);
  return run;
}
