// packages/api/src/routers/crawl-execute.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { db, runs, runItems, sources, orgs, projects, datasets } from '@robot/db';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from './index.js';

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

afterEach(async () => {
  if (orgId) await db.delete(orgs).where(eq(orgs.id, orgId));
  orgId = null;
});

describe('crawl.status', () => {
  it('reports what the work list has done so far', async () => {
    const runId = await seedPlannedRun();
    const status = await caller.crawl.status({ runId });
    expect(status.status).toBe('planned');
    expect(status.counts).toMatchObject({ pending: 1, failed: 1, done: 1 });
  });

  it('rejects an unknown run rather than reporting an empty one', async () => {
    await expect(caller.crawl.status({ runId: '00000000-0000-0000-0000-000000000000' }))
      .rejects.toThrow(/not found/i);
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
});
