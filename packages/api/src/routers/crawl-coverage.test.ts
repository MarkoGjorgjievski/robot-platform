// packages/api/src/routers/crawl-coverage.test.ts
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, runs, runItems, extractions, captures, sources, projects, datasets } from '@robot/db';
import { signedInCaller } from '../test-helpers/identity.js';

// A throwaway signed-in identity: every customer procedure needs a session
// and works in its org only, so nothing here touches the seeded `default` org.
const me = await signedInCaller('crawl-coverage');
const caller = me.caller;
afterAll(async () => { await me.cleanup(); });
const SLUG = 'test-crawl-coverage';
let orgId: string | null = null;

/**
 * One run, two detail items: one with a real extraction (`title` filled,
 * `isbn` missing), one failed with no extraction at all (both fields
 * missing) — the shape that exercises every branch of computeCoverage
 * through the real DB → effectiveSchema → coverage.ts path.
 */
async function seedRunWithCoverageItems() {
  const org = me.session.org; // the signed-in caller's org: procedures only see their own
  orgId = org!.id;
  const [project] = await db.insert(projects).values({ orgId: org!.id, name: SLUG, slug: SLUG }).returning();
  const [dataset] = await db.insert(datasets).values({
    projectId: project!.id, name: SLUG, slug: SLUG,
    schema: [{ name: 'title', type: 'string' }, { name: 'isbn', type: 'string' }],
  }).returning();
  const [source] = await db.insert(sources).values({ datasetId: dataset!.id, name: SLUG, slug: SLUG, country: 'US' }).returning();
  const [run] = await db.insert(runs).values({ sourceId: source!.id, status: 'completed' }).returning();

  const [capture] = await db.insert(captures).values({
    sourceId: source!.id, runId: run!.id, url: 'https://example.com/p/1',
  }).returning();
  const [extraction] = await db.insert(extractions).values({
    sourceId: source!.id, captureId: capture!.id, runId: run!.id,
    data: [{ title: 'A', isbn: null, _url: 'https://example.com/p/1', _page_number: 1 }],
  }).returning();

  const [item1] = await db.insert(runItems).values({
    runId: run!.id, kind: 'detail', url: 'https://example.com/p/1', inputIndex: 0,
    status: 'done', extractionId: extraction!.id,
  }).returning();
  const [item2] = await db.insert(runItems).values({
    runId: run!.id, kind: 'detail', url: 'https://example.com/p/2', inputIndex: 0,
    status: 'failed', error: 'blocked',
  }).returning();
  // A listing item must not be counted — coverage is about detail rows only.
  await db.insert(runItems).values({
    runId: run!.id, kind: 'listing', url: 'https://example.com/c/1', inputIndex: 0, status: 'done',
  });

  return { runId: run!.id, sourceId: source!.id, item1Id: item1!.id, item2Id: item2!.id };
}

afterEach(async () => {
  if (orgId) await db.delete(projects).where(eq(projects.orgId, orgId));
  orgId = null;
});

describe('crawl.coverage', () => {
  it('rejects an unknown run', async () => {
    await expect(caller.crawl.coverage({ runId: '00000000-0000-0000-0000-000000000000' }))
      .rejects.toThrow(/not found/i);
  });

  it('reports per-field fill counts and per-item gaps for a real run', async () => {
    const { runId, item1Id, item2Id } = await seedRunWithCoverageItems();

    const result = await caller.crawl.coverage({ runId });

    expect(result.fields).toEqual([
      { name: 'title', filled: 1, missing: 1, confirmedAbsent: 0, total: 2 },
      { name: 'isbn', filled: 0, missing: 2, confirmedAbsent: 0, total: 2 },
    ]);
    expect(result.gapItems).toEqual([
      { itemId: item1Id, url: 'https://example.com/p/1', missingFields: ['isbn'] },
      { itemId: item2Id, url: 'https://example.com/p/2', missingFields: ['title', 'isbn'] },
    ]);
  });
});
