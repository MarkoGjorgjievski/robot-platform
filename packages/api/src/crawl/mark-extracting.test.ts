// packages/api/src/crawl/mark-extracting.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, runs, sources, orgs, projects, datasets } from '@robot/db';
import { markRunExtracting } from './mark-extracting.js';

const SLUG = 'test-mark-extracting';
let orgId: string | null = null;
let sourceId: string | null = null;

async function seedSource() {
  const [org] = await db.insert(orgs).values({ name: SLUG, slug: SLUG }).returning();
  orgId = org!.id;
  const [project] = await db.insert(projects).values({ orgId: org!.id, name: SLUG, slug: SLUG }).returning();
  const [dataset] = await db.insert(datasets).values({ projectId: project!.id, name: SLUG, slug: SLUG, schema: [] }).returning();
  const [source] = await db.insert(sources).values({ datasetId: dataset!.id, name: SLUG, slug: SLUG, country: 'US' }).returning();
  sourceId = source!.id;
}

async function seedRun(values: { status: string; startedAt?: Date | null; completedAt?: Date | null }) {
  if (!sourceId) await seedSource();
  const [run] = await db.insert(runs).values({ sourceId: sourceId!, ...values }).returning();
  return run!.id;
}

const read = async (runId: string) => (await db.select().from(runs).where(eq(runs.id, runId)))[0]!;

afterEach(async () => {
  if (orgId) await db.delete(orgs).where(eq(orgs.id, orgId));
  orgId = null;
  sourceId = null;
});

describe('markRunExtracting', () => {
  it('starts a planned run and stamps when it started', async () => {
    const runId = await seedRun({ status: 'planned', startedAt: null });
    expect(await markRunExtracting(db, runId)).toBe(true);

    const row = await read(runId);
    expect(row.status).toBe('extracting');
    expect(row.startedAt).not.toBeNull();
  });

  it('never overwrites `cancelling` — a Stop must not be silently voided', async () => {
    // The race: the user clicks Stop, and before the running loop's next
    // between-items check (up to ~30s later) a second execute arrives. Writing
    // 'extracting' here made the loop's own `isCancelled` read 'extracting',
    // return false, and keep crawling a run the user had stopped.
    const runId = await seedRun({ status: 'cancelling' });
    expect(await markRunExtracting(db, runId)).toBe(false);
    expect((await read(runId)).status).toBe('cancelling');
  });

  it('still permits re-entry on an extracting run — crash-resume depends on it', async () => {
    const runId = await seedRun({ status: 'extracting' });
    expect(await markRunExtracting(db, runId)).toBe(true);
    expect((await read(runId)).status).toBe('extracting');
  });

  it('keeps the original startedAt when a run is resumed', async () => {
    // Resetting it made a resumed run report its duration from the resume
    // rather than from when the work actually began.
    const started = new Date(Date.now() - 3 * 3_600_000);
    const runId = await seedRun({ status: 'partial', startedAt: started, completedAt: new Date() });

    expect(await markRunExtracting(db, runId)).toBe(true);
    const row = await read(runId);
    expect(row.startedAt?.getTime()).toBe(started.getTime());
  });

  it('clears the completion timestamp of a run that is running again', async () => {
    // finaliseRun's own rule: a non-terminal run has no completedAt. Leaving
    // the previous settle's timestamp there shows "completed 10:05" on a run
    // that is visibly still working.
    const runId = await seedRun({ status: 'partial', startedAt: new Date(), completedAt: new Date() });

    await markRunExtracting(db, runId);
    expect((await read(runId)).completedAt).toBeNull();
  });

  it('reports false for a run that does not exist', async () => {
    expect(await markRunExtracting(db, '00000000-0000-0000-0000-000000000000')).toBe(false);
  });
});
