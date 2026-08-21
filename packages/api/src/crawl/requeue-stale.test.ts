// packages/api/src/crawl/requeue-stale.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, runs, runItems, sources, orgs, projects, datasets } from '@robot/db';
import { requeueStaleRunningItems, STALE_RUNNING_MS } from './requeue-stale.js';

const SLUG = 'test-requeue-stale';
let orgId: string | null = null;

async function seedRun() {
  const [org] = await db.insert(orgs).values({ name: SLUG, slug: SLUG }).returning();
  orgId = org!.id;
  const [project] = await db.insert(projects).values({ orgId: org!.id, name: SLUG, slug: SLUG }).returning();
  const [dataset] = await db.insert(datasets).values({ projectId: project!.id, name: SLUG, slug: SLUG, schema: [] }).returning();
  const [source] = await db.insert(sources).values({ datasetId: dataset!.id, name: SLUG, slug: SLUG, country: 'US' }).returning();
  const [run] = await db.insert(runs).values({ sourceId: source!.id, status: 'extracting' }).returning();
  return run!.id;
}

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);

afterEach(async () => {
  if (orgId) await db.delete(orgs).where(eq(orgs.id, orgId));
  orgId = null;
});

describe('requeueStaleRunningItems', () => {
  it('requeues an item abandoned at `running` so execute can claim it again', async () => {
    // The api-server-restart shape: claimNextItem flipped the item to `running`
    // and stamped started_at; the process then died. Nothing else ever moves a
    // `running` item, and claimNextItem only claims `pending` — so without this
    // the row is unreachable work forever.
    const runId = await seedRun();
    await db.insert(runItems).values({
      runId, kind: 'detail', url: 'https://example.com/p/1', inputIndex: 0,
      status: 'running', startedAt: minutesAgo(45), attempts: 1,
    });

    const requeued = await requeueStaleRunningItems(db, runId);
    expect(requeued).toBe(1);

    const [row] = await db.select().from(runItems).where(eq(runItems.runId, runId));
    expect(row!.status).toBe('pending');
    // A pending item hasn't started; claimNextItem re-stamps started_at when it
    // claims it again.
    expect(row!.startedAt).toBeNull();
    // attempts is the honest history of how many times this URL was tried —
    // requeueing is a new attempt, not an erasure of the old one.
    expect(row!.attempts).toBe(1);
  });

  it('never steals an item from a live loop — 30 minutes is ~50x one item', async () => {
    // An item takes ~35s. A `running` row younger than the threshold is work in
    // progress in another (or this) loop, and requeueing it would hand the same
    // URL to two extractors.
    const runId = await seedRun();
    await db.insert(runItems).values({
      runId, kind: 'detail', url: 'https://example.com/p/1', inputIndex: 0,
      status: 'running', startedAt: minutesAgo(2),
    });

    expect(await requeueStaleRunningItems(db, runId)).toBe(0);
    const [row] = await db.select().from(runItems).where(eq(runItems.runId, runId));
    expect(row!.status).toBe('running');
  });

  it('leaves pending, done and failed items exactly as they are', async () => {
    const runId = await seedRun();
    await db.insert(runItems).values([
      { runId, kind: 'listing', url: 'https://example.com/c/1', inputIndex: 0, status: 'done' },
      { runId, kind: 'detail', url: 'https://example.com/p/1', inputIndex: 0, status: 'pending' },
      { runId, kind: 'detail', url: 'https://example.com/p/2', inputIndex: 0, status: 'done' },
      // `failed` is retryFailed's business, not this one's: retrying a blocked
      // page just gets blocked again, which is why it is opt-in.
      { runId, kind: 'detail', url: 'https://example.com/p/3', inputIndex: 0, status: 'failed', error: 'blocked' },
    ]);

    expect(await requeueStaleRunningItems(db, runId)).toBe(0);
    const rows = await db.select().from(runItems).where(eq(runItems.runId, runId));
    expect(rows.map((r) => r.status).sort()).toEqual(['done', 'done', 'failed', 'pending']);
  });

  // The `kind = 'detail'` filter had no test: no fixture ever seeded a
  // `listing` row at `running` past the threshold, so deleting that clause left
  // the whole suite green. A guard nothing exercises is a guard that can be
  // removed by accident — the same gap two earlier findings were about.
  it('leaves a stale `listing` item alone — listing rows are not phase-2 work', async () => {
    // Planning writes listing rows `done`, so this shape means something went
    // wrong upstream. That is exactly when the guard has to hold: requeueing a
    // listing row parks it in the queue `claimNextItem` draws from, where it
    // would either be extracted as if it were a detail page or sit `pending`
    // forever and keep the run's roll-up non-terminal.
    const runId = await seedRun();
    await db.insert(runItems).values([
      { runId, kind: 'listing', url: 'https://example.com/c/1', inputIndex: 0, status: 'running', startedAt: minutesAgo(45) },
      { runId, kind: 'detail', url: 'https://example.com/p/1', inputIndex: 0, status: 'running', startedAt: minutesAgo(45) },
    ]);

    // One, not two: the detail item only.
    expect(await requeueStaleRunningItems(db, runId)).toBe(1);
    const rows = await db.select().from(runItems).where(eq(runItems.runId, runId));
    expect(rows.find((r) => r.kind === 'listing')!.status).toBe('running');
    expect(rows.find((r) => r.kind === 'detail')!.status).toBe('pending');
  });

  it('touches only the run it was asked about', async () => {
    const runId = await seedRun();
    const [otherRun] = await db.insert(runs)
      .values({ sourceId: (await db.select().from(runs).where(eq(runs.id, runId)))[0]!.sourceId, status: 'extracting' })
      .returning();
    await db.insert(runItems).values([
      { runId, kind: 'detail', url: 'https://example.com/p/1', inputIndex: 0, status: 'running', startedAt: minutesAgo(45) },
      { runId: otherRun!.id, kind: 'detail', url: 'https://example.com/p/9', inputIndex: 0, status: 'running', startedAt: minutesAgo(45) },
    ]);

    expect(await requeueStaleRunningItems(db, runId)).toBe(1);
    const [other] = await db.select().from(runItems).where(eq(runItems.runId, otherRun!.id));
    expect(other!.status).toBe('running');
  });

  it('exposes a threshold far longer than one item takes', () => {
    expect(STALE_RUNNING_MS).toBe(30 * 60_000);
  });
});
