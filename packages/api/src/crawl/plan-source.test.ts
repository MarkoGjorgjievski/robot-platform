// packages/api/src/crawl/plan-source.test.ts
// `appendRunLog` only — `formatPlanLog`/`safeErrorMessage`/`planSource` are
// exercised elsewhere (crawl-plan.test.ts and friends); this file covers the
// task-7 addition: appending one line to `runs.logs` without clobbering
// whatever is already there.

import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, runs, sources, orgs, projects, datasets } from '@robot/db';
import { appendRunLog } from './plan-source.js';

const SLUG = 'test-append-run-log';
let orgId: string | null = null;

async function seedRun(logs: string | null) {
  const [org] = await db.insert(orgs).values({ name: SLUG, slug: SLUG }).returning();
  orgId = org!.id;
  const [project] = await db.insert(projects).values({ orgId: org!.id, name: SLUG, slug: SLUG }).returning();
  const [dataset] = await db.insert(datasets).values({ projectId: project!.id, name: SLUG, slug: SLUG, schema: [] }).returning();
  const [source] = await db.insert(sources).values({ datasetId: dataset!.id, name: SLUG, slug: SLUG, country: 'US' }).returning();
  const [run] = await db.insert(runs).values({ sourceId: source!.id, status: 'partial', logs }).returning();
  return run!.id;
}

const readLogs = async (runId: string) => (await db.select({ logs: runs.logs }).from(runs).where(eq(runs.id, runId)))[0]!.logs;

afterEach(async () => {
  if (orgId) await db.delete(orgs).where(eq(orgs.id, orgId));
  orgId = null;
});

describe('appendRunLog', () => {
  it('becomes the log verbatim when logs was null', async () => {
    const runId = await seedRun(null);
    await appendRunLog(db, runId, 'warning: repair failed for isbn — sweep skipped, cells left missing');
    expect(await readLogs(runId)).toBe('warning: repair failed for isbn — sweep skipped, cells left missing');
  });

  it('appends after a newline, preserving what was already there', async () => {
    const runId = await seedRun('warning: an earlier planning warning');
    await appendRunLog(db, runId, 'warning: repair failed for isbn — sweep skipped, cells left missing');
    expect(await readLogs(runId)).toBe(
      'warning: an earlier planning warning\nwarning: repair failed for isbn — sweep skipped, cells left missing',
    );
  });
});
