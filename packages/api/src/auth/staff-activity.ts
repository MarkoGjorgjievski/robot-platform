// Reading the staff activity log (spec 2026-10-07 §2.4) — one query for ops and the customer.
import { and, count, desc, eq, type SQL } from 'drizzle-orm';
import { orgs, projects, runs, sources, staffActions, users, type Database } from '@robot/db';

export type StaffEntry = {
  id: string; at: Date;
  actor: { name: string | null; email: string };
  org: { id: string; name: string };
  project: { id: string; name: string } | null;
  website: { id: string; name: string } | null;
  summary: string;
  run: { id: string; costUsd: number } | null;
};

export async function listStaffActivity(
  db: Database,
  filter: { orgId?: string; userId?: string; sourceId?: string },
  page: { offset: number; limit: number },
): Promise<{ entries: StaffEntry[]; total: number }> {
  const conds: SQL[] = [];
  if (filter.orgId) conds.push(eq(staffActions.orgId, filter.orgId));
  if (filter.userId) conds.push(eq(staffActions.userId, filter.userId));
  if (filter.sourceId) conds.push(eq(staffActions.sourceId, filter.sourceId));
  const where = conds.length ? and(...conds) : undefined;

  const [rows, [{ n }]] = await Promise.all([
    db.select({
      id: staffActions.id, at: staffActions.at, summary: staffActions.summary, actorEmail: staffActions.actorEmail,
      userName: users.name, orgId: orgs.id, orgName: orgs.name,
      projectId: projects.id, projectName: projects.name, sourceId: sources.id, sourceName: sources.name,
      runId: runs.id, runCost: runs.costUsd,
    })
      .from(staffActions)
      .innerJoin(orgs, eq(staffActions.orgId, orgs.id))
      .leftJoin(users, eq(staffActions.userId, users.id))
      .leftJoin(projects, eq(staffActions.projectId, projects.id))
      .leftJoin(sources, eq(staffActions.sourceId, sources.id))
      .leftJoin(runs, eq(staffActions.runId, runs.id))
      .where(where)
      .orderBy(desc(staffActions.at), desc(staffActions.id))
      .offset(page.offset)
      .limit(page.limit),
    db.select({ n: count() }).from(staffActions).where(where),
  ]);

  return {
    total: Number(n),
    entries: rows.map((r) => ({
      id: r.id, at: r.at, summary: r.summary,
      actor: { name: r.userName ?? null, email: r.actorEmail },
      org: { id: r.orgId, name: r.orgName },
      project: r.projectId ? { id: r.projectId, name: r.projectName! } : null,
      website: r.sourceId ? { id: r.sourceId, name: r.sourceName! } : null,
      run: r.runId ? { id: r.runId, costUsd: Number(r.runCost) } : null,
    })),
  };
}
