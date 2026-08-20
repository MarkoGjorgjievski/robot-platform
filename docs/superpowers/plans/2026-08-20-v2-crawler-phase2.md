# v2 Crawler — Plan B: Phase 2 (`execute`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a planned work list into extracted data — claim each `run_items` row, extract it through the existing chain, record its result, and make the whole run readable and exportable as one dataset.

**Architecture:** `run_items` is the queue. A sequential in-process loop claims one pending detail item at a time with `FOR UPDATE SKIP LOCKED`, runs the existing `runExtraction` against it, writes a capture + extraction, and stamps the item. The run rolls up to `completed` / `partial` / `failed`. The read side then unions a run's extractions so the run view and the CSV/JSON export show every row, not just the last one.

**Tech Stack:** TypeScript ESM, pnpm workspaces, Drizzle ORM + PostgreSQL, tRPC v11 + Zod, Playwright, Vitest.

**Spec:** [`docs/superpowers/specs/2026-08-19-v2-crawler-design.md`](../specs/2026-08-19-v2-crawler-design.md) — §1.2, §3, §3.1, §3.2, §4.

## Global Constraints

- All packages are ESM (`"type": "module"`). **Relative imports must carry the `.js` extension.**
- Node ≥ 20.12. Tests are Vitest.
- **Both gates must be run explicitly and both must be clean:** `pnpm -r test` AND `pnpm typecheck`. `pnpm -r test` does NOT run tsc — an earlier task in this project shipped a type error precisely because it only ran the test gate. When touching the dashboard also run `pnpm --filter @robot/dashboard exec tsc --noEmit`.
- Postgres is already running (docker container `robot-platform-db`, user `postgres`, db `robot_platform`). Do not start or stop containers. Any row a test inserts must be removed again — this database is shared.
- Run status vocabulary, verbatim from the spec: `planning → planned → extracting → completed | partial | failed`, plus `cancelling` / `cancelled`. `partial` means some items failed and is the normal outcome at scale.
- Item status vocabulary, verbatim: `'pending' | 'running' | 'done' | 'failed'`. Only `kind='detail'` items are claimed; `kind='listing'` items are already `done` at plan time.
- **No automatic retries** (spec §3.1). The dominant failure is anti-bot blocking, and retrying two seconds later spends money to get blocked again. `execute` is idempotent and resumable; `retryFailed: true` re-attempts failures only when asked.
- Row merge order, verbatim from §1.4: `{ ...input, ...listing, ...detail, _url, _page_number }` — the origins are disjoint, so there are no precedence rules.
- Commits: focused and single-purpose, conventional-commit prefixes.

## What already exists (do not rebuild)

| Thing | Where | Note |
|---|---|---|
| `run_items` table | `packages/db/src/schema.ts` (`runItems`) | columns: `runId, kind, url, inputIndex, inputValues, listingValues, pageNumber, parentId, status, attempts, error, extractionId, startedAt, completedAt` |
| `planRun` (phase 1) | `packages/scraper/src/crawl/plan-run.ts` | produces the work list this plan consumes |
| `mergeRow` | `packages/scraper/src/crawl/merge-row.ts` | exported from `@robot/scraper`; **written for exactly this loop and not yet used by anything** |
| `partitionSchemaByOrigin` | `packages/scraper/src/crawl/partition-schema.ts` | gives `.detail` and `.input` field lists |
| `runExtraction` | `packages/scraper/src/extraction-orchestrator.ts` | takes the per-domain lock itself; do NOT wrap it in another lock |
| `crawl.plan` / `crawl.items` | `packages/api/src/routers/crawl.ts` | the router this plan extends |
| Export serializer + loader | `packages/api/src/export/` | `loadRunExport` currently reads only the LATEST extraction |
| Work list UI | `packages/dashboard/src/routes/source-run-detail.tsx` (`WorkList`) | renders `crawl.items` |

---

### Task 1: Claim one pending item, atomically

**Files:**
- Create: `packages/api/src/crawl/claim-item.ts`
- Test: `packages/api/src/crawl/claim-item.test.ts`

**Interfaces:**
- Consumes: `runItems` from `@robot/db`
- Produces: `claimNextItem(db, runId): Promise<ClaimedItem | null>` where
  ```typescript
  export type ClaimedItem = {
    id: string; url: string; inputIndex: number;
    inputValues: Record<string, unknown>; listingValues: Record<string, unknown>;
    pageNumber: number | null; attempts: number;
  };
  ```

- [ ] **Step 1: Write the failing test**

```typescript
// packages/api/src/crawl/claim-item.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { db, runs, runItems, sources, orgs, projects, datasets } from '@robot/db';
import { eq } from 'drizzle-orm';
import { claimNextItem } from './claim-item.js';

const SLUG = 'test-claim-item';

async function seedRun(items: Array<{ kind: 'listing' | 'detail'; url: string; status?: string }>) {
  const [org] = await db.insert(orgs).values({ name: SLUG, slug: SLUG }).returning();
  const [project] = await db.insert(projects).values({ orgId: org!.id, name: SLUG, slug: SLUG }).returning();
  const [dataset] = await db.insert(datasets).values({ projectId: project!.id, name: SLUG, slug: SLUG, schema: [] }).returning();
  const [source] = await db.insert(sources).values({
    datasetId: dataset!.id, name: SLUG, slug: SLUG, country: 'US', isSandbox: false,
  }).returning();
  const [run] = await db.insert(runs).values({ sourceId: source!.id, status: 'planned' }).returning();
  await db.insert(runItems).values(items.map((i, index) => ({
    runId: run!.id, kind: i.kind, url: i.url, inputIndex: index,
    status: i.status ?? 'pending',
  })));
  return { runId: run!.id, orgId: org!.id };
}

let orgId: string | null = null;
afterEach(async () => {
  if (orgId) await db.delete(orgs).where(eq(orgs.id, orgId));
  orgId = null;
});

describe('claimNextItem', () => {
  it('claims a pending detail item and marks it running', async () => {
    const seeded = await seedRun([{ kind: 'detail', url: 'https://example.com/p/1' }]);
    orgId = seeded.orgId;

    const claimed = await claimNextItem(db, seeded.runId);
    expect(claimed?.url).toBe('https://example.com/p/1');

    const [row] = await db.select().from(runItems).where(eq(runItems.id, claimed!.id));
    expect(row!.status).toBe('running');
    expect(row!.attempts).toBe(1);
    expect(row!.startedAt).toBeInstanceOf(Date);
  });

  it('never claims a listing item — those were done at plan time', async () => {
    const seeded = await seedRun([{ kind: 'listing', url: 'https://example.com/c/1', status: 'done' }]);
    orgId = seeded.orgId;
    expect(await claimNextItem(db, seeded.runId)).toBeNull();
  });

  it('never re-claims an item that already failed', async () => {
    const seeded = await seedRun([{ kind: 'detail', url: 'https://example.com/p/1', status: 'failed' }]);
    orgId = seeded.orgId;
    expect(await claimNextItem(db, seeded.runId)).toBeNull();
  });

  it('returns null when the queue is empty', async () => {
    const seeded = await seedRun([{ kind: 'detail', url: 'https://example.com/p/1', status: 'done' }]);
    orgId = seeded.orgId;
    expect(await claimNextItem(db, seeded.runId)).toBeNull();
  });

  it('hands the same item to only one caller when two claim at once', async () => {
    const seeded = await seedRun([{ kind: 'detail', url: 'https://example.com/p/1' }]);
    orgId = seeded.orgId;

    const [a, b] = await Promise.all([
      claimNextItem(db, seeded.runId),
      claimNextItem(db, seeded.runId),
    ]);
    const claimedIds = [a?.id, b?.id].filter(Boolean);
    expect(claimedIds).toHaveLength(1);
  });

  it('carries the values the row needs for its output row', async () => {
    const seeded = await seedRun([{ kind: 'detail', url: 'https://example.com/p/1' }]);
    orgId = seeded.orgId;
    await db.update(runItems)
      .set({ inputValues: { slug: 'shelves' }, listingValues: { category_name: 'Shelves' }, pageNumber: 2 })
      .where(eq(runItems.runId, seeded.runId));

    const claimed = await claimNextItem(db, seeded.runId);
    expect(claimed?.inputValues).toEqual({ slug: 'shelves' });
    expect(claimed?.listingValues).toEqual({ category_name: 'Shelves' });
    expect(claimed?.pageNumber).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @robot/api exec vitest run src/crawl/claim-item.test.ts`
Expected: FAIL — `Cannot find module './claim-item.js'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/api/src/crawl/claim-item.ts
// Taking one item off the queue, exactly once.
//
// `FOR UPDATE SKIP LOCKED` is what makes this safe to call from two places at
// the same time: a second caller skips the locked row instead of blocking on it
// or, worse, handing out the same URL twice. The loop is sequential today, but a
// re-entered `execute` (a crash, a resumed run, a second api-server) must never
// double-fetch a page.

import { sql } from 'drizzle-orm';
import type { db as Database } from '@robot/db';

export type ClaimedItem = {
  id: string;
  url: string;
  inputIndex: number;
  inputValues: Record<string, unknown>;
  listingValues: Record<string, unknown>;
  pageNumber: number | null;
  attempts: number;
};

export async function claimNextItem(
  db: typeof Database,
  runId: string,
): Promise<ClaimedItem | null> {
  const result = await db.execute(sql`
    UPDATE run_items
       SET status = 'running',
           attempts = attempts + 1,
           started_at = now()
     WHERE id = (
       SELECT id FROM run_items
        WHERE run_id = ${runId}
          AND kind = 'detail'
          AND status = 'pending'
        ORDER BY input_index, page_number NULLS FIRST, created_at
        FOR UPDATE SKIP LOCKED
        LIMIT 1
     )
    RETURNING id, url, input_index, input_values, listing_values, page_number, attempts
  `);

  const row = (result as unknown as { rows: Array<Record<string, unknown>> }).rows?.[0];
  if (!row) return null;

  return {
    id: String(row.id),
    url: String(row.url),
    inputIndex: Number(row.input_index ?? 0),
    inputValues: (row.input_values ?? {}) as Record<string, unknown>,
    listingValues: (row.listing_values ?? {}) as Record<string, unknown>,
    pageNumber: row.page_number === null || row.page_number === undefined ? null : Number(row.page_number),
    attempts: Number(row.attempts ?? 0),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @robot/api exec vitest run src/crawl/claim-item.test.ts`
Expected: PASS — 6 tests

If `db.execute` returns rows under a different property in this Drizzle version, inspect the real shape with a scratch `console.log` and adapt the accessor — do not change the SQL.

- [ ] **Step 5: Verify the database is left clean**

```bash
docker exec -e PGPASSWORD=postgres robot-platform-db psql -U postgres -d robot_platform -c "select (select count(*) from orgs where slug like 'test-%') orgs, (select count(*) from run_items) items;"
```

Expected: `0` test orgs. (`run_items` may hold rows from earlier real crawls — that is fine; only assert no `test-` rows remain.)

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/crawl/claim-item.ts packages/api/src/crawl/claim-item.test.ts
git commit -m "feat(crawl): claim one pending item atomically with SKIP LOCKED"
```

---

### Task 2: Record an item's outcome

**Files:**
- Create: `packages/api/src/crawl/record-outcome.ts`
- Test: `packages/api/src/crawl/record-outcome.test.ts`

**Interfaces:**
- Consumes: `runItems` from `@robot/db`
- Produces: `markItemDone(db, itemId, extractionId): Promise<void>`; `markItemFailed(db, itemId, message): Promise<void>`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/api/src/crawl/record-outcome.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, runs, runItems, sources, orgs, projects, datasets } from '@robot/db';
import { markItemDone, markItemFailed } from './record-outcome.js';

const SLUG = 'test-record-outcome';
let orgId: string | null = null;

async function seedItem() {
  const [org] = await db.insert(orgs).values({ name: SLUG, slug: SLUG }).returning();
  orgId = org!.id;
  const [project] = await db.insert(projects).values({ orgId: org!.id, name: SLUG, slug: SLUG }).returning();
  const [dataset] = await db.insert(datasets).values({ projectId: project!.id, name: SLUG, slug: SLUG, schema: [] }).returning();
  const [source] = await db.insert(sources).values({ datasetId: dataset!.id, name: SLUG, slug: SLUG, country: 'US' }).returning();
  const [run] = await db.insert(runs).values({ sourceId: source!.id, status: 'extracting' }).returning();
  const [item] = await db.insert(runItems).values({
    runId: run!.id, kind: 'detail', url: 'https://example.com/p/1', inputIndex: 0, status: 'running',
  }).returning();
  return { itemId: item!.id };
}

afterEach(async () => {
  if (orgId) await db.delete(orgs).where(eq(orgs.id, orgId));
  orgId = null;
});

describe('markItemDone', () => {
  it('records success with its extraction and a completion time', async () => {
    const { itemId } = await seedItem();
    await markItemDone(db, itemId, null);
    const [row] = await db.select().from(runItems).where(eq(runItems.id, itemId));
    expect(row!.status).toBe('done');
    expect(row!.completedAt).toBeInstanceOf(Date);
    expect(row!.error).toBeNull();
  });
});

describe('markItemFailed', () => {
  it('records the failure reason, because a bare failed status explains nothing', async () => {
    const { itemId } = await seedItem();
    await markItemFailed(db, itemId, 'navigation timeout after 30000ms');
    const [row] = await db.select().from(runItems).where(eq(runItems.id, itemId));
    expect(row!.status).toBe('failed');
    expect(row!.error).toBe('navigation timeout after 30000ms');
    expect(row!.completedAt).toBeInstanceOf(Date);
  });

  it('truncates a huge error rather than storing a stack dump', async () => {
    const { itemId } = await seedItem();
    await markItemFailed(db, itemId, 'x'.repeat(5000));
    const [row] = await db.select().from(runItems).where(eq(runItems.id, itemId));
    expect(row!.error!.length).toBeLessThanOrEqual(1000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @robot/api exec vitest run src/crawl/record-outcome.test.ts`
Expected: FAIL — `Cannot find module './record-outcome.js'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/api/src/crawl/record-outcome.ts
// How an item's fate is written down. Separate from the loop so the loop reads
// as what it does, and so both outcomes are impossible to get subtly different.

import { eq } from 'drizzle-orm';
import { runItems } from '@robot/db';
import type { db as Database } from '@robot/db';

/** A page's error can arrive as a full stack; the column is for a reason, not a dump. */
const MAX_ERROR = 1000;

export async function markItemDone(
  db: typeof Database,
  itemId: string,
  extractionId: string | null,
): Promise<void> {
  await db.update(runItems)
    .set({ status: 'done', extractionId, error: null, completedAt: new Date() })
    .where(eq(runItems.id, itemId));
}

export async function markItemFailed(
  db: typeof Database,
  itemId: string,
  message: string,
): Promise<void> {
  await db.update(runItems)
    .set({ status: 'failed', error: message.slice(0, MAX_ERROR), completedAt: new Date() })
    .where(eq(runItems.id, itemId));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @robot/api exec vitest run src/crawl/record-outcome.test.ts`
Expected: PASS — 3 tests

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/crawl/record-outcome.ts packages/api/src/crawl/record-outcome.test.ts
git commit -m "feat(crawl): record each item's outcome with its reason"
```

---

### Task 3: Roll a run up from its items

**Files:**
- Create: `packages/api/src/crawl/roll-up-run.ts`
- Test: `packages/api/src/crawl/roll-up-run.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces: `rollUpStatus(counts: { pending: number; done: number; failed: number }): 'completed' | 'partial' | 'failed' | 'extracting'`; `finaliseRun(db, runId, rowCount): Promise<'completed' | 'partial' | 'failed' | 'extracting'>`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/api/src/crawl/roll-up-run.test.ts
import { describe, it, expect } from 'vitest';
import { rollUpStatus } from './roll-up-run.js';

describe('rollUpStatus', () => {
  it('is completed when every item succeeded', () => {
    expect(rollUpStatus({ pending: 0, done: 12, failed: 0 })).toBe('completed');
  });

  it('is partial when some failed — the normal outcome at scale', () => {
    // Spec §1.2: "480 of 500 succeeded" is what a real run looks like, and the
    // old binary completed/failed could not say it.
    expect(rollUpStatus({ pending: 0, done: 480, failed: 20 })).toBe('partial');
  });

  it('is failed only when nothing succeeded at all', () => {
    expect(rollUpStatus({ pending: 0, done: 0, failed: 8 })).toBe('failed');
  });

  it('stays extracting while work remains', () => {
    expect(rollUpStatus({ pending: 3, done: 5, failed: 1 })).toBe('extracting');
  });

  it('treats a run with no items at all as completed rather than failed', () => {
    // A detail-mode source whose InputSet was empty planned nothing. That is an
    // empty result, not an error.
    expect(rollUpStatus({ pending: 0, done: 0, failed: 0 })).toBe('completed');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @robot/api exec vitest run src/crawl/roll-up-run.test.ts`
Expected: FAIL — `Cannot find module './roll-up-run.js'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/api/src/crawl/roll-up-run.ts
// What a run's status is, given what happened to its items.

import { and, eq, sql } from 'drizzle-orm';
import { runs, runItems } from '@robot/db';
import type { db as Database } from '@robot/db';

export type RunRollup = 'completed' | 'partial' | 'failed' | 'extracting';

export function rollUpStatus(counts: { pending: number; done: number; failed: number }): RunRollup {
  if (counts.pending > 0) return 'extracting';
  if (counts.failed === 0) return 'completed';
  // `partial` exists because at scale "480 of 500 succeeded" is the normal
  // outcome, and a binary completed/failed cannot express it.
  return counts.done > 0 ? 'partial' : 'failed';
}

/**
 * Writes the run's final state and its extracted row count.
 *
 * `resultCount` means EXTRACTED ROWS everywhere else in this codebase — the
 * dashboard renders it as "N rows" — so phase 1 deliberately leaves it null and
 * phase 2 is what fills it in.
 */
export async function finaliseRun(
  db: typeof Database,
  runId: string,
  rowCount: number,
): Promise<RunRollup> {
  const [counts] = await db
    .select({
      pending: sql<number>`count(*) filter (where ${runItems.status} = 'pending')::int`,
      done: sql<number>`count(*) filter (where ${runItems.status} = 'done')::int`,
      failed: sql<number>`count(*) filter (where ${runItems.status} = 'failed')::int`,
    })
    .from(runItems)
    .where(and(eq(runItems.runId, runId), eq(runItems.kind, 'detail')));

  const status = rollUpStatus({
    pending: Number(counts?.pending ?? 0),
    done: Number(counts?.done ?? 0),
    failed: Number(counts?.failed ?? 0),
  });

  await db.update(runs)
    .set({
      status,
      resultCount: rowCount,
      completedAt: status === 'extracting' ? null : new Date(),
    })
    .where(eq(runs.id, runId));

  return status;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @robot/api exec vitest run src/crawl/roll-up-run.test.ts`
Expected: PASS — 5 tests

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/crawl/roll-up-run.ts packages/api/src/crawl/roll-up-run.test.ts
git commit -m "feat(crawl): roll a run up from its items, including partial"
```

---

### Task 4: The execution loop

**Files:**
- Create: `packages/api/src/crawl/execute-run.ts`
- Test: `packages/api/src/crawl/execute-run.test.ts`

**Interfaces:**
- Consumes: `claimNextItem` (Task 1), `markItemDone` / `markItemFailed` (Task 2), `finaliseRun` (Task 3), `mergeRow` and `partitionSchemaByOrigin` from `@robot/scraper`
- Produces:
  ```typescript
  export type ExecuteDeps = {
    claim: (runId: string) => Promise<ClaimedItem | null>;
    extractItem: (item: ClaimedItem) => Promise<{ row: Record<string, unknown>; extractionId: string | null }>;
    onDone: (itemId: string, extractionId: string | null) => Promise<void>;
    onFailed: (itemId: string, message: string) => Promise<void>;
    isCancelled: () => Promise<boolean>;
    finalise: (rowCount: number) => Promise<string>;
  };
  export function executeRun(runId: string, deps: ExecuteDeps): Promise<ExecuteOutcome>;
  export type ExecuteOutcome = { extracted: number; failed: number; cancelled: boolean; status: string };
  ```

- [ ] **Step 1: Write the failing test**

```typescript
// packages/api/src/crawl/execute-run.test.ts
import { describe, it, expect } from 'vitest';
import { executeRun, type ExecuteDeps } from './execute-run.js';
import type { ClaimedItem } from './claim-item.js';

const item = (id: string): ClaimedItem => ({
  id, url: `https://example.com/p/${id}`, inputIndex: 0,
  inputValues: {}, listingValues: {}, pageNumber: 1, attempts: 1,
});

function harness(overrides: Partial<ExecuteDeps> = {}, queue: ClaimedItem[] = []) {
  const done: string[] = [];
  const failed: Array<{ id: string; message: string }> = [];
  let finalRowCount = -1;
  const deps: ExecuteDeps = {
    claim: async () => queue.shift() ?? null,
    extractItem: async (i) => ({ row: { title: `row ${i.id}` }, extractionId: `x-${i.id}` }),
    onDone: async (id) => { done.push(id); },
    onFailed: async (id, message) => { failed.push({ id, message }); },
    isCancelled: async () => false,
    finalise: async (rowCount) => { finalRowCount = rowCount; return 'completed'; },
    ...overrides,
  };
  return { deps, done, failed, rowCount: () => finalRowCount };
}

describe('executeRun', () => {
  it('works through every pending item', async () => {
    const h = harness({}, [item('1'), item('2'), item('3')]);
    const outcome = await executeRun('run-1', h.deps);
    expect(h.done).toEqual(['1', '2', '3']);
    expect(outcome.extracted).toBe(3);
  });

  it('keeps going when one item throws, and records why', async () => {
    // Anti-bot blocks one page in a run of hundreds. Losing the other 299 to it
    // would be the worst possible failure mode.
    const h = harness({
      extractItem: async (i) => {
        if (i.id === '2') throw new Error('blocked: captcha');
        return { row: { title: i.id }, extractionId: null };
      },
    }, [item('1'), item('2'), item('3')]);

    const outcome = await executeRun('run-1', h.deps);
    expect(h.done).toEqual(['1', '3']);
    expect(h.failed).toEqual([{ id: '2', message: 'blocked: captcha' }]);
    expect(outcome.extracted).toBe(2);
    expect(outcome.failed).toBe(1);
  });

  it('stops between items when the run is cancelled, leaving the rest pending', async () => {
    let seen = 0;
    const h = harness({
      isCancelled: async () => seen >= 2,
      extractItem: async (i) => { seen++; return { row: {}, extractionId: null }; },
    }, [item('1'), item('2'), item('3'), item('4')]);

    const outcome = await executeRun('run-1', h.deps);
    expect(outcome.cancelled).toBe(true);
    expect(h.done).toEqual(['1', '2']);
  });

  it('checks for cancellation before doing any work at all', async () => {
    const h = harness({ isCancelled: async () => true }, [item('1')]);
    const outcome = await executeRun('run-1', h.deps);
    expect(outcome.cancelled).toBe(true);
    expect(h.done).toEqual([]);
  });

  it('finalises with the number of rows actually extracted', async () => {
    const h = harness({}, [item('1'), item('2')]);
    await executeRun('run-1', h.deps);
    expect(h.rowCount()).toBe(2);
  });

  it('finalises even when every item failed', async () => {
    const h = harness({
      extractItem: async () => { throw new Error('nope'); },
    }, [item('1'), item('2')]);
    const outcome = await executeRun('run-1', h.deps);
    expect(outcome.failed).toBe(2);
    expect(h.rowCount()).toBe(0);
  });

  it('does nothing gracefully when the queue is already empty', async () => {
    const h = harness({}, []);
    const outcome = await executeRun('run-1', h.deps);
    expect(outcome).toMatchObject({ extracted: 0, failed: 0, cancelled: false });
  });

  it('surfaces a failure whose error is not an Error object', async () => {
    const h = harness({
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      extractItem: async () => { throw 'plain string'; },
    }, [item('1')]);
    await executeRun('run-1', h.deps);
    expect(h.failed[0]?.message).toContain('plain string');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @robot/api exec vitest run src/crawl/execute-run.test.ts`
Expected: FAIL — `Cannot find module './execute-run.js'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/api/src/crawl/execute-run.ts
// Phase 2: turn a work list into data, one item at a time.
//
// Sequential on purpose. A Source is one domain, and `runExtraction` already
// serialises same-domain work behind the per-domain lock plus a 2s politeness
// delay — so parallelism here would only fight the politeness rule that keeps us
// welcome on the site.
//
// Every collaborator is injected. The loop's logic — keep going after a failure,
// stop when cancelled, count what actually happened — is then testable without a
// browser, an API key, or a database.

import type { ClaimedItem } from './claim-item.js';

export type ExecuteDeps = {
  claim: (runId: string) => Promise<ClaimedItem | null>;
  extractItem: (item: ClaimedItem) => Promise<{ row: Record<string, unknown>; extractionId: string | null }>;
  onDone: (itemId: string, extractionId: string | null) => Promise<void>;
  onFailed: (itemId: string, message: string) => Promise<void>;
  isCancelled: () => Promise<boolean>;
  finalise: (rowCount: number) => Promise<string>;
};

export type ExecuteOutcome = {
  extracted: number;
  failed: number;
  cancelled: boolean;
  status: string;
};

export async function executeRun(runId: string, deps: ExecuteDeps): Promise<ExecuteOutcome> {
  let extracted = 0;
  let failed = 0;
  let cancelled = false;

  for (;;) {
    // Between items, never mid-item: a cancelled run leaves clean state, and an
    // item already claimed is finished rather than abandoned as `running`.
    if (await deps.isCancelled()) {
      cancelled = true;
      break;
    }

    const item = await deps.claim(runId);
    if (!item) break;

    try {
      const { extractionId } = await deps.extractItem(item);
      await deps.onDone(item.id, extractionId);
      extracted++;
    } catch (err) {
      // One blocked page must never cost the other 299 in the run.
      await deps.onFailed(item.id, err instanceof Error ? err.message : String(err));
      failed++;
    }
  }

  const status = await deps.finalise(extracted);
  return { extracted, failed, cancelled, status };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @robot/api exec vitest run src/crawl/execute-run.test.ts`
Expected: PASS — 8 tests

- [ ] **Step 5: Prove the failure isolation has teeth**

Temporarily remove the `try/catch` around `deps.extractItem` so a throw escapes the loop, re-run the test file, and confirm "keeps going when one item throws" FAILS. Restore it and confirm the suite passes again. Report both observations.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/crawl/execute-run.ts packages/api/src/crawl/execute-run.test.ts
git commit -m "feat(crawl): the phase 2 execution loop, with failure isolation and cancel"
```

---

### Task 5: Extract one item for real

**Files:**
- Create: `packages/api/src/crawl/extract-item.ts`
- Test: `packages/api/src/crawl/extract-item.test.ts`

**Interfaces:**
- Consumes: `ClaimedItem` (Task 1); `runExtraction`, `mergeRow`, `partitionSchemaByOrigin`, `OriginField` from `@robot/scraper`; `captures`, `extractions` from `@robot/db`
- Produces:
  ```typescript
  export type ExtractItemDeps = {
    browser: IBrowser;
    agent: ExtractionAgent | null;
    sourceId: string;
    runId: string;
    schema: OriginField[];
    extract?: typeof runExtraction;
  };
  export function extractItem(db, item: ClaimedItem, deps: ExtractItemDeps):
    Promise<{ row: Record<string, unknown>; extractionId: string | null }>;
  ```

- [ ] **Step 1: Write the failing test**

```typescript
// packages/api/src/crawl/extract-item.test.ts
import { describe, it, expect } from 'vitest';
import type { IBrowser } from '@robot/browser';
import { extractItem } from './extract-item.js';
import type { ClaimedItem } from './claim-item.js';

const ITEM: ClaimedItem = {
  id: 'item-1',
  url: 'https://example.com/p/1',
  inputIndex: 0,
  inputValues: { category_slug: 'shelves' },
  listingValues: { category_name: 'Shelves' },
  pageNumber: 2,
  attempts: 1,
};

const SCHEMA = [
  { name: 'title', type: 'string', origin: 'detail' as const },
  { name: 'category_name', type: 'string', origin: 'listing' as const },
  { name: 'requested_category', type: 'string', origin: 'input' as const, input_column: 'category_slug' },
];

const fakeBrowser = {} as IBrowser;

/** Persistence is stubbed: this test is about the ROW, not about Drizzle. */
const fakeDb = {
  insert: () => ({ values: () => ({ returning: async () => [{ id: 'ext-1' }] }) }),
} as never;

describe('extractItem', () => {
  it('asks the chain only for detail-origin fields', async () => {
    let requestedFields: string[] = [];
    await extractItem(fakeDb, ITEM, {
      browser: fakeBrowser, agent: null, sourceId: 's', runId: 'r', schema: SCHEMA,
      extract: async (request) => {
        requestedFields = request.fields.map((f) => f.name);
        return { data: [{ title: 'Kallax' }], plan: null, confidence: 0.9, sources: {},
          fieldCount: { found: 1, total: 1 }, fieldsByTier: { requested: [], discovered: [] }, cacheHit: false };
      },
    });
    // A listing-origin field must never be re-fetched from the detail page: it was
    // already captured, and asking again risks a wrong value from a page that
    // does not have it.
    expect(requestedFields).toEqual(['title']);
  });

  it('merges the detail row with what the listing and the input already knew', async () => {
    const result = await extractItem(fakeDb, ITEM, {
      browser: fakeBrowser, agent: null, sourceId: 's', runId: 'r', schema: SCHEMA,
      extract: async () => ({ data: [{ title: 'Kallax' }], plan: null, confidence: 0.9, sources: {},
        fieldCount: { found: 1, total: 1 }, fieldsByTier: { requested: [], discovered: [] }, cacheHit: false }),
    });

    expect(result.row).toEqual({
      title: 'Kallax',
      category_name: 'Shelves',
      requested_category: 'shelves',
      _url: 'https://example.com/p/1',
      _page_number: 2,
    });
  });

  it('still produces a row when the detail page resolved nothing', async () => {
    const result = await extractItem(fakeDb, ITEM, {
      browser: fakeBrowser, agent: null, sourceId: 's', runId: 'r', schema: SCHEMA,
      extract: async () => ({ data: [], plan: null, confidence: 0, sources: {},
        fieldCount: { found: 0, total: 1 }, fieldsByTier: { requested: [], discovered: [] }, cacheHit: false }),
    });
    expect(result.row).toMatchObject({ category_name: 'Shelves', _url: 'https://example.com/p/1' });
  });

  it('lets an extraction failure propagate, so the loop can record it', async () => {
    await expect(extractItem(fakeDb, ITEM, {
      browser: fakeBrowser, agent: null, sourceId: 's', runId: 'r', schema: SCHEMA,
      extract: async () => { throw new Error('navigation timeout'); },
    })).rejects.toThrow('navigation timeout');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @robot/api exec vitest run src/crawl/extract-item.test.ts`
Expected: FAIL — `Cannot find module './extract-item.js'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/api/src/crawl/extract-item.ts
// One work item → one persisted row.
//
// The detail page is asked ONLY for detail-origin fields. Listing-origin values
// were captured during planning and travel on the item; re-asking the detail page
// for them risks a wrong value from a page that never had them, which is exactly
// what the origin partition exists to prevent.

import type { IBrowser } from '@robot/browser';
import {
  runExtraction, mergeRow, partitionSchemaByOrigin,
  type ExtractionAgent, type OriginField,
} from '@robot/scraper';
import { captures, extractions } from '@robot/db';
import type { db as Database } from '@robot/db';
import type { ClaimedItem } from './claim-item.js';

export type ExtractItemDeps = {
  browser: IBrowser;
  agent: ExtractionAgent | null;
  sourceId: string;
  runId: string;
  schema: OriginField[];
  /** Injected so the merge can be tested without a browser or an API key. */
  extract?: typeof runExtraction;
};

export async function extractItem(
  db: typeof Database,
  item: ClaimedItem,
  deps: ExtractItemDeps,
): Promise<{ row: Record<string, unknown>; extractionId: string | null }> {
  const partitions = partitionSchemaByOrigin(deps.schema);
  const extract = deps.extract ?? runExtraction;

  // runExtraction takes the per-domain lock itself, and this loop is sequential,
  // so nothing here holds a lock around it.
  const outcome = await extract(
    {
      url: item.url,
      pageType: 'detail',
      fields: partitions.detail.map((f) => ({ name: f.name, type: f.type })),
    },
    { browser: deps.browser, agent: deps.agent },
  );

  const row = mergeRow({
    inputFields: partitions.input,
    inputValues: item.inputValues,
    listingValues: item.listingValues,
    detailRow: outcome.data[0] ?? {},
    url: item.url,
    pageNumber: item.pageNumber,
  });

  const [capture] = await db.insert(captures).values({
    sourceId: deps.sourceId,
    runId: deps.runId,
    url: item.url,
    metadata: {},
  }).returning({ id: captures.id });

  const [extraction] = await db.insert(extractions).values({
    sourceId: deps.sourceId,
    captureId: capture!.id,
    runId: deps.runId,
    data: [row],
    rowCount: 1,
    confidence: Math.round((outcome.confidence ?? 0) * 100),
  }).returning({ id: extractions.id });

  return { row, extractionId: extraction?.id ?? null };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @robot/api exec vitest run src/crawl/extract-item.test.ts`
Expected: PASS — 4 tests

The stub `fakeDb` returns `[{ id: 'ext-1' }]` for every insert; if the code shape you write needs a different stub, adjust the STUB, never the assertions about the row.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/crawl/extract-item.ts packages/api/src/crawl/extract-item.test.ts
git commit -m "feat(crawl): extract one item and merge it with what planning learned"
```

---

### Task 6: `crawl.execute`, `crawl.status`, `crawl.cancel`

**Files:**
- Modify: `packages/api/src/routers/crawl.ts`
- Test: `packages/api/src/routers/crawl-execute.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–5
- Produces: `crawl.execute({ runId, retryFailed? })` → `{ runId, started: boolean }`; `crawl.status({ runId })` → `{ status, counts, rowCount }`; `crawl.cancel({ runId })` → `{ status }`

- [ ] **Step 1: Write the failing test**

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @robot/api exec vitest run src/routers/crawl-execute.test.ts`
Expected: FAIL — `crawl.status` / `crawl.execute` / `crawl.cancel` do not exist

- [ ] **Step 3: Add the three procedures**

Add to `packages/api/src/routers/crawl.ts` inside the router object. `dryRun` exists so the requeue behaviour is testable without launching a browser — it prepares the queue and returns without starting the loop.

```typescript
  status: publicProcedure
    .input(z.object({ runId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const run = await ctx.db.query.runs.findFirst({
        where: eq(runs.id, input.runId),
        columns: { id: true, status: true, resultCount: true, errorMessage: true },
      });
      if (!run) throw new TRPCError({ code: 'NOT_FOUND', message: `Run ${input.runId} not found` });

      const rows = await ctx.db.query.runItems.findMany({
        where: eq(runItems.runId, input.runId),
        columns: { kind: true, status: true },
      });
      const counts = { pending: 0, running: 0, done: 0, failed: 0, listing: 0, detail: 0 };
      for (const row of rows) {
        if (row.status in counts) counts[row.status as 'pending' | 'running' | 'done' | 'failed']++;
        if (row.kind === 'listing') counts.listing++;
        else counts.detail++;
      }
      return { status: run.status, counts, rowCount: run.resultCount ?? 0, errorMessage: run.errorMessage };
    }),

  cancel: publicProcedure
    .input(z.object({ runId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const run = await ctx.db.query.runs.findFirst({
        where: eq(runs.id, input.runId), columns: { id: true },
      });
      if (!run) throw new TRPCError({ code: 'NOT_FOUND', message: `Run ${input.runId} not found` });
      // The loop checks between items, so pending work stays pending and resume
      // is the same mechanism as cancel.
      await ctx.db.update(runs).set({ status: 'cancelling' }).where(eq(runs.id, input.runId));
      return { status: 'cancelling' as const };
    }),

  execute: publicProcedure
    .input(z.object({
      runId: z.string().uuid(),
      retryFailed: z.boolean().optional(),
      /** Prepare the queue and return without running — used by tests. */
      dryRun: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const run = await ctx.db.query.runs.findFirst({
        where: eq(runs.id, input.runId),
        with: { source: { columns: { id: true, datasetId: true }, with: { dataset: { columns: { schema: true } } } } },
      });
      if (!run) throw new TRPCError({ code: 'NOT_FOUND', message: `Run ${input.runId} not found` });
      if (!run.source) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Run has no Source' });

      if (input.retryFailed) {
        await ctx.db.update(runItems)
          .set({ status: 'pending', error: null })
          .where(and(eq(runItems.runId, input.runId), eq(runItems.status, 'failed')));
      }

      await ctx.db.update(runs).set({ status: 'extracting', startedAt: new Date() }).where(eq(runs.id, input.runId));
      if (input.dryRun) return { runId: input.runId, started: false };

      // Returns immediately: hundreds of items at ~30s each outlives any HTTP
      // request. All state lives in run_items, so progress is read with
      // crawl.status and a crash resumes by calling execute again.
      void startExecution(input.runId, run.source.id, (run.source.dataset?.schema ?? []) as OriginField[]);
      return { runId: input.runId, started: true };
    }),
```

- [ ] **Step 4: Add the background starter**

Add above the router in the same file:

```typescript
/**
 * Runs the loop outside the request. Deliberately not awaited: 200 items at
 * ~30s each is ~100 minutes, which no HTTP mutation can hold open. The honest
 * limit of having no job queue is that an api-server restart pauses the run —
 * `run_items` survives, so calling execute again resumes it.
 */
async function startExecution(runId: string, sourceId: string, schema: OriginField[]): Promise<void> {
  const browser = new PlaywrightBrowser();
  try {
    await browser.launch({ headless: true });
    const agent = new SchemaAgent();
    await executeRun(runId, {
      claim: (id) => claimNextItem(db, id),
      extractItem: (item) => extractItem(db, item, { browser, agent, sourceId, runId, schema }),
      onDone: (itemId, extractionId) => markItemDone(db, itemId, extractionId),
      onFailed: (itemId, message) => markItemFailed(db, itemId, message),
      isCancelled: async () => {
        const row = await db.query.runs.findFirst({ where: eq(runs.id, runId), columns: { status: true } });
        return row?.status === 'cancelling';
      },
      finalise: (rowCount) => finaliseRun(db, runId, rowCount),
    });
  } catch (err) {
    console.error(`[crawl] execution of run ${runId} failed:`, err);
    await db.update(runs)
      .set({ status: 'failed', errorMessage: (err as Error).message.slice(0, 1000), completedAt: new Date() })
      .where(eq(runs.id, runId));
  } finally {
    await browser.close();
  }
}
```

Add the imports this needs at the top of the file: `and` from `drizzle-orm`; `db` from `@robot/db`; `type OriginField` from `@robot/scraper`; and the four crawl modules (`claimNextItem`, `markItemDone`, `markItemFailed`, `finaliseRun`, `executeRun`, `extractItem`).

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @robot/api exec vitest run src/routers/crawl-execute.test.ts`
Expected: PASS — 7 tests

Run: `pnpm --filter @robot/api exec vitest run`
Expected: PASS — no regressions

- [ ] **Step 6: Confirm the database is clean**

```bash
docker exec -e PGPASSWORD=postgres robot-platform-db psql -U postgres -d robot_platform -c "select count(*) from orgs where slug like 'test-%';"
```

Expected: `0`

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/routers/crawl.ts packages/api/src/routers/crawl-execute.test.ts
git commit -m "feat(api): crawl.execute, crawl.status and crawl.cancel"
```

---

### Task 7: Read a whole run, not just its last extraction

**Files:**
- Modify: `packages/api/src/export/load-run-export.ts`
- Modify: `packages/api/src/routers/runs.ts` (the `getWithDetails` procedure)
- Test: `packages/api/src/export/load-run-export-aggregate.test.ts`

**Interfaces:**
- Consumes: `buildRunExport` from `packages/api/src/export/build-run-export.js`
- Produces: no new exports; `loadRunExport` and `runs.getWithDetails` now union every extraction of a run

- [ ] **Step 1: Write the failing test**

```typescript
// packages/api/src/export/load-run-export-aggregate.test.ts
// Phase 2 writes ONE extraction per URL. Reading only the latest one would show
// a 500-item crawl as a single row — and the CSV export would deliver one.
import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, runs, sources, orgs, projects, datasets, captures, extractions } from '@robot/db';
import { loadRunExport } from './load-run-export.js';

const SLUG = 'test-export-aggregate';
let orgId: string | null = null;

async function seedRunWithExtractions(rows: Array<Record<string, unknown>>) {
  const [org] = await db.insert(orgs).values({ name: SLUG, slug: SLUG }).returning();
  orgId = org!.id;
  const [project] = await db.insert(projects).values({ orgId: org!.id, name: SLUG, slug: SLUG }).returning();
  const [dataset] = await db.insert(datasets).values({ projectId: project!.id, name: SLUG, slug: SLUG, schema: [] }).returning();
  const [source] = await db.insert(sources).values({
    datasetId: dataset!.id, name: SLUG, slug: SLUG, country: 'US',
    selectorsJson: { fields: [{ name: 'title', type: 'string' }] },
  }).returning();
  const [run] = await db.insert(runs).values({ sourceId: source!.id, status: 'completed' }).returning();

  for (const row of rows) {
    const [capture] = await db.insert(captures).values({
      sourceId: source!.id, runId: run!.id, url: String(row._url ?? 'https://example.com/p/x'),
    }).returning({ id: captures.id });
    await db.insert(extractions).values({
      sourceId: source!.id, captureId: capture!.id, runId: run!.id, data: [row], rowCount: 1,
    });
  }
  return run!.id;
}

afterEach(async () => {
  if (orgId) await db.delete(orgs).where(eq(orgs.id, orgId));
  orgId = null;
});

describe('loadRunExport across many extractions', () => {
  it('returns every row of the run, not just the last one', async () => {
    const runId = await seedRunWithExtractions([
      { title: 'One', _url: 'https://example.com/p/1' },
      { title: 'Two', _url: 'https://example.com/p/2' },
      { title: 'Three', _url: 'https://example.com/p/3' },
    ]);

    const result = await loadRunExport(db, runId);
    expect(result?.rows).toHaveLength(3);
    expect(result?.rows.map((r) => r.title)).toEqual(['One', 'Two', 'Three']);
    expect(result?.run.rowCount).toBe(3);
  });

  it('keeps the system column so a row can be traced to its page', async () => {
    const runId = await seedRunWithExtractions([{ title: 'One', _url: 'https://example.com/p/1' }]);
    const result = await loadRunExport(db, runId);
    expect(result?.fields).toContain('_url');
  });

  it('still reads a single-extraction run exactly as before', async () => {
    const runId = await seedRunWithExtractions([{ title: 'Only', _url: 'https://example.com/p/1' }]);
    const result = await loadRunExport(db, runId);
    expect(result?.rows).toEqual([{ title: 'Only', _url: 'https://example.com/p/1' }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @robot/api exec vitest run src/export/load-run-export-aggregate.test.ts`
Expected: FAIL — only 1 row comes back, because the loader reads `findFirst`

- [ ] **Step 3: Union the extractions in the loader**

In `packages/api/src/export/load-run-export.ts`, replace the `extractions.findFirst` call with a `findMany` ordered by `createdAt` ascending, and flatten every extraction's `data` array into one row list:

```typescript
    db.query.extractions.findMany({
      where: eq(extractions.runId, runId),
      orderBy: [asc(extractions.createdAt)],
      columns: { data: true },
    }),
```

and where the outcome is built, flatten:

```typescript
  // Phase 2 writes one extraction per URL, so a run's rows are the concatenation
  // of them in the order they were extracted. A single-extraction run (the
  // sandbox flow) flattens to exactly what it was before.
  const rows = extractionRows.flatMap((e) => (Array.isArray(e.data) ? e.data : []));
```

Pass `rows` to `buildRunExport` as `extractionData`. Import `asc` from `drizzle-orm`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @robot/api exec vitest run src/export/`
Expected: PASS — the new file plus every existing export test

- [ ] **Step 5: Union the same rows in the run view**

In `packages/api/src/routers/runs.ts`'s `getWithDetails`, replace the `extractions.findFirst` call with:

```typescript
        ctx.db.query.extractions.findMany({
          where: eq(extractions.runId, input.id),
          orderBy: [asc(extractions.createdAt)],
          columns: { data: true, confidence: true, rowCount: true, validationResult: true },
        }),
```

and replace the `extraction:` block of the returned object with:

```typescript
        extraction: extractionRows.length > 0 ? {
          // Phase 2 writes one extraction per URL, so a run's rows are all of
          // them in extraction order. Capped for the view: the table shows 100,
          // and a 5000-item crawl must not ship megabytes to a browser. The CSV
          // export is the way to get everything.
          data: allRows.slice(0, VIEW_ROW_CAP),
          confidence: extractionRows[0]!.confidence,
          rowCount: allRows.length,
          validationResult: extractionRows[0]!.validationResult,
        } : null,
```

with these above the procedure:

```typescript
const VIEW_ROW_CAP = 500;
```

and this where the rows are assembled:

```typescript
      const allRows = extractionRows.flatMap((e) => (Array.isArray(e.data) ? e.data : []));
```

Import `asc` from `drizzle-orm`. Rename the destructured `latestExtraction` to `extractionRows` at its `Promise.all` call site.

- [ ] **Step 6: Run the full gates**

Run: `pnpm -r test`
Expected: PASS

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/export/load-run-export.ts packages/api/src/export/load-run-export-aggregate.test.ts packages/api/src/routers/runs.ts
git commit -m "feat(api): a run's rows are all of its extractions, not the last one"
```

---

### Task 8: Run the crawl from the dashboard

**Files:**
- Create: `packages/dashboard/src/lib/run-progress.ts`
- Test: `packages/dashboard/src/lib/run-progress.test.ts`
- Modify: `packages/dashboard/src/routes/source-run-detail.tsx`

**Interfaces:**
- Consumes: `crawl.execute`, `crawl.status`, `crawl.cancel` (Task 6)
- Produces: `progressLabel(counts, status): string`; `isRunActive(status): boolean`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/dashboard/src/lib/run-progress.test.ts
import { describe, it, expect } from 'vitest';
import { progressLabel, isRunActive } from './run-progress';

describe('progressLabel', () => {
  it('counts what is finished against what was planned', () => {
    expect(progressLabel({ pending: 3, running: 1, done: 6, failed: 0, listing: 1, detail: 10 }, 'extracting'))
      .toBe('6 of 10 extracted');
  });

  it('names failures, which are the reason to look', () => {
    expect(progressLabel({ pending: 0, running: 0, done: 8, failed: 2, listing: 1, detail: 10 }, 'partial'))
      .toBe('8 of 10 extracted · 2 failed');
  });

  it('says a plan is waiting when nothing has run yet', () => {
    expect(progressLabel({ pending: 10, running: 0, done: 0, failed: 0, listing: 1, detail: 10 }, 'planned'))
      .toBe('10 URLs planned, not yet extracted');
  });

  it('reports a cancelled run as stopped rather than finished', () => {
    expect(progressLabel({ pending: 4, running: 0, done: 6, failed: 0, listing: 1, detail: 10 }, 'cancelled'))
      .toBe('Stopped after 6 of 10');
  });
});

describe('isRunActive', () => {
  it('is true while work is in flight, so the UI keeps polling', () => {
    expect(isRunActive('extracting')).toBe(true);
    expect(isRunActive('cancelling')).toBe(true);
  });

  it('is false once the run has settled', () => {
    expect(isRunActive('completed')).toBe(false);
    expect(isRunActive('partial')).toBe(false);
    expect(isRunActive('planned')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @robot/dashboard exec vitest run src/lib/run-progress.test.ts`
Expected: FAIL — `Cannot find module './run-progress'`

- [ ] **Step 3: Write the helper**

```typescript
// packages/dashboard/src/lib/run-progress.ts
export type RunCounts = {
  pending: number; running: number; done: number; failed: number;
  listing: number; detail: number;
};

/** Statuses where work is still moving, and the view should keep polling. */
export function isRunActive(status: string): boolean {
  return status === 'extracting' || status === 'cancelling';
}

export function progressLabel(counts: RunCounts, status: string): string {
  const total = counts.detail;
  if (status === 'cancelled') return `Stopped after ${counts.done} of ${total}`;
  if (counts.done === 0 && counts.failed === 0) return `${total} URLs planned, not yet extracted`;
  const base = `${counts.done} of ${total} extracted`;
  return counts.failed > 0 ? `${base} · ${counts.failed} failed` : base;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @robot/dashboard exec vitest run src/lib/run-progress.test.ts`
Expected: PASS — 6 tests

- [ ] **Step 5: Add the controls to the run detail page**

In `packages/dashboard/src/routes/source-run-detail.tsx`, add this component and render it directly above `<WorkList runId={runId} />`:

```tsx
function ExecuteControls({ runId }: { runId: string }) {
  const utils = trpc.useUtils();
  const statusQuery = trpc.crawl.status.useQuery(
    { runId },
    { refetchInterval: (query) => (isRunActive(query.state.data?.status ?? '') ? 3000 : false) },
  );
  const execute = trpc.crawl.execute.useMutation({
    onSuccess: () => { utils.crawl.invalidate(); utils.runs.invalidate(); },
  });
  const cancel = trpc.crawl.cancel.useMutation({ onSuccess: () => utils.crawl.invalidate() });

  const data = statusQuery.data;
  if (!data || data.counts.detail === 0) return null;
  const active = isRunActive(data.status);

  return (
    <div className="mt-6 flex items-center gap-3 rounded-md border px-4 py-3">
      <span className="text-sm font-medium">{progressLabel(data.counts, data.status)}</span>
      <div className="ml-auto flex items-center gap-2">
        {active ? (
          <button
            onClick={() => cancel.mutate({ runId })}
            disabled={cancel.isPending}
            className="rounded border px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {cancel.isPending ? 'Stopping…' : 'Stop'}
          </button>
        ) : (
          <>
            <button
              onClick={() => execute.mutate({ runId })}
              disabled={execute.isPending || data.counts.pending === 0}
              className="rounded border px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              title="Fetch and extract every pending URL in the work list"
            >
              Extract {data.counts.pending} pending
            </button>
            {data.counts.failed > 0 && (
              <button
                onClick={() => execute.mutate({ runId, retryFailed: true })}
                disabled={execute.isPending}
                className="rounded border px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                title="Re-queue the failed items and extract them again"
              >
                Retry {data.counts.failed} failed
              </button>
            )}
          </>
        )}
      </div>
      {execute.isError && <span className="text-[11px] text-red-600">{execute.error.message}</span>}
    </div>
  );
}
```

Add the import: `import { progressLabel, isRunActive } from '../lib/run-progress';`

- [ ] **Step 6: Verify in a real browser**

There is no component-test infrastructure in this dashboard, so this must be checked by hand.

```bash
pnpm dev:all
```

Find a run that has pending items:

```bash
docker exec -e PGPASSWORD=postgres robot-platform-db psql -U postgres -d robot_platform -c "select run_id, count(*) from run_items where status='pending' group by run_id limit 3;"
```

Open that run at `http://localhost:3456/p/sandbox/sources/<source-slug>/runs/<run-id>`, confirm the progress line and the "Extract N pending" button appear, click it, and confirm the label starts moving and the work list statuses change from `pending` to `done`. Stop the dev servers when finished. Report exactly what you observed, including anything that did NOT update.

- [ ] **Step 7: Run the gates**

Run: `pnpm --filter @robot/dashboard exec vitest run` and `pnpm --filter @robot/dashboard exec tsc --noEmit`
Expected: PASS and clean

- [ ] **Step 8: Commit**

```bash
git add packages/dashboard/src/lib/run-progress.ts packages/dashboard/src/lib/run-progress.test.ts packages/dashboard/src/routes/source-run-detail.tsx
git commit -m "feat(dashboard): run a planned crawl and watch it progress"
```

---

### Task 9: Extract a real crawl end to end

**Files:**
- Modify: `docs/roadmap.md`
- Modify: `docs/handoff.md`

**Interfaces:**
- Consumes: everything above

This task spends real money (roughly $0.20–0.50) and makes real requests to a live site. Keep the budget tiny.

- [ ] **Step 1: Plan a small crawl**

```bash
pnpm --filter @robot/api exec tsx src/crawl-plan.ts newegg-gpus-live
```

Note the run id it prints. The seeded Source's budget is `max_pages: 1, max_items: 5`.

- [ ] **Step 2: Execute it**

Create `packages/api/src/crawl-execute.ts`:

```typescript
// CLI: extract every pending URL in a planned run, and watch it happen.
//
//   pnpm --filter @robot/api exec tsx src/crawl-execute.ts <runId>
//
// This SPENDS MONEY and makes real requests — one page load and, on a cold
// domain, one AI selector pass per URL. Check the work list first.

import { eq } from 'drizzle-orm';
import { db, runItems } from '@robot/db';
import { createCallerFactory } from './trpc.js';
import { appRouter } from './routers/index.js';

const runId = process.argv[2];
if (!runId) {
  console.error('usage: crawl-execute <runId>');
  process.exit(1);
}

const caller = createCallerFactory(appRouter)({ db });

const before = await caller.crawl.status({ runId });
console.log(`\nRun ${runId} — ${before.status}`);
console.log(`  pending ${before.counts.pending} · done ${before.counts.done} · failed ${before.counts.failed}\n`);

await caller.crawl.execute({ runId });

const ACTIVE = new Set(['extracting', 'cancelling']);
let status = before.status;
for (let tick = 0; tick < 240; tick++) {
  await new Promise((resolve) => setTimeout(resolve, 5000));
  const now = await caller.crawl.status({ runId });
  status = now.status;
  console.log(`  [${status}] done ${now.counts.done}/${now.counts.detail} · failed ${now.counts.failed}`);
  if (!ACTIVE.has(status)) break;
}

const items = await db.query.runItems.findMany({
  where: eq(runItems.runId, runId),
  columns: { kind: true, url: true, status: true, error: true },
});
console.log(`\nFinal: ${status}`);
for (const item of items.filter((i) => i.kind === 'detail')) {
  console.log(`  [${item.status}] ${item.url.slice(0, 90)}${item.error ? ` — ${item.error.slice(0, 60)}` : ''}`);
}
process.exit(0);
```

```bash
pnpm --filter @robot/api exec tsx src/crawl-execute.ts <run-id>
```

- [ ] **Step 3: Verify what landed**

```bash
docker exec -e PGPASSWORD=postgres robot-platform-db psql -U postgres -d robot_platform -c "select status, count(*) from run_items where run_id='<run-id>' group by status;"
docker exec -e PGPASSWORD=postgres robot-platform-db psql -U postgres -d robot_platform -c "select status, result_count from runs where id='<run-id>';"
```

Expected: detail items `done` (or `failed` with a recorded reason), the run `completed` or `partial`, and `result_count` equal to the number of rows extracted.

- [ ] **Step 4: Verify the export delivers the whole crawl**

```bash
curl -s "http://localhost:4000/export/runs/<run-id>.csv" | head -8
```

(Start the api-server first if it is not running.) Expected: a header row plus ONE ROW PER EXTRACTED URL — this is the end the whole feature exists for. Confirm `_url` differs per row and that any listing-origin column carries its value.

- [ ] **Step 5: Record what is true now**

Update `docs/roadmap.md`'s v2 section to mark the listing→detail crawler and batch extraction as delivered, and `docs/handoff.md` to describe the current state: what phase 1 and phase 2 do, what the live run produced, and what remains (api-param pagination, pagination-config caching, infinite scroll, progressive-confidence ladder). Do not claim anything the live run did not demonstrate.

- [ ] **Step 6: Commit**

```bash
git add docs/roadmap.md docs/handoff.md packages/api/src/crawl-execute.ts
git commit -m "docs: v2 crawler extracts a real crawl end to end"
```

---

## Done when

- `pnpm -r test` and `pnpm typecheck` are clean, plus `tsc --noEmit` on the dashboard.
- `crawl.execute` turns a planned run into one extraction per URL, with per-item status and no automatic retries.
- A blocked or failing page records its reason and the run continues; the run ends `completed` or `partial`.
- `crawl.cancel` stops the loop between items, leaving the rest pending, and calling `execute` again resumes.
- A run's CSV export contains one row per extracted URL, each carrying its `_url` and any listing-origin values.
- A real crawl has been extracted end to end and the docs say what is actually true.

## Not in this plan

`api-param` pagination detection and replay; caching the winning pagination config to `domain_intelligence`; infinite scroll and load-more; the progressive-confidence ladder; a real job queue (an api-server restart still pauses a run); per-input status UI beyond the work list already shipped.
