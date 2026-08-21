// packages/api/src/routers/crawl-execute.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { db, runs, runItems, sources, orgs, projects, datasets } from '@robot/db';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from './index.js';
import { safeErrorMessage } from './crawl.js';

const caller = createCallerFactory(appRouter)({ db });
const SLUG = 'test-crawl-execute';
let orgId: string | null = null;

async function seedPlannedRun() {
  const [org] = await db.insert(orgs).values({ name: SLUG, slug: SLUG }).returning();
  orgId = org!.id;
  const [project] = await db.insert(projects).values({ orgId: org!.id, name: SLUG, slug: SLUG }).returning();
  const [dataset] = await db.insert(datasets).values({ projectId: project!.id, name: SLUG, slug: SLUG, schema: [] }).returning();
  const [source] = await db.insert(sources).values({ datasetId: dataset!.id, name: SLUG, slug: SLUG, country: 'US' }).returning();
  const [run] = await db.insert(runs).values({ sourceId: source!.id, status: 'planned' }).returning();
  await db.insert(runItems).values([
    { runId: run!.id, kind: 'listing', url: 'https://example.com/c/1', inputIndex: 0, status: 'done' },
    { runId: run!.id, kind: 'detail', url: 'https://example.com/p/1', inputIndex: 0, status: 'pending' },
    { runId: run!.id, kind: 'detail', url: 'https://example.com/p/2', inputIndex: 0, status: 'failed', error: 'blocked' },
  ]);
  return run!.id;
}

/**
 * A run whose listing item is done (planning bookkeeping, not phase-2 work)
 * alongside detail items in every status — the shape that exposes whether
 * crawl.status's counters are scoped to detail items or leak listing rows in.
 */
async function seedRunWithDoneListingAndMixedDetails() {
  const [org] = await db.insert(orgs).values({ name: SLUG, slug: SLUG }).returning();
  orgId = org!.id;
  const [project] = await db.insert(projects).values({ orgId: org!.id, name: SLUG, slug: SLUG }).returning();
  const [dataset] = await db.insert(datasets).values({ projectId: project!.id, name: SLUG, slug: SLUG, schema: [] }).returning();
  const [source] = await db.insert(sources).values({ datasetId: dataset!.id, name: SLUG, slug: SLUG, country: 'US' }).returning();
  const [run] = await db.insert(runs).values({ sourceId: source!.id, status: 'extracting' }).returning();
  await db.insert(runItems).values([
    { runId: run!.id, kind: 'listing', url: 'https://example.com/c/1', inputIndex: 0, status: 'done' },
    { runId: run!.id, kind: 'detail', url: 'https://example.com/p/1', inputIndex: 0, status: 'done' },
    { runId: run!.id, kind: 'detail', url: 'https://example.com/p/2', inputIndex: 0, status: 'pending' },
    { runId: run!.id, kind: 'detail', url: 'https://example.com/p/3', inputIndex: 0, status: 'running' },
    { runId: run!.id, kind: 'detail', url: 'https://example.com/p/4', inputIndex: 0, status: 'failed', error: 'blocked' },
  ]);
  return run!.id;
}

afterEach(async () => {
  if (orgId) await db.delete(orgs).where(eq(orgs.id, orgId));
  orgId = null;
});

describe('crawl.status', () => {
  it('reports what the work list has done so far', async () => {
    const runId = await seedPlannedRun();
    const status = await caller.crawl.status({ runId });
    expect(status.status).toBe('planned');
    // The listing item is already `done` at plan time, but that's planning
    // bookkeeping, not phase-2 work — it must not count as extracted here.
    expect(status.counts).toMatchObject({ pending: 1, failed: 1, done: 0, listing: 1, detail: 2 });
  });

  it('rejects an unknown run rather than reporting an empty one', async () => {
    await expect(caller.crawl.status({ runId: '00000000-0000-0000-0000-000000000000' }))
      .rejects.toThrow(/not found/i);
  });

  it('counts pending/running/done/failed over detail items only — the done listing item is planning bookkeeping, not phase-2 work', async () => {
    const runId = await seedRunWithDoneListingAndMixedDetails();
    const status = await caller.crawl.status({ runId });
    expect(status.counts).toEqual({ pending: 1, running: 1, done: 1, failed: 1, listing: 1, detail: 4 });
  });
});

describe('crawl.items', () => {
  // Finding 2: crawl.items had the same bug pattern crawl.status was already
  // fixed for — pending/done/failed summed across BOTH kinds, inflating `done`
  // against a `detail` total that excludes listing rows.
  it('counts pending/done/failed over detail items only — mirrors the crawl.status fix', async () => {
    const runId = await seedRunWithDoneListingAndMixedDetails();
    const result = await caller.crawl.items({ runId });
    expect(result.counts).toEqual({ listing: 1, detail: 4, pending: 1, done: 1, failed: 1 });
  });
});

describe('crawl.cancel', () => {
  it('marks a run cancelling, which the loop checks between items', async () => {
    const runId = await seedPlannedRun();
    const result = await caller.crawl.cancel({ runId });
    expect(result.status).toBe('cancelling');
    const [row] = await db.select().from(runs).where(eq(runs.id, runId));
    expect(row!.status).toBe('cancelling');
  });
});

describe('crawl.execute', () => {
  it('rejects a non-uuid runId', async () => {
    await expect(caller.crawl.execute({ runId: 'nope' })).rejects.toThrow();
  });

  it('rejects an unknown run', async () => {
    await expect(caller.crawl.execute({ runId: '00000000-0000-0000-0000-000000000000' }))
      .rejects.toThrow(/not found/i);
  });

  it('re-queues failed items only when asked', async () => {
    const runId = await seedPlannedRun();
    await caller.crawl.execute({ runId, retryFailed: true, dryRun: true });
    const rows = await db.select().from(runItems).where(eq(runItems.runId, runId));
    const failed = rows.filter((r) => r.status === 'failed');
    const pending = rows.filter((r) => r.status === 'pending');
    expect(failed).toHaveLength(0);
    expect(pending).toHaveLength(2);
  });

  it('leaves failed items alone by default, because retrying a blocked page just gets blocked again', async () => {
    const runId = await seedPlannedRun();
    await caller.crawl.execute({ runId, dryRun: true });
    const rows = await db.select().from(runItems).where(eq(runItems.runId, runId));
    expect(rows.filter((r) => r.status === 'failed')).toHaveLength(1);
  });

  it('dryRun is fully inert: it never touches the run row, since no loop starts', async () => {
    const runId = await seedPlannedRun();
    await caller.crawl.execute({ runId, dryRun: true });
    const [row] = await db.select().from(runs).where(eq(runs.id, runId));
    expect(row!.status).toBe('planned');
    expect(row!.startedAt).toBeNull();
  });
});

// FINDING 1 (critical): startExecution's own recovery catch block must never
// itself throw. The concrete risk is `(err as Error).message` on a rejection
// that is not an Error instance — a string, a driver error without the Error
// prototype, etc. — which would throw a TypeError from inside the catch block
// and escape the deliberately-unawaited `void startExecution(...)` call as an
// unhandled rejection, which Node treats as fatal.
describe('safeErrorMessage', () => {
  it('uses .message for a genuine Error', () => {
    expect(safeErrorMessage(new Error('blocked by upstream'))).toBe('blocked by upstream');
  });

  it('stringifies a non-Error rejection instead of throwing', () => {
    expect(safeErrorMessage('a plain string rejection')).toBe('a plain string rejection');
    expect(safeErrorMessage(undefined)).toBe('undefined');
    expect(safeErrorMessage(42)).toBe('42');
    expect(safeErrorMessage({ code: 'ECONNREFUSED' })).toBe('[object Object]');
  });
});

// Fix 1(b): an item abandoned at `running` (api-server restart mid-item) is
// invisible to claimNextItem, which claims `pending` only. `execute` is the
// documented recovery ("call execute again"), so `execute` is where the
// reclaim has to happen — unconditionally, not behind retryFailed.
describe('crawl.execute — stale running items', () => {
  async function seedRunWithStaleRunningItem(startedMinutesAgo: number) {
    const [org] = await db.insert(orgs).values({ name: SLUG, slug: SLUG }).returning();
    orgId = org!.id;
    const [project] = await db.insert(projects).values({ orgId: org!.id, name: SLUG, slug: SLUG }).returning();
    const [dataset] = await db.insert(datasets).values({ projectId: project!.id, name: SLUG, slug: SLUG, schema: [] }).returning();
    const [source] = await db.insert(sources).values({ datasetId: dataset!.id, name: SLUG, slug: SLUG, country: 'US' }).returning();
    const [run] = await db.insert(runs).values({ sourceId: source!.id, status: 'extracting' }).returning();
    await db.insert(runItems).values([
      { runId: run!.id, kind: 'detail', url: 'https://example.com/p/1', inputIndex: 0, status: 'done' },
      {
        runId: run!.id, kind: 'detail', url: 'https://example.com/p/2', inputIndex: 0,
        status: 'running', startedAt: new Date(Date.now() - startedMinutesAgo * 60_000), attempts: 1,
      },
    ]);
    return run!.id;
  }

  it('requeues an item stuck at running, without being asked to retry anything', async () => {
    const runId = await seedRunWithStaleRunningItem(45);
    await caller.crawl.execute({ runId, dryRun: true });

    const rows = await db.select().from(runItems).where(eq(runItems.runId, runId));
    const stuck = rows.find((r) => r.url === 'https://example.com/p/2');
    expect(stuck!.status).toBe('pending');
    // ...and it is now visible to the reader the dashboard drives its buttons
    // from, which is what makes the run recoverable from the UI at all.
    const status = await caller.crawl.status({ runId });
    expect(status.counts).toMatchObject({ pending: 1, running: 0, done: 1 });
  });

  it('leaves a freshly claimed item alone — a live loop must not have its work stolen', async () => {
    const runId = await seedRunWithStaleRunningItem(1);
    await caller.crawl.execute({ runId, dryRun: true });

    const rows = await db.select().from(runItems).where(eq(runItems.runId, runId));
    expect(rows.find((r) => r.url === 'https://example.com/p/2')!.status).toBe('running');
  });
});
