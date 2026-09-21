// packages/api/src/routers/crawl-execute.test.ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { db, runs, runItems, sources, orgs, projects, datasets } from '@robot/db';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from './index.js';
import { safeErrorMessage } from './crawl.js';
import { executeRun } from '../crawl/execute-run.js';
import { claimNextItem } from '../crawl/claim-item.js';
import { markItemDone } from '../crawl/record-outcome.js';
import { finaliseRun } from '../crawl/roll-up-run.js';

// Finding 1 (final-review-findings.md): `crawl.execute` is the resume/retry
// path for EVERY non-initial execution of a backfill run (Retry-N-failed,
// Extract-N-pending, crash-resume) — it must pass `mergeToParent: true` to
// `startExecution` whenever the run being executed is itself a backfill
// (has a parentRunId), same as `crawl.backfill`'s own fire-and-forget call
// already does. Mocked exactly the way crawl-backfill.test.ts mocks it, so
// the args reaching `startExecution` are inspectable without a browser.
const { startExecutionMock } = vi.hoisted(() => ({ startExecutionMock: vi.fn() }));
vi.mock('../crawl/start-execution.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../crawl/start-execution.js')>();
  return { ...actual, startExecution: startExecutionMock };
});

const caller = createCallerFactory(appRouter)({ db, session: null });
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
  startExecutionMock.mockReset();
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
    expect(result.counts).toEqual({ listing: 1, detail: 4, pending: 1, running: 1, done: 1, failed: 1 });
  });

  // N5: crawl.items omitted `running` after crawl.status started counting it,
  // so the two readers of one run disagreed about what it contained — here
  // pending + done + failed stopped summing to `detail` the moment an item
  // stalled. Nothing misreported yet, but a reader whose per-status counts
  // silently fail to account for every item is precisely how "2 of 1
  // extracted" got onto this branch once already.
  it('accounts for every detail item, so the statuses sum to the detail total', async () => {
    const runId = await seedRunWithDoneListingAndMixedDetails();
    const { counts } = await caller.crawl.items({ runId });
    expect(counts.pending + counts.running + counts.done + counts.failed).toBe(counts.detail);
  });

  it('agrees with crawl.status about what the run contains', async () => {
    const runId = await seedRunWithDoneListingAndMixedDetails();
    const [items, status] = await Promise.all([
      caller.crawl.items({ runId }),
      caller.crawl.status({ runId }),
    ]);
    expect(items.counts).toEqual(status.counts);
  });
});

describe('crawl.cancel', () => {
  const setStatus = (runId: string, status: string) =>
    db.update(runs).set({ status }).where(eq(runs.id, runId));

  it('marks an extracting run cancelling, which the loop checks between items', async () => {
    const runId = await seedPlannedRun();
    await setStatus(runId, 'extracting');

    const result = await caller.crawl.cancel({ runId });
    expect(result.status).toBe('cancelling');
    const [row] = await db.select().from(runs).where(eq(runs.id, runId));
    expect(row!.status).toBe('cancelling');
  });

  it('is idempotent on a run that is already stopping', async () => {
    const runId = await seedPlannedRun();
    await setStatus(runId, 'cancelling');
    await expect(caller.crawl.cancel({ runId })).resolves.toMatchObject({ status: 'cancelling' });
  });

  // Cancelling a run nothing is working writes `cancelling`, which no loop
  // will ever observe and therefore nothing will ever finalise — and
  // `isRunActive` reports it as active, so the dashboard polls it forever.
  // That is the same permanent trap the Run detail page's Stop button used to
  // create, reachable here from the CLI or any API client.
  it.each(['completed', 'partial', 'failed', 'cancelled', 'planned', 'planning'])(
    'refuses to cancel a run that is not active (%s)',
    async (status) => {
      const runId = await seedPlannedRun();
      await setStatus(runId, status);

      await expect(caller.crawl.cancel({ runId })).rejects.toThrow(/not active|cannot be cancelled/i);
      const [row] = await db.select().from(runs).where(eq(runs.id, runId));
      expect(row!.status).toBe(status);
    },
  );

  it('rejects an unknown run rather than pretending to stop it', async () => {
    await expect(caller.crawl.cancel({ runId: '00000000-0000-0000-0000-000000000000' }))
      .rejects.toThrow(/not found/i);
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

  it('stops after opts.limit items and leaves the rest pending', async () => {
    // Fake claim serves 5 items; limit 2 → exactly 2 extractItem calls, then finalise.
    const claimed: string[] = [];
    const items = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id }) as never);
    let i = 0;
    const outcome = await executeRun('run-1', {
      claim: async () => { const it = items[i] ?? null; if (it) { i++; claimed.push((it as { id: string }).id); } return it; },
      extractItem: async () => ({ row: {}, extractionId: 'x' }),
      onDone: async () => {},
      onFailed: async () => {},
      isCancelled: async () => false,
      finalise: async () => 'partial',
    } as never, { limit: 2 });
    expect(claimed).toEqual(['a', 'b']);
    expect(outcome.extracted).toBe(2);
  });
});

// ─── Task 13: the certification gate ────────────────────────────────────────

describe('crawl.execute — certification gate', () => {
  async function seedCustomerSchemaRun() {
    const [org] = await db.insert(orgs).values({ name: SLUG, slug: SLUG }).returning();
    orgId = org!.id;
    const [project] = await db.insert(projects).values({ orgId: org!.id, name: SLUG, slug: SLUG }).returning();
    const [dataset] = await db.insert(datasets).values({ projectId: project!.id, name: SLUG, slug: SLUG, schema: [] }).returning();
    const [source] = await db.insert(sources).values({
      datasetId: dataset!.id, name: SLUG, slug: SLUG, country: 'US',
      schemaDefinition: [{ key: 'price', name: 'Price', type: 'money', description: 'x', concept: 'price' }],
    }).returning();
    const [run] = await db.insert(runs).values({ sourceId: source!.id, status: 'planned' }).returning();
    await db.insert(runItems).values({
      runId: run!.id, kind: 'detail', url: 'https://example.com/p/1', inputIndex: 0, status: 'pending',
    });
    return run!.id;
  }

  it('refuses to execute a run whose Source has a customer schema but no current certification', async () => {
    const runId = await seedCustomerSchemaRun();
    await expect(caller.crawl.execute({ runId, dryRun: true }))
      .rejects.toThrow(/Verify the schema before extracting/);
    // Refused before the requeue/dryRun bookkeeping ran: nothing was touched.
    const [row] = await db.select().from(runs).where(eq(runs.id, runId));
    expect(row!.status).toBe('planned');
  });
});

// Finding 1 (critical, final-review-findings.md): a probe stopped by its own
// sample limit (PROBE_SAMPLE_LIMIT=3 of up to 30 planned items) must still
// reach a TERMINAL status with completedAt set — not roll up to 'extracting'
// forever with 27 items left `pending`. The unit-level executeRun tests all
// stub `finalise`/`rollUpStatus`'s inputs, which is exactly how this bug hid:
// this test exercises the REAL roll-up path — real claimNextItem, real
// markItemDone, real finaliseRun against the database — with nothing stubbed
// except extractItem (no browser) and the limit itself.
describe('executeRun — a limit-stopped run rolls up through the real finalise path', () => {
  async function seedRunWithPendingDetailItems(count: number) {
    const [org] = await db.insert(orgs).values({ name: SLUG, slug: SLUG }).returning();
    orgId = org!.id;
    const [project] = await db.insert(projects).values({ orgId: org!.id, name: SLUG, slug: SLUG }).returning();
    const [dataset] = await db.insert(datasets).values({ projectId: project!.id, name: SLUG, slug: SLUG, schema: [] }).returning();
    const [source] = await db.insert(sources).values({ datasetId: dataset!.id, name: SLUG, slug: SLUG, country: 'US' }).returning();
    const [run] = await db.insert(runs).values({ sourceId: source!.id, status: 'extracting', inputLabel: 'probe' }).returning();
    await db.insert(runItems).values(
      Array.from({ length: count }, (_, i) => ({
        runId: run!.id, kind: 'detail' as const, url: `https://example.com/p/${i}`, inputIndex: 0, status: 'pending' as const,
      })),
    );
    return run!.id;
  }

  it('finalises to a terminal status with completedAt set once the sample limit is reached, not stuck at extracting', async () => {
    const runId = await seedRunWithPendingDetailItems(30);

    const outcome = await executeRun(runId, {
      claim: (id) => claimNextItem(db, id),
      extractItem: async () => ({ row: { title: 'x' }, extractionId: null, targetFields: null }),
      onDone: (itemId, extractionId) => markItemDone(db, itemId, extractionId),
      onFailed: async () => {},
      isCancelled: async () => false,
      finalise: (_rowCount, cancelled, limitReached) => finaliseRun(db, runId, cancelled, limitReached),
    }, { limit: 3 });

    expect(outcome.extracted).toBe(3);

    const [row] = await db.select().from(runs).where(eq(runs.id, runId));
    // Not 'extracting': that status means "a loop is still working this run",
    // which isRunActive reads as license to poll crawl.status every 3s
    // forever, and runControls reads as license to offer Stop into a
    // 'cancelling' write nothing will ever observe.
    expect(row!.status).not.toBe('extracting');
    // A non-terminal status leaves completedAt null by finaliseRun's own
    // rule (`completedAt: status === 'extracting' ? null : new Date()`), so
    // asserting it is set is the same check from the other side.
    expect(row!.completedAt).not.toBeNull();

    const items = await db.select().from(runItems).where(eq(runItems.runId, runId));
    expect(items.filter((i) => i.status === 'pending')).toHaveLength(27);
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

  // N3: the dashboard's "Resume N stalled" button appears the moment
  // `running > 0`, but the reclaim only acts past the 30-minute threshold.
  // Without the count in the response, a click inside that window launched a
  // chromium, claimed nothing, finalised straight back to `extracting`, and
  // told the operator nothing — while the tooltip promised it had "reclaimed
  // any item abandoned mid-extraction". The caller has to be able to say what
  // actually happened.
  it('reports how many stalled items it reclaimed', async () => {
    const runId = await seedRunWithStaleRunningItem(45);
    const result = await caller.crawl.execute({ runId, dryRun: true });
    expect(result.requeued).toBe(1);
  });

  it('reports zero when the stalled item is still inside the threshold', async () => {
    const runId = await seedRunWithStaleRunningItem(1);
    const result = await caller.crawl.execute({ runId, dryRun: true });
    expect(result.requeued).toBe(0);
  });
});

// Finding 1 (critical, final-review-findings.md): every non-initial
// execution path of a backfill run goes through `crawl.execute` — Retry-N-
// failed, Extract-N-pending, crash-resume — and it used to call
// `startExecution` with no `mergeToParent` at all, so a healed item's row
// landed only in the backfill run's own extraction and never merged into the
// parent, silently breaking R4's "'done' MEANS merged" the moment an
// operator retried instead of using the original backfill click.
describe('crawl.execute — mergeToParent for backfill runs (Finding 1)', () => {
  async function seedBackfillRunWithFailedItem() {
    const [org] = await db.insert(orgs).values({ name: SLUG, slug: SLUG }).returning();
    orgId = org!.id;
    const [project] = await db.insert(projects).values({ orgId: org!.id, name: SLUG, slug: SLUG }).returning();
    const [dataset] = await db.insert(datasets).values({ projectId: project!.id, name: SLUG, slug: SLUG, schema: [] }).returning();
    const [source] = await db.insert(sources).values({ datasetId: dataset!.id, name: SLUG, slug: SLUG, country: 'US' }).returning();
    const [parentRun] = await db.insert(runs).values({ sourceId: source!.id, status: 'completed', completedAt: new Date() }).returning();
    const [backfillRun] = await db.insert(runs).values({
      sourceId: source!.id, status: 'partial', parentRunId: parentRun!.id, inputLabel: 'backfill',
    }).returning();
    await db.insert(runItems).values({
      runId: backfillRun!.id, kind: 'detail', url: 'https://example.com/p/1', inputIndex: 0,
      status: 'failed', error: 'blocked',
    });
    return backfillRun!.id;
  }

  it('passes mergeToParent: true when the run being executed has a parentRunId', async () => {
    startExecutionMock.mockResolvedValue(undefined);
    const runId = await seedBackfillRunWithFailedItem();

    await caller.crawl.execute({ runId, retryFailed: true });

    expect(startExecutionMock).toHaveBeenCalledTimes(1);
    const call = startExecutionMock.mock.calls[0]!;
    expect(call[0]).toBe(runId);
    expect(call[4]).toEqual({ mergeToParent: true });
  });

  it('does not set mergeToParent for a plain (non-backfill) run', async () => {
    startExecutionMock.mockResolvedValue(undefined);
    const runId = await seedPlannedRun(); // no parentRunId

    await caller.crawl.execute({ runId, retryFailed: true });

    expect(startExecutionMock).toHaveBeenCalledTimes(1);
    const call = startExecutionMock.mock.calls[0]!;
    expect(call[0]).toBe(runId);
    expect(call[4]).toBeUndefined();
  });
});
