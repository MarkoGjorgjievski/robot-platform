// Which org owns a run or a project, for the export routes (final review I1):
// they sit outside tRPC, so they cannot reuse `auth/scope.ts`'s ctx-based
// guards. Each returns the org id, or null when the run/project (or its
// website/dataset chain) doesn't exist — the route turns that into the same
// 404 it already gives for an unknown id, never distinguishing the two.
import { eq } from 'drizzle-orm';
import { runs, sources, datasets, projects } from '@robot/db';
import type { db as Database } from '@robot/db';

export async function orgIdForRun(db: typeof Database, runId: string): Promise<string | null> {
  const row = await db
    .select({ orgId: projects.orgId })
    .from(runs)
    .innerJoin(sources, eq(runs.sourceId, sources.id))
    .innerJoin(datasets, eq(sources.datasetId, datasets.id))
    .innerJoin(projects, eq(datasets.projectId, projects.id))
    .where(eq(runs.id, runId))
    .limit(1);
  return row[0]?.orgId ?? null;
}

export async function orgIdForProject(db: typeof Database, projectId: string): Promise<string | null> {
  const row = await db.select({ orgId: projects.orgId }).from(projects).where(eq(projects.id, projectId)).limit(1);
  return row[0]?.orgId ?? null;
}
