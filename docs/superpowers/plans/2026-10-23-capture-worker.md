# A job queue and a separate capture worker — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every page load and in-browser script moves out of the api-server into a new `@robot/worker` process fed by a Postgres `jobs` table; the worker alone owns browsers and limits them; a crashed or stuck job is retried or closed with the sentence the app already shows.

**Architecture:** `@robot/db` gets a `jobs` table and a `job_id` column on the five status-row tables. `@robot/api` gets `src/jobs/` — the queue operations, the job context (AsyncLocalStorage), the browser gate, the runner (lanes, leases, reaping, stuck jobs, shutdown) and the handler registry — and every start that used to fire a promise now enqueues in its own transaction; every procedure that used to await a browser now enqueues and awaits its job. `@robot/worker` is a thin process around `startJobRunner` with the real gate and the website-check scheduler. The api-server forbids browser launches at boot.

**Tech Stack:** TypeScript ESM; Drizzle + Postgres (postgres-js, drizzle-kit migrations); tRPC v11; Hono; Playwright via `@robot/browser`; vitest; tsx.

**Spec:** `docs/superpowers/specs/2026-10-23-capture-worker-design.md`

**Planner's notes:** eleven tasks, strictly in order — each consumes names the one before produces. 1 the migration; 2 the queue; 3 the browser gate and the launch guard; 4 the runner; 5 captures and Verify through the queue; 6 drift, coverage and the scheduled check; 7 runs; 8 awaited procedures and plan; 9 the api-server starts no browser; 10 the worker package; 11 the merge gate. Line numbers were read on `main` @ `fda4506b` and are approximate — find code by the quoted text. Tasks 5–8 change behaviour that existing tests pinned ("the background body ran"): in each, the existing tests of the touched files must pass again — adapt a test that awaited an in-process fire-and-forget to run the queue with `withJobRunner`/`runQueuedJobs` (Task 4), or to call the inline body (`fire: false`) directly; never delete an assertion about what the body writes.

## Global Constraints

- ESM. Relative imports carry `.js` in `@robot/api`, `@robot/scraper`, `@robot/browser`, `@robot/db` (except its existing `./schema` import), `@robot/api-server` and `@robot/worker`; none in `@robot/app`.
- DB changes only through the Drizzle migration `0020_capture_jobs` (`cd packages/db && npx drizzle-kit generate --name capture_jobs`, then `npx drizzle-kit migrate`). No foreign key from `job_id` to `jobs`.
- Defaults, verbatim from the spec: `JOB_QUEUE` default `default`; `WORKER_BROWSERS` 3; `WORKER_INTERACTIVE` 3; `WORKER_CONCURRENCY` 2; `WORKER_RUNS` 1; `WORKER_MIN_FREE_MB` 1024; `WORKER_LEASE_MS` 60000 (heartbeat every quarter lease); `WORKER_POLL_MS` 500; `WORKER_SHUTDOWN_MS` 25000; `WORKER_RETRY_MS` 30000 (backoff `WORKER_RETRY_MS × 2^(attempt-1)`); reaper every 15 s and once at start; purge of finished jobs after 7 days; memory wait per launch at most 120 s; `awaitJob` polls every 150 ms; an awaited job's ceiling = start window + stuck limit + 10 s.
- Job policies (spec §4.2) — type: lane, priority, attempts, stuck after, start within, key:
  `proof-page-capture`: interactive, 10, 2, 3 min, 5 min, `capture:<id>` · `reachability`: interactive, 0, 1, 60 s, 60 s, `reachability:<url>` · `listing-check`: interactive, 0, 1, 90 s, 60 s, `listing:<url>` · `transfer-marks`: interactive, 0, 1, 60 s, 60 s, none · `detect-variants`: interactive, 0, 1, 60 s, 60 s, `detect-variants:<sourceId>` · `variant-links-near`: interactive, 0, 1, 30 s, 60 s, none · `plan`: interactive, 5, 1, 15 min, 2 min, `plan:<runId>` · `verify`: background, 10, 2, 14 min, 15 min, `verify:<id>` · `drift-check`: background, 20, 2, 9 min, 30 min, `drift:<id>` · `coverage-check`: background, 20, 2, 9 min, 30 min, `coverage:<id>` · `website-check`: background (at most 1 at a time), 30, 2, 25 min, none, `website-check:<sourceId>` · `run`: runs, 10, 3, 15 min, none, `run:<runId>`, retried when stuck.
- Customer copy, verbatim (spec §6): run → `This run stopped before it finished. Extract again to pick up where it left off.`; plan → `Finding the products stopped before it finished. Try again.`. Every other closed row reuses its existing code `'stalled'` (verification `error_message`, drift/coverage `error`, capture `metadata.error`). Never a job, worker, queue, lease or browser word in customer copy (memory `customer-copy-no-internals`); `BROWSER_UNAVAILABLE` is existing copy.
- The api-server never launches a browser: `configureApiProcess()` calls `forbidBrowserLaunch()` before serving.
- Tests: per package, one file at a time while working: `cd packages/<pkg> && npx vitest run <file>`; the full api and scraper suites serially: `npx vitest run --no-file-parallelism`. Never `pnpm -r test`. The api, api-server, db and worker tests need Postgres (`docker start robot-platform-db`). Each api/api-server/worker test file runs on its own `JOB_QUEUE` (`test-<uuid>`, a vitest setup file) and deletes its jobs afterwards — the test database is Marko's.
- Tests must not leave browsers running: every test that starts a real Chromium stops its worker/runner (`await worker.stop()`) in `afterAll`/`finally`, and asserts the gate reports `open() === 0` where it owns one.
- No paid API anywhere: every server, worker and script this plan starts runs with `ANTHROPIC_API_KEY= JEV_SHADOW= TYPESAFE_API_KEY=`; api tests keep `JEV_SHADOW: ''` (`vitest.config.ts`).
- Commits by explicit path (`git add <paths>` then `git commit`), never `git add -A` / `git add .`; never stage `packages/app/src/routeTree.gen.ts` (restore it with `git checkout -- packages/app/src/routeTree.gen.ts`). Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never start, stop or restart Marko's dev servers (:3000, :4000) or a worker of his. The only processes this plan starts are tests, the isolated pair on :4100/:3100 and its worker on queue `isolated-4100` (Task 11), and the live-check script.
- Work only in `C:\Users\Marko\Documents\projects\robot-platform-worker` (bash: `/c/Users/Marko/Documents/projects/robot-platform-worker`) on `feat/capture-worker`.
- Files in this repo are CRLF. Edit with tools that keep line endings; new files may be LF.

## Review Focus

1. **A Verify queued longer than the stall window** — a customer clicks Verify while the background lane is busy; twenty minutes later another click (or a read) must find it in progress, not close it as stalled and start a second one. → Task 5 test "a verification older than the stall window whose job is queued stays in flight".
2. **Another process's jobs** — Marko's worker must never run a test's job, and the isolated smoke worker must never run Marko's. → Task 2 test "never claims another queue"; the per-file `JOB_QUEUE` setup (Task 2) and the isolated pair's `JOB_QUEUE=isolated-4100` (Task 11).
3. **Two executors of one run** — Execute clicked while the run's job is queued or running, or a retry after a crash: one job, one loop. → Task 7 tests "a second execute adds no job" and "a retry requeues every running item; a first attempt only stale ones".
4. **A worker stopped while it holds browsers** — a graceful stop must close every Chromium it opened and give its jobs back; a hard kill must leave the jobs to be retried by the next worker. → Task 4 test "shutdown gives running jobs back", Task 10 tests "crash recovery across processes" and "capture end to end … no open browser after stop".
5. **A stopped attempt finishing late** — a stuck Verify or capture is closed as stalled; when its hung call finally returns it must not overwrite the closed row. → Task 5 tests "a capture closed meanwhile is not overwritten" and "a verification completed meanwhile is not overwritten".

---

### Task 1: The migration — `jobs` and `job_id` (`@robot/db`) — spec §4.1

**Files:**
- Modify: `packages/db/src/schema.ts` (new `jobs` table after the `coverageChecks` relations; `jobId` column + index on `sourceVerifications`, `driftChecks`, `coverageChecks`, `captures`, `runs`)
- Create: `packages/db/drizzle/0020_capture_jobs.sql`, `packages/db/drizzle/meta/0020_snapshot.json`, `packages/db/drizzle/meta/_journal.json` (generated)
- Test: `packages/db/src/schema.test.ts`

**Interfaces:**
- Produces: `jobs` (drizzle table, exported from `@robot/db`), columns `id, queue, type, key, payload, status, priority, attempts, maxAttempts, runAfter, expiresAt, lockedBy, lockedUntil, startedAt, finishedAt, result, error, createdAt`; `jobId: string | null` on `sourceVerifications`, `driftChecks`, `coverageChecks`, `captures`, `runs`.

- [ ] **Step 1: Write the failing test** — append to `packages/db/src/schema.test.ts` (add `jobs` to its import from `./index.js`):

```ts
describe('jobs (2026-10-23)', () => {
  const queue = `schema-test-${Date.now()}`;
  afterEach(async () => { await db.delete(jobs).where(eq(jobs.queue, queue)); });

  it('stores a job with its defaults', async () => {
    const [row] = await db.insert(jobs).values({ queue, type: 'verify', payload: { a: 1 } }).returning();
    expect(row).toMatchObject({ queue, type: 'verify', status: 'queued', priority: 10, attempts: 0, maxAttempts: 1, key: null, lockedBy: null, result: null });
    expect(row!.runAfter).toBeInstanceOf(Date);
  });

  it('allows one queued or running job per key, and a new one once it finished', async () => {
    await db.insert(jobs).values({ queue, type: 'verify', key: 'verify:x' });
    await expect(db.insert(jobs).values({ queue, type: 'verify', key: 'verify:x' })).rejects.toThrow();
    await db.update(jobs).set({ status: 'done' }).where(eq(jobs.queue, queue));
    await expect(db.insert(jobs).values({ queue, type: 'verify', key: 'verify:x' })).resolves.toBeDefined();
    // Jobs without a key never collide.
    await db.insert(jobs).values({ queue, type: 'verify' });
    await db.insert(jobs).values({ queue, type: 'verify' });
  });

  it('every status-row table carries a nullable job_id', async () => {
    const { orgId: seededOrgId, source } = await seedSource();
    orgId = seededOrgId;
    const jobId = '00000000-0000-4000-8000-000000000001';
    const [v] = await db.insert(sourceVerifications).values({ sourceId: source.id, definitionHash: 'h', jobId }).returning();
    const [d] = await db.insert(driftChecks).values({ sourceId: source.id, jobId }).returning();
    const [c] = await db.insert(captures).values({ sourceId: source.id, url: 'https://x.test/', jobId }).returning();
    const [r] = await db.insert(runs).values({ sourceId: source.id, jobId }).returning();
    expect([v!.jobId, d!.jobId, c!.jobId, r!.jobId]).toEqual([jobId, jobId, jobId, jobId]);
    const [none] = await db.insert(runs).values({ sourceId: source.id }).returning();
    expect(none!.jobId).toBeNull();
  });
});
```

Also import `coverageChecks` and add, inside the last test: `const [cc] = await db.insert(coverageChecks).values({ sourceId: source.id, jobId }).returning(); expect(cc!.jobId).toBe(jobId);`.

- [ ] **Step 2: Run it to see it fail**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-worker/packages/db && npx vitest run src/schema.test.ts`
Expected: FAIL — `jobs` is not exported.

- [ ] **Step 3: The schema** — in `packages/db/src/schema.ts`, after `coverageChecksRelations`:

```ts
// ─── Jobs (2026-10-23) ──────────────────────────────────────────────────────
// The work queue every page load goes through (spec 2026-10-23 capture worker §4.1). The api-server
// enqueues in the transaction that writes the status row; @robot/worker claims with FOR UPDATE SKIP
// LOCKED and holds a lease it renews. `queue` namespaces workers: tests and the isolated smoke pair use
// their own. A status row names its job in `job_id` (no foreign key: finished jobs are purged).
export const jobs = pgTable('jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  queue: varchar('queue', { length: 64 }).notNull().default('default'),
  type: varchar('type', { length: 40 }).notNull(),
  // One queued or running job per (queue, key); null never collides.
  key: varchar('key', { length: 200 }),
  payload: jsonb('payload').notNull().default({}),
  // 'queued' | 'running' | 'done' | 'failed'
  status: varchar('status', { length: 12 }).notNull().default('queued'),
  // Lower runs first.
  priority: integer('priority').notNull().default(10),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(1),
  runAfter: timestamp('run_after', { withTimezone: true }).defaultNow().notNull(),
  // Not started by then: failed 'expired' and its rows closed.
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  lockedBy: varchar('locked_by', { length: 200 }),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  // Done: `{ value }`; failed: `{ error: SerializedError }` (@robot/api jobs/errors.ts).
  result: jsonb('result'),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('jobs_claim_idx').on(table.queue, table.status, table.priority, table.runAfter),
  index('jobs_lease_idx').on(table.status, table.lockedUntil),
  uniqueIndex('jobs_active_key_idx').on(table.queue, table.key)
    .where(sql`${table.status} in ('queued', 'running') and ${table.key} is not null`),
]);
```

and in each of `sourceVerifications`, `driftChecks`, `coverageChecks`, `captures`, `runs` add the column (before `createdAt`)

```ts
  // The job working on this row (spec 2026-10-23 §4.5); null for rows written outside the queue.
  jobId: uuid('job_id'),
```

and to each table's index list `index('<table>_job_id_idx').on(table.jobId)` with `<table>` = `source_verifications`, `drift_checks`, `coverage_checks`, `captures`, `runs`.

- [ ] **Step 4: Generate and apply the migration**

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-worker/packages/db && npx drizzle-kit generate --name capture_jobs && npx drizzle-kit migrate
```

Expected: `drizzle/0020_capture_jobs.sql` with one `CREATE TABLE "jobs"`, five `ALTER TABLE … ADD COLUMN "job_id" uuid`, the indexes (the unique one with its `WHERE`), and nothing else (no `DROP`, no rewrite). Read the file before migrating; if it contains anything else, stop and fix the schema.

- [ ] **Step 5: Run the test and the type-check**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-worker/packages/db && npx vitest run src/schema.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-worker
git add packages/db/src/schema.ts packages/db/src/schema.test.ts packages/db/drizzle/0020_capture_jobs.sql packages/db/drizzle/meta/0020_snapshot.json packages/db/drizzle/meta/_journal.json
git commit -m "feat(db): a jobs table and job_id on the status rows

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The queue (`@robot/api` `src/jobs/`) — spec §4.1, §4.5

**Files:**
- Create: `packages/api/src/jobs/types.ts`, `packages/api/src/jobs/errors.ts`, `packages/api/src/jobs/rows.ts`, `packages/api/src/jobs/queue.ts`, `packages/api/src/jobs/enqueue.ts`, `packages/api/src/test-setup/job-queue.ts`
- Modify: `packages/api/vitest.config.ts` (`setupFiles`)
- Test: `packages/api/src/jobs/queue.test.ts`

**Interfaces:**
- Consumes: `jobs` and the `job_id` columns (Task 1).
- Produces:
  - `types.ts`: `type Lane = 'interactive' | 'background' | 'runs'`; `type JobPolicy = { lane: Lane; priority: number; maxAttempts: number; stuckMs: number; startWithinMs: number | null; maxConcurrent?: number; retryOnStuck?: boolean; runSentence?: string }`; `JOB_POLICIES` (the table in Global Constraints); `type JobType = keyof typeof JOB_POLICIES`; `type JobPayloads` (below); `RUN_STOPPED`, `PLAN_STOPPED`.
  - `errors.ts`: `type SerializedError`; `class JobUnavailableError`; `serializeError(err: unknown): SerializedError`; `rebuildError(e: SerializedError): Error`.
  - `rows.ts`: `type JobSubject = { table: 'source_verifications' | 'drift_checks' | 'coverage_checks' | 'captures' | 'runs'; id: string }`; `closeJobRows(tx: DbOrTx, jobId: string, opts: { runSentence: string; except?: JobSubject | null }): Promise<void>`.
  - `queue.ts`: `type DbOrTx`; `jobQueueName(env?)`; `type JobRow`; `enqueueJob(dbOrTx, spec: EnqueueSpec): Promise<{ id: string; created: boolean }>`; `claimJob({ queue, workerId, types, leaseMs }): Promise<JobRow | null>`; `renewLease(id, workerId, leaseMs): Promise<boolean>`; `completeJob(id, workerId, value: unknown): Promise<boolean>`; `retryJob(id, workerId, error: string, delayMs: number): Promise<boolean>`; `type FailGuard = { owner: string } | 'lapsed' | 'queued'`; `failJobTerminal(id, guard: FailGuard, detail: SerializedError, runSentence: string): Promise<boolean>`; `releaseJob(id, workerId): Promise<void>`; `reapJobs(queue, opts: { retryBaseMs: number; runSentenceFor: (type: string) => string }): Promise<{ retried: string[]; failed: string[]; expired: string[] }>`; `purgeJobs(queue, olderThanMs?)`; `liveJobIds(dbOrTx, ids): Promise<Set<string>>`; `isJobLive(dbOrTx, id: string | null | undefined): Promise<boolean>`; `openJobCount(queue): Promise<number>`; `awaitJob(id, ceilingMs, pollMs?): Promise<unknown>`.
  - `enqueue.ts`: `enqueue<T extends JobType>(dbOrTx, type: T, payload: JobPayloads[T], opts?: { key?: string | null; priority?: number }): Promise<string>` (the job id); `ceilingOf(type: JobType): number`; `runAndWait<T extends JobType>(type: T, payload: JobPayloads[T], opts?: { key?: string | null }): Promise<unknown>`.

- [ ] **Step 1: The per-file queue** — `packages/api/src/test-setup/job-queue.ts`:

```ts
// Every api test file enqueues and claims on its own queue, so no worker of Marko's (whose database the
// tests share) ever runs a test's job, and no test claims his. Its jobs are deleted after the file.
import { randomUUID } from 'node:crypto';
import { afterAll } from 'vitest';

process.env.JOB_QUEUE = `test-${randomUUID()}`;

afterAll(async () => {
  const { db } = await import('@robot/db');
  const { sql } = await import('drizzle-orm');
  await db.execute(sql`DELETE FROM jobs WHERE queue = ${process.env.JOB_QUEUE!}`);
});
```

and in `packages/api/vitest.config.ts` add `setupFiles: ['./src/test-setup/job-queue.ts'],` beside `env`.

- [ ] **Step 2: Write the failing tests** — `packages/api/src/jobs/queue.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { db, jobs, sourceVerifications, runs } from '@robot/db';
import { createTestSource, deleteTestSource } from '../test-helpers/source.js';
import {
  enqueueJob, claimJob, renewLease, completeJob, retryJob, failJobTerminal, releaseJob, reapJobs,
  purgeJobs, liveJobIds, isJobLive, awaitJob, jobQueueName,
} from './queue.js';
import { JobUnavailableError, serializeError } from './errors.js';
import { RUN_STOPPED } from './types.js';

const W = 'test-worker:1';
const q = () => jobQueueName();
const get = async (id: string) => (await db.query.jobs.findFirst({ where: eq(jobs.id, id) }))!;
const claim = (types = ['t'], leaseMs = 60_000) => claimJob({ queue: q(), workerId: W, types, leaseMs });
const reapOpts = { retryBaseMs: 1000, runSentenceFor: () => RUN_STOPPED };

afterEach(async () => { await db.delete(jobs).where(eq(jobs.queue, q())); });

describe('enqueueJob', () => {
  it('one queued or running job per key: a second enqueue returns the first', async () => {
    const a = await enqueueJob(db, { type: 't', payload: { n: 1 }, key: 'k' });
    expect(a.created).toBe(true);
    expect(await enqueueJob(db, { type: 't', payload: { n: 2 }, key: 'k' })).toEqual({ id: a.id, created: false });
    await db.update(jobs).set({ status: 'done' }).where(eq(jobs.id, a.id));
    expect((await enqueueJob(db, { type: 't', payload: {}, key: 'k' })).created).toBe(true);
  });

  it('inside a transaction that rolls back, leaves no job', async () => {
    await expect(db.transaction(async (tx) => {
      await enqueueJob(tx, { type: 't', payload: {} });
      throw new Error('rollback');
    })).rejects.toThrow('rollback');
    expect(await db.query.jobs.findMany({ where: eq(jobs.queue, q()) })).toEqual([]);
  });
});

describe('claimJob', () => {
  it('lowest priority first, then the oldest; only the listed types; not before run_after; never an expired one', async () => {
    const late = await enqueueJob(db, { type: 't', payload: {}, priority: 10 });
    const urgent = await enqueueJob(db, { type: 't', payload: {}, priority: 0 });
    await enqueueJob(db, { type: 'other', payload: {}, priority: 0 });
    await enqueueJob(db, { type: 't', payload: {}, priority: 0, runAfter: new Date(Date.now() + 60_000) });
    await enqueueJob(db, { type: 't', payload: {}, priority: 0, expiresAt: new Date(Date.now() - 1000) });
    expect((await claim())!.id).toBe(urgent.id);
    expect((await claim())!.id).toBe(late.id);
    expect(await claim()).toBeNull();
  });

  it('never claims another queue', async () => {
    const other = `${q()}-other`;
    await enqueueJob(db, { type: 't', payload: {}, queue: other });
    try { expect(await claim()).toBeNull(); } finally { await db.delete(jobs).where(eq(jobs.queue, other)); }
  });

  it('marks the job running with its owner, a lease and one more attempt', async () => {
    const { id } = await enqueueJob(db, { type: 't', payload: { x: 1 }, maxAttempts: 2 });
    const job = (await claim())!;
    expect(job).toMatchObject({ id, status: 'running', attempts: 1, maxAttempts: 2, lockedBy: W, payload: { x: 1 } });
    expect(job.lockedUntil!.getTime()).toBeGreaterThan(Date.now() + 50_000);
  });
});

describe('the lease', () => {
  it('renews for its owner only; completes for its owner only', async () => {
    const { id } = await enqueueJob(db, { type: 't', payload: {} });
    await claim();
    expect(await renewLease(id, W, 60_000)).toBe(true);
    expect(await renewLease(id, 'someone-else', 60_000)).toBe(false);
    expect(await completeJob(id, 'someone-else', 1)).toBe(false);
    expect(await completeJob(id, W, { ok: true })).toBe(true);
    expect(await get(id)).toMatchObject({ status: 'done', result: { value: { ok: true } }, lockedBy: null });
    expect(await renewLease(id, W, 60_000)).toBe(false);
  });
});

describe('failures', () => {
  it('a retry puts the job back, later, with its error', async () => {
    const { id } = await enqueueJob(db, { type: 't', payload: {}, maxAttempts: 2 });
    await claim();
    expect(await retryJob(id, W, 'boom', 30_000)).toBe(true);
    const row = await get(id);
    expect(row).toMatchObject({ status: 'queued', error: 'boom', lockedBy: null, attempts: 1 });
    expect(row.runAfter.getTime()).toBeGreaterThan(Date.now() + 20_000);
  });

  it('a terminal failure stores the error and closes every row the job owns, in one go', async () => {
    const sourceId = await createTestSource({ schema: [] });
    try {
      const { id } = await enqueueJob(db, { type: 't', payload: {} });
      const [v] = await db.insert(sourceVerifications).values({ sourceId, definitionHash: 'h', jobId: id }).returning();
      const [r] = await db.insert(runs).values({ sourceId, status: 'extracting', jobId: id }).returning();
      await claim();
      expect(await failJobTerminal(id, { owner: W }, serializeError(new Error('nope')), RUN_STOPPED)).toBe(true);
      expect(await get(id)).toMatchObject({ status: 'failed', error: 'nope', result: { error: { kind: 'error', message: 'nope' } } });
      expect(await db.query.sourceVerifications.findFirst({ where: eq(sourceVerifications.id, v!.id) })).toMatchObject({ errorMessage: 'stalled' });
      expect((await db.query.sourceVerifications.findFirst({ where: eq(sourceVerifications.id, v!.id) }))!.completedAt).not.toBeNull();
      expect(await db.query.runs.findFirst({ where: eq(runs.id, r!.id) })).toMatchObject({ status: 'failed', errorMessage: RUN_STOPPED });
    } finally { await deleteTestSource(sourceId); }
  });

  it('release gives the job back without spending its attempt', async () => {
    const { id } = await enqueueJob(db, { type: 't', payload: {}, maxAttempts: 2 });
    await claim();
    await releaseJob(id, W);
    expect(await get(id)).toMatchObject({ status: 'queued', attempts: 0, lockedBy: null });
  });
});

describe('reapJobs', () => {
  it('a lapsed lease with attempts left is retried; without, failed stalled; a queued job past its window, expired', async () => {
    const again = await enqueueJob(db, { type: 't', payload: {}, maxAttempts: 2 });
    const once = await enqueueJob(db, { type: 't', payload: {}, maxAttempts: 1 });
    await claim(['t'], 1); await claim(['t'], 1);           // 1 ms leases: both lapse at once
    const late = await enqueueJob(db, { type: 'late', payload: {}, expiresAt: new Date(Date.now() - 1000) });
    await new Promise((r) => setTimeout(r, 20));
    const out = await reapJobs(q(), reapOpts);
    expect(out).toEqual({ retried: [again.id], failed: [once.id], expired: [late.id] });
    expect(await get(again.id)).toMatchObject({ status: 'queued', error: 'lease expired' });
    expect(await get(once.id)).toMatchObject({ status: 'failed', error: 'stalled' });
    expect(await get(late.id)).toMatchObject({ status: 'failed', error: 'expired' });
  });

  it('purge deletes finished jobs older than the window only', async () => {
    const old = await enqueueJob(db, { type: 't', payload: {} });
    const fresh = await enqueueJob(db, { type: 't', payload: {} });
    await db.update(jobs).set({ status: 'done', finishedAt: new Date(Date.now() - 8 * 86_400_000) }).where(eq(jobs.id, old.id));
    await db.update(jobs).set({ status: 'done', finishedAt: new Date() }).where(eq(jobs.id, fresh.id));
    await purgeJobs(q());
    expect(await db.query.jobs.findFirst({ where: eq(jobs.id, old.id) })).toBeUndefined();
    expect(await get(fresh.id)).toBeDefined();
  });
});

describe('liveness', () => {
  it('queued in its window, or running with a lease, is live; anything else is not', async () => {
    const queued = await enqueueJob(db, { type: 't', payload: {} });
    const expired = await enqueueJob(db, { type: 'x', payload: {}, expiresAt: new Date(Date.now() - 1000) });
    const running = await enqueueJob(db, { type: 'r', payload: {} });
    await claim(['r']);
    const lapsed = await enqueueJob(db, { type: 'l', payload: {} });
    await claim(['l'], 1);
    await new Promise((r) => setTimeout(r, 20));
    const live = await liveJobIds(db, [queued.id, expired.id, running.id, lapsed.id, null, undefined]);
    expect([...live].sort()).toEqual([queued.id, running.id].sort());
    expect(await isJobLive(db, null)).toBe(false);
    expect(await isJobLive(db, '00000000-0000-4000-8000-000000000009')).toBe(false);
  });
});

describe('awaitJob', () => {
  it('a done job answers its value; a failed one rethrows its error as the class it was', async () => {
    const ok = await enqueueJob(db, { type: 't', payload: {} });
    await claim(); await completeJob(ok.id, W, { links: 3 });
    expect(await awaitJob(ok.id, 1000)).toEqual({ links: 3 });

    const bad = await enqueueJob(db, { type: 't', payload: {} });
    await claim();
    await failJobTerminal(bad.id, { owner: W }, serializeError(new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Mark page 1 first' })), RUN_STOPPED);
    await expect(awaitJob(bad.id, 1000)).rejects.toMatchObject({ code: 'PRECONDITION_FAILED', message: 'Mark page 1 first' });
  });

  it('a queued job past its window, or the ceiling, is unavailable', async () => {
    const expired = await enqueueJob(db, { type: 't', payload: {}, expiresAt: new Date(Date.now() - 1000) });
    await expect(awaitJob(expired.id, 1000)).rejects.toBeInstanceOf(JobUnavailableError);
    expect(await get(expired.id)).toMatchObject({ status: 'failed', error: 'expired' });
    const waiting = await enqueueJob(db, { type: 't', payload: {} });
    await expect(awaitJob(waiting.id, 300)).rejects.toBeInstanceOf(JobUnavailableError);
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-worker/packages/api && npx vitest run src/jobs/queue.test.ts`
Expected: FAIL — `./queue.js` does not exist.

- [ ] **Step 4: `types.ts`**

```ts
// packages/api/src/jobs/types.ts
// What each kind of job is, where it runs and how it fails (spec 2026-10-23 capture worker §4.2).
// Plain data: enqueuers read it without importing a handler (handlers import the enqueuers).
import type { StoredCaptureRef } from '../verify/capture-store.js';

export type Lane = 'interactive' | 'background' | 'runs';

export type JobPolicy = {
  lane: Lane;
  /** Lower is claimed first. */
  priority: number;
  maxAttempts: number;
  /** Stopped when no `ctx.progress()` (or start) for this long. */
  stuckMs: number;
  /** Failed 'expired' when not started this long after it was enqueued; null: no limit. */
  startWithinMs: number | null;
  /** At most this many of this type at once in one worker. */
  maxConcurrent?: number;
  /** A stuck job is retried (while attempts remain) instead of failed: only for work that resumes. */
  retryOnStuck?: boolean;
  /** What a run row stamped with this job says when the job fails for good. */
  runSentence?: string;
};

/** Spec §6, customer copy. */
export const RUN_STOPPED = 'This run stopped before it finished. Extract again to pick up where it left off.';
export const PLAN_STOPPED = 'Finding the products stopped before it finished. Try again.';

const MIN = 60_000;

export const JOB_POLICIES = {
  'proof-page-capture': { lane: 'interactive', priority: 10, maxAttempts: 2, stuckMs: 3 * MIN, startWithinMs: 5 * MIN },
  reachability: { lane: 'interactive', priority: 0, maxAttempts: 1, stuckMs: MIN, startWithinMs: MIN },
  'listing-check': { lane: 'interactive', priority: 0, maxAttempts: 1, stuckMs: 90_000, startWithinMs: MIN },
  'transfer-marks': { lane: 'interactive', priority: 0, maxAttempts: 1, stuckMs: MIN, startWithinMs: MIN },
  'detect-variants': { lane: 'interactive', priority: 0, maxAttempts: 1, stuckMs: MIN, startWithinMs: MIN },
  'variant-links-near': { lane: 'interactive', priority: 0, maxAttempts: 1, stuckMs: 30_000, startWithinMs: MIN },
  plan: { lane: 'interactive', priority: 5, maxAttempts: 1, stuckMs: 15 * MIN, startWithinMs: 2 * MIN, runSentence: PLAN_STOPPED },
  verify: { lane: 'background', priority: 10, maxAttempts: 2, stuckMs: 14 * MIN, startWithinMs: 15 * MIN },
  'drift-check': { lane: 'background', priority: 20, maxAttempts: 2, stuckMs: 9 * MIN, startWithinMs: 30 * MIN },
  'coverage-check': { lane: 'background', priority: 20, maxAttempts: 2, stuckMs: 9 * MIN, startWithinMs: 30 * MIN },
  'website-check': { lane: 'background', priority: 30, maxAttempts: 2, stuckMs: 25 * MIN, startWithinMs: null, maxConcurrent: 1 },
  run: { lane: 'runs', priority: 10, maxAttempts: 3, stuckMs: 15 * MIN, startWithinMs: null, retryOnStuck: true, runSentence: RUN_STOPPED },
} as const satisfies Record<string, JobPolicy>;

export type JobType = keyof typeof JOB_POLICIES;

export type VerifyJobOptions = {
  onlyKeys?: string[];
  free?: boolean;
  origin?: 'customer' | 'refresh';
  captureRefs?: Record<string, StoredCaptureRef>;
};

export type TransferMarksPayload = {
  sourceId: string;
  fromUrl: string;
  toUrls: string[];
  from?: Record<string, { value: string; mark?: unknown; via?: unknown }>;
  fieldKeys?: string[];
};

export type JobPayloads = {
  'proof-page-capture': { captureId: string };
  reachability: { url: string };
  'listing-check': { listingUrl: string };
  'transfer-marks': TransferMarksPayload;
  'detect-variants': { sourceId: string };
  'variant-links-near': { sourceId: string; url: string; xpath: string };
  plan: { sourceId: string; runId: string; probe: boolean };
  verify: { sourceId: string; verificationId: string } & VerifyJobOptions;
  'drift-check': { checkId: string; storedRefs?: Record<string, StoredCaptureRef> };
  'coverage-check': { checkId: string };
  'website-check': { sourceId: string };
  run: { runId: string; limit?: number; repairSweep?: { deadFields: string[] } };
};
```

- [ ] **Step 5: `errors.ts`**

```ts
// packages/api/src/jobs/errors.ts
// An error crosses from the worker to the api-server as JSON on the job row and is thrown again as the
// class the procedure expects: a TRPCError keeps its code, a CaptureProblemError its customer sentence.
import { TRPCError } from '@trpc/server';
import { CaptureProblemError } from '@robot/scraper';
import type { CaptureVerdict } from '@robot/browser';

export type SerializedError =
  | { kind: 'trpc'; code: TRPCError['code']; message: string }
  | { kind: 'capture-problem'; message: string; verdict?: CaptureVerdict }
  | { kind: 'error'; message: string }
  /** The job did not run to an answer: stalled, expired, lost, or the caller stopped waiting. */
  | { kind: 'unavailable'; message: string };

/** The job ran no answer in time (stalled, expired, crashed past its attempts, or the wait's ceiling). */
export class JobUnavailableError extends Error {
  constructor(public readonly reason: string) {
    super(`The job did not finish: ${reason}`);
    this.name = 'JobUnavailableError';
  }
}

export function serializeError(err: unknown): SerializedError {
  if (err instanceof TRPCError) return { kind: 'trpc', code: err.code, message: err.message };
  if (err instanceof CaptureProblemError) return { kind: 'capture-problem', message: err.message, ...(err.verdict ? { verdict: err.verdict } : {}) };
  if (err instanceof JobUnavailableError) return { kind: 'unavailable', message: err.reason };
  const message = err instanceof Error ? err.message : String(err);
  return { kind: 'error', message: message.slice(0, 1000) };
}

export function rebuildError(e: SerializedError): Error {
  switch (e.kind) {
    case 'trpc': return new TRPCError({ code: e.code, message: e.message });
    case 'capture-problem': return new CaptureProblemError(e.message, e.verdict);
    case 'unavailable': return new JobUnavailableError(e.message);
    default: return new Error(e.message);
  }
}
```

- [ ] **Step 6: `rows.ts`**

```ts
// packages/api/src/jobs/rows.ts
// A job that will not run again closes every status row it owns (spec §4.5), with the code the app
// already words: 'stalled'. A run row gets the job's own sentence. On a retry, the rows an earlier
// attempt left half-done are closed the same way, except the one the payload names (it is reused).
import { sql } from 'drizzle-orm';
import type { DbOrTx } from './queue.js';

export type JobSubject = { table: 'source_verifications' | 'drift_checks' | 'coverage_checks' | 'captures' | 'runs'; id: string };

export async function closeJobRows(tx: DbOrTx, jobId: string, opts: { runSentence: string; except?: JobSubject | null }): Promise<void> {
  const not = (table: JobSubject['table']) => (opts.except?.table === table ? sql`AND id <> ${opts.except.id}` : sql``);
  await tx.execute(sql`UPDATE source_verifications SET error_message = 'stalled', completed_at = now()
    WHERE job_id = ${jobId} AND completed_at IS NULL ${not('source_verifications')}`);
  await tx.execute(sql`UPDATE drift_checks SET status = 'failed', error = 'stalled', completed_at = now()
    WHERE job_id = ${jobId} AND status = 'running' ${not('drift_checks')}`);
  await tx.execute(sql`UPDATE coverage_checks SET status = 'failed', error = 'stalled', completed_at = now()
    WHERE job_id = ${jobId} AND status = 'running' ${not('coverage_checks')}`);
  await tx.execute(sql`UPDATE captures SET metadata = jsonb_build_object(
      'kind', 'proof-page', 'status', 'failed', 'url', metadata->>'url', 'startedAt', metadata->>'startedAt', 'error', 'stalled')
    WHERE job_id = ${jobId} AND metadata->>'kind' = 'proof-page' AND metadata->>'status' = 'capturing' ${not('captures')}`);
  await tx.execute(sql`UPDATE runs SET
      error_message = CASE WHEN status = 'cancelling' THEN error_message ELSE ${opts.runSentence} END,
      status = CASE WHEN status = 'cancelling' THEN 'cancelled' ELSE 'failed' END,
      completed_at = now()
    WHERE job_id = ${jobId} AND status IN ('planning', 'extracting', 'cancelling') ${not('runs')}`);
}
```

- [ ] **Step 7: `queue.ts`**

```ts
// packages/api/src/jobs/queue.ts
// The jobs table's operations (spec 2026-10-23 §4.1). Every claim and enqueue is scoped to one
// JOB_QUEUE; a worker never sees another queue. Raw SQL, like crawl/claim-item.ts: postgres-js via
// drizzle returns the row list itself.
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db } from '@robot/db';
import type { Database } from '@robot/db';
import { closeJobRows } from './rows.js';
import { JobUnavailableError, rebuildError, type SerializedError } from './errors.js';
import { JOB_POLICIES, RUN_STOPPED } from './types.js';

/** The database or a transaction on it. */
export type DbOrTx = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

export type JobStatus = 'queued' | 'running' | 'done' | 'failed';
export type JobRow = {
  id: string; queue: string; type: string; key: string | null; payload: unknown; status: JobStatus;
  priority: number; attempts: number; maxAttempts: number; runAfter: Date; expiresAt: Date | null;
  lockedBy: string | null; lockedUntil: Date | null; result: unknown; error: string | null;
};
type RawJob = {
  id: string; queue: string; type: string; key: string | null; payload: unknown; status: JobStatus; priority: number;
  attempts: number; max_attempts: number; run_after: Date | string; expires_at: Date | string | null;
  locked_by: string | null; locked_until: Date | string | null; result: unknown; error: string | null;
};
const date = (v: Date | string | null): Date | null => (v === null ? null : v instanceof Date ? v : new Date(v));
const toJob = (r: RawJob): JobRow => ({
  id: r.id, queue: r.queue, type: r.type, key: r.key, payload: r.payload, status: r.status, priority: r.priority,
  attempts: r.attempts, maxAttempts: r.max_attempts, runAfter: date(r.run_after)!, expiresAt: date(r.expires_at),
  lockedBy: r.locked_by, lockedUntil: date(r.locked_until), result: r.result, error: r.error,
});
const rows = <T>(r: unknown) => r as T[];
const secs = (ms: number) => Math.max(ms, 1) / 1000;

export function jobQueueName(env: Record<string, string | undefined> = process.env): string {
  return (env.JOB_QUEUE ?? '').trim() || 'default';
}

export type EnqueueSpec = {
  type: string; payload: unknown; key?: string | null; priority?: number; maxAttempts?: number;
  runAfter?: Date; expiresAt?: Date | null; queue?: string;
};

/** Inserts a job, or hands back the queued/running one with the same key. Use the caller's transaction. */
export async function enqueueJob(dbOrTx: DbOrTx, spec: EnqueueSpec): Promise<{ id: string; created: boolean }> {
  const queue = spec.queue ?? jobQueueName();
  const key = spec.key ?? null;
  for (let tries = 0; tries < 3; tries++) {
    const id = randomUUID();
    const inserted = rows<{ id: string }>(await dbOrTx.execute(sql`
      INSERT INTO jobs (id, queue, type, key, payload, priority, max_attempts, run_after, expires_at)
      VALUES (${id}, ${queue}, ${spec.type}, ${key}, ${JSON.stringify(spec.payload ?? {})}::jsonb,
              ${spec.priority ?? 10}, ${spec.maxAttempts ?? 1}, ${(spec.runAfter ?? new Date()).toISOString()}::timestamptz,
              ${spec.expiresAt ? spec.expiresAt.toISOString() : null}::timestamptz)
      ON CONFLICT (queue, key) WHERE status IN ('queued', 'running') AND key IS NOT NULL DO NOTHING
      RETURNING id`));
    if (inserted[0]) return { id: inserted[0].id, created: true };
    const existing = rows<{ id: string }>(await dbOrTx.execute(sql`
      SELECT id FROM jobs WHERE queue = ${queue} AND key = ${key} AND status IN ('queued', 'running') LIMIT 1`));
    if (existing[0]) return { id: existing[0].id, created: false };
    // The active one finished between the two statements: the key is free again — insert.
  }
  throw new Error(`could not enqueue ${spec.type} (${key})`);
}

export async function claimJob(opts: { queue: string; workerId: string; types: string[]; leaseMs: number }): Promise<JobRow | null> {
  if (opts.types.length === 0) return null;
  const types = sql.join(opts.types.map((t) => sql`${t}`), sql`, `);
  const claimed = rows<RawJob>(await db.execute(sql`
    UPDATE jobs SET status = 'running', attempts = attempts + 1, locked_by = ${opts.workerId},
           locked_until = now() + make_interval(secs => ${secs(opts.leaseMs)}), started_at = now()
     WHERE id = (
       SELECT id FROM jobs
        WHERE queue = ${opts.queue} AND status = 'queued' AND type IN (${types})
          AND run_after <= now() AND (expires_at IS NULL OR expires_at > now())
        ORDER BY priority, run_after, created_at
        LIMIT 1
        FOR UPDATE SKIP LOCKED)
    RETURNING *`));
  return claimed[0] ? toJob(claimed[0]) : null;
}

export async function renewLease(id: string, workerId: string, leaseMs: number): Promise<boolean> {
  const r = rows(await db.execute(sql`UPDATE jobs SET locked_until = now() + make_interval(secs => ${secs(leaseMs)})
    WHERE id = ${id} AND locked_by = ${workerId} AND status = 'running' RETURNING id`));
  return r.length > 0;
}

export async function completeJob(id: string, workerId: string, value: unknown): Promise<boolean> {
  const r = rows(await db.execute(sql`UPDATE jobs SET status = 'done', result = ${JSON.stringify({ value: value ?? null })}::jsonb,
      error = NULL, finished_at = now(), locked_by = NULL, locked_until = NULL
    WHERE id = ${id} AND locked_by = ${workerId} AND status = 'running' RETURNING id`));
  return r.length > 0;
}

export async function retryJob(id: string, workerId: string, error: string, delayMs: number): Promise<boolean> {
  const r = rows(await db.execute(sql`UPDATE jobs SET status = 'queued', error = ${error.slice(0, 1000)}, locked_by = NULL, locked_until = NULL,
      run_after = now() + make_interval(secs => ${secs(delayMs)})
    WHERE id = ${id} AND locked_by = ${workerId} AND status = 'running' RETURNING id`));
  return r.length > 0;
}

/** Who may fail the job: its owner, a reaper (the lease lapsed), or anyone while it is still queued. */
export type FailGuard = { owner: string } | 'lapsed' | 'queued';

export async function failJobTerminal(id: string, guard: FailGuard, detail: SerializedError, runSentence: string): Promise<boolean> {
  const where = guard === 'lapsed' ? sql`status = 'running' AND locked_until < now()`
    : guard === 'queued' ? sql`status = 'queued'`
    : sql`status = 'running' AND locked_by = ${guard.owner}`;
  return db.transaction(async (tx) => {
    const r = rows(await tx.execute(sql`UPDATE jobs SET status = 'failed', error = ${detail.message.slice(0, 1000)},
        result = ${JSON.stringify({ error: detail })}::jsonb, finished_at = now(), locked_by = NULL, locked_until = NULL
      WHERE id = ${id} AND ${where} RETURNING id`));
    if (r.length === 0) return false;
    await closeJobRows(tx, id, { runSentence });
    return true;
  });
}

/** Shutdown: back to the queue at once, its attempt not spent. */
export async function releaseJob(id: string, workerId: string): Promise<void> {
  await db.execute(sql`UPDATE jobs SET status = 'queued', attempts = GREATEST(attempts - 1, 0), locked_by = NULL,
      locked_until = NULL, run_after = now()
    WHERE id = ${id} AND locked_by = ${workerId} AND status = 'running'`);
}

export async function reapJobs(queue: string, opts: { retryBaseMs: number; runSentenceFor: (type: string) => string }): Promise<{ retried: string[]; failed: string[]; expired: string[] }> {
  const out = { retried: [] as string[], failed: [] as string[], expired: [] as string[] };
  const lapsed = rows<{ id: string; type: string; attempts: number; max_attempts: number }>(await db.execute(sql`
    SELECT id, type, attempts, max_attempts FROM jobs
     WHERE queue = ${queue} AND status = 'running' AND locked_until < now() ORDER BY created_at`));
  for (const j of lapsed) {
    if (j.attempts < j.max_attempts) {
      const delay = opts.retryBaseMs * 2 ** Math.max(j.attempts - 1, 0);
      const r = rows(await db.execute(sql`UPDATE jobs SET status = 'queued', error = 'lease expired', locked_by = NULL,
          locked_until = NULL, run_after = now() + make_interval(secs => ${secs(delay)})
        WHERE id = ${j.id} AND status = 'running' AND locked_until < now() RETURNING id`));
      if (r.length) out.retried.push(j.id);
    } else if (await failJobTerminal(j.id, 'lapsed', { kind: 'unavailable', message: 'stalled' }, opts.runSentenceFor(j.type))) {
      out.failed.push(j.id);
    }
  }
  const late = rows<{ id: string; type: string }>(await db.execute(sql`
    SELECT id, type FROM jobs WHERE queue = ${queue} AND status = 'queued' AND expires_at < now() ORDER BY created_at`));
  for (const j of late) {
    if (await failJobTerminal(j.id, 'queued', { kind: 'unavailable', message: 'expired' }, opts.runSentenceFor(j.type))) out.expired.push(j.id);
  }
  return out;
}

export async function purgeJobs(queue: string, olderThanMs = 7 * 86_400_000): Promise<void> {
  await db.execute(sql`DELETE FROM jobs WHERE queue = ${queue} AND status IN ('done', 'failed')
    AND finished_at < now() - make_interval(secs => ${secs(olderThanMs)})`);
}

/** The ids among `ids` whose job is queued within its window, or running under an unexpired lease. */
export async function liveJobIds(dbOrTx: DbOrTx, ids: Array<string | null | undefined>): Promise<Set<string>> {
  const wanted = [...new Set(ids.filter((i): i is string => typeof i === 'string' && i.length > 0))];
  if (wanted.length === 0) return new Set();
  const list = sql.join(wanted.map((i) => sql`${i}::uuid`), sql`, `);
  const live = rows<{ id: string }>(await dbOrTx.execute(sql`SELECT id FROM jobs WHERE id IN (${list})
    AND ((status = 'queued' AND (expires_at IS NULL OR expires_at > now())) OR (status = 'running' AND locked_until > now()))`));
  return new Set(live.map((r) => r.id));
}

export async function isJobLive(dbOrTx: DbOrTx, id: string | null | undefined): Promise<boolean> {
  return id ? (await liveJobIds(dbOrTx, [id])).has(id) : false;
}

/** Jobs of this queue still to do now (queued and due, or running) — what a test drains. */
export async function openJobCount(queue: string): Promise<number> {
  const r = rows<{ n: number }>(await db.execute(sql`SELECT count(*)::int AS n FROM jobs WHERE queue = ${queue}
    AND (status = 'running' OR (status = 'queued' AND run_after <= now() AND (expires_at IS NULL OR expires_at > now())))`));
  return r[0]?.n ?? 0;
}

/**
 * Waits for a job's answer (spec §4.1): its value when done; its error, rebuilt, when failed. A queued
 * job past its window is failed here and its rows closed; past `ceilingMs` the caller stops waiting.
 */
export async function awaitJob(id: string, ceilingMs: number, pollMs = 150): Promise<unknown> {
  const until = Date.now() + ceilingMs;
  for (;;) {
    const [row] = rows<{ status: JobStatus; result: { value?: unknown; error?: SerializedError } | null; error: string | null; type: string; expired: boolean }>(
      await db.execute(sql`SELECT status, result, error, type, (expires_at IS NOT NULL AND expires_at < now()) AS expired FROM jobs WHERE id = ${id}`));
    if (!row) throw new JobUnavailableError('gone');
    if (row.status === 'done') return row.result?.value ?? null;
    if (row.status === 'failed') throw rebuildError(row.result?.error ?? { kind: 'unavailable', message: row.error ?? 'failed' });
    if (row.status === 'queued' && row.expired) {
      // An awaited job's rows (a plan's run) close with its policy's sentence.
      const sentence = (JOB_POLICIES as Record<string, { runSentence?: string }>)[row.type]?.runSentence ?? RUN_STOPPED;
      await failJobTerminal(id, 'queued', { kind: 'unavailable', message: 'expired' }, sentence);
      throw new JobUnavailableError('expired');
    }
    if (Date.now() >= until) throw new JobUnavailableError('no answer in time');
    await new Promise((r) => setTimeout(r, pollMs));
  }
}
```

- [ ] **Step 8: `enqueue.ts`**

```ts
// packages/api/src/jobs/enqueue.ts
// The one way api code starts a job: the type's policy decides its priority, attempts and window.
import { db } from '@robot/db';
import { JOB_POLICIES, type JobPayloads, type JobType } from './types.js';
import { awaitJob, enqueueJob, type DbOrTx } from './queue.js';

export async function enqueue<T extends JobType>(dbOrTx: DbOrTx, type: T, payload: JobPayloads[T], opts: { key?: string | null; priority?: number } = {}): Promise<string> {
  const p = JOB_POLICIES[type];
  const { id } = await enqueueJob(dbOrTx, {
    type, payload, key: opts.key ?? null, priority: opts.priority ?? p.priority, maxAttempts: p.maxAttempts,
    expiresAt: p.startWithinMs === null ? null : new Date(Date.now() + p.startWithinMs),
  });
  return id;
}

/** How long the api-server waits for an awaited job: its start window, its stuck limit and ten seconds. `JOB_AWAIT_MAX_MS` caps it (tests). */
export function ceilingOf(type: JobType, env: Record<string, string | undefined> = process.env): number {
  const p = JOB_POLICIES[type];
  const ceiling = (p.startWithinMs ?? 0) + p.stuckMs + 10_000;
  const cap = Number(env.JOB_AWAIT_MAX_MS);
  return Number.isFinite(cap) && cap > 0 ? Math.min(ceiling, cap) : ceiling;
}

/** Enqueue and wait for the answer (the procedures that answered from a browser in the request). */
export async function runAndWait<T extends JobType>(type: T, payload: JobPayloads[T], opts: { key?: string | null } = {}): Promise<unknown> {
  const id = await enqueue(db, type, payload, opts);
  return awaitJob(id, ceilingOf(type));
}
```

- [ ] **Step 9: Run the tests and the type-check**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-worker/packages/api && npx vitest run src/jobs/queue.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 10: Commit**

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-worker
git add packages/api/src/jobs/types.ts packages/api/src/jobs/errors.ts packages/api/src/jobs/rows.ts packages/api/src/jobs/queue.ts packages/api/src/jobs/enqueue.ts packages/api/src/jobs/queue.test.ts packages/api/src/test-setup/job-queue.ts packages/api/vitest.config.ts
git commit -m "feat(api): the job queue — enqueue, claim, lease, retry, reap, await

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The browser gate and the launch guard (`@robot/browser`, `@robot/api`) — spec §4.3, §4.4

**Files:**
- Modify: `packages/browser/src/playwright-browser.ts` (`launch`), `packages/browser/src/index.ts` (exports), `packages/api/src/browser-session.ts`
- Create: `packages/browser/src/launch-guard.ts`, `packages/api/src/jobs/context.ts`, `packages/api/src/jobs/browser-gate.ts`
- Test: `packages/browser/src/launch-guard.test.ts`, `packages/api/src/browser-session.test.ts` (append), `packages/api/src/jobs/browser-gate.test.ts`

**Interfaces:**
- Produces:
  - `@robot/browser`: `forbidBrowserLaunch(reason?: string): void`, `allowBrowserLaunch(): void`, `class BrowserForbiddenError extends Error`, `assertBrowserLaunchAllowed(): void`.
  - `jobs/context.ts`: `type JobContext = { jobId: string; type: string; lane: Lane; attempt: number; signal: AbortSignal; progress: () => void }`; `currentJob(): JobContext | undefined`; `currentJobId(): string | null`; `runInJob<T>(ctx: JobContext, fn: () => Promise<T>): Promise<T>`.
  - `browser-session.ts`: `type BrowserGate = { acquire(): Promise<() => void>; track(browser: IBrowser): () => void }`; `setBrowserGate(gate: BrowserGate | null): void`; `class NestedBrowserSessionError`.
  - `jobs/browser-gate.ts`: `type WorkerBrowserGate = BrowserGate & { open(): number; closeJob(jobId: string): Promise<void>; closeAll(): Promise<void> }`; `createBrowserGate(opts: { max: number; minFreeMb?: number; freeMb?: () => number; memoryWaitMs?: number; pollMs?: number }): WorkerBrowserGate`.

- [ ] **Step 1: Failing tests** — `packages/browser/src/launch-guard.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { PlaywrightBrowser } from './playwright-browser.js';
import { forbidBrowserLaunch, allowBrowserLaunch, BrowserForbiddenError } from './launch-guard.js';

afterEach(() => allowBrowserLaunch());

describe('the launch guard', () => {
  it('a forbidden process cannot launch Chromium — the launch throws before any process starts', async () => {
    forbidBrowserLaunch('The api-server never starts a browser.');
    const b = new PlaywrightBrowser();
    await expect(b.launch({ headless: true })).rejects.toBeInstanceOf(BrowserForbiddenError);
    await b.close(); // null-safe: nothing was launched
  });
});
```

Append to `packages/api/src/browser-session.test.ts` (it already builds fake browsers; reuse its fake factory, or this one):

```ts
import { setBrowserGate, NestedBrowserSessionError, type BrowserGate } from './browser-session.js';

describe('withBrowserSession under a gate', () => {
  const fake = () => ({ launch: vi.fn(async () => {}), close: vi.fn(async () => {}) }) as unknown as IBrowser;
  afterEach(() => setBrowserGate(null));

  it('asks the gate before launching, tracks the browser, and releases after close', async () => {
    const events: string[] = [];
    const gate: BrowserGate = {
      acquire: async () => { events.push('acquire'); return () => events.push('release'); },
      track: () => { events.push('track'); return () => events.push('untrack'); },
    };
    setBrowserGate(gate);
    const b = fake();
    await withBrowserSession(async () => { events.push('work'); }, () => b);
    expect(events).toEqual(['acquire', 'track', 'work', 'untrack', 'release']);
    expect(b.close).toHaveBeenCalledOnce();
  });

  it('refuses a session opened inside another', async () => {
    setBrowserGate({ acquire: async () => () => {}, track: () => () => {} });
    await expect(withBrowserSession(() => withBrowserSession(async () => 1, fake), fake)).rejects.toBeInstanceOf(NestedBrowserSessionError);
  });

  it('without a gate, nests as before (scripts)', async () => {
    await expect(withBrowserSession(() => withBrowserSession(async () => 1, fake), fake)).resolves.toBe(1);
  });
});
```

`packages/api/src/jobs/browser-gate.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import type { IBrowser } from '@robot/browser';
import { createBrowserGate } from './browser-gate.js';
import { runInJob, type JobContext } from './context.js';

const ctx = (jobId: string, lane: JobContext['lane']): JobContext => ({ jobId, type: 't', lane, attempt: 1, signal: new AbortController().signal, progress: () => {} });
const fake = () => ({ close: vi.fn(async () => {}) }) as unknown as IBrowser;
const tick = () => new Promise((r) => setTimeout(r, 10));

describe('createBrowserGate', () => {
  it('never more than max at once; a waiting interactive job goes before a waiting run', async () => {
    const gate = createBrowserGate({ max: 1 });
    const releaseFirst = await runInJob(ctx('a', 'background'), () => gate.acquire());
    const order: string[] = [];
    const run = runInJob(ctx('r', 'runs'), async () => { const rel = await gate.acquire(); order.push('run'); rel(); });
    const inter = runInJob(ctx('i', 'interactive'), async () => { const rel = await gate.acquire(); order.push('interactive'); rel(); });
    await tick();
    expect(order).toEqual([]);
    releaseFirst();
    await Promise.all([run, inter]);
    expect(order).toEqual(['interactive', 'run']);
  });

  it('waits for free memory, but not forever', async () => {
    let free = 100;
    const gate = createBrowserGate({ max: 2, minFreeMb: 500, freeMb: () => free, memoryWaitMs: 1000, pollMs: 10 });
    let got = false;
    const p = gate.acquire().then((rel) => { got = true; return rel; });
    await tick();
    expect(got).toBe(false);
    free = 900;
    (await p)();
    expect(got).toBe(true);
    free = 100;
    const t0 = Date.now();
    (await gate.acquire())();               // gives up waiting after memoryWaitMs and launches anyway
    expect(Date.now() - t0).toBeGreaterThanOrEqual(900);
  });

  it('closes one job\'s browsers, or all of them', async () => {
    const gate = createBrowserGate({ max: 3 });
    const a = fake(); const b = fake(); const c = fake();
    await runInJob(ctx('j1', 'background'), async () => { gate.track(a); gate.track(b); });
    await runInJob(ctx('j2', 'background'), async () => { gate.track(c); });
    expect(gate.open()).toBe(3);
    await gate.closeJob('j1');
    expect(a.close).toHaveBeenCalled(); expect(b.close).toHaveBeenCalled(); expect(c.close).not.toHaveBeenCalled();
    await gate.closeAll();
    expect(c.close).toHaveBeenCalled();
    expect(gate.open()).toBe(0);
  });

  it('an aborted job waiting for a browser gets none', async () => {
    const gate = createBrowserGate({ max: 1 });
    const hold = await gate.acquire();
    const controller = new AbortController();
    const waiting = runInJob({ ...ctx('x', 'background'), signal: controller.signal }, () => gate.acquire());
    controller.abort('stuck');
    hold();
    await expect(waiting).rejects.toThrow(/stopped/);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd packages/browser && npx vitest run src/launch-guard.test.ts` and `cd packages/api && npx vitest run src/browser-session.test.ts src/jobs/browser-gate.test.ts`
Expected: FAIL — modules/exports missing.

- [ ] **Step 3: The launch guard** — `packages/browser/src/launch-guard.ts`:

```ts
// A process that must never start Chromium (the api-server, spec 2026-10-23 §4.4) says so once at
// boot; from then on every PlaywrightBrowser.launch in that process throws before anything starts.
let forbidden: string | null = null;

export class BrowserForbiddenError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'BrowserForbiddenError';
  }
}

export function forbidBrowserLaunch(reason = 'This process does not start browsers.'): void { forbidden = reason; }
/** Tests only. */
export function allowBrowserLaunch(): void { forbidden = null; }
export function assertBrowserLaunchAllowed(): void { if (forbidden !== null) throw new BrowserForbiddenError(forbidden); }
```

In `playwright-browser.ts`, first line of `async launch(options: BrowserOptions = {})`: `assertBrowserLaunchAllowed();` (import from `./launch-guard.js`). In `index.ts`: `export { forbidBrowserLaunch, allowBrowserLaunch, assertBrowserLaunchAllowed, BrowserForbiddenError } from './launch-guard.js';`.

- [ ] **Step 4: The job context** — `packages/api/src/jobs/context.ts`:

```ts
// The job a piece of code is running in (spec §4.3): the runner sets it around each handler; rows a
// job inserts are stamped with its id, and the browser gate reads its lane and closes its browsers.
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Lane } from './types.js';

export type JobContext = { jobId: string; type: string; lane: Lane; attempt: number; signal: AbortSignal; progress: () => void };

const store = new AsyncLocalStorage<JobContext>();

export function currentJob(): JobContext | undefined { return store.getStore(); }
export function currentJobId(): string | null { return store.getStore()?.jobId ?? null; }
export function runInJob<T>(ctx: JobContext, fn: () => Promise<T>): Promise<T> { return store.run(ctx, fn); }
```

- [ ] **Step 5: The gate hook** — in `packages/api/src/browser-session.ts` add (keep the header comment; extend it with one paragraph: "A process may install a gate (the worker does, spec 2026-10-23 §4.3): every session then waits for it, is tracked by it, and may not be opened inside another session."):

```ts
import { AsyncLocalStorage } from 'node:async_hooks';

/** The worker's limit on browsers (jobs/browser-gate.ts). Unset: every session launches at once, as before. */
export type BrowserGate = { acquire(): Promise<() => void>; track(browser: IBrowser): () => void };

let gate: BrowserGate | null = null;
const inSession = new AsyncLocalStorage<true>();

export function setBrowserGate(next: BrowserGate | null): void { gate = next; }

export class NestedBrowserSessionError extends Error {
  constructor() {
    super('A browser session was opened inside another one: a job must never wait for a second browser while holding one.');
    this.name = 'NestedBrowserSessionError';
  }
}
```

and replace the body of `withBrowserSession` with:

```ts
  const g = gate;
  if (g && inSession.getStore()) throw new NestedBrowserSessionError();
  const release = g ? await g.acquire() : () => {};
  const browser = browserFactory();
  const untrack = g ? g.track(browser) : () => {};
  try {
    // `launch()` belongs INSIDE the try (see the note that stood here: a half-finished launch is reaped by close()).
    await browser.launch({ headless: true });
    return await inSession.run(true, () => fn(browser));
  } finally {
    try {
      await browser.close();
    } catch (err) {
      console.error('[browser-session] browser.close() failed (non-fatal):', err);
    }
    untrack();
    release();
  }
```

Keep the two existing explanatory comments (launch inside the try; a broken close must not replace fn's outcome) at their lines.

- [ ] **Step 6: The worker's gate** — `packages/api/src/jobs/browser-gate.ts`:

```ts
// The one place that limits browsers (spec 2026-10-23 §4.3): at most `max` Chromium processes in the
// worker, interactive jobs served before background before runs, none started while free memory is
// under `minFreeMb` (at most `memoryWaitMs`, then it launches anyway), each tracked by its job so a
// stopped job's browsers — or all of them, at shutdown — can be closed.
import os from 'node:os';
import type { IBrowser } from '@robot/browser';
import type { BrowserGate } from '../browser-session.js';
import { currentJob } from './context.js';

export type WorkerBrowserGate = BrowserGate & { open(): number; closeJob(jobId: string): Promise<void>; closeAll(): Promise<void> };

const RANK = { interactive: 0, background: 1, runs: 2 } as const;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createBrowserGate(opts: { max: number; minFreeMb?: number; freeMb?: () => number; memoryWaitMs?: number; pollMs?: number }): WorkerBrowserGate {
  let inUse = 0;
  let seq = 0;
  const waiters: Array<{ rank: number; seq: number; wake: () => void }> = [];
  const open = new Map<IBrowser, string | null>();
  const freeMb = opts.freeMb ?? (() => os.freemem() / 1_048_576);
  const pump = () => {
    waiters.sort((a, b) => a.rank - b.rank || a.seq - b.seq);
    while (inUse < opts.max && waiters.length > 0) { inUse++; waiters.shift()!.wake(); }
  };
  const release = () => { inUse--; pump(); };
  return {
    async acquire() {
      const job = currentJob();
      await new Promise<void>((wake) => { waiters.push({ rank: RANK[job?.lane ?? 'background'], seq: seq++, wake }); pump(); });
      if (job?.signal.aborted) { release(); throw new Error('The job was stopped before its browser started.'); }
      const until = Date.now() + (opts.memoryWaitMs ?? 120_000);
      while (freeMb() < (opts.minFreeMb ?? 0) && Date.now() < until && !job?.signal.aborted) await sleep(opts.pollMs ?? 1000);
      let released = false;
      return () => { if (!released) { released = true; release(); } };
    },
    track(browser) {
      open.set(browser, currentJob()?.jobId ?? null);
      return () => { open.delete(browser); };
    },
    open: () => open.size,
    async closeJob(jobId) {
      await Promise.all([...open].filter(([, j]) => j === jobId).map(([b]) => b.close().catch(() => {})));
    },
    async closeAll() {
      await Promise.all([...open.keys()].map((b) => b.close().catch(() => {})));
      open.clear();
    },
  };
}
```

- [ ] **Step 7: Run the tests and type-checks**

Run: `cd packages/browser && npx vitest run src/launch-guard.test.ts && npx tsc --noEmit`, then `cd packages/api && npx vitest run src/browser-session.test.ts src/jobs/browser-gate.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors. (The launch-guard test starts no Chromium.)

- [ ] **Step 8: Commit**

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-worker
git add packages/browser/src/launch-guard.ts packages/browser/src/launch-guard.test.ts packages/browser/src/playwright-browser.ts packages/browser/src/index.ts packages/api/src/browser-session.ts packages/api/src/browser-session.test.ts packages/api/src/jobs/context.ts packages/api/src/jobs/browser-gate.ts packages/api/src/jobs/browser-gate.test.ts
git commit -m "feat(browser,api): a launch guard, a job context and the worker's browser gate

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The runner (`@robot/api` `src/jobs/runner.ts`) — spec §4.3, §5

**Files:**
- Create: `packages/api/src/jobs/runner.ts`, `packages/api/src/jobs/test-jobs.ts`, `packages/api/src/test-helpers/jobs.ts`
- Test: `packages/api/src/jobs/runner.test.ts`

**Interfaces:**
- Consumes: Task 2's queue, Task 3's context and `WorkerBrowserGate`.
- Produces:
  - `type JobDefinition = { policy: JobPolicy; subject?: (payload: any) => JobSubject | null; run: (payload: any, ctx: JobContext) => Promise<unknown> }`; `type Registry = Record<string, JobDefinition>`.
  - `type RunnerOptions = { queue: string; registry: Registry; lanes: Record<Lane, number>; leaseMs?: number; pollMs?: number; reapEveryMs?: number; stuckCheckMs?: number; retryBaseMs?: number; minFreeMb?: number; freeMb?: () => number; browsers?: Pick<WorkerBrowserGate, 'closeJob' | 'closeAll'>; workerName?: string; log?: (line: string) => void }`.
  - `type JobRunner = { workerId: string; active(): number; stop(graceMs?: number): Promise<void> }`; `startJobRunner(opts: RunnerOptions): JobRunner`.
  - `test-jobs.ts`: `testJobDefinitions(): Registry` with `test-sleep` (2 attempts) and `test-sleep-once` (1 attempt), payload `{ ms: number; finishOnAttempt?: number }`.
  - `test-helpers/jobs.ts`: `withJobRunner<T>(fn: () => Promise<T>, opts?: { registry?: Registry }): Promise<T>`; `runQueuedJobs(opts?: { registry?: Registry; timeoutMs?: number }): Promise<void>`; `jobsOf(type: string): Promise<JobRow[]>` (this queue's jobs of a type, oldest first).

- [ ] **Step 1: Failing tests** — `packages/api/src/jobs/runner.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, jobs, sourceVerifications } from '@robot/db';
import { createTestSource, deleteTestSource } from '../test-helpers/source.js';
import { enqueueJob, claimJob, jobQueueName } from './queue.js';
import { startJobRunner, type Registry, type JobRunner } from './runner.js';
import type { JobPolicy } from './types.js';

const q = () => jobQueueName();
const get = async (id: string) => (await db.query.jobs.findFirst({ where: eq(jobs.id, id) }))!;
const policy = (p: Partial<JobPolicy> = {}): JobPolicy => ({ lane: 'background', priority: 10, maxAttempts: 1, stuckMs: 60_000, startWithinMs: null, ...p });
const until = async (pred: () => Promise<boolean>, ms = 10_000) => {
  const t = Date.now() + ms;
  while (!(await pred())) { if (Date.now() > t) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 25)); }
};
const lanes = { interactive: 1, background: 1, runs: 1 };
let runners: JobRunner[] = [];
const start = (registry: Registry, extra: Partial<Parameters<typeof startJobRunner>[0]> = {}) => {
  const r = startJobRunner({ queue: q(), registry, lanes, pollMs: 20, reapEveryMs: 50, stuckCheckMs: 20, retryBaseMs: 10, log: () => {}, ...extra });
  runners.push(r);
  return r;
};
afterEach(async () => { await Promise.all(runners.map((r) => r.stop(1000))); runners = []; await db.delete(jobs).where(eq(jobs.queue, q())); });

describe('startJobRunner', () => {
  it('runs a job and records its answer', async () => {
    const { id } = await enqueueJob(db, { type: 'echo', payload: { n: 2 } });
    start({ echo: { policy: policy(), run: async (p: { n: number }) => ({ twice: p.n * 2 }) } });
    await until(async () => (await get(id)).status === 'done');
    expect((await get(id)).result).toEqual({ value: { twice: 4 } });
  });

  it('a handler that throws is retried, then failed with its error', async () => {
    const { id } = await enqueueJob(db, { type: 'boom', payload: {}, maxAttempts: 2 });
    let calls = 0;
    start({ boom: { policy: policy({ maxAttempts: 2 }), run: async () => { calls++; throw new Error('db went away'); } } });
    await until(async () => (await get(id)).status === 'failed');
    expect(calls).toBe(2);
    expect(await get(id)).toMatchObject({ attempts: 2, error: 'db went away' });
  });

  it('a lane never runs more than its slots; a type never more than its cap', async () => {
    for (let i = 0; i < 3; i++) await enqueueJob(db, { type: 'slow', payload: {} });
    let now = 0; let peak = 0;
    start({ slow: { policy: policy(), run: async () => { now++; peak = Math.max(peak, now); await new Promise((r) => setTimeout(r, 80)); now--; } } },
      { lanes: { interactive: 1, background: 3, runs: 1 } });
    await until(async () => (await db.query.jobs.findMany({ where: eq(jobs.queue, q()) })).every((j) => j.status === 'done'));
    expect(peak).toBe(3);
    await db.delete(jobs).where(eq(jobs.queue, q()));
    for (let i = 0; i < 3; i++) await enqueueJob(db, { type: 'capped', payload: {} });
    now = 0; peak = 0;
    start({ capped: { policy: policy({ maxConcurrent: 1 }), run: async () => { now++; peak = Math.max(peak, now); await new Promise((r) => setTimeout(r, 50)); now--; } } },
      { lanes: { interactive: 1, background: 3, runs: 1 } });
    await until(async () => (await db.query.jobs.findMany({ where: eq(jobs.queue, q()) })).every((j) => j.status === 'done'));
    expect(peak).toBe(1);
  });

  it('a stuck job is stopped: its signal fires, its browsers close, it fails stalled — or, for work that resumes, is retried', async () => {
    const closed: string[] = [];
    const browsers = { closeJob: async (id: string) => { closed.push(id); }, closeAll: async () => {} };
    let aborted = false;
    const { id } = await enqueueJob(db, { type: 'hang', payload: {}, maxAttempts: 2 });
    start({ hang: { policy: policy({ stuckMs: 100, maxAttempts: 2 }), run: (_p, ctx) => new Promise((_, reject) => ctx.signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); })) } }, { browsers });
    await until(async () => (await get(id)).status === 'failed');
    expect(aborted).toBe(true);
    expect(closed).toContain(id);
    expect(await get(id)).toMatchObject({ error: 'stalled', attempts: 1 });   // never retried in the same process

    const r = await enqueueJob(db, { type: 'resumes', payload: {}, maxAttempts: 2 });
    let attempt = 0;
    start({ resumes: { policy: policy({ stuckMs: 100, maxAttempts: 2, retryOnStuck: true }), run: (_p, ctx) => { attempt = ctx.attempt; return ctx.attempt === 1 ? new Promise(() => {}) : Promise.resolve('resumed'); } } });
    await until(async () => (await get(r.id)).status === 'done');
    expect(attempt).toBe(2);
  });

  it('a job with progress is not stuck', async () => {
    const { id } = await enqueueJob(db, { type: 'busy', payload: {} });
    start({ busy: { policy: policy({ stuckMs: 100 }), run: async (_p, ctx) => { for (let i = 0; i < 6; i++) { await new Promise((r) => setTimeout(r, 50)); ctx.progress(); } return 'ok'; } } });
    await until(async () => (await get(id)).status === 'done');
  });

  it('shutdown waits, then gives running jobs back with their attempt unspent', async () => {
    const { id } = await enqueueJob(db, { type: 'long', payload: {}, maxAttempts: 2 });
    const r = start({ long: { policy: policy({ maxAttempts: 2 }), run: (_p, ctx) => new Promise((_, reject) => ctx.signal.addEventListener('abort', () => reject(new Error('stopped')))) } });
    await until(async () => (await get(id)).status === 'running');
    await r.stop(100);
    expect(await get(id)).toMatchObject({ status: 'queued', attempts: 0, lockedBy: null });
  });

  it('a crashed worker\'s job is reaped and finished by another (in-process)', async () => {
    const { id } = await enqueueJob(db, { type: 'echo', payload: { n: 1 }, maxAttempts: 2 });
    await claimJob({ queue: q(), workerId: 'dead:1', types: ['echo'], leaseMs: 50 });   // claimed, then nobody renews
    start({ echo: { policy: policy({ maxAttempts: 2 }), run: async () => 'recovered' } });
    await until(async () => (await get(id)).status === 'done');
    expect(await get(id)).toMatchObject({ attempts: 2, result: { value: 'recovered' } });
  });

  it('a retry closes the half-done rows of the earlier attempt, but not the one its payload names', async () => {
    const sourceId = await createTestSource({ schema: [] });
    try {
      const { id } = await enqueueJob(db, { type: 'redo', payload: {}, maxAttempts: 2 });
      const [mine] = await db.insert(sourceVerifications).values({ sourceId, definitionHash: 'h', jobId: id }).returning();
      const [leftover] = await db.insert(sourceVerifications).values({ sourceId, definitionHash: 'h', jobId: id }).returning();
      await claimJob({ queue: q(), workerId: 'dead:2', types: ['redo'], leaseMs: 50 });
      start({ redo: { policy: policy({ maxAttempts: 2 }), subject: () => ({ table: 'source_verifications', id: mine!.id }), run: async () => 'ok' } });
      await until(async () => (await get(id)).status === 'done');
      expect((await db.query.sourceVerifications.findFirst({ where: eq(sourceVerifications.id, leftover!.id) }))!.errorMessage).toBe('stalled');
      expect((await db.query.sourceVerifications.findFirst({ where: eq(sourceVerifications.id, mine!.id) }))!.completedAt).toBeNull();
    } finally { await deleteTestSource(sourceId); }
  });

  it('claims nothing while free memory is low', async () => {
    const { id } = await enqueueJob(db, { type: 'echo', payload: { n: 1 } });
    let free = 10;
    start({ echo: { policy: policy(), run: async () => 'ok' } }, { minFreeMb: 100, freeMb: () => free });
    await new Promise((r) => setTimeout(r, 200));
    expect((await get(id)).status).toBe('queued');
    free = 1000;
    await until(async () => (await get(id)).status === 'done');
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd packages/api && npx vitest run src/jobs/runner.test.ts`
Expected: FAIL — `./runner.js` does not exist.

- [ ] **Step 3: The runner** — `packages/api/src/jobs/runner.ts`:

```ts
// packages/api/src/jobs/runner.ts
// The worker's loop (spec 2026-10-23 §4.3): three lanes claim jobs while they have a slot and memory;
// every held job's lease is renewed each quarter lease; lapsed leases (a crashed worker) are reaped
// every 15 s; a job with no progress past its limit is stopped; shutdown gives running jobs back.
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { db } from '@robot/db';
import type { JobPolicy, Lane } from './types.js';
import { RUN_STOPPED } from './types.js';
import type { JobSubject } from './rows.js';
import { closeJobRows } from './rows.js';
import { runInJob, type JobContext } from './context.js';
import { serializeError } from './errors.js';
import type { WorkerBrowserGate } from './browser-gate.js';
import { claimJob, completeJob, failJobTerminal, purgeJobs, reapJobs, releaseJob, renewLease, retryJob, type JobRow } from './queue.js';

export type JobDefinition = {
  policy: JobPolicy;
  /** The status row the payload names, reused by a retry (every other row the job owns is closed first). */
  subject?: (payload: any) => JobSubject | null;
  run: (payload: any, ctx: JobContext) => Promise<unknown>;
};
export type Registry = Record<string, JobDefinition>;

export type RunnerOptions = {
  queue: string;
  registry: Registry;
  lanes: Record<Lane, number>;
  leaseMs?: number;
  pollMs?: number;
  reapEveryMs?: number;
  stuckCheckMs?: number;
  retryBaseMs?: number;
  minFreeMb?: number;
  freeMb?: () => number;
  browsers?: Pick<WorkerBrowserGate, 'closeJob' | 'closeAll'>;
  workerName?: string;
  log?: (line: string) => void;
};

export type JobRunner = { workerId: string; active(): number; stop(graceMs?: number): Promise<void> };

type Active = { job: JobRow; def: JobDefinition; controller: AbortController; lastProgress: number; over: boolean };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function startJobRunner(opts: RunnerOptions): JobRunner {
  const workerId = `${opts.workerName ?? os.hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  const leaseMs = opts.leaseMs ?? 60_000;
  const pollMs = opts.pollMs ?? 500;
  const retryBase = opts.retryBaseMs ?? 30_000;
  const log = opts.log ?? ((line: string) => console.log(`[worker] ${line}`));
  const freeMb = opts.freeMb ?? (() => os.freemem() / 1_048_576);
  const backoff = (attempt: number) => retryBase * 2 ** Math.max(attempt - 1, 0);
  const runSentenceFor = (type: string) => opts.registry[type]?.policy.runSentence ?? RUN_STOPPED;
  const active = new Map<string, Active>();
  let stopping = false;

  const count = (pred: (a: Active) => boolean) => [...active.values()].filter(pred).length;

  /** Ends a job's hold here: the slot is free at once, whatever its handler still does. */
  const finish = (a: Active) => { a.over = true; active.delete(a.job.id); };

  const start = (job: JobRow) => {
    const def = opts.registry[job.type]!;
    const controller = new AbortController();
    const a: Active = { job, def, controller, lastProgress: Date.now(), over: false };
    active.set(job.id, a);
    const ctx: JobContext = {
      jobId: job.id, type: job.type, lane: def.policy.lane, attempt: job.attempts, signal: controller.signal,
      progress: () => { a.lastProgress = Date.now(); },
    };
    log(`claimed ${job.type} ${job.id} (attempt ${job.attempts} of ${job.maxAttempts})`);
    void (async () => {
      try {
        if (job.attempts > 1) await closeJobRows(db, job.id, { runSentence: runSentenceFor(job.type), except: def.subject?.(job.payload) ?? null });
        const value = await runInJob(ctx, () => def.run(job.payload, ctx));
        if (a.over) return;
        finish(a);
        await completeJob(job.id, workerId, value ?? null);
        log(`done ${job.type} ${job.id}`);
      } catch (err) {
        if (a.over) return;
        finish(a);
        try {
          if (job.attempts < job.maxAttempts) {
            await retryJob(job.id, workerId, msg(err), backoff(job.attempts));
            log(`retry ${job.type} ${job.id} after: ${msg(err)}`);
          } else {
            await failJobTerminal(job.id, { owner: workerId }, serializeError(err), runSentenceFor(job.type));
            log(`failed ${job.type} ${job.id}: ${msg(err)}`);
          }
        } catch (recordErr) {
          log(`could not record the failure of ${job.id}: ${msg(recordErr)}`);
        }
      }
    })();
  };

  const laneLoop = async (lane: Lane) => {
    while (!stopping) {
      const busy = count((a) => a.def.policy.lane === lane);
      if (busy >= opts.lanes[lane] || freeMb() < (opts.minFreeMb ?? 0)) { await sleep(pollMs); continue; }
      const types = Object.entries(opts.registry)
        .filter(([type, d]) => d.policy.lane === lane && (d.policy.maxConcurrent === undefined || count((a) => a.job.type === type) < d.policy.maxConcurrent))
        .map(([type]) => type);
      let job: JobRow | null = null;
      try {
        job = await claimJob({ queue: opts.queue, workerId, types, leaseMs });
      } catch (err) {
        log(`claim failed: ${msg(err)}`);
      }
      if (!job) { await sleep(pollMs); continue; }
      if (stopping) { await releaseJob(job.id, workerId).catch(() => {}); break; }
      start(job);
    }
  };

  const heartbeat = setInterval(() => {
    for (const a of [...active.values()]) {
      void renewLease(a.job.id, workerId, leaseMs).then(async (held) => {
        if (held || a.over) return;
        // Another worker reaped it (this one looked dead): stop here; that worker owns the job now.
        finish(a);
        a.controller.abort('lease lost');
        await opts.browsers?.closeJob(a.job.id);
        log(`lost the lease on ${a.job.type} ${a.job.id}; stopped it here`);
      }).catch(() => { /* a database blip is not a lost lease */ });
    }
  }, Math.max(250, Math.floor(leaseMs / 4)));

  const stuckCheck = setInterval(() => {
    for (const a of [...active.values()]) {
      if (a.over || Date.now() - a.lastProgress < a.def.policy.stuckMs) continue;
      finish(a);
      a.controller.abort('stuck');
      void (async () => {
        await opts.browsers?.closeJob(a.job.id).catch(() => {});
        if (a.def.policy.retryOnStuck && a.job.attempts < a.job.maxAttempts) await retryJob(a.job.id, workerId, 'stuck', backoff(a.job.attempts));
        else await failJobTerminal(a.job.id, { owner: workerId }, { kind: 'unavailable', message: 'stalled' }, runSentenceFor(a.job.type));
        log(`stuck ${a.job.type} ${a.job.id}: no progress for ${a.def.policy.stuckMs} ms`);
      })().catch((err) => log(`could not stop ${a.job.id}: ${msg(err)}`));
    }
  }, opts.stuckCheckMs ?? 5000);

  let reaps = 0;
  const reap = async () => {
    try {
      const r = await reapJobs(opts.queue, { retryBaseMs: retryBase, runSentenceFor });
      for (const id of r.retried) log(`reaped ${id}: its worker stopped answering; retrying`);
      for (const id of r.failed) log(`reaped ${id}: its worker stopped answering; no attempts left`);
      for (const id of r.expired) log(`expired ${id}: not started in time`);
      if (reaps++ % 240 === 0) await purgeJobs(opts.queue);
    } catch (err) {
      log(`reap failed: ${msg(err)}`);
    }
  };
  void reap();
  const reaper = setInterval(() => void reap(), opts.reapEveryMs ?? 15_000);

  const loops = (['interactive', 'background', 'runs'] as Lane[]).filter((l) => opts.lanes[l] > 0).map((l) => laneLoop(l));

  return {
    workerId,
    active: () => active.size,
    async stop(graceMs = 25_000) {
      stopping = true;
      const deadline = Date.now() + graceMs;
      while (active.size > 0 && Date.now() < deadline) await sleep(50);
      for (const a of [...active.values()]) {
        finish(a);
        a.controller.abort('shutdown');
        await releaseJob(a.job.id, workerId).catch(() => {});
        log(`gave back ${a.job.type} ${a.job.id} (shutdown)`);
      }
      clearInterval(heartbeat); clearInterval(stuckCheck); clearInterval(reaper);
      await opts.browsers?.closeAll().catch(() => {});
      await Promise.all(loops);
    },
  };
}
```

- [ ] **Step 4: The test jobs** — `packages/api/src/jobs/test-jobs.ts`:

```ts
// Registered only with WORKER_TEST_JOBS=1 (the worker's crash-recovery test): they sleep, load no page.
import type { Registry } from './runner.js';

const sleepJob = (maxAttempts: number): Registry[string] => ({
  policy: { lane: 'background', priority: 10, maxAttempts, stuckMs: 10 * 60_000, startWithinMs: null },
  run: (p: { ms: number; finishOnAttempt?: number }, ctx) => {
    if (p.finishOnAttempt !== undefined && ctx.attempt >= p.finishOnAttempt) return Promise.resolve({ attempt: ctx.attempt });
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => resolve({ attempt: ctx.attempt }), p.ms);
      ctx.signal.addEventListener('abort', () => { clearTimeout(t); reject(new Error('stopped')); });
    });
  },
});

export function testJobDefinitions(): Registry {
  return { 'test-sleep': sleepJob(2), 'test-sleep-once': sleepJob(1) };
}
```

- [ ] **Step 5: The test helper** — `packages/api/src/test-helpers/jobs.ts`:

```ts
// Runs this test file's queue in-process: module mocks (browser-session, plan-source, …) apply to the
// handlers exactly as they did to the old fire-and-forget bodies. Never a real browser unless the test
// itself provides one.
import { eq, and, asc } from 'drizzle-orm';
import { db, jobs } from '@robot/db';
import { jobQueueName, openJobCount, type JobRow } from '../jobs/queue.js';
import { startJobRunner, type Registry } from '../jobs/runner.js';

async function registryOrDefault(registry?: Registry): Promise<Registry> {
  if (registry) return registry;
  const { jobRegistry } = await import('../jobs/handlers.js');
  return jobRegistry();
}

const runnerFor = (registry: Registry) => startJobRunner({
  queue: jobQueueName(), registry, lanes: { interactive: 3, background: 2, runs: 1 },
  pollMs: 25, reapEveryMs: 60_000, retryBaseMs: 10, log: () => {},
});

/** Runs `fn` (a procedure that awaits a job) with a runner working this file's queue. */
export async function withJobRunner<T>(fn: () => Promise<T>, opts: { registry?: Registry } = {}): Promise<T> {
  const runner = runnerFor(await registryOrDefault(opts.registry));
  try { return await fn(); } finally { await runner.stop(5000); }
}

/** Runs every due job of this file's queue (and the jobs they enqueue) until none is left. */
export async function runQueuedJobs(opts: { registry?: Registry; timeoutMs?: number } = {}): Promise<void> {
  const runner = runnerFor(await registryOrDefault(opts.registry));
  const until = Date.now() + (opts.timeoutMs ?? 30_000);
  try {
    while ((await openJobCount(jobQueueName())) > 0) {
      if (Date.now() > until) throw new Error('jobs still open after the timeout');
      await new Promise((r) => setTimeout(r, 25));
    }
  } finally { await runner.stop(5000); }
}

export async function jobsOf(type: string): Promise<JobRow[]> {
  const found = await db.query.jobs.findMany({ where: and(eq(jobs.queue, jobQueueName()), eq(jobs.type, type)), orderBy: [asc(jobs.createdAt)] });
  return found as unknown as JobRow[];
}
```

(`jobs/handlers.ts` arrives in Task 5; until then `runQueuedJobs`/`withJobRunner` are only called with an explicit registry. The dynamic import keeps this file compiling — create a stub `packages/api/src/jobs/handlers.ts` now: `import type { Registry } from './runner.js'; export function jobRegistry(_opts: { testJobs?: boolean } = {}): Registry { return {}; }` — Task 5 fills it.)

- [ ] **Step 6: Run the tests and the type-check**

Run: `cd packages/api && npx vitest run src/jobs/runner.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-worker
git add packages/api/src/jobs/runner.ts packages/api/src/jobs/runner.test.ts packages/api/src/jobs/test-jobs.ts packages/api/src/jobs/handlers.ts packages/api/src/test-helpers/jobs.ts
git commit -m "feat(api): the job runner — lanes, leases, reaping, stuck jobs, shutdown

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Proof-page captures and Verify through the queue (`@robot/api`) — spec §4.4, §4.5

**Files:**
- Modify: `packages/api/src/verify/proof-page-capture.ts`, `packages/api/src/verify/in-flight.ts`, `packages/api/src/verify/run-failure.ts`, `packages/api/src/verify/run-source-verification.ts`, `packages/api/src/verify/refresh-values.ts`, `packages/api/src/routers/sources.ts` (`captureProofPage`, `proofPageCapture`, `verify`, `verificationStatus`), `packages/api/src/jobs/handlers.ts`, `packages/api/src/verify/run-coverage-check.ts` (only: drop `captureSlots`)
- Create: `packages/api/src/jobs/handlers/verify.ts`
- Delete: `packages/api/src/verify/limiter.ts`, `packages/api/src/verify/limiter.test.ts`
- Test: `packages/api/src/verify/proof-page-capture.test.ts`, `packages/api/src/verify/in-flight.test.ts` (create), `packages/api/src/verify/run-failure.test.ts` (create if absent, else append), `packages/api/src/routers/sources-verify.test.ts`, `packages/api/src/verify/run-source-verification.test.ts`, `packages/api/src/verify/refresh-values.test.ts`

**Interfaces:**
- Consumes: `enqueue`, `isJobLive`, `currentJobId`, `jobRegistry` stub, `withJobRunner`/`runQueuedJobs`/`jobsOf`.
- Produces:
  - `startProofPageCapture(sourceId, url, opts?: { fire?: boolean }): Promise<{ captureId: string }>` — fire (default) inserts the row and enqueues `proof-page-capture` (key `capture:<id>`, row `job_id`) in one transaction; `fire: false` inserts with `job_id = currentJobId()`. The `session` option is gone (tests use `fire: false` + `runProofPageCapture(id, session)`).
  - `runProofPageCaptureInSlot` kept as `export const runProofPageCaptureInSlot = runProofPageCapture;` (scripts call it). `captureSlots`, `waitingForSlot` removed.
  - `resolveStalledProofPage(captureId: string, meta: ProofPageMeta, jobId: string | null): Promise<ProofPageMeta>`.
  - `startVerificationRow(db, sourceId, definitionHash, onStarted?, job?: VerifyJobOptions): Promise<{ verificationId; status }>` — with `job`, enqueues `verify` (key `verify:<id>`) in the same transaction and stamps the row.
  - `runFailure(row, now?, live?: boolean)`.
  - `runVerifyJob(p: JobPayloads['verify']): Promise<void>`.
  - `jobRegistry()` now has `proof-page-capture` and `verify`.

- [ ] **Step 1: Failing tests.** Add to `packages/api/src/verify/proof-page-capture.test.ts` (it already has a signed-in caller, `createProjectWithSource`, `fakeCapture`, `CAPTURES_DIR`; import `jobs` from `@robot/db`, `jobsOf` from `../test-helpers/jobs.js`, `enqueueJob` from `../jobs/queue.js`, `resolveStalledProofPage` from `./proof-page-capture.js`):

```ts
describe('proof-page captures go through the queue (spec 2026-10-23 §4.4)', () => {
  it('a start inserts the row and its job together; the row names the job', async () => {
    const f = await createProjectWithSource(caller, { tag: 'ppc-queue', fields: [{ name: 'Title', type: 'text' }] });
    try {
      const { captureId } = await startProofPageCapture(f.sourceId, 'https://shop.test/p/1');
      const [job] = await jobsOf('proof-page-capture');
      expect(job).toMatchObject({ status: 'queued', key: `capture:${captureId}`, payload: { captureId }, maxAttempts: 2 });
      const row = await db.query.captures.findFirst({ where: eq(captures.id, captureId) });
      expect(row!.jobId).toBe(job!.id);
    } finally { await f.cleanup(); }
  });

  it('a capturing row older than the stall window stays capturing while its job is live; with none it stalls', async () => {
    const f = await createProjectWithSource(caller, { tag: 'ppc-live', fields: [{ name: 'Title', type: 'text' }] });
    try {
      const old = new Date(Date.now() - PROOF_PAGE_STALL_MS - 60_000).toISOString();
      const meta: ProofPageMeta = { kind: 'proof-page', status: 'capturing', url: 'https://shop.test/p/2', startedAt: old };
      const { id: jobId } = await enqueueJob(db, { type: 'proof-page-capture', payload: {} });
      const [queued] = await db.insert(captures).values({ sourceId: f.sourceId, url: meta.url, metadata: meta, jobId }).returning();
      expect((await resolveStalledProofPage(queued!.id, meta, jobId)).status).toBe('capturing');
      const [orphan] = await db.insert(captures).values({ sourceId: f.sourceId, url: meta.url, metadata: meta }).returning();
      expect(await resolveStalledProofPage(orphan!.id, meta, null)).toMatchObject({ status: 'failed', error: 'stalled' });
    } finally { await f.cleanup(); }
  });

  it('a capture closed meanwhile is not overwritten when its late attempt finishes', async () => {
    const f = await createProjectWithSource(caller, { tag: 'ppc-fence', fields: [{ name: 'Title', type: 'text' }] });
    try {
      const url = 'https://shop.test/p/3';
      const { captureId } = await startProofPageCapture(f.sourceId, url, { fire: false });
      const closed: ProofPageMeta = { kind: 'proof-page', status: 'failed', url, startedAt: new Date().toISOString(), error: 'stalled' };
      // The session closes the row first — as the runner does when it stops a stuck attempt — then the capture "finishes".
      const session = async <T,>(fn: (b: IBrowser) => Promise<T>) => {
        await db.update(captures).set({ metadata: closed }).where(eq(captures.id, captureId));
        return fn({ capture: async () => fakeCapture(url) } as unknown as IBrowser);
      };
      await runProofPageCapture(captureId, session as never, { jev: false });
      expect((await db.query.captures.findFirst({ where: eq(captures.id, captureId) }))!.metadata).toEqual(closed);
    } finally { await f.cleanup(); }
  });
});
```

(Use the file's existing way of building a fake browser for `captureProofPage` — it calls `browser.capture(...)` and more; copy the existing successful-capture test's fake rather than the sketch above if it differs. Existing tests that called `startProofPageCapture(…, { session })` and waited for the fired run now call `startProofPageCapture(…, { fire: false })` then `await runProofPageCapture(captureId, session)`.)

`packages/api/src/verify/in-flight.test.ts` (new):

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, sourceVerifications } from '@robot/db';
import { VERIFY_STALL_MS } from '@robot/scraper';
import { createTestSource, deleteTestSource } from '../test-helpers/source.js';
import { enqueueJob } from '../jobs/queue.js';
import { resolveInFlightVerification, startVerificationRow } from './in-flight.js';
import { jobsOf } from '../test-helpers/jobs.js';

const sources: string[] = [];
afterAll(async () => { for (const s of sources) await deleteTestSource(s); });
const source = async () => { const id = await createTestSource({ schema: [] }); sources.push(id); return id; };
const old = () => new Date(Date.now() - VERIFY_STALL_MS - 60_000);

describe('a verification in flight (spec 2026-10-23 §4.5)', () => {
  it('a verification older than the stall window whose job is queued stays in flight', async () => {
    const s = await source();
    const { id: jobId } = await enqueueJob(db, { type: 'verify', payload: {} });
    const [v] = await db.insert(sourceVerifications).values({ sourceId: s, definitionHash: 'h', startedAt: old(), jobId }).returning();
    expect(await resolveInFlightVerification(db, s)).toEqual({ id: v!.id });
    expect((await db.query.sourceVerifications.findFirst({ where: eq(sourceVerifications.id, v!.id) }))!.completedAt).toBeNull();
  });

  it('one with no live job follows the time rule, as before', async () => {
    const s = await source();
    const [v] = await db.insert(sourceVerifications).values({ sourceId: s, definitionHash: 'h', startedAt: old() }).returning();
    expect(await resolveInFlightVerification(db, s)).toBeNull();
    expect((await db.query.sourceVerifications.findFirst({ where: eq(sourceVerifications.id, v!.id) }))!.errorMessage).toBe('stalled');
  });

  it('a start with job options inserts the row and its verify job in one transaction; a second start is in progress', async () => {
    const s = await source();
    const a = await startVerificationRow(db, s, 'h', undefined, { onlyKeys: ['price'], free: true });
    expect(a.status).toBe('started');
    const [job] = await jobsOf('verify');
    expect(job).toMatchObject({ key: `verify:${a.verificationId}`, payload: { sourceId: s, verificationId: a.verificationId, onlyKeys: ['price'], free: true } });
    expect((await db.query.sourceVerifications.findFirst({ where: eq(sourceVerifications.id, a.verificationId) }))!.jobId).toBe(job!.id);
    expect(await startVerificationRow(db, s, 'h', undefined, {})).toEqual({ verificationId: a.verificationId, status: 'in-progress' });
    expect(await jobsOf('verify')).toHaveLength(1);
  });

  it('without job options, no job (scripts start their own run)', async () => {
    const s = await source();
    await startVerificationRow(db, s, 'h');
    expect((await jobsOf('verify')).filter((j) => (j.payload as { sourceId: string }).sourceId === s)).toEqual([]);
  });
});
```

`run-failure` (append, or create `packages/api/src/verify/run-failure.test.ts` with the import):

```ts
import { VERIFY_STALL_MS } from '@robot/scraper';
import { runFailure } from './run-failure.js';
describe('runFailure with a live job', () => {
  it('an old in-flight row with a live job has not failed', () => {
    const row = { startedAt: new Date(Date.now() - VERIFY_STALL_MS - 1), completedAt: null, errorMessage: null };
    expect(runFailure(row, Date.now(), true)).toBeNull();
    expect(runFailure(row, Date.now(), false)).toBe('stalled');
    expect(runFailure(row)).toBe('stalled');
  });
});
```

In `packages/api/src/routers/sources-verify.test.ts`: the existing tests mock `runSourceVerification` or assert the background ran — change every "Verify started" assertion to also check the queued job: after `caller.sources.verify(...)`, `const [job] = await jobsOf('verify'); expect(job!.payload).toMatchObject({ verificationId: started.verificationId, onlyKeys: … })`; where a test needs the run's outcome, `await runQueuedJobs()` (with its existing `vi.mock` of browser-session/agent in place) before reading the row.

In `packages/api/src/verify/run-source-verification.test.ts` add:

```ts
it('a verification completed meanwhile is not overwritten (a stopped attempt finishing late)', async () => {
  // Build the source and fake session exactly as this file's passing-Verify test does; inside the fake
  // session's first capture, close the row as the runner would: completedAt set, errorMessage 'stalled'.
  // After runSourceVerification returns: errorMessage is still 'stalled', results still {}, no field_holds row
  // was written for this verification, and saveVerifiedPaths/startCoverage were not called.
});
```

— write it concretely by copying this file's simplest passing-Verify setup (its fake session, source and `startCoverage` spy), adding the in-session `db.update(sourceVerifications).set({ completedAt: new Date(), errorMessage: 'stalled' }).where(eq(sourceVerifications.id, verificationId))` before the first capture returns, and asserting `{ errorMessage: 'stalled', results: {} }` on the row and `startCoverage` not called.

And for `runVerifyJob` (new `describe` in the same file): a completed row → `runVerifyJob` returns without calling the session; an open row with `startedAt` an hour ago → after `runVerifyJob` (with the fake session via `vi.mock('../browser-session.js')` as the file already does, or by calling through `runSourceVerification`'s injected deps) its `startedAt` is within the last minute.

In `packages/api/src/verify/refresh-values.test.ts`: tests of `startRefreshVerify` that passed `deps.run` now assert the job instead: `const [job] = await jobsOf('verify'); expect(job!.payload).toMatchObject({ onlyKeys: keys, free: true, origin: 'refresh', captureRefs })` and that the `value_refreshes` rows carry the new verification id (unchanged rule). Remove the `run` dependency from those calls.

- [ ] **Step 2: Run them to see them fail**

Run: `cd packages/api && npx vitest run src/verify/proof-page-capture.test.ts src/verify/in-flight.test.ts src/verify/run-failure.test.ts`
Expected: FAIL — no job is enqueued; `resolveStalledProofPage` takes two arguments; `startVerificationRow` ignores job options.

- [ ] **Step 3: Captures.** In `packages/api/src/verify/proof-page-capture.ts`:
  - Remove the `createLimiter` import, `captureSlots`, `waitingForSlot` and every `waitingForSlot.*` line. Import `randomUUID` from `node:crypto`, `enqueue` from `../jobs/enqueue.js`, `currentJobId` from `../jobs/context.js`, `isJobLive` from `../jobs/queue.js`, and `sql` from `drizzle-orm`.
  - Replace `startProofPageCapture` and `runProofPageCaptureInSlot` with:

```ts
/**
 * Inserts a `capturing` row (spec 2026-09-18 §3.1). Fired (the default): its `proof-page-capture` job is
 * enqueued in the same transaction and the worker takes it (spec 2026-10-23 §4.4). `fire: false`: the caller
 * runs `runProofPageCapture` itself (the drift check, scripts); the row then belongs to the caller's job.
 */
export async function startProofPageCapture(sourceId: string, url: string, opts: { fire?: boolean } = {}): Promise<{ captureId: string }> {
  const meta: ProofPageMeta = { kind: 'proof-page', status: 'capturing', url, startedAt: new Date().toISOString() };
  const id = randomUUID();
  if (opts.fire ?? true) {
    await db.transaction(async (tx) => {
      const jobId = await enqueue(tx, 'proof-page-capture', { captureId: id }, { key: `capture:${id}` });
      await tx.insert(captures).values({ id, sourceId, url, metadata: meta, jobId });
    });
  } else {
    await db.insert(captures).values({ id, sourceId, url, metadata: meta, jobId: currentJobId() });
  }
  return { captureId: id };
}

/** Scripts still call it by this name; the worker's gate is the slot now. */
export const runProofPageCaptureInSlot = runProofPageCapture;
```

  (Move the `runProofPageCaptureInSlot` const below `runProofPageCapture`'s declaration.)
  - In `runProofPageCapture`: select `metadata` as today; right after the `if (!row)` guard add `if ((row.metadata as ProofPageMeta | null)?.status !== 'capturing') return;` (a retried or closed row is not taken again). Every later `db.update(captures)…where(eq(captures.id, captureId))` (the start-time reset, the backoff answer, the success write, the failure write) becomes `.where(and(eq(captures.id, captureId), stillCapturing))` with `const stillCapturing = sql\`${captures.metadata}->>'status' = 'capturing'\`;` at module level.
  - Replace `resolveStalledProofPage`:

```ts
export async function resolveStalledProofPage(captureId: string, meta: ProofPageMeta, jobId: string | null): Promise<ProofPageMeta> {
  if (meta.status !== 'capturing') return meta;
  // Its job is queued or working on it: waiting in the queue is not a stall (spec 2026-10-23 §4.5).
  if (await isJobLive(db, jobId)) return meta;
  if (!(Date.now() - Date.parse(meta.startedAt) > PROOF_PAGE_STALL_MS)) return meta;
  const failed: ProofPageMeta = { kind: 'proof-page', status: 'failed', url: meta.url, startedAt: meta.startedAt, error: 'stalled' };
  await db.update(captures).set({ metadata: failed }).where(and(eq(captures.id, captureId), stillCapturing))
    .catch((e) => console.error(`[proof-page] failed to close stalled capture ${captureId}:`, e));
  return failed;
}
```

  - `latestProofPageCaptures`: select `jobId: true` too and call `resolveStalledProofPage(r.id, m, r.jobId)`.
  - Update the header comment: the background body runs in the worker as the `proof-page-capture` job.
- In `packages/api/src/routers/sources.ts` `proofPageCapture`: select `jobId: true` and call `resolveStalledProofPage(row.id, stored, row.jobId)`. `captureProofPage` is unchanged (`startProofPageCapture(input.sourceId, input.url)` now enqueues).
- In `packages/api/src/verify/run-coverage-check.ts`: drop `captureSlots` from the import and unwrap both `captureSlots(() => withBrowserSession(…))` into `withBrowserSession(…)` (the worker's gate limits them now); keep the comments, reworded: "the worker's browser gate keeps it within WORKER_BROWSERS".
- `git rm packages/api/src/verify/limiter.ts packages/api/src/verify/limiter.test.ts` (nothing else imports `createLimiter`: `grep -rn "limiter" packages/api/src` must show nothing after).

- [ ] **Step 4: Verify.** In `packages/api/src/verify/in-flight.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { enqueue } from '../jobs/enqueue.js';
import { isJobLive } from '../jobs/queue.js';
import type { VerifyJobOptions } from '../jobs/types.js';

export async function startVerificationRow(
  db: Database,
  sourceId: string,
  definitionHash: string,
  onStarted?: (tx: DbOrTx, verificationId: string) => Promise<unknown>,
  /** With options, the `verify` job is enqueued in this transaction (spec 2026-10-23 §4.4); without, the caller runs it. */
  job?: VerifyJobOptions,
): Promise<{ verificationId: string; status: 'started' | 'in-progress' }> {
  return db.transaction(async (tx) => {
    await lockSource(tx, sourceId);
    const inFlight = await resolveInFlightVerification(tx, sourceId);
    if (inFlight) return { verificationId: inFlight.id, status: 'in-progress' as const };
    const id = randomUUID();
    const jobId = job ? await enqueue(tx, 'verify', { sourceId, verificationId: id, ...job }, { key: `verify:${id}` }) : null;
    await tx.insert(sourceVerifications).values({ id, sourceId, definitionHash, jobId });
    if (onStarted) await onStarted(tx, id);
    return { verificationId: id, status: 'started' as const };
  });
}
```

and in `resolveInFlightVerification` select `jobId: true` and, before the time check, `if (await isJobLive(db, inFlight.jobId)) return { id: inFlight.id };` (update its doc comment: "A row whose job is live is in flight however old; otherwise the time rule"). `DbOrTx` stays exported from here (other modules import it); `jobs/queue.ts` has its own identical alias.

`packages/api/src/verify/run-failure.ts`:

```ts
export function runFailure(row: { startedAt: Date; completedAt: Date | null; errorMessage: string | null }, now: number = Date.now(), live = false): RunFailure | null {
  if (row.completedAt !== null) return row.errorMessage === null ? null : row.errorMessage === 'stalled' ? 'stalled' : 'stopped';
  // A row whose job is queued or running is in flight, however long it waited (spec 2026-10-23 §4.5).
  if (live) return null;
  return now - row.startedAt.getTime() >= VERIFY_STALL_MS ? 'stalled' : null;
}
```

In `routers/sources.ts` `verificationStatus`: `const failure = runFailure(newest, Date.now(), await isJobLive(ctx.db, newest.jobId));` (import `isJobLive` from `../jobs/queue.js`).

`routers/sources.ts` `verify`: replace the `startVerificationRow` call and the `void runSourceVerification(…)` block with

```ts
      const start = await startVerificationRow(ctx.db, input.sourceId, hash, undefined, {
        ...(input.onlyKeys ? { onlyKeys: input.onlyKeys } : {}), ...(input.free ? { free: true } : {}),
      });
      return start.status === 'in-progress' ? start : { verificationId: start.verificationId, status: 'started' as const };
```

and drop the now-unused `runSourceVerification` import if nothing else in the file uses it.

`packages/api/src/verify/refresh-values.ts` `startRefreshVerify`: drop `deps.run` and the `void … runSourceVerification(…)` block; pass the job to the start:

```ts
  const start = await startVerificationRow(db, sourceId, hash, checkId
    ? (tx, id) => tx.update(valueRefreshes).set({ verificationId: id }).where(and(eq(valueRefreshes.driftCheckId, checkId), inArray(valueRefreshes.fieldKey, keys)))
    : undefined,
    { onlyKeys: keys, free: true, origin: 'refresh', captureRefs });
  return start.status === 'in-progress' ? null : start.verificationId;
```

(`deps` keeps `checkId` only; remove the `runSourceVerification` import.)

`packages/api/src/verify/run-source-verification.ts`:
  - The final transaction becomes fenced:

```ts
    const wrote = await db.transaction(async (tx) => {
      const [won] = await tx.update(sourceVerifications).set({ /* the same fields as today */ })
        .where(and(eq(sourceVerifications.id, verificationId), isNull(sourceVerifications.completedAt)))
        .returning({ id: sourceVerifications.id });
      // Closed meanwhile (the runner stopped this attempt as stuck): a late attempt writes nothing (spec §7.6).
      if (!won) return false;
      await writeHolds(tx, sourceId, holdPlan);
      await tx.update(sources).set({ nextCheckAt: nextCheckAt() }).where(eq(sources.id, sourceId));
      return true;
    });
    if (!wrote) return;
```

  - `void startCoverage(sourceId, verificationId).catch(…)` → `await startCoverage(sourceId, verificationId).catch((err) => console.error(…))` (it only enqueues now).
  - `void startCheck(…).catch(…)` → `await startCheck(…).catch(…)`, and `startVerifyCheck` becomes `return startDriftCheck(sourceId, null, { trigger: 'verify', keys, storedRefs: refs });` (Task 6 adds `storedRefs`; until then keep `capture: storedCaptures(refs)` — Task 6 Step 3 makes the switch).
  - The `catch` block's failure update gains `and(eq(sourceVerifications.id, verificationId), isNull(sourceVerifications.completedAt))`.
  - Header comment: "the body of the `verify` job (jobs/handlers/verify.ts); never awaited by a request."

`packages/api/src/jobs/handlers/verify.ts`:

```ts
// The `verify` job (spec 2026-10-23 §4.4): a row already finished or closed is not run again; the
// clock starts with the work (the app reads `startedAt` for its stall line), then today's body.
import { and, eq, isNull } from 'drizzle-orm';
import { db, sourceVerifications } from '@robot/db';
import { runSourceVerification } from '../../verify/run-source-verification.js';
import type { JobPayloads } from '../types.js';

export async function runVerifyJob(p: JobPayloads['verify']): Promise<void> {
  const [open] = await db.update(sourceVerifications).set({ startedAt: new Date() })
    .where(and(eq(sourceVerifications.id, p.verificationId), isNull(sourceVerifications.completedAt)))
    .returning({ id: sourceVerifications.id });
  if (!open) return;
  await runSourceVerification(p.sourceId, p.verificationId, {
    ...(p.onlyKeys ? { onlyKeys: p.onlyKeys } : {}), ...(p.free ? { free: true } : {}),
    ...(p.origin ? { origin: p.origin } : {}), ...(p.captureRefs ? { captureRefs: p.captureRefs } : {}),
  });
}
```

`packages/api/src/jobs/handlers.ts` (replace the stub):

```ts
// Every job type the worker runs, with its policy (types.ts) and the status row its payload names.
import { JOB_POLICIES, type JobPayloads } from './types.js';
import type { Registry } from './runner.js';
import { testJobDefinitions } from './test-jobs.js';
import { runProofPageCapture } from '../verify/proof-page-capture.js';
import { runVerifyJob } from './handlers/verify.js';

export function jobRegistry(opts: { testJobs?: boolean } = {}): Registry {
  const registry: Registry = {
    'proof-page-capture': {
      policy: JOB_POLICIES['proof-page-capture'],
      subject: (p: JobPayloads['proof-page-capture']) => ({ table: 'captures', id: p.captureId }),
      run: (p: JobPayloads['proof-page-capture']) => runProofPageCapture(p.captureId),
    },
    verify: {
      policy: JOB_POLICIES.verify,
      subject: (p: JobPayloads['verify']) => ({ table: 'source_verifications', id: p.verificationId }),
      run: (p: JobPayloads['verify']) => runVerifyJob(p),
    },
  };
  return opts.testJobs ? { ...registry, ...testJobDefinitions() } : registry;
}
```

- [ ] **Step 5: Run the touched tests, then the verify and router folders**

Run (from `packages/api`): `npx vitest run src/verify/proof-page-capture.test.ts src/verify/in-flight.test.ts src/verify/run-failure.test.ts src/verify/run-source-verification.test.ts src/verify/run-source-verification-holds.test.ts src/verify/run-source-verification-hold-rollback.test.ts src/verify/refresh-values.test.ts src/routers/sources-verify.test.ts src/routers/sources-marks.test.ts src/routers/site-scope.test.ts src/auth/staff-actions.test.ts && npx tsc --noEmit`
Expected: PASS. Fix every test that relied on a fired body by running the queue (`runQueuedJobs()`) or calling the inline body; keep its assertions.

- [ ] **Step 6: Commit**

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-worker
git add packages/api/src/verify/proof-page-capture.ts packages/api/src/verify/proof-page-capture.test.ts packages/api/src/verify/in-flight.ts packages/api/src/verify/in-flight.test.ts packages/api/src/verify/run-failure.ts packages/api/src/verify/run-failure.test.ts packages/api/src/verify/run-source-verification.ts packages/api/src/verify/run-source-verification.test.ts packages/api/src/verify/refresh-values.ts packages/api/src/verify/refresh-values.test.ts packages/api/src/verify/run-coverage-check.ts packages/api/src/routers/sources.ts packages/api/src/routers/sources-verify.test.ts packages/api/src/jobs/handlers.ts packages/api/src/jobs/handlers/verify.ts
git add -u packages/api/src/verify/limiter.ts packages/api/src/verify/limiter.test.ts
git status --short   # add any other test file this step had to adapt, by path
git commit -m "feat(api): proof-page captures and Verify run as jobs; stall rules ask the job

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Drift, coverage and the scheduled check through the queue (`@robot/api`) — spec §4.3, §4.4, §4.5

**Files:**
- Modify: `packages/api/src/verify/run-drift-check.ts`, `packages/api/src/verify/run-coverage-check.ts`, `packages/api/src/verify/website-checks.ts`, `packages/api/src/verify/run-source-verification.ts` (`startVerifyCheck`), `packages/api/src/jobs/handlers.ts`
- Test: `packages/api/src/verify/run-drift-check.test.ts`, `packages/api/src/verify/run-coverage-check.test.ts`, `packages/api/src/verify/website-checks.test.ts`, `packages/api/src/routers/sources-drift.test.ts`, `packages/api/src/routers/sources-coverage.test.ts`

**Interfaces:**
- Consumes: Task 5's names.
- Produces:
  - `startDriftCheck(sourceId, runId, opts?: { capture?: CaptureProofPagesFn; storedRefs?: Record<string, StoredCaptureRef>; fire?: boolean; emptyShare?; trigger?; keys? })` — fired: enqueues `drift-check` `{ checkId, storedRefs? }` (key `drift:<id>`) with the row; `capture` with `fire !== false` throws (a function cannot cross to the worker).
  - `startCoverageCheck(sourceId, verificationId, opts?)` — fired: enqueues `coverage-check` `{ checkId }` (key `coverage:<id>`).
  - `checkWebsite(sourceId, deps?: { capture?; coverage?; onPhase?: () => void })`.
  - `enqueueDueWebsiteChecks(opts?: { limit?: number; only?: string[] }): Promise<string[]>`.
  - `jobRegistry()` gains `drift-check`, `coverage-check`, `website-check`.

- [ ] **Step 1: Failing tests.** In `packages/api/src/verify/run-drift-check.test.ts` add (reuse its site fixture helper, `test-helpers/drift-site.ts`):

```ts
describe('drift checks through the queue (spec 2026-10-23)', () => {
  it('a fired start enqueues the check with its stored refs; the row names the job', async () => {
    const site = await driftSite();          // this file's existing fixture
    try {
      const refs = { [site.urls[0]!]: { captureId: '', capturedAt: new Date().toISOString(), blockedReason: 'x' } };
      const { checkId } = await startDriftCheck(site.sourceId, null, { trigger: 'verify', keys: ['price'], storedRefs: refs });
      const [job] = await jobsOf('drift-check');
      expect(job).toMatchObject({ key: `drift:${checkId}`, payload: { checkId, storedRefs: refs } });
      expect((await db.query.driftChecks.findFirst({ where: eq(driftChecks.id, checkId) }))!.jobId).toBe(job!.id);
    } finally { await site.cleanup(); }
  });

  it('a capture function cannot be fired', async () => {
    const site = await driftSite();
    try {
      await expect(startDriftCheck(site.sourceId, null, { capture: async () => ({}) })).rejects.toThrow(/inline/);
    } finally { await site.cleanup(); }
  });

  it('a running check older than the window whose job is live is in progress, not stalled', async () => {
    const site = await driftSite();
    try {
      const { id: jobId } = await enqueueJob(db, { type: 'drift-check', payload: {} });
      const [row] = await db.insert(driftChecks).values({ sourceId: site.sourceId, status: 'running', jobId, createdAt: new Date(Date.now() - DRIFT_CHECK_STALL_MS - 60_000) }).returning();
      expect(await startDriftCheck(site.sourceId, null, { fire: false })).toEqual({ checkId: row!.id, status: 'in-progress' });
      expect((await latestDriftCheck(site.sourceId))!.status).toBe('running');
    } finally { await site.cleanup(); }
  });

  it('a check that is no longer running is not run again', async () => {
    const site = await driftSite();
    try {
      const [row] = await db.insert(driftChecks).values({ sourceId: site.sourceId, status: 'failed', error: 'stalled' }).returning();
      const capture = vi.fn();
      await runDriftCheck(row!.id, { capture });
      expect(capture).not.toHaveBeenCalled();
    } finally { await site.cleanup(); }
  });

  it('a retried check re-verifies the refreshes an earlier attempt applied but never linked', async () => {
    // Use this file's existing "refreshes a by-nature field" setup up to the point applyRefreshes committed;
    // then call runDriftCheck again on the same (still running) check with a capture that reads the refreshed
    // values (so planRefresh plans nothing new) and a startRefreshVerify spy. Expect the spy called with the
    // earlier refresh's key.
  });
});
```

Write the last test concretely by copying the file's existing refresh test (it builds a certified Price field, a capture returning a new price on every page, and passes `applyRefreshes`/`startRefreshVerify` deps): run it once with a `startRefreshVerify` dep that throws before linking (`async () => { throw new Error('crash'); }` — the check then fails; reset it to `running` with `db.update(driftChecks).set({ status: 'running', error: null, completedAt: null })`), then run `runDriftCheck` again with a spy and assert `spy` was called with `(sourceId, ['price'], expect.any(Object), { checkId })`.

In `packages/api/src/verify/run-coverage-check.test.ts` add the analogous three: fired start enqueues `coverage-check` `{ checkId }` keyed and stamped; an old running row with a live job is `in-progress` and `latestCoverageCheck` keeps it `running`; `runCoverageCheck` on a `failed` row calls no `listing`.

In `packages/api/src/verify/website-checks.test.ts` add:

```ts
it('the sweep enqueues one website-check job per due website it claims (only those it is given)', async () => {
  // Use this file's existing due-website fixture (a certified website with next_check_at in the past).
  const ids = await enqueueDueWebsiteChecks({ only: [site.sourceId] });
  expect(ids).toEqual([site.sourceId]);
  const [job] = await jobsOf('website-check');
  expect(job).toMatchObject({ key: `website-check:${site.sourceId}`, payload: { sourceId: site.sourceId } });
  expect(await enqueueDueWebsiteChecks({ only: [site.sourceId] })).toEqual([]);   // claimed: not due again
});

it('rows a website check starts belong to its job', async () => {
  // Inside runInJob({ jobId, … }), run checkWebsite(site.sourceId, { capture: fakeCapture, coverage: fakeCoverageDeps })
  // (this file's existing fakes); the drift and coverage rows it inserted carry job_id = jobId.
});
```

(Write the second one concretely with the file's existing fakes and `runInJob({ jobId: (await enqueueJob(db, { type: 'website-check', payload: {} })).id, type: 'website-check', lane: 'background', attempt: 1, signal: new AbortController().signal, progress: () => {} }, () => checkWebsite(...))`.)

- [ ] **Step 2: Run them to see them fail**

Run: `cd packages/api && npx vitest run src/verify/run-drift-check.test.ts src/verify/run-coverage-check.test.ts src/verify/website-checks.test.ts`
Expected: FAIL.

- [ ] **Step 3: Drift.** In `run-drift-check.ts` (imports: `randomUUID`, `enqueue`, `currentJobId`, `isJobLive`, `isNull`, `valueRefreshes`):

```ts
export async function startDriftCheck(
  sourceId: string,
  runId: string | null,
  opts: { capture?: CaptureProofPagesFn; storedRefs?: Record<string, StoredCaptureRef>; fire?: boolean; emptyShare?: Record<string, number>; trigger?: DriftTrigger; keys?: string[] } = {},
): Promise<{ checkId: string; status: 'started' | 'in-progress' }> {
  const fire = opts.fire ?? true;
  if (fire && opts.capture) throw new Error('A capture function runs inline only (fire: false); a fired check carries storedRefs.');
  const running = await db.query.driftChecks.findFirst({
    where: and(eq(driftChecks.sourceId, sourceId), eq(driftChecks.status, 'running')),
    orderBy: [desc(driftChecks.createdAt)],
    columns: { id: true, createdAt: true, jobId: true },
  });
  if (running) {
    // A check whose job is queued or working is in progress however long it waited (spec 2026-10-23 §4.5).
    if (await isJobLive(db, running.jobId) || Date.now() - running.createdAt.getTime() < DRIFT_CHECK_STALL_MS) return { checkId: running.id, status: 'in-progress' };
    await db.update(driftChecks)
      .set({ status: 'failed', error: 'stalled', completedAt: new Date() })
      .where(and(eq(driftChecks.id, running.id), eq(driftChecks.status, 'running')));
  }
  const upFront = Object.fromEntries(Object.entries(opts.emptyShare ?? {}).map(([key, share]) => [key, { key, emptyShare: share }]));
  const checkId = randomUUID();
  await db.transaction(async (tx) => {
    const jobId = fire
      ? await enqueue(tx, 'drift-check', { checkId, ...(opts.storedRefs ? { storedRefs: opts.storedRefs } : {}) }, { key: `drift:${checkId}` })
      : currentJobId();
    await tx.insert(driftChecks).values({ id: checkId, sourceId, runId, status: 'running', trigger: opts.trigger ?? 'run', jobId, results: { runId, fields: upFront, ...(opts.keys ? { keys: opts.keys } : {}) } });
  });
  return { checkId, status: 'started' };
}
```

`latestDriftCheck`: select the row as today; the stall branch becomes `if (row.status === 'running' && !(await isJobLive(db, row.jobId)) && Date.now() - row.createdAt.getTime() >= DRIFT_CHECK_STALL_MS)`.

`runDriftCheck`: after reading `check`, `if (!check || check.status !== 'running') return;`. After `const refreshed = await refreshByNature(…)`:

```ts
    // A retry after a crash between a refresh and its re-verify (spec 2026-10-23 §4.4): the earlier attempt's
    // refreshes of this check that no re-verify names are re-verified now, with the ones just applied.
    const unlinked = await db.select({ key: valueRefreshes.fieldKey }).from(valueRefreshes)
      .where(and(eq(valueRefreshes.driftCheckId, checkId), isNull(valueRefreshes.verificationId)));
    const toReverify = [...new Set([...refreshed, ...unlinked.map((r) => r.key)])];
```

and the final `if (refreshed.length > 0) await (deps.startRefreshVerify ?? startRefreshVerify)(check.sourceId, refreshed, refs, { checkId });` uses `toReverify` (the reopen-as-done branch keeps `refreshed.length > 0`).

In `run-source-verification.ts`, `startVerifyCheck` becomes `return startDriftCheck(sourceId, null, { trigger: 'verify', keys, storedRefs: refs });` and its dynamic import no longer needs `storedCaptures`.

- [ ] **Step 4: Coverage.** In `run-coverage-check.ts`, `startCoverageCheck`: select `jobId` on the running row; `stalled = !(await isJobLive(db, running.jobId)) && Date.now() - running.createdAt.getTime() >= COVERAGE_CHECK_STALL_MS`; insert with a pre-made id in a transaction:

```ts
  const checkId = randomUUID();
  const { fire, ...deps } = opts;
  if (fire ?? true) {
    if (Object.keys(deps).length > 0) throw new Error('Coverage deps run inline only (fire: false).');
    await db.transaction(async (tx) => {
      const jobId = await enqueue(tx, 'coverage-check', { checkId }, { key: `coverage:${checkId}` });
      await tx.insert(coverageChecks).values({ id: checkId, sourceId, verificationId, status: 'running', jobId });
    });
  } else {
    await db.insert(coverageChecks).values({ id: checkId, sourceId, verificationId, status: 'running', jobId: currentJobId() });
  }
  return { checkId, status: 'started' };
```

`runCoverageCheck`: `if (!check || check.status !== 'running') return;`. `latestCoverageCheck`: the stall branch adds `&& !(await isJobLive(db, row.jobId))`.

- [ ] **Step 5: The scheduled check.** In `website-checks.ts`: `checkWebsite(sourceId, deps: { capture?; coverage?; onPhase?: () => void } = {})` calls `deps.onPhase?.()` after `runDriftCheck` returns. Add

```ts
/**
 * The worker's sweep (spec 2026-10-23 §4.3): claims at most `limit` due websites and enqueues one
 * `website-check` job each — the job runs `checkWebsite`. `only` as in `claimDueWebsite` (tests pass it).
 */
export async function enqueueDueWebsiteChecks(opts: { limit?: number; only?: string[] } = {}): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < (opts.limit ?? SWEEP_LIMIT); i++) {
    const id = await claimDueWebsite(opts.only ? { only: opts.only } : {});
    if (!id) break;
    await enqueue(db, 'website-check', { sourceId: id }, { key: `website-check:${id}` });
    out.push(id);
  }
  return out;
}
```

and update the file header: "the worker's timer … enqueues a `website-check` job per due website; the api-server has no timer".

- [ ] **Step 6: The registry** — add to `jobRegistry()` in `jobs/handlers.ts` (imports: `runDriftCheck`, `storedCaptures` from `../verify/run-drift-check.js`; `runCoverageCheck` from `../verify/run-coverage-check.js`; `checkWebsite` from `../verify/website-checks.js`):

```ts
    'drift-check': {
      policy: JOB_POLICIES['drift-check'],
      subject: (p: JobPayloads['drift-check']) => ({ table: 'drift_checks', id: p.checkId }),
      run: (p: JobPayloads['drift-check']) => runDriftCheck(p.checkId, p.storedRefs ? { capture: storedCaptures(p.storedRefs) } : {}),
    },
    'coverage-check': {
      policy: JOB_POLICIES['coverage-check'],
      subject: (p: JobPayloads['coverage-check']) => ({ table: 'coverage_checks', id: p.checkId }),
      run: (p: JobPayloads['coverage-check']) => runCoverageCheck(p.checkId),
    },
    'website-check': {
      policy: JOB_POLICIES['website-check'],
      subject: () => null,
      run: (p: JobPayloads['website-check'], ctx) => checkWebsite(p.sourceId, { onPhase: ctx.progress }),
    },
```

- [ ] **Step 7: Run the tests**

Run (from `packages/api`): `npx vitest run src/verify/run-drift-check.test.ts src/verify/run-coverage-check.test.ts src/verify/website-checks.test.ts src/verify/drift-end-to-end.test.ts src/verify/run-source-verification.test.ts src/verify/run-source-verification-holds.test.ts src/routers/sources-drift.test.ts src/routers/sources-coverage.test.ts src/routers/sources-attention.test.ts && npx tsc --noEmit`
Expected: PASS. Tests that relied on `startDriftCheck`/`startCoverageCheck` firing now either pass `fire: false` and call the body, or `runQueuedJobs()`; tests that passed `capture` with the default `fire` pass `fire: false`.

- [ ] **Step 8: Commit**

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-worker
git add packages/api/src/verify/run-drift-check.ts packages/api/src/verify/run-drift-check.test.ts packages/api/src/verify/run-coverage-check.ts packages/api/src/verify/run-coverage-check.test.ts packages/api/src/verify/website-checks.ts packages/api/src/verify/website-checks.test.ts packages/api/src/verify/run-source-verification.ts packages/api/src/jobs/handlers.ts
git status --short   # add any other adapted test file, by path
git commit -m "feat(api): drift, coverage and scheduled website checks run as jobs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Runs through the queue (`@robot/api`) — spec §4.4

**Files:**
- Modify: `packages/api/src/crawl/execute-run.ts` (`aborted`), `packages/api/src/crawl/start-execution.ts` (`hooks`), `packages/api/src/routers/crawl.ts` (`execute`, `probeAndSample`'s execution, `backfill`), `packages/api/src/jobs/handlers.ts`
- Create: `packages/api/src/jobs/handlers/run.ts`
- Test: `packages/api/src/crawl/execute-run.test.ts`, `packages/api/src/jobs/handlers/run.test.ts`, `packages/api/src/routers/crawl-execute.test.ts`, `packages/api/src/routers/crawl-probe.test.ts`, `packages/api/src/routers/crawl-backfill.test.ts`

**Interfaces:**
- Produces:
  - `ExecuteDeps.aborted?: () => boolean` — checked between items with `isCancelled`; when true the loop stops and `finalise` is not called; `ExecuteOutcome.status` is `'aborted'`.
  - `startExecution(runId, sourceId, schema, limit?, opts?: { mergeToParent?: boolean; hooks?: { onItem?: () => void; aborted?: () => boolean } })`.
  - `enqueueRun(db, payload: JobPayloads['run']): Promise<string>` — enqueues `run` (key `run:<runId>`) and stamps `runs.job_id` in one transaction; idempotent while one is active.
  - `runExecuteJob(p: JobPayloads['run'], ctx: JobContext, deps?: { execute?: typeof startExecution; repairSweep?: typeof runRepairSweep }): Promise<void>`.

- [ ] **Step 1: Failing tests.** `packages/api/src/crawl/execute-run.test.ts` (append; reuse its fake deps builder):

```ts
it('an aborted loop stops between items and does not finalise (its retry resumes the run)', async () => {
  let n = 0;
  const finalise = vi.fn(async () => 'extracting');
  const out = await executeRun('run-1', {
    ...baseDeps(),                                // this file's stub deps builder
    claim: async () => ({ id: `item-${++n}`, url: 'https://x.test/', inputIndex: 0, inputValues: {}, listingValues: {}, pageNumber: null, attempts: 1, targetFields: null }),
    aborted: () => n >= 2,
    finalise,
  });
  expect(n).toBe(2);
  expect(finalise).not.toHaveBeenCalled();
  expect(out.status).toBe('aborted');
});
```

`packages/api/src/jobs/handlers/run.test.ts`:

```ts
import { describe, it, expect, vi, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, runs, runItems } from '@robot/db';
import { createTestSource, deleteTestSource } from '../../test-helpers/source.js';
import { enqueueRun, runExecuteJob } from './run.js';
import { jobsOf } from '../../test-helpers/jobs.js';
import type { JobContext } from '../context.js';

const sources: string[] = [];
afterAll(async () => { for (const s of sources) await deleteTestSource(s); });
const ctx = (attempt: number): JobContext => ({ jobId: 'j', type: 'run', lane: 'runs', attempt, signal: new AbortController().signal, progress: () => {} });

async function runWithItems() {
  const sourceId = await createTestSource({ schema: [] });
  sources.push(sourceId);
  const [run] = await db.insert(runs).values({ sourceId, status: 'extracting' }).returning();
  const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);
  await db.insert(runItems).values([
    { runId: run!.id, kind: 'detail', url: 'https://x.test/1', inputIndex: 0, status: 'running', startedAt: minutesAgo(1) },
    { runId: run!.id, kind: 'detail', url: 'https://x.test/2', inputIndex: 1, status: 'running', startedAt: minutesAgo(45) },
  ]);
  return run!.id;
}
const statuses = async (runId: string) => (await db.query.runItems.findMany({ where: eq(runItems.runId, runId) })).map((i) => `${i.url}:${i.status}`).sort();

describe('runs through the queue (spec 2026-10-23 §4.4)', () => {
  it('one run job per run: a second enqueue adds none; the run names its job', async () => {
    const runId = await runWithItems();
    const a = await enqueueRun(db, { runId });
    const b = await enqueueRun(db, { runId, limit: 3 });
    expect(b).toBe(a);
    expect((await jobsOf('run')).filter((j) => (j.payload as { runId: string }).runId === runId)).toHaveLength(1);
    expect((await db.query.runs.findFirst({ where: eq(runs.id, runId) }))!.jobId).toBe(a);
  });

  it('a retry requeues every running item; a first attempt only stale ones', async () => {
    const execute = vi.fn(async () => {});
    const first = await runWithItems();
    await runExecuteJob({ runId: first }, ctx(1), { execute });
    expect(await statuses(first)).toEqual(['https://x.test/1:running', 'https://x.test/2:pending']);
    const retry = await runWithItems();
    await runExecuteJob({ runId: retry }, ctx(2), { execute });
    expect(await statuses(retry)).toEqual(['https://x.test/1:pending', 'https://x.test/2:pending']);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('a run no longer extracting is not run', async () => {
    const runId = await runWithItems();
    await db.update(runs).set({ status: 'completed' }).where(eq(runs.id, runId));
    const execute = vi.fn(async () => {});
    await runExecuteJob({ runId }, ctx(1), { execute });
    expect(execute).not.toHaveBeenCalled();
  });

  it('passes the limit, the merge rule, progress and the abort to the execution; a repair sweep goes through the sweep', async () => {
    const runId = await runWithItems();
    const execute = vi.fn(async () => {});
    await runExecuteJob({ runId, limit: 3 }, ctx(1), { execute });
    expect(execute).toHaveBeenCalledWith(runId, expect.any(String), expect.any(Array), 3, expect.objectContaining({ hooks: expect.objectContaining({ onItem: expect.any(Function), aborted: expect.any(Function) }) }));
    const repairSweep = vi.fn(async () => {});
    await runExecuteJob({ runId, repairSweep: { deadFields: ['price'] } }, ctx(1), { execute, repairSweep });
    expect(repairSweep).toHaveBeenCalledWith(db, runId, ['price'], expect.any(Function));
  });
});
```

Router tests: in `crawl-execute.test.ts`, the existing tests `vi.mock('../crawl/start-execution.js')` and assert `startExecution` was called; change those to assert the run job: `const [job] = await jobsOf('run'); expect(job!.payload).toEqual({ runId, ...(limit ? { limit } : {}) });` and add "a second execute adds no job" (two `caller.crawl.execute({ runId })` → one `run` job; both answers `started: true`). In `crawl-probe.test.ts` the execution after a probe → a `run` job with `{ runId, limit: PROBE_SAMPLE_LIMIT }` (planning stays as it is until Task 8). In `crawl-backfill.test.ts` → a `run` job `{ runId: backfillRunId }`, or `{ runId: backfillRunId, repairSweep: { deadFields } }` with `deadFieldStrategy: 'repair_sweep'`.

- [ ] **Step 2: Run them to see them fail**

Run: `cd packages/api && npx vitest run src/crawl/execute-run.test.ts src/jobs/handlers/run.test.ts`
Expected: FAIL.

- [ ] **Step 3: The loop.** In `execute-run.ts`: add to `ExecuteDeps`

```ts
  /** The worker stopped this attempt (stuck or shutting down): stop between items, without finalising — the retry resumes the run (spec 2026-10-23 §4.4). */
  aborted?: () => boolean;
```

In `executeRun`: `let abortedStop = false;` and, right before the `isCancelled` check, `if (deps.aborted?.()) { abortedStop = true; break; }`; in `finally`: `status = abortedStop ? 'aborted' : await deps.finalise(extracted, cancelled, limitReached);`.

In `start-execution.ts`: `opts?: { mergeToParent?: boolean; hooks?: { onItem?: () => void; aborted?: () => boolean } }`; in the `executeRun` deps:

```ts
        onDone: async (...args) => { await buildOnDone(db, opts?.mergeToParent, { variantPlan })(...args); opts?.hooks?.onItem?.(); },
        onFailed: async (itemId, message) => { await markItemFailed(db, itemId, message); opts?.hooks?.onItem?.(); },
        ...(opts?.hooks?.aborted ? { aborted: opts.hooks.aborted } : {}),
```

(build `buildOnDone(…)` once outside the object and call it). Update the header comment's "honest limit of having no job queue" paragraph: runs are now `run` jobs; a crash resumes by itself.

- [ ] **Step 4: The handler** — `packages/api/src/jobs/handlers/run.ts`:

```ts
// The `run` job (spec 2026-10-23 §4.4): one executor per run (key run:<runId>). A retry knows its earlier
// attempt was the only one, so every `running` item goes back to pending; a first attempt reclaims only
// stale ones (an operator CLI may be working the run). Then today's execution, reporting progress per
// item and stopping between items when the worker stops it.
import { eq } from 'drizzle-orm';
import { db, runs } from '@robot/db';
import type { Database } from '@robot/db';
import { requeueStaleRunningItems, STALE_RUNNING_MS } from '../../crawl/requeue-stale.js';
import { startExecution } from '../../crawl/start-execution.js';
import { runRepairSweep } from '../../crawl/repair-sweep.js';
import { effectiveSchema } from '../../crawl/effective-schema.js';
import { enqueue } from '../enqueue.js';
import type { JobContext } from '../context.js';
import type { JobPayloads } from '../types.js';

const ACTIVE = ['extracting', 'cancelling'];

export async function enqueueRun(dbh: Database, payload: JobPayloads['run']): Promise<string> {
  return dbh.transaction(async (tx) => {
    const jobId = await enqueue(tx, 'run', payload, { key: `run:${payload.runId}` });
    await tx.update(runs).set({ jobId }).where(eq(runs.id, payload.runId));
    return jobId;
  });
}

export async function runExecuteJob(
  p: JobPayloads['run'],
  ctx: JobContext,
  deps: { execute?: typeof startExecution; repairSweep?: typeof runRepairSweep } = {},
): Promise<void> {
  const run = await db.query.runs.findFirst({
    where: eq(runs.id, p.runId),
    with: { source: { columns: { id: true, selectorsJson: true, schemaDefinition: true }, with: { dataset: { columns: { schema: true } } } } },
  });
  if (!run?.source || !ACTIVE.includes(run.status)) return;
  await requeueStaleRunningItems(db, p.runId, ctx.attempt > 1 ? 0 : STALE_RUNNING_MS);
  const execute = deps.execute ?? startExecution;
  const sourceId = run.source.id;
  const schema = effectiveSchema(run.source);
  const hooks = { onItem: ctx.progress, aborted: () => ctx.signal.aborted };
  const merge = run.parentRunId ? { mergeToParent: true } : {};
  const go = (o?: { limit?: number }) => execute(p.runId, sourceId, schema, o?.limit, { ...merge, hooks });
  if (p.repairSweep) await (deps.repairSweep ?? runRepairSweep)(db, p.runId, p.repairSweep.deadFields, go);
  else await go(p.limit !== undefined ? { limit: p.limit } : undefined);
}
```

(If `requeueStaleRunningItems`' `lt(startedAt, cutoff)` with a 0 ms window misses an item stamped this same millisecond, it is still reclaimed by the next attempt; acceptable.)

Registry entry (`jobs/handlers.ts`, import `runExecuteJob`):

```ts
    run: {
      policy: JOB_POLICIES.run,
      subject: (p: JobPayloads['run']) => ({ table: 'runs', id: p.runId }),
      run: (p: JobPayloads['run'], ctx) => runExecuteJob(p, ctx),
    },
```

- [ ] **Step 5: The routers.** In `routers/crawl.ts` (import `enqueueRun` from `../jobs/handlers/run.js`):
  - `execute`: replace the `void startExecution(…).catch(…)` block (and its comments about "deliberately not awaited") with `await enqueueRun(ctx.db, { runId: input.runId, ...(input.limit !== undefined ? { limit: input.limit } : {}) });` and a two-line comment: the worker runs it (`run` job, one per run); a crash resumes by itself.
  - `probeAndSample`: replace `void startExecution(outcome.runId, …, PROBE_SAMPLE_LIMIT).catch(…)` with `await enqueueRun(ctx.db, { runId: outcome.runId, limit: PROBE_SAMPLE_LIMIT });` (keep `markRunExtracting` before it; `execSource` is now only an existence check — keep the lookup, drop the unused columns if the type-check complains).
  - `backfill`: replace the `execute` closure and both `void …` calls with `await enqueueRun(ctx.db, { runId: backfillRunId, ...(isRepairSweep ? { repairSweep: { deadFields } } : {}) });`.
  - Remove the `startExecution` / `runRepairSweep` imports if now unused.

- [ ] **Step 6: Run the tests**

Run (from `packages/api`): `npx vitest run src/crawl/execute-run.test.ts src/crawl/start-execution.test.ts src/jobs/handlers/run.test.ts src/routers/crawl-execute.test.ts src/routers/crawl-probe.test.ts src/routers/crawl-backfill.test.ts src/routers/crawl.test.ts src/routers/site-scope.test.ts src/auth/staff-actions.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-worker
git add packages/api/src/crawl/execute-run.ts packages/api/src/crawl/execute-run.test.ts packages/api/src/crawl/start-execution.ts packages/api/src/jobs/handlers/run.ts packages/api/src/jobs/handlers/run.test.ts packages/api/src/jobs/handlers.ts packages/api/src/routers/crawl.ts packages/api/src/routers/crawl-execute.test.ts packages/api/src/routers/crawl-probe.test.ts packages/api/src/routers/crawl-backfill.test.ts
git status --short   # add any other adapted test file, by path
git commit -m "feat(api): runs are jobs — one executor per run, resumed after a crash

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Awaited procedures and planning through the queue (`@robot/api`) — spec §4.4

**Files:**
- Create: `packages/api/src/jobs/handlers/interactive.ts`, `packages/api/src/crawl/plan-via-worker.ts`
- Modify: `packages/api/src/routers/sources.ts` (`checkListingPage`, `reachability`, `transferMarks`, `detectVariants`, `variantLinksNear`, `confirm`), `packages/api/src/routers/crawl.ts` (`plan`, `probeAndSample`), `packages/api/src/crawl/plan-source.ts` (`opts.runId`, `planningRunValues`), `packages/api/src/jobs/handlers.ts`
- Test: `packages/api/src/jobs/handlers/interactive.test.ts`, `packages/api/src/crawl/plan-via-worker.test.ts`, and the router tests listed in Step 6

**Interfaces:**
- Produces:
  - `reachabilityNow(url: string): Promise<Reachability>`; `listingCheckNow(listingUrl: string): Promise<ListingPageCheck>`; `transferMarksNow(p: TransferMarksPayload)`; `detectVariantsNow(sourceId: string)`; `variantLinksNearNow(p: { sourceId: string; url: string; xpath: string })` — the procedures' bodies, moved verbatim (after the org check).
  - `planSource(db, sourceId, opts?: { probe?: boolean; runId?: string })` — with `runId`, uses that row instead of inserting one.
  - `planningRunValues(source, probe): { sourceId; status: 'planning'; startedAt; inputLabel }`; `assertPlannable(db, sourceId)` (NOT_FOUND / PRECONDITION_FAILED exactly as `planSource` throws them today), both in `plan-source.ts`.
  - `planViaWorker(db, sourceId, opts: { probe: boolean }): Promise<PlanSourceResult>`.
  - `jobRegistry()` gains the six interactive types.

- [ ] **Step 1: Move the bodies.** `packages/api/src/jobs/handlers/interactive.ts` — cut, unchanged, from `routers/sources.ts`:
  - `checkListingPage`'s body (from `const hostname = …` to the end of its `catch`) into `export async function listingCheckNow(listingUrl: string): Promise<ListingPageCheck>` (replace `input.listingUrl` by `listingUrl`);
  - `reachability`'s body into `export async function reachabilityNow(url: string): Promise<Reachability>`;
  - `transferMarks`' body after `await sourceInOrg(ctx, input.sourceId);` into `export async function transferMarksNow(input: TransferMarksPayload)` (replace `ctx.db` by `db` from `@robot/db`);
  - `detectVariants`' body after its `sourceInOrg` into `export async function detectVariantsNow(sourceId: string)`;
  - `variantLinksNear`'s body after its `sourceInOrg` into `export async function variantLinksNearNow(input: { sourceId: string; url: string; xpath: string })`.
  Move with them every import only they use (`readListingPage`, `describeListingPage`, `unreadListingPage`, `reachabilityResult`, `buildXPathProbeScript`, `buildDomSearchScript`, `transferMarks`, `detectVariantLists`, `buildVariantLinksScript`, `buildVariantPickerScript`, `buildLinksNearScript`, `withBrowserSession`, …); keep in `sources.ts` what other procedures still use. Keep their doc comments on the new functions, with one added line: "Runs in the worker (job `<type>`, spec 2026-10-23 §4.4)."

- [ ] **Step 2: Failing tests.** `packages/api/src/jobs/handlers/interactive.test.ts` — the procedures' existing behaviour tests move here, aimed at the functions (copy from `sources-extract.test.ts` / `sources-schema.test.ts` / `sources-marks.test.ts` / `sources-variants.test.ts` / `sources-variant-answers.test.ts` the cases that mock `../browser-session.js` and assert the listing/reachability/transfer/variants answers; change `caller.sources.X(input)` to `XNow(…)` and the mock path to `../../browser-session.js`). Then, in each of those router test files, keep one case per procedure that goes end to end through the queue:

```ts
it('checkListingPage answers through the worker', async () => {
  const answer = await withJobRunner(() => caller.sources.checkListingPage({ listingUrl: 'https://shop.test/list' }));
  expect(answer).toMatchObject({ /* the same expectation this file had for this fake listing */ });
  expect((await jobsOf('listing-check'))[0]).toMatchObject({ status: 'done', payload: { listingUrl: 'https://shop.test/list' } });
});

it('with no worker, the listing check says the browser could not open (JobUnavailableError)', async () => {
  process.env.JOB_AWAIT_MAX_MS = '300';
  try {
    const answer = await caller.sources.checkListingPage({ listingUrl: 'https://shop.test/none' });
    expect(answer).toMatchObject({ message: BROWSER_UNAVAILABLE });
  } finally { delete process.env.JOB_AWAIT_MAX_MS; }
});

it('transferMarks keeps its precondition error across the worker', async () => {
  // A website with no fresh capture of page 1: PRECONDITION_FAILED "Mark page 1 first: it has no fresh capture".
  await expect(withJobRunner(() => caller.sources.transferMarks({ sourceId: f.sourceId, fromUrl: u1, toUrls: [u2] })))
    .rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
});
```

(the same "answers through the worker" case for `reachability`, `detectVariants`, `variantLinksNear`, `transferMarks`; the "no worker" case for `reachability` too, expecting `message: BROWSER_UNAVAILABLE`; and for `detectVariants` expecting a `TRPCError` `INTERNAL_SERVER_ERROR` with message `BROWSER_UNAVAILABLE`).

`packages/api/src/crawl/plan-via-worker.test.ts`:

```ts
import { describe, it, expect, vi, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, runs } from '@robot/db';
import { withJobRunner, jobsOf } from '../test-helpers/jobs.js';
import { createProjectWithSource } from '../test-helpers/customer-source.js';
import { signedInCaller } from '../test-helpers/identity.js';
import { PLAN_STOPPED } from '../jobs/types.js';
import type { Registry } from '../jobs/runner.js';
import { JOB_POLICIES } from '../jobs/types.js';

vi.mock('./plan-source.js', async (orig) => {
  const real = await orig<typeof import('./plan-source.js')>();
  return { ...real, planSource: vi.fn(async (_db: unknown, _s: string, o: { runId?: string }) => ({ runId: o.runId!, status: 'planned', itemCount: 2, listingPages: 1, warnings: [], errors: [], inputs: [], cacheWarm: false })) };
});
const { planViaWorker } = await import('./plan-via-worker.js');

const me = await signedInCaller('plan-via-worker');
afterAll(async () => { await me.cleanup(); });

describe('planViaWorker (spec 2026-10-23 §4.4)', () => {
  it('inserts the planning run stamped with its plan job, and answers the plan', async () => {
    const f = await createProjectWithSource(me.caller, { tag: 'pvw', fields: [{ name: 'Title', type: 'text' }], listingUrl: 'https://shop.test/list' });
    try {
      const out = await withJobRunner(() => planViaWorker(db, f.sourceId, { probe: true }));
      const [job] = await jobsOf('plan');
      expect(job).toMatchObject({ status: 'done', key: `plan:${out.runId}`, payload: { sourceId: f.sourceId, runId: out.runId, probe: true } });
      expect(await db.query.runs.findFirst({ where: eq(runs.id, out.runId) })).toMatchObject({ jobId: job!.id, inputLabel: 'probe' });
    } finally { await f.cleanup(); }
  });

  it('a plan job that dies closes its run with the sentence', async () => {
    const f = await createProjectWithSource(me.caller, { tag: 'pvw-dies', fields: [{ name: 'Title', type: 'text' }], listingUrl: 'https://shop.test/list' });
    try {
      const dying: Registry = { plan: { policy: JOB_POLICIES.plan, run: async () => { throw new Error('worker died'); } } };
      await expect(withJobRunner(() => planViaWorker(db, f.sourceId, { probe: false }), { registry: dying })).rejects.toThrow();
      const [run] = await db.query.runs.findMany({ where: eq(runs.sourceId, f.sourceId) });
      expect(run).toMatchObject({ status: 'failed', errorMessage: PLAN_STOPPED });
    } finally { await f.cleanup(); }
  });
});
```

(Use `createProjectWithSource`'s actual option for a listing URL / input set — read `test-helpers/customer-source.ts`; the website must have an input set for `assertPlannable`.)

- [ ] **Step 3: Run them to see them fail**

Run: `cd packages/api && npx vitest run src/jobs/handlers/interactive.test.ts src/crawl/plan-via-worker.test.ts`
Expected: FAIL.

- [ ] **Step 4: Planning.** In `crawl/plan-source.ts`:

```ts
/** The source as planning reads it, or the precondition error it has always thrown. */
export async function assertPlannable(db: typeof Database, sourceId: string) {
  const source = await db.query.sources.findFirst({
    where: eq(sources.id, sourceId),
    with: { dataset: { columns: { schema: true } }, inputSet: { columns: { columns: true, rows: true } } },
  });
  if (!source) throw new TRPCError({ code: 'NOT_FOUND', message: `Source ${sourceId} not found` });
  if (!source.inputSet) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: `Source ${sourceId} has no InputSet to plan from` });
  return source;
}

/** The `planning` run row a plan fills in (a probe's label is 'probe'). */
export function planningRunValues(source: { id: string; urlTemplate: string | null; name: string }, probe: boolean) {
  return { sourceId: source.id, status: 'planning' as const, startedAt: new Date(), inputLabel: probe ? 'probe' : (source.urlTemplate ?? source.name).slice(0, 200) };
}
```

`planSource` uses `assertPlannable` for its first lines, takes `opts: { probe?: boolean; runId?: string }`, and: `const [run] = opts.runId ? [{ id: opts.runId }] : await db.insert(runs).values(planningRunValues(source, probe)).returning({ id: runs.id });`.

`crawl/plan-via-worker.ts`:

```ts
// Planning walks the listing in a browser, so it runs in the worker (job `plan`, spec 2026-10-23 §4.4).
// The run row is written here with the job, in one transaction; the request waits for the plan.
import { randomUUID } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { runs } from '@robot/db';
import type { db as Database } from '@robot/db';
import { assertPlannable, planningRunValues, type PlanSourceResult } from './plan-source.js';
import { enqueue, ceilingOf } from '../jobs/enqueue.js';
import { awaitJob } from '../jobs/queue.js';
import { JobUnavailableError } from '../jobs/errors.js';
import { PLAN_STOPPED } from '../jobs/types.js';

export async function planViaWorker(db: typeof Database, sourceId: string, opts: { probe: boolean }): Promise<PlanSourceResult> {
  const source = await assertPlannable(db, sourceId);
  const runId = randomUUID();
  const jobId = await db.transaction(async (tx) => {
    const id = await enqueue(tx, 'plan', { sourceId, runId, probe: opts.probe }, { key: `plan:${runId}` });
    await tx.insert(runs).values({ id: runId, ...planningRunValues(source, opts.probe), jobId: id });
    return id;
  });
  try {
    return (await awaitJob(jobId, ceilingOf('plan'))) as PlanSourceResult;
  } catch (err) {
    if (err instanceof TRPCError) throw err;
    if (!(err instanceof JobUnavailableError)) console.error(`[crawl] plan ${runId} failed in the worker:`, err);
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: PLAN_STOPPED });
  }
}
```

Routers: `crawl.plan` → `return planViaWorker(ctx.db, input.sourceId, { probe: input.probe === true });`; `crawl.probeAndSample` → `const outcome = await planViaWorker(ctx.db, input.sourceId, { probe: true });`; `sources.confirm` → `const result = await planViaWorker(ctx.db, source.id, { probe: false });`.

- [ ] **Step 5: The other procedures and the registry.** In `routers/sources.ts` (imports: `runAndWait` from `../jobs/enqueue.js`, `JobUnavailableError` from `../jobs/errors.js`, the `*Now` types as needed):

```ts
  checkListingPage: protectedProcedure
    .input(z.object({ listingUrl: httpUrl }))
    .mutation(async ({ input }): Promise<ListingPageCheck> => {
      try {
        return (await runAndWait('listing-check', { listingUrl: input.listingUrl }, { key: `listing:${input.listingUrl}` })) as ListingPageCheck;
      } catch (err) {
        // No answer from the worker reads as a browser that could not start — the answer a crash gave before.
        if (err instanceof JobUnavailableError) return { ...unreadListingPage({ kind: 'crashed' }, input.listingUrl), message: BROWSER_UNAVAILABLE };
        throw err;
      }
    }),
```

`reachability` likewise with `runAndWait('reachability', { url: input.url }, { key: \`reachability:${input.url}\` })` and, on `JobUnavailableError`, `return { ...reachabilityResult(input.url, { kind: 'crashed' }, null, 0), message: BROWSER_UNAVAILABLE };`.
`transferMarks`, `detectVariants`, `variantLinksNear`: keep `await sourceInOrg(ctx, input.sourceId);`, then `return (await unavailableAsError(runAndWait('transfer-marks', input))) as Awaited<ReturnType<typeof transferMarksNow>>` (keys: none, `detect-variants:<sourceId>`, none), with in the file:

```ts
/** An awaited job with no answer is a browser that could not start (the copy a crash showed before). */
async function unavailableAsError<T>(p: Promise<T>): Promise<T> {
  try { return await p; } catch (err) {
    if (err instanceof JobUnavailableError) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: BROWSER_UNAVAILABLE });
    throw err;
  }
}
```

Registry (`jobs/handlers.ts`; import the `*Now` functions and `planSource` + `db`):

```ts
    reachability: { policy: JOB_POLICIES.reachability, run: (p: JobPayloads['reachability']) => reachabilityNow(p.url) },
    'listing-check': { policy: JOB_POLICIES['listing-check'], run: (p: JobPayloads['listing-check']) => listingCheckNow(p.listingUrl) },
    'transfer-marks': { policy: JOB_POLICIES['transfer-marks'], run: (p: JobPayloads['transfer-marks']) => transferMarksNow(p) },
    'detect-variants': { policy: JOB_POLICIES['detect-variants'], run: (p: JobPayloads['detect-variants']) => detectVariantsNow(p.sourceId) },
    'variant-links-near': { policy: JOB_POLICIES['variant-links-near'], run: (p: JobPayloads['variant-links-near']) => variantLinksNearNow(p) },
    plan: {
      policy: JOB_POLICIES.plan,
      subject: (p: JobPayloads['plan']) => ({ table: 'runs', id: p.runId }),
      run: (p: JobPayloads['plan']) => planSource(db, p.sourceId, { probe: p.probe, runId: p.runId }),
    },
```

`TransferMarksPayload` in `types.ts` must match the router's zod input type: make `transferMarksNow(input: TransferMarksPayload)` and, if the type-checker finds `mark`/`via` narrower in `transferMarks`, type the payload fields with the scraper's `Mark`/`ConfirmedPath` types instead of `unknown`.

- [ ] **Step 6: Run the tests**

Run (from `packages/api`): `npx vitest run src/jobs/handlers/interactive.test.ts src/crawl/plan-via-worker.test.ts src/crawl/plan-source.test.ts src/routers/sources-extract.test.ts src/routers/sources-schema.test.ts src/routers/sources-marks.test.ts src/routers/sources-variants.test.ts src/routers/sources-variant-answers.test.ts src/routers/crawl.test.ts src/routers/crawl-probe.test.ts src/routers/sources.test.ts src/routers/site-scope.test.ts src/auth/staff-actions.test.ts && npx tsc --noEmit`
Expected: PASS. Router tests that called these procedures now wrap the call in `withJobRunner(() => …)`; tests that mocked `planSource` keep their mock (it applies inside the in-process runner).

- [ ] **Step 7: Commit**

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-worker
git add packages/api/src/jobs/handlers/interactive.ts packages/api/src/jobs/handlers/interactive.test.ts packages/api/src/jobs/handlers.ts packages/api/src/crawl/plan-via-worker.ts packages/api/src/crawl/plan-via-worker.test.ts packages/api/src/crawl/plan-source.ts packages/api/src/routers/sources.ts packages/api/src/routers/crawl.ts
git status --short   # add every adapted router test file, by path
git commit -m "feat(api): listing check, reachability, mark transfer, variants and planning answer from the worker

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The api-server starts no browser (`@robot/api`, `@robot/api-server`) — spec §4.4, §7.1–7.2

**Files:**
- Create: `packages/api/src/jobs/index.ts`, `packages/api-server/src/process.ts`, `packages/api-server/vitest.config.ts`, `packages/api-server/src/test-setup/job-queue.ts`
- Modify: `packages/api/package.json` (`exports["./jobs"]`), `packages/api-server/src/index.ts`
- Test: `packages/api-server/src/no-browser.test.ts`

**Interfaces:**
- Produces: `@robot/api/jobs` exporting `startJobRunner`, `type Registry`, `type RunnerOptions`, `type JobRunner`, `jobRegistry`, `createBrowserGate`, `type WorkerBrowserGate`, `setBrowserGate`, `jobQueueName`, `enqueueJob`, `runAndWait`, `openJobCount`, `enqueueDueWebsiteChecks`, `startWebsiteChecks`, `forbidBrowserLaunch` (re-exported from `@robot/browser`), `JOB_POLICIES`, `type Lane`; `configureApiProcess(): void`.

- [ ] **Step 1: The export** — `packages/api/src/jobs/index.ts`:

```ts
// What the worker process (and the api-server's guard) needs from @robot/api (spec 2026-10-23 §4.3).
export { startJobRunner, type Registry, type RunnerOptions, type JobRunner, type JobDefinition } from './runner.js';
export { jobRegistry } from './handlers.js';
export { createBrowserGate, type WorkerBrowserGate } from './browser-gate.js';
export { setBrowserGate } from '../browser-session.js';
export { jobQueueName, enqueueJob, openJobCount, awaitJob } from './queue.js';
export { runAndWait, enqueue } from './enqueue.js';
export { JOB_POLICIES, type Lane, type JobType } from './types.js';
export { enqueueDueWebsiteChecks, startWebsiteChecks } from '../verify/website-checks.js';
export { forbidBrowserLaunch } from '@robot/browser';
```

and in `packages/api/package.json` `exports`: `"./jobs": "./src/jobs/index.ts",`.

- [ ] **Step 2: The failing test** — `packages/api-server/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { env: { JEV_SHADOW: '' }, setupFiles: ['./src/test-setup/job-queue.ts'] } });
```

`packages/api-server/src/test-setup/job-queue.ts`: identical to `packages/api/src/test-setup/job-queue.ts`.

`packages/api-server/src/no-browser.test.ts`:

```ts
// Spec 2026-10-23 §7.1–7.2: the api-server process never launches Chromium, and every procedure that
// used to load a page (or run a script in a browser) now goes through a job. A fake worker answers the
// jobs here, so nothing real runs; the launch guard is on, so a launch anywhere would throw.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, jobs, sources } from '@robot/db';
import { signedInCaller } from '@robot/api/test-helpers/identity';
import { createProjectWithSource } from '@robot/api/test-helpers/customer-source';
import { startJobRunner, jobQueueName, JOB_POLICIES, type Registry, type JobRunner } from '@robot/api/jobs';
import { PlaywrightBrowser } from '@robot/browser';
import { configureApiProcess } from './process.js';

configureApiProcess();

const me = await signedInCaller('no-browser');
const seen: string[] = [];
const canned: Record<string, (p: any) => unknown> = {
  reachability: (p) => ({ url: p.url, ok: true, message: null }),
  'listing-check': () => ({ groupSize: 0, sample: [], pager: false, message: null }),
  'transfer-marks': () => ({}),
  'detect-variants': () => ({ pages: [], suggested: 'none' }),
  'variant-links-near': () => null,
  plan: (p) => ({ runId: p.runId, status: 'planned', itemCount: 0, listingPages: 0, warnings: [], errors: [], inputs: [], cacheWarm: false }),
};
const fake: Registry = Object.fromEntries(Object.entries(JOB_POLICIES).map(([type, policy]) => [type, {
  policy, run: async (p: unknown) => { seen.push(type); return canned[type]?.(p) ?? null; },
}]));
let worker: JobRunner;
beforeAll(() => { worker = startJobRunner({ queue: jobQueueName(), registry: fake, lanes: { interactive: 3, background: 2, runs: 1 }, pollMs: 25, log: () => {} }); });
afterAll(async () => { await worker.stop(2000); await me.cleanup(); });

describe('the api-server starts no browser', () => {
  it('Chromium cannot launch in this process', async () => {
    await expect(new PlaywrightBrowser().launch({ headless: true })).rejects.toThrow(/never starts a browser/);
  });

  it('every procedure that loaded a page goes through a job', async () => {
    const f = await createProjectWithSource(me.caller, { tag: 'no-browser', fields: [{ name: 'Title', type: 'text' }], listingUrl: 'https://shop.test/list' });
    try {
      const c = me.caller;
      const url = 'https://shop.test/p/1';
      await c.sources.reachability({ url });
      await c.sources.checkListingPage({ listingUrl: 'https://shop.test/list' });
      await c.sources.captureProofPage({ sourceId: f.sourceId, url });
      await c.sources.transferMarks({ sourceId: f.sourceId, fromUrl: url, toUrls: ['https://shop.test/p/2'] });
      await c.sources.detectVariants({ sourceId: f.sourceId });
      await c.sources.variantLinksNear({ sourceId: f.sourceId, url, xpath: '//a' });
      await c.sources.checkDrift({ sourceId: f.sourceId });
      const planned = await c.crawl.plan({ sourceId: f.sourceId, probe: true });
      await c.crawl.execute({ runId: planned.runId }).catch(() => {});   // a probe plan with no items is refused before any job: fine
      await c.sources.verify({ sourceId: f.sourceId }).catch(() => {});  // refused for a binding with no proof pages: fine — no browser either way
      const types = new Set((await db.query.jobs.findMany({ where: eq(jobs.queue, jobQueueName()) })).map((j) => j.type));
      for (const t of ['reachability', 'listing-check', 'proof-page-capture', 'transfer-marks', 'detect-variants', 'variant-links-near', 'drift-check', 'plan']) {
        expect(types, `no ${t} job`).toContain(t);
      }
    } finally { await f.cleanup(); }
  });
});
```

(Read `createProjectWithSource`'s options first and give the website a listing URL and, if the helper supports it, three proof pages and values, so `sources.verify` is accepted and `verify` joins the expected list; `sources.verify` with a full binding must produce a `verify` job. `crawl.execute` needs a run with detail items: if the fake plan leaves none, seed one `run_items` row on `planned.runId` with `db.insert(runItems)` and expect `run` in the list too.)

- [ ] **Step 3: Run it to see it fail**

Run: `cd packages/api-server && npx vitest run src/no-browser.test.ts`
Expected: FAIL — `./process.js` missing.

- [ ] **Step 4: The guard and the entry** — `packages/api-server/src/process.ts`:

```ts
// Spec 2026-10-23 §4.4: page loads run in @robot/worker; this process must never start Chromium.
import { forbidBrowserLaunch } from '@robot/api/jobs';

export function configureApiProcess(): void {
  forbidBrowserLaunch('The api-server never starts a browser: page loads run in the worker (pnpm dev:all starts it).');
}
```

`packages/api-server/src/index.ts`: after the `.env` load, `const { configureApiProcess } = await import('./process.js'); configureApiProcess();` before `createApp`; delete the website-checks block (the three lines from `// The scheduled website check` to its `console.log`) and log instead `console.log(\`[api-server] jobs go to queue "${(await import('@robot/api/jobs')).jobQueueName()}" — the worker runs them\`);`.

- [ ] **Step 5: Run the api-server tests and type-check**

Run: `cd packages/api-server && npx vitest run && npx tsc --noEmit`, then `cd ../api && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-worker
git add packages/api/src/jobs/index.ts packages/api/package.json packages/api-server/src/process.ts packages/api-server/src/index.ts packages/api-server/src/no-browser.test.ts packages/api-server/vitest.config.ts packages/api-server/src/test-setup/job-queue.ts
git commit -m "feat(api-server): forbid browser launches; no scheduler — jobs go to the worker

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: The worker process (`@robot/worker`) — spec §4.3, §8, §10

**Files:**
- Create: `packages/worker/package.json`, `packages/worker/tsconfig.json`, `packages/worker/vitest.config.ts`, `packages/worker/src/test-setup/job-queue.ts`, `packages/worker/src/config.ts`, `packages/worker/src/worker.ts`, `packages/worker/src/index.ts`, `packages/worker/src/live-check.ts`
- Modify: `pnpm-lock.yaml` (via `pnpm install`), `packages/app/src/staff-smoke.test.ts` and `packages/app/src/routes-smoke.test.ts` (header comments only: the isolated pair needs its worker; the backoff lives in the worker)
- Test: `packages/worker/src/config.test.ts`, `packages/worker/src/crash-recovery.test.ts`, `packages/worker/src/capture-e2e.test.ts`

**Interfaces:**
- Consumes: `@robot/api/jobs`.
- Produces: `type WorkerConfig`; `readWorkerConfig(env): WorkerConfig`; `startWorker(config, deps?: { freeMb?: () => number }): Promise<{ runner: JobRunner; gate: WorkerBrowserGate; stop(): Promise<void> }>`.

- [ ] **Step 1: The package**

`packages/worker/package.json`:

```json
{
  "name": "@robot/worker",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts",
    "test": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@robot/api": "workspace:*",
    "@robot/browser": "workspace:*",
    "@robot/db": "workspace:*",
    "drizzle-orm": "^0.44.0"
  },
  "devDependencies": {
    "@types/node": "^25.3.3",
    "tsx": "^4.0.0",
    "typescript": "^5.7.0",
    "vitest": "^4.1.6"
  }
}
```

`packages/worker/tsconfig.json`: a copy of `packages/api-server/tsconfig.json`. `packages/worker/vitest.config.ts`: as the api-server's (Task 9 Step 2), plus `test.testTimeout: 120_000`. `packages/worker/src/test-setup/job-queue.ts`: identical to the api's.

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-worker && pnpm install` — Expected: the workspace links `@robot/worker`; `pnpm-lock.yaml` gains its importer and nothing else changes versions (check `git diff --stat pnpm-lock.yaml` is small).

- [ ] **Step 2: Failing tests** — `packages/worker/src/config.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readWorkerConfig } from './config.js';

describe('readWorkerConfig', () => {
  it('the spec defaults', () => {
    expect(readWorkerConfig({})).toEqual({
      queue: 'default', name: null, browsers: 3, lanes: { interactive: 3, background: 2, runs: 1 }, minFreeMb: 1024,
      leaseMs: 60_000, pollMs: 500, shutdownMs: 25_000, retryBaseMs: 30_000, websiteChecks: false, testJobs: false, stopFile: null,
    });
  });
  it('reads every knob; nonsense falls back to the default', () => {
    const c = readWorkerConfig({ JOB_QUEUE: 'isolated-4100', WORKER_NAME: 'w1', WORKER_BROWSERS: '1', WORKER_INTERACTIVE: '2', WORKER_CONCURRENCY: '4', WORKER_RUNS: '0',
      WORKER_MIN_FREE_MB: '512', WORKER_LEASE_MS: '2000', WORKER_POLL_MS: 'x', WORKER_SHUTDOWN_MS: '-1', WORKER_RETRY_MS: '100', WEBSITE_CHECKS: 'on', WORKER_TEST_JOBS: '1', WORKER_STOP_FILE: 'C:/tmp/stop' });
    expect(c).toEqual({ queue: 'isolated-4100', name: 'w1', browsers: 1, lanes: { interactive: 2, background: 4, runs: 0 }, minFreeMb: 512,
      leaseMs: 2000, pollMs: 500, shutdownMs: 25_000, retryBaseMs: 100, websiteChecks: true, testJobs: true, stopFile: 'C:/tmp/stop' });
  });
  it('at least one browser', () => { expect(readWorkerConfig({ WORKER_BROWSERS: '0' }).browsers).toBe(3); });
});
```

`packages/worker/src/crash-recovery.test.ts`:

```ts
// Spec 2026-10-23 §10: a real worker process is killed mid-job; a second one finishes it (attempt 2), or —
// with one attempt allowed — fails it 'stalled'. The test jobs sleep; no browser, no page.
import { describe, it, expect, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { db, jobs } from '@robot/db';
import { enqueueJob, jobQueueName } from '@robot/api/jobs';

const pkg = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'worker-crash-'));
const children: ChildProcess[] = [];
const get = async (id: string) => (await db.query.jobs.findFirst({ where: eq(jobs.id, id) }))!;
const until = async (pred: () => Promise<boolean>, ms = 60_000) => {
  const t = Date.now() + ms;
  while (!(await pred())) { if (Date.now() > t) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 100)); }
};

function worker(stopFile: string): ChildProcess {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: pkg, stdio: 'ignore',
    env: { ...process.env, JOB_QUEUE: jobQueueName(), WORKER_TEST_JOBS: '1', WEBSITE_CHECKS: 'off', WORKER_LEASE_MS: '2000',
      WORKER_POLL_MS: '100', WORKER_RETRY_MS: '100', WORKER_MIN_FREE_MB: '0', WORKER_STOP_FILE: stopFile,
      ANTHROPIC_API_KEY: '', JEV_SHADOW: '', TYPESAFE_API_KEY: '' },
  });
  children.push(child);
  return child;
}
const exited = (c: ChildProcess) => new Promise<void>((r) => (c.exitCode !== null ? r() : c.once('exit', () => r())));
const stop = async (c: ChildProcess, stopFile: string) => { writeFileSync(stopFile, ''); await exited(c); };

afterEach(async () => { for (const c of children) if (c.exitCode === null) c.kill('SIGKILL'); children.length = 0; });

describe('crash recovery across processes', () => {
  it('a job whose worker was killed is finished by the next worker, on attempt 2', async () => {
    const { id } = await enqueueJob(db, { type: 'test-sleep', payload: { ms: 600_000, finishOnAttempt: 2 }, maxAttempts: 2 });
    const a = worker(join(dir, 'a.stop'));
    await until(async () => (await get(id)).status === 'running');
    a.kill('SIGKILL');
    await exited(a);
    expect(await get(id)).toMatchObject({ status: 'running', attempts: 1 });
    const b = worker(join(dir, 'b.stop'));
    await until(async () => (await get(id)).status === 'done');
    expect(await get(id)).toMatchObject({ attempts: 2, result: { value: { attempt: 2 } } });
    await stop(b, join(dir, 'b.stop'));
    expect(b.exitCode).toBe(0);
  });

  it('with one attempt allowed, the job is failed stalled', async () => {
    const { id } = await enqueueJob(db, { type: 'test-sleep-once', payload: { ms: 600_000 }, maxAttempts: 1 });
    const a = worker(join(dir, 'c.stop'));
    await until(async () => (await get(id)).status === 'running');
    a.kill('SIGKILL');
    await exited(a);
    const b = worker(join(dir, 'd.stop'));
    await until(async () => (await get(id)).status === 'failed');
    expect(await get(id)).toMatchObject({ error: 'stalled', attempts: 1 });
    await stop(b, join(dir, 'd.stop'));
  });

  it('a graceful stop gives a running job back', async () => {
    const { id } = await enqueueJob(db, { type: 'test-sleep', payload: { ms: 600_000 }, maxAttempts: 2 });
    const a = worker(join(dir, 'e.stop'));
    await until(async () => (await get(id)).status === 'running');
    await stop(a, join(dir, 'e.stop'));
    expect(await get(id)).toMatchObject({ status: 'queued', attempts: 0 });
  });
});
```

(Set `WORKER_SHUTDOWN_MS: '500'` in the child env so the graceful stop does not wait 25 s for a 600-second sleep.)

`packages/worker/src/capture-e2e.test.ts`:

```ts
// Spec 2026-10-23 §10: a real proof-page capture through the queue, in a real Chromium under the worker's
// gate, of a page served on 127.0.0.1 — then no browser left open.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { signedInCaller } from '@robot/api/test-helpers/identity';
import { createProjectWithSource } from '@robot/api/test-helpers/customer-source';
import { readWorkerConfig } from './config.js';
import { startWorker } from './worker.js';

const PAGE = `<!doctype html><html><head><title>Widget</title><script type="application/ld+json">{"@type":"Product","name":"Widget","offers":{"price":"19.99","priceCurrency":"EUR"}}</script></head><body><main><h1>Widget</h1><p>${'A fine widget. '.repeat(80)}</p><span class="price">19,99 €</span></main></body></html>`;
let server: Server;
let base = '';
const dir = mkdtempSync(join(tmpdir(), 'worker-e2e-'));
beforeAll(async () => {
  process.env.CAPTURES_DIR = dir;
  server = createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(PAGE); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => { server.close(); rmSync(dir, { recursive: true, force: true }); });

describe('a capture end to end through the worker', () => {
  it('captures the page and leaves no browser open after stop', async () => {
    const me = await signedInCaller('worker-e2e');
    const f = await createProjectWithSource(me.caller, { tag: 'worker-e2e', fields: [{ name: 'Title', type: 'text' }] });
    const worker = await startWorker({ ...readWorkerConfig({ JOB_QUEUE: process.env.JOB_QUEUE }), browsers: 1, minFreeMb: 0, pollMs: 50, websiteChecks: false });
    try {
      const { captureId } = await me.caller.sources.captureProofPage({ sourceId: f.sourceId, url: `${base}/p/1` });
      let state = await me.caller.sources.proofPageCapture({ captureId });
      const t = Date.now() + 90_000;
      while (state.status === 'capturing' && Date.now() < t) { await new Promise((r) => setTimeout(r, 250)); state = await me.caller.sources.proofPageCapture({ captureId }); }
      expect(state.status).toBe('captured');
      expect(state.tiles.length).toBeGreaterThan(0);
    } finally {
      await worker.stop();
      expect(worker.gate.open()).toBe(0);
      await f.cleanup();
      await me.cleanup();
    }
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `cd packages/worker && npx vitest run src/config.test.ts`
Expected: FAIL — `./config.js` missing.

- [ ] **Step 4: The config** — `packages/worker/src/config.ts`:

```ts
// The worker's knobs (spec 2026-10-23 §4.3, §8). Unset or nonsense: the default.
export type WorkerConfig = {
  queue: string; name: string | null; browsers: number;
  lanes: { interactive: number; background: number; runs: number };
  minFreeMb: number; leaseMs: number; pollMs: number; shutdownMs: number; retryBaseMs: number;
  websiteChecks: boolean; testJobs: boolean; stopFile: string | null;
};

type Env = Record<string, string | undefined>;
const int = (env: Env, name: string, fallback: number, min: number): number => {
  const raw = (env[name] ?? '').trim();
  const n = Number(raw);
  return raw !== '' && Number.isInteger(n) && n >= min ? n : fallback;
};
const text = (env: Env, name: string): string | null => { const v = (env[name] ?? '').trim(); return v === '' ? null : v; };

export function readWorkerConfig(env: Env): WorkerConfig {
  return {
    queue: text(env, 'JOB_QUEUE') ?? 'default',
    name: text(env, 'WORKER_NAME'),
    browsers: int(env, 'WORKER_BROWSERS', 3, 1),
    lanes: { interactive: int(env, 'WORKER_INTERACTIVE', 3, 0), background: int(env, 'WORKER_CONCURRENCY', 2, 0), runs: int(env, 'WORKER_RUNS', 1, 0) },
    minFreeMb: int(env, 'WORKER_MIN_FREE_MB', 1024, 0),
    leaseMs: int(env, 'WORKER_LEASE_MS', 60_000, 1000),
    pollMs: int(env, 'WORKER_POLL_MS', 500, 10),
    shutdownMs: int(env, 'WORKER_SHUTDOWN_MS', 25_000, 0),
    retryBaseMs: int(env, 'WORKER_RETRY_MS', 30_000, 1),
    websiteChecks: (env.WEBSITE_CHECKS ?? '').trim().toLowerCase() === 'on',
    testJobs: (env.WORKER_TEST_JOBS ?? '').trim() === '1',
    stopFile: text(env, 'WORKER_STOP_FILE'),
  };
}
```

(`WORKER_SHUTDOWN_MS: '-1'` falls back to 25 000 because `min` is 0.)

- [ ] **Step 5: The worker** — `packages/worker/src/worker.ts`:

```ts
// The worker (spec 2026-10-23 §4.3): the only process with browsers. One gate limits them; the runner
// claims this queue's jobs; with WEBSITE_CHECKS=on, the hourly sweep enqueues due website checks.
import {
  createBrowserGate, setBrowserGate, startJobRunner, jobRegistry, startWebsiteChecks, enqueueDueWebsiteChecks,
  type JobRunner, type WorkerBrowserGate,
} from '@robot/api/jobs';
import type { WorkerConfig } from './config.js';

export async function startWorker(config: WorkerConfig, deps: { freeMb?: () => number } = {}): Promise<{ runner: JobRunner; gate: WorkerBrowserGate; stop(): Promise<void> }> {
  const gate = createBrowserGate({ max: config.browsers, minFreeMb: config.minFreeMb, ...(deps.freeMb ? { freeMb: deps.freeMb } : {}) });
  setBrowserGate(gate);
  const runner = startJobRunner({
    queue: config.queue, registry: jobRegistry({ testJobs: config.testJobs }), lanes: config.lanes,
    leaseMs: config.leaseMs, pollMs: config.pollMs, retryBaseMs: config.retryBaseMs, minFreeMb: config.minFreeMb,
    ...(deps.freeMb ? { freeMb: deps.freeMb } : {}), browsers: gate, ...(config.name ? { workerName: config.name } : {}),
  });
  const stopChecks = startWebsiteChecks({ env: { WEBSITE_CHECKS: config.websiteChecks ? 'on' : 'off' }, sweep: () => enqueueDueWebsiteChecks() });
  console.log(`[worker] ${runner.workerId} on queue "${config.queue}": browsers ${config.browsers}; lanes interactive ${config.lanes.interactive}, background ${config.lanes.background}, runs ${config.lanes.runs}; min free memory ${config.minFreeMb} MB; website checks ${config.websiteChecks ? 'on (hourly)' : 'off'}`);
  let stopped = false;
  return {
    runner, gate,
    async stop() {
      if (stopped) return;
      stopped = true;
      stopChecks();
      await runner.stop(config.shutdownMs);
      await gate.closeAll();
      setBrowserGate(null);
    },
  };
}
```

`packages/worker/src/index.ts`:

```ts
// @robot/worker — `pnpm dev:all` starts it (turbo `dev`). Stops on SIGINT/SIGTERM, or when WORKER_STOP_FILE appears (Windows smokes).
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';
import { existsSync, rmSync } from 'node:fs';

const here = fileURLToPath(new URL('.', import.meta.url));
try {
  loadEnvFile(join(here, '..', '..', '..', '.env'));
} catch {
  // no .env: whatever is in process.env
}
// The api-server serves capture files from its public/captures; the worker writes them there (Docker: a shared volume, item 2).
process.env.CAPTURES_DIR ??= join(here, '..', '..', 'api-server', 'public', 'captures');

const { readWorkerConfig } = await import('./config.js');
const { startWorker } = await import('./worker.js');
const config = readWorkerConfig(process.env);
if (config.stopFile) rmSync(config.stopFile, { force: true });
const worker = await startWorker(config);

let stopping = false;
async function shutdown(why: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.log(`[worker] stopping (${why})`);
  await worker.stop();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => console.error('[worker] unhandled rejection:', err));
if (config.stopFile) {
  const file = config.stopFile;
  setInterval(() => { if (existsSync(file)) { rmSync(file, { force: true }); void shutdown('stop file'); } }, 500);
}
```

- [ ] **Step 6: The live check** — `packages/worker/src/live-check.ts`:

```ts
// A free live check (CLAUDE.md "Autonomous runs", gate 5): reachability and the listing check on real
// public pages, through an in-process worker on its own queue. Page loads only — no key, no Jev.
//   cd packages/worker && ANTHROPIC_API_KEY= JEV_SHADOW= TYPESAFE_API_KEY= npx tsx src/live-check.ts [url …]
import { randomUUID } from 'node:crypto';
process.env.JOB_QUEUE = `live-check-${randomUUID()}`;
process.env.ANTHROPIC_API_KEY = '';
process.env.JEV_SHADOW = '';

const { readWorkerConfig } = await import('./config.js');
const { startWorker } = await import('./worker.js');
const { runAndWait } = await import('@robot/api/jobs');
const { db } = await import('@robot/db');
const { sql } = await import('drizzle-orm');

const urls = process.argv.slice(2).length > 0 ? process.argv.slice(2) : [
  'https://books.toscrape.com/',
  'https://webscraper.io/test-sites/e-commerce/allinone/computers/laptops',
  'https://www.allbirds.com/collections/mens',
];
const worker = await startWorker({ ...readWorkerConfig(process.env), websiteChecks: false });
let bad = 0;
try {
  for (const url of urls) {
    const reach = (await runAndWait('reachability', { url })) as { message?: string | null; verdict?: { kind: string } };
    const listing = (await runAndWait('listing-check', { listingUrl: url })) as { message?: string | null; groupSize?: number };
    console.log(`${url}\n  reachability: ${JSON.stringify(reach).slice(0, 300)}\n  listing: ${JSON.stringify(listing).slice(0, 300)}`);
    if (reach.message || listing.message) bad++;
  }
} finally {
  await worker.stop();
  console.log(`browsers open after stop: ${worker.gate.open()}`);
  await db.execute(sql`DELETE FROM jobs WHERE queue = ${process.env.JOB_QUEUE!}`);
}
process.exit(bad === 0 ? 0 : 1);
```

(Print the real field names of `Reachability` / `ListingPageCheck` — read their types in `routers/sources.ts` / `verify/find-product-pages.ts` and adjust the casts.)

- [ ] **Step 7: The smoke headers** — in `packages/app/src/staff-smoke.test.ts`, the "isolated pair" instructions at the top: add `JOB_QUEUE=isolated-4100 WEBSITE_CHECKS=off` to the api-server command and a third command, the worker:
`cd packages/worker && ANTHROPIC_API_KEY= JEV_SHADOW= TYPESAFE_API_KEY= WEBSITE_CHECKS=off JOB_QUEUE=isolated-4100 WORKER_STOP_FILE=<a temp file> npx tsx src/index.ts` (stop it by creating the file). In `packages/app/src/routes-smoke.test.ts`, in the header paragraph about the wall: "puts the shop's host (127.0.0.1) on backoff in the api-server" → "in the worker (the isolated pair's own; see staff-smoke.test.ts for the three commands)". Comment changes only.

- [ ] **Step 8: Run the worker tests and type-check**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-worker/packages/worker && npx vitest run --no-file-parallelism && npx tsc --noEmit`
Expected: PASS (the e2e starts one Chromium and closes it; the crash test starts and stops two worker processes per case and no browser). Afterwards `Get-Process chrome, chromium, headless_shell -ErrorAction SilentlyContinue | Where-Object { $_.StartTime -gt (Get-Date).AddMinutes(-10) }` in PowerShell lists nothing this run started (Marko's own browsers are older or are his Chrome — compare by start time and command line; never stop his).

- [ ] **Step 9: Commit**

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-worker
git add packages/worker/package.json packages/worker/tsconfig.json packages/worker/vitest.config.ts packages/worker/src/test-setup/job-queue.ts packages/worker/src/config.ts packages/worker/src/config.test.ts packages/worker/src/worker.ts packages/worker/src/index.ts packages/worker/src/live-check.ts packages/worker/src/crash-recovery.test.ts packages/worker/src/capture-e2e.test.ts pnpm-lock.yaml packages/app/src/staff-smoke.test.ts packages/app/src/routes-smoke.test.ts
git commit -m "feat(worker): the capture worker process — gate, runner, scheduler, graceful stop

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: The merge gate, docs, the merge (`CLAUDE.md` "Autonomous runs")

**Files:**
- Modify: `docs/superpowers/specs/2026-10-23-capture-worker-design.md` (Status), `docs/handoff.md` ("Read this first": the "Newest" line; a new section before `## Websites change: keep running, re-check, tell the customer (2026-10-21)`), `CLAUDE.md` (Package Map, Commands, Environment, Key Technical Decisions), `.env.example`, `docs/queue.md` (item 1 → Done; Needs Marko)

**Interfaces:**
- Consumes: every earlier task.
- Produces: a branch that passes the gate, docs that say what shipped, `main` fast-forwarded and pushed.

- [ ] **Step 1: Reviews are clean; trailers are right**

Confirm each task's review (and fix rounds) ended clean. Then:

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-worker && git log main..HEAD --format=%B | grep Co-Authored-By | sort | uniq -c
```

Expected: only `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Rewrite strays with `git rebase main --exec "bash <script>"` where the script amends only commits whose trailer names another model (memory `subagent-commit-trailers`).

- [ ] **Step 2: Full test run and type-check of every touched package**

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-worker/packages/db && npx vitest run && npx tsc --noEmit
cd /c/Users/Marko/Documents/projects/robot-platform-worker/packages/browser && npx vitest run --no-file-parallelism && npx tsc --noEmit
cd /c/Users/Marko/Documents/projects/robot-platform-worker/packages/scraper && npx tsc --noEmit
cd /c/Users/Marko/Documents/projects/robot-platform-worker/packages/api && npx vitest run --no-file-parallelism && npx tsc --noEmit
cd /c/Users/Marko/Documents/projects/robot-platform-worker/packages/api-server && npx vitest run && npx tsc --noEmit
cd /c/Users/Marko/Documents/projects/robot-platform-worker/packages/worker && npx vitest run --no-file-parallelism && npx tsc --noEmit
cd /c/Users/Marko/Documents/projects/robot-platform-worker/packages/app && npx vitest run && npx tsc --noEmit
```

Expected: all PASS, no type errors (Postgres up). A Chromium file that times out only in the full run: re-run it alone; `transfer-marks.test.ts`'s JSON-LD image-array case is a known flake. A real failure blocks the merge: fix it on the branch with a test. Then `git status --short`: restore `packages/app/src/routeTree.gen.ts` if it changed; no test left a `jobs` row behind (`SELECT queue, count(*) FROM jobs WHERE queue LIKE 'test-%' GROUP BY queue` → none).

- [ ] **Step 3: Whole-branch review**

The controller dispatches one reviewer on the most capable model over `git diff main...HEAD`, with the spec and this plan. Points to press: spec §7's nine properties one by one; every `void` start of browser work in `packages/api/src` outside `src/scripts`, `dogfood.ts`, `judge-run.ts`, `jev-*.ts`, `crawl-plan.ts`, `crawl-execute.ts` is gone (`grep -rn "void run\|void start" packages/api/src --include=*.ts`); each status row and its job in one transaction; the job-aware stall rules (a live job is never stalled; no job → today's rule); the fences on late writes (capture, Verify, drift, coverage); `closeJobRows` per table and on retry; one run job per run; the queue namespace in every enqueue and claim and in every test; the gate's limit, priority, memory wait, nested refusal and `closeAll`; the runner's stuck/lease-lost/shutdown paths freeing the slot and never double-recording; customer copy (two new sentences, verbatim, no internals). No open Critical or Important finding may remain; fix on the branch and re-run Step 2 for the touched packages.

- [ ] **Step 4: The route smoke, from the branch, on an isolated pair with its worker**

A stop file for the worker: `/c/Users/Marko/AppData/Local/Temp/claude/worker-4100.stop` (the worker deletes a stale one at start). In the background, three processes:

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-worker/packages/api-server && ANTHROPIC_API_KEY= JEV_SHADOW= TYPESAFE_API_KEY= WEBSITE_CHECKS=off JOB_QUEUE=isolated-4100 PORT=4100 APP_ORIGINS=http://localhost:3100 npx tsx src/index.ts
```

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-worker/packages/worker && ANTHROPIC_API_KEY= JEV_SHADOW= TYPESAFE_API_KEY= WEBSITE_CHECKS=off JOB_QUEUE=isolated-4100 WORKER_STOP_FILE=/c/Users/Marko/AppData/Local/Temp/claude/worker-4100.stop npx tsx src/index.ts
```

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-worker/packages/app && VITE_API_URL=http://localhost:4100 npx vite dev --port 3100
```

Wait until `curl -s http://localhost:4100/healthz` answers `{"status":"ok"}` (its log says `jobs go to queue "isolated-4100"`), the worker's log says `on queue "isolated-4100"` and `website checks off`, and `curl -s -o /dev/null -w "%{http_code}" http://localhost:3100/login` answers 200. Then:

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-worker/packages/app && RUN_UI_SMOKE=1 APP_URL=http://localhost:3100 API_URL=http://localhost:4100 npx vitest run src/routes-smoke.test.ts
```

Expected: PASS, 28 of 28 (as on `main` @ `5ec19af`). The worker's log shows `listing-check`, `reachability`, `proof-page-capture` and `transfer-marks` jobs claimed and done. Look at the Verification-tab screenshots the smoke wrote (`docs/testing/screens/app-site-*.png`): the three proof-page cards carry their screenshots. If many early steps fail at once ("Reached … (HTTP 200)" missing, cards missing), check the worker is running and on `isolated-4100` before anything else.

Stop the worker gracefully — `touch /c/Users/Marko/AppData/Local/Temp/claude/worker-4100.stop` and wait for its process to exit (its log ends `stopping (stop file)`; its browsers close) — then the two servers by port, never :3000/:4000:

```powershell
Get-NetTCPConnection -LocalPort 4100,3100 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -Confirm:$false }
```

If the worker has not exited 60 s after the stop file, find it by command line and stop it — only this worktree's: `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*robot-platform-worker*packages*worker*src*index.ts*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -Confirm:$false }`. Then `DELETE FROM jobs WHERE queue = 'isolated-4100'` (via `npx tsx -e` with `@robot/db`, from `packages/worker`). Restore what the run rewrote: `git checkout -- packages/app/src/routeTree.gen.ts docs/testing/screens` (no new screenshot belongs to this item).

- [ ] **Step 5: The live check (gate 5)**

Capture moved processes. Run, free and keyless:

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-worker/packages/worker && ANTHROPIC_API_KEY= JEV_SHADOW= TYPESAFE_API_KEY= npx tsx src/live-check.ts
```

Expected: each site's reachability reads as reached and its listing check finds a product group (a site that walls the browser says so in its customer sentence — that is an answer, not a failure of the worker; compare with the same site's answer on `main` if in doubt); `browsers open after stop: 0`; exit 0, or a wall explained. Together with Step 4's screenshots of the proof cards, this is the look at real captures through the worker.

- [ ] **Step 6: Docs**

Note the last code commit: `git log -1 --format=%h -- packages` → `<sha>`.

1. Spec — replace the Status paragraph's first sentence with ``**Status:** implemented on `feat/capture-worker` and merged to `main` on <date> (`<sha>`); written 2026-10-23 under the standing approval …`` (keep the rest), and add any deviation the reviews forced as a **Deviations:** sentence.
2. `CLAUDE.md`:
   - Package Map: a row `| \`@robot/worker\` | The only process that loads pages: claims jobs from Postgres, owns and limits the browsers, runs Verify, captures, checks, runs and the website-check schedule | Playwright (via @robot/browser), @robot/api jobs |`; in `@robot/api-server`'s row, "Purpose" ends "… serves captures; never starts a browser".
   - Commands: `pnpm dev:all` — "start the api-server (:4000), the app (:3000) and the worker; the app is no use without the api-server, and nothing loads a page without the worker"; in `test:ui:staff`'s line, the isolated pair is three processes: add "and its worker (`JOB_QUEUE=isolated-4100` on both the api-server and the worker, `WEBSITE_CHECKS=off`; stop the worker with its `WORKER_STOP_FILE`)"; a new line `- \`pnpm --filter @robot/worker exec tsx src/live-check.ts [url …]\` — free live check of reachability and the listing check through an in-process worker (keyless)`.
   - Environment: `JOB_QUEUE` — "the queue the api-server enqueues to and the worker claims from; default `default`. Tests use their own per file; the isolated smoke pair uses `isolated-4100`"; `WORKER_BROWSERS` (3), `WORKER_INTERACTIVE` (3), `WORKER_CONCURRENCY` (2), `WORKER_RUNS` (1), `WORKER_MIN_FREE_MB` (1024), `WORKER_LEASE_MS` (60000), `WORKER_SHUTDOWN_MS` (25000), `WORKER_RETRY_MS` (30000), `WORKER_STOP_FILE` — one line each with its meaning from spec §4.3; `WEBSITE_CHECKS` — "… now read by the worker".
   - Key Technical Decisions, after the "Websites change" bullet:

```markdown
- Capture worker (2026-10-23): every page load and in-browser script runs in `@robot/worker`, fed by a Postgres `jobs` table (enqueued in the same transaction as the status row the app polls; claimed `FOR UPDATE SKIP LOCKED` under a renewed lease; namespaced by `JOB_QUEUE`). The api-server forbids browser launches. One gate limits Chromium (`WORKER_BROWSERS`), lanes keep runs, background checks and interactive captures apart, and no browser starts under `WORKER_MIN_FREE_MB`. A crashed worker's job is retried; a stuck one is stopped; a job that will not run again closes its rows with the sentence the app already shows. A row whose job is live is never "stalled".
```

3. `.env.example` — a commented block "# Capture worker (spec 2026-10-23)" with `# JOB_QUEUE=default` and each `WORKER_*` default, one comment line each; move the `WEBSITE_CHECKS` comment's "the api-server" wording to "the worker".
4. `docs/handoff.md` — replace the line starting `**Newest: [Websites change (2026-10-21)]` with `**Newest: [A job queue and a capture worker (2026-10-23)](#a-job-queue-and-a-capture-worker-2026-10-23).** Page loads left the api-server for @robot/worker, fed by a Postgres jobs table; one gate limits browsers and memory; a crashed or stuck job is retried or closed with a sentence. Merged <date> after the full gate.` followed by `**Before it: [Websites change (2026-10-21)](#websites-change-keep-running-re-check-tell-the-customer-2026-10-21).**` and the rest of the old line. Insert before `## Websites change: keep running, re-check, tell the customer (2026-10-21)` a section `## A job queue and a capture worker (2026-10-23)` with: spec/plan paths; **What changed** (the queue; the worker and its gate and lanes; the api-server guard; job-aware stall rules; what customers see — one paragraph each, from the spec); **How it was proven** (test counts from Step 2, the crash-recovery and e2e tests, the smoke on the isolated pair with its worker, the live check's lines); **After pulling** (`pnpm install` — a new package; `pnpm db:migrate` is already applied to the dev database by the branch's tests; restart `pnpm dev:all` to get the worker — until then the old api-server keeps running page loads itself); **What NOT to redo** (no `void` start of browser work in the api; enqueue in the status row's transaction; keep `JOB_QUEUE` per test file; the gate is the only limit — no second limiter); **Open** (spec §12, and the review's deferred Minors).
5. `docs/queue.md` — move item 1 from **Next** to **Done** as `- <date> — A job queue and a separate capture worker (\`<sha>\`): page loads run in @robot/worker from a Postgres jobs table; the api-server starts no browser; crashed jobs retried, stuck ones closed with a sentence. Restart \`pnpm dev:all\` (after \`pnpm install\`) to get the worker.`; renumber **Next**; add under **Needs Marko**: `- **Runs wait their turn?** With the worker, one run at a time by default (\`WORKER_RUNS=1\`); a second website's run waits at "extracting". Keep 1 until item 3 (run speed), or 2 now?` and `- **Two new customer sentences** (spec 2026-10-23 §6): a run whose worker gave up — "This run stopped before it finished. Extract again to pick up where it left off."; a plan — "Finding the products stopped before it finished. Try again." Keep?`

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-worker
git add docs/superpowers/specs/2026-10-23-capture-worker-design.md docs/handoff.md CLAUDE.md .env.example docs/queue.md
git commit -m "docs: capture worker — shipped; handoff, decisions, commands, environment, queue

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Rebase on `main`, fast-forward `main`, push**

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-worker
git checkout -- packages/app/src/routeTree.gen.ts
git status --short
git fetch origin
git rebase main
```

If `main` moved, re-run Step 2 for the touched packages (and Step 4 if an app/api file on `main` changed). The main checkout must be clean and on `main`:

```bash
git -C /c/Users/Marko/Documents/projects/robot-platform status --short
git -C /c/Users/Marko/Documents/projects/robot-platform rev-parse --abbrev-ref HEAD
```

If it is not clean, or not on `main`, stop: write the item under **Needs Marko** in `docs/queue.md` ("branch ready, main checkout not clean") and do not merge. Otherwise:

```bash
git -C /c/Users/Marko/Documents/projects/robot-platform merge --ff-only feat/capture-worker
git -C /c/Users/Marko/Documents/projects/robot-platform push origin main
```

Expected: a fast-forward and a push. A refused fast-forward (main moved again) means: rebase again, re-run Steps 2 and 4, try again. Marko's dev servers are not restarted: his running api-server keeps the old code (and keeps loading pages itself) until he runs `pnpm install` and restarts `pnpm dev:all` — say so in the run's digest. Do not run `pnpm install` in the main checkout (it is his working copy; the digest tells him).
