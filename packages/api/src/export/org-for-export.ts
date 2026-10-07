// Which org owns a run or a project, for the export routes (final review I1):
// they sit outside tRPC, so they cannot reuse `auth/scope.ts`'s ctx-based
// guards. Each returns the org id, or null when the run/project (or its
// website/dataset chain) doesn't exist — the route turns that into the same
// 404 it already gives for an unknown id, never distinguishing the two.
import { eq, or, sql } from 'drizzle-orm';
import { runs, sources, datasets, projects, captures } from '@robot/db';
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

/**
 * Which org owns a `/captures/<file>` file, for the capture-serving route
 * (same gate as the export routes above). `filename` is the bare
 * `<name>.<ext>` — the route rejects anything containing a path separator or
 * `..` before this is ever called, so it is safe to embed directly.
 *
 * A capture file is one of two things `persistScreenshot` ever wrote under
 * this name (`persist-screenshot.ts`):
 *   - a verification screenshot — `captures.screenshot_path` is exactly
 *     `/captures/<file>` (`run-source-verification.ts`'s `storeCapture`)
 *   - a proof-page tile — the file's path is one entry of the `tiles` array
 *     inside `captures.metadata` (`proof-page-capture.ts`'s
 *     `ProofPageMeta['tiles']`; note `screenshot_path` there is only
 *     `tiles[0]`, so later tiles are reachable only through this check)
 *
 * Both kinds live on the same `captures` row, scoped by `sourceId` the same
 * way a run is scoped by it — `sources.datasetId` can be null (an
 * unattached/legacy source), and the inner joins below make that resolve to
 * null exactly like a run whose source has none, so the route 404s instead
 * of leaking existence.
 */
export async function orgIdForCaptureFile(db: typeof Database, filename: string): Promise<string | null> {
  const path = `/captures/${filename}`;
  const row = await db
    .select({ orgId: projects.orgId })
    .from(captures)
    .innerJoin(sources, eq(captures.sourceId, sources.id))
    .innerJoin(datasets, eq(sources.datasetId, datasets.id))
    .innerJoin(projects, eq(datasets.projectId, projects.id))
    .where(
      or(
        eq(captures.screenshotPath, path),
        sql`${captures.metadata}->'tiles' @> ${JSON.stringify([path])}::jsonb`,
      ),
    )
    .limit(1);
  return row[0]?.orgId ?? null;
}
