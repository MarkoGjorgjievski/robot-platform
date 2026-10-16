// packages/api/src/test-helpers/source.ts
// A bare org → project → dataset (with the given contract schema) → source,
// inserted directly, for tests that need a source row and nothing else (no
// session, no binding). Deleted by its org: everything below cascades.
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, orgs, projects, datasets, sources } from '@robot/db';

const orgBySource = new Map<string, string>();

export async function createTestSource(opts: { schema: unknown[] }): Promise<string> {
  const slug = `test-src-${randomUUID().slice(0, 8)}`;
  const [org] = await db.insert(orgs).values({ name: slug, slug }).returning({ id: orgs.id });
  const [project] = await db.insert(projects).values({ orgId: org!.id, name: slug, slug }).returning({ id: projects.id });
  const [dataset] = await db.insert(datasets).values({ projectId: project!.id, name: slug, slug, schema: opts.schema }).returning({ id: datasets.id });
  const [source] = await db.insert(sources).values({ datasetId: dataset!.id, name: slug, slug, country: 'US', isSandbox: false }).returning({ id: sources.id });
  orgBySource.set(source!.id, org!.id);
  return source!.id;
}

export async function deleteTestSource(sourceId: string): Promise<void> {
  const orgId = orgBySource.get(sourceId);
  if (!orgId) return;
  await db.delete(orgs).where(eq(orgs.id, orgId));
  orgBySource.delete(sourceId);
}
