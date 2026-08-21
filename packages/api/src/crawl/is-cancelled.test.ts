// packages/api/src/crawl/is-cancelled.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, runs, sources, orgs, projects, datasets } from '@robot/db';
import { isRunCancelled } from './is-cancelled.js';

const SLUG = 'test-is-cancelled';
let orgId: string | null = null;

async function seedRun(status: string) {
  const [org] = await db.insert(orgs).values({ name: SLUG, slug: SLUG }).returning();
  orgId = org!.id;
  const [project] = await db.insert(projects).values({ orgId: org!.id, name: SLUG, slug: SLUG }).returning();
  const [dataset] = await db.insert(datasets).values({ projectId: project!.id, name: SLUG, slug: SLUG, schema: [] }).returning();
  const [source] = await db.insert(sources).values({ datasetId: dataset!.id, name: SLUG, slug: SLUG, country: 'US' }).returning();
  const [run] = await db.insert(runs).values({ sourceId: source!.id, status }).returning();
  return run!.id;
}

afterEach(async () => {
  if (orgId) await db.delete(orgs).where(eq(orgs.id, orgId));
  orgId = null;
});

describe('isRunCancelled', () => {
  it('stops a loop on `cancelling` — the status crawl.cancel writes', async () => {
    expect(await isRunCancelled(db, await seedRun('cancelling'))).toBe(true);
  });

  // The N1 bug. Two loops can be alive on one run at once: the dashboard now
  // renders Extract ALONGSIDE Stop on an active run (deliberately — re-entry is
  // the documented crash-resume path), so the reachable sequence is
  //   loop A working  ->  Stop (status: cancelling)  ->  Extract (loop B)
  //   -> loop B's first check sees `cancelling`, breaks, and finalises the run
  //      to the TERMINAL status `cancelled`
  //   -> loop A finishes its item and checks again.
  // Matching only `cancelling` made that last check read `cancelled` as "not
  // cancelled": loop A claimed the next item and kept crawling a run the user
  // had stopped and the UI showed as cancelled, then overwrote `cancelled` with
  // `completed`/`partial` when it finalised. A terminal cancel is a stronger
  // stop signal than a pending one, not a weaker one.
  it('stops a loop on `cancelled` too — another loop already finalised this run', async () => {
    expect(await isRunCancelled(db, await seedRun('cancelled'))).toBe(true);
  });

  it('lets a live run keep working', async () => {
    expect(await isRunCancelled(db, await seedRun('extracting'))).toBe(false);
    if (orgId) await db.delete(orgs).where(eq(orgs.id, orgId));
    orgId = null;
    expect(await isRunCancelled(db, await seedRun('planned'))).toBe(false);
  });

  it('does not stop the loop over a run row it cannot read', async () => {
    // A missing row is not a cancel: the loop's own guard treats a broken check
    // as "not cancelled" so a working run is never stopped by a read problem.
    expect(await isRunCancelled(db, '00000000-0000-0000-0000-000000000000')).toBe(false);
  });
});
