# A job queue and a separate capture worker — design

**Status:** written 2026-10-23 under the standing approval (queue item 1; Marko approved the item 2026-10-23,
"start"). Plan: `docs/superpowers/plans/2026-10-23-capture-worker.md`. Branch `feat/capture-worker` from `main`
@ `fda4506b`, worktree `C:\Users\Marko\Documents\projects\robot-platform-worker`.

## 1. Why

Every page load today happens inside the api-server process, started as an un-awaited promise
(`void runSourceVerification(...)`, `void startExecution(...)`, `if (fire) void runDriftCheck(...)`), or
awaited inside an HTTP request (the finder's listing check, the reachability line, the mark transfer, planning).
Each of those opens its own Chromium through `withBrowserSession`; only proof-page captures and the coverage
check share a limiter (`captureSlots`, three), so a Verify, a run, a drift check and three captures can hold six
or more browsers at once. On the dev machine memory pressure has killed jobs repeatedly (the 2026-10-21
Gymshark re-check "could not open a browser"; the Claude Code watchdog killed the api-server four times in two
days). A job that dies with its process leaves its row `running`; the row is closed as `stalled` only when
somebody reads it, by a time rule per table. A queued capture can be closed as stalled while it merely waits
(the in-process `waitingForSlot` set exists only to stop that, and is lost on restart).

This also blocks the next two items: hosting (item 2: Docker Compose with app, api, worker, db — the api image
should not need Chromium at all) and run speed (item 3: several websites in parallel, which needs one place that
decides how many browsers run).

## 2. What changes, in one paragraph

A `jobs` table in Postgres is the only way work that loads a page (or evaluates a script in a browser) starts.
The api-server enqueues — in the same transaction that inserts the status row the app polls — and never launches
a browser (a process-wide guard makes `PlaywrightBrowser.launch` throw there). A new process, `@robot/worker`,
claims jobs with `FOR UPDATE SKIP LOCKED`, holds a lease it renews every 15 seconds, runs the job's handler (the
same code that runs today), and is the only process with browsers: one gate limits how many Chromium processes
run (`WORKER_BROWSERS`, default 3), refuses to start one while free memory is low, and closes every browser it
opened on shutdown. A job whose worker crashed is retried when its lease expires; a job that is stuck (no
progress for its time limit) is stopped; either way, a job that will not be retried closes every status row it
owns with the sentence the app already shows for a stalled row. The status rows, their polling, and every
customer screen stay as they are; the only visible difference is fewer stalls.

## 3. Inventory (read on `main` @ `fda4506b`)

### 3.1 Background work started from the api-server (fire-and-forget today)

| Work | Start (file:line) | Status row | Browser | Stall rule today |
|---|---|---|---|---|
| Proof-page capture | `routers/sources.ts:785` `captureProofPage` → `verify/proof-page-capture.ts:60` `startProofPageCapture` (fires `:64`) | `captures.metadata` (`capturing` → `captured`/`failed`) | `runProofPageCapture` `:112`, in `captureSlots` (`:20`, limit 3) | `resolveStalledProofPage` `:175`: `capturing` older than `PROOF_PAGE_STALL_MS` (3 min, `:166`) from the work start → `failed`/`'stalled'`, unless in this process's `waitingForSlot` (`:28`) |
| Verify | `routers/sources.ts:1149` `verify` → `verify/run-source-verification.ts:97` | `source_verifications` (`completed_at` null → set; `_stage` in `captures`) | one session around the whole run, `:180` (also variants and holds) | `verify/in-flight.ts:61` `resolveInFlightVerification`: in flight older than `VERIFY_STALL_MS` (15 min, `scraper/src/verify/constants.ts:26`) → `'stalled'`; `verify/run-failure.ts:7` `runFailure` reads the same window; the app's `verificationState` (`app/src/lib/site/verification-view.ts:160`) too, client-side, from `startedAt` |
| Refresh re-verify | `verify/refresh-values.ts:85` `startRefreshVerify` (fires `:104`), called from `run-drift-check.ts:317` | `source_verifications` | as Verify | as Verify |
| Coverage check | `run-source-verification.ts:257` (after a passing Verify) → `verify/run-coverage-check.ts:108` `startCoverageCheck` (fires `:129`) | `coverage_checks` (`running` → `done`/`failed`) | a session per page: listing `:50`, each of twenty products `:79`, both in `captureSlots` | `startCoverageCheck` and `latestCoverageCheck` (`:235`): `running` older than 10 min (`:24`) from `created_at` → `'stalled'` |
| Drift check | `routers/sources.ts:1256` `checkDrift` (manual); `crawl/start-execution.ts` `buildFinalise` (after a run); `run-source-verification.ts:263` (trigger `verify`, on stored captures) → `verify/run-drift-check.ts:129` `startDriftCheck` (fires `:151`) | `drift_checks` | proof pages re-captured through `startProofPageCapture` + `runProofPageCaptureInSlot` (`:98`), awaited; one session for classification `:264` | `startDriftCheck` and `latestDriftCheck` (`:336`): `running` older than 10 min (`:87`) from `created_at` |
| Scheduled website check | timer in `api-server/src/index.ts:30` → `verify/website-checks.ts:115` `startWebsiteChecks` → `:92` `runDueWebsiteChecks` → `:72` `checkWebsite` (drift then coverage, inline, awaited) | `drift_checks`, `coverage_checks` | as drift and coverage | as drift and coverage; off unless `WEBSITE_CHECKS=on` |
| Run execution | `routers/crawl.ts:308` `execute` (fires `:409`), `:78` `probeAndSample` (fires `:189`), `:511` `backfill` (fires `:638`, repair sweep `:641`) (plain or repair sweep) → `crawl/start-execution.ts:152` `startExecution` → `crawl/execute-run.ts:73` | `runs`, `run_items` | one session for the whole run, `start-execution.ts:169` | `crawl/requeue-stale.ts`: an item `running` for 30 min is requeued — only when someone calls `execute` again ("Resume N stalled", `app/src/lib/site/run-progress.ts:120`) |
| Jev reading, Jev agreement | after a capture (`proof-page-capture.ts:125`) and after Verify (`run-source-verification.ts:270`) | `jev_readings`, `source_verifications.verify_agreement` | none (HTTP to TypeSafe) | none |

### 3.2 Browser work awaited inside an HTTP request today

| Procedure | file:line | What it does with a browser |
|---|---|---|
| `sources.checkListingPage` | `routers/sources.ts:700` (session `:707`) | reads a listing (load more ×3), describes its product group |
| `sources.reachability` (a query) | `routers/sources.ts:744` (session `:754`) | one page load, one tile |
| `sources.transferMarks` | `routers/sources.ts:889` (session `:924`) | XPath probe and DOM search on stored HTML (`setContentEvaluate`) |
| `sources.detectVariants` (a query) | `routers/sources.ts:1310` (session `:1331`) | variant link and picker scripts on stored HTML |
| `sources.variantLinksNear` (a query) | `routers/sources.ts:1571` (session `:1582`) | the links-near script on stored HTML |
| `crawl.plan`, `crawl.probeAndSample`, `sources.confirm` | `routers/crawl.ts:47` (call `:60`), `:78` (call `:150`); `routers/sources.ts:952` (call `:971`) → `crawl/plan-source.ts:72` (session `:127`) | walks the listing (and pagination), with an agent |

### 3.3 Process-local state that moves with the browsers

- The host backoff after a wall (`backoffAnswer` / `reportVerdict`, `@robot/scraper` `domain-lock.ts`) lives in the
  process that loads pages. It moves to the worker with them: every page load and every backoff answer happens
  there. (Two workers would each keep their own; item 2/3 decide whether that needs to be shared.)
- The Jev daily budget (`JEV_DAILY_READINGS`) counts in the process that captures — the worker.
- `captureSlots` and `waitingForSlot` are deleted; the worker's browser gate replaces the first, the job's lease the second.

### 3.4 Out of scope

Operator scripts that launch their own browser in their own process stay as they are: `dogfood.ts`,
`judge-run.ts`, `jev-images-run.ts`, `jev-live-check.ts`, `crawl-plan.ts`, `crawl-execute.ts`,
`scripts/*.ts`, `@robot/scraper`'s CLIs, `@robot/agent/render-calibration.ts`. They keep calling the inline
functions (`fire: false`, `runProofPageCapture`, `startExecution`, `planSource`) directly, with no gate.

## 4. Design

### 4.1 The queue: a `jobs` table (no library)

Migration `0020_capture_jobs` (`@robot/db`):

```
jobs(
  id uuid pk, queue varchar(64) not null default 'default', type varchar(40) not null,
  key varchar(200) null,                      -- dedupe: one queued/running job per (queue, key)
  payload jsonb not null default '{}', status varchar(12) not null default 'queued',  -- queued|running|done|failed
  priority integer not null default 10,       -- lower first
  attempts integer not null default 0, max_attempts integer not null default 1,
  run_after timestamptz not null default now(), expires_at timestamptz null,   -- not started by then: failed 'expired'
  locked_by varchar(200) null, locked_until timestamptz null,                  -- the lease
  started_at, finished_at timestamptz null, result jsonb null, error text null, created_at timestamptz default now()
)
index (queue, status, priority, run_after); index (status, locked_until);
unique (queue, key) where status in ('queued','running') and key is not null
```

and a nullable `job_id uuid` (no foreign key: finished jobs are purged after seven days, and a dangling id reads as
"no live job") with an index on `source_verifications`, `drift_checks`, `coverage_checks`, `captures` and `runs`.
A row's `job_id` names the job working on it.

**Why not pg-boss.** It brings its own schema and migrations, the `pg` driver beside our `postgres` one (a second
pool), and no lease renewal; and our central need — inserting the status row, taking the website row lock, and
enqueueing in one transaction (`startVerificationRow` already holds `FOR UPDATE` on the website) — would go
through an adapter around its own connection. The table above is about three hundred lines with drizzle, sits in
our migrations, and gets queue namespaces (below) for free.

**Queue namespaces.** Every enqueue and every claim is scoped to `JOB_QUEUE` (default `default`). The test
database is Marko's dev database: each api test file sets its own `test-<uuid>` queue (a vitest setup file) and
deletes its rows after; the isolated smoke pair and its worker use `isolated-4100`. No worker ever claims
another namespace's jobs, so Marko's worker never runs a test's job and the isolated worker never runs his.

**Operations** (`@robot/api` `src/jobs/queue.ts`):
- `enqueueJob(dbOrTx, spec)` — insert, `ON CONFLICT (queue, key) … DO NOTHING`, returning the new or the existing
  active job's id (idempotent per key). Called inside the caller's transaction.
- `claimJob(queue, workerId, types, leaseMs)` — `UPDATE jobs SET status='running', attempts=attempts+1,
  locked_by, locked_until=now()+lease, started_at=now() WHERE id = (SELECT id … WHERE queue=$q AND
  status='queued' AND type = ANY($types) AND run_after <= now() AND (expires_at IS NULL OR expires_at > now())
  ORDER BY priority, run_after, created_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`.
- `renewLease(id, workerId, leaseMs)` → false when the lease was lost (reaped).
- `completeJob`, `retryJob` (back to `queued` after a delay), `failJobTerminal` — conditional on the lease
  (`locked_by = me AND status='running'`, a lapsed lease for the reaper, or `queued` for an expiry). A terminal
  failure closes the job's rows (4.5) in the same transaction. `releaseJob` (shutdown) gives a job back unspent.
- `reapJobs(queue)` — running jobs past `locked_until` are retried (attempts left) or failed `stalled`; queued
  jobs past `expires_at` are failed `expired`; both terminal cases close the job's rows. Done/failed jobs older
  than seven days are deleted.
- `liveJobIds(ids)` — the ids among `ids` that are queued and not expired, or running with an unexpired lease.
- `awaitJob(id, ceilingMs)` — polls every 150 ms until done (its `result`) or failed (the error, rethrown as the
  class it was: a `TRPCError` with its code, a `CaptureProblemError` with its verdict; anything else, and a job
  that expired, stalled or passed the ceiling, as `JobUnavailableError`). `JOB_AWAIT_MAX_MS` caps the ceiling
  (tests only).

### 4.2 Job types

| Type | Lane | Priority | Attempts | Stuck after (no progress) | Must start within | Key | Rows it owns |
|---|---|---|---|---|---|---|---|
| `proof-page-capture` | interactive | 10 | 2 | 3 min | 5 min | `capture:<id>` | the capture |
| `reachability` | interactive | 0 | 1 | 60 s | 60 s | `reachability:<url>` | — (awaited) |
| `listing-check` | interactive | 0 | 1 | 90 s | 60 s | `listing:<url>` | — (awaited) |
| `transfer-marks` | interactive | 0 | 1 | 60 s | 60 s | — | — (awaited) |
| `detect-variants` | interactive | 0 | 1 | 60 s | 60 s | `detect-variants:<sourceId>` | — (awaited) |
| `variant-links-near` | interactive | 0 | 1 | 30 s | 60 s | — | — (awaited) |
| `plan` | interactive | 5 | 1 | 15 min | 2 min | `plan:<runId>` | the run (awaited) |
| `verify` | background | 10 | 2 | 14 min | 15 min | `verify:<id>` | the verification |
| `drift-check` | background | 20 | 2 | 9 min | 30 min | `drift:<id>` | the check + its captures |
| `coverage-check` | background | 20 | 2 | 9 min | 30 min | `coverage:<id>` | the check |
| `website-check` | background, at most 1 at a time | 30 | 2 | 25 min | — | `website-check:<sourceId>` | the checks and captures it starts |
| `run` | runs | 10 | 3 | 15 min | — | `run:<runId>` | the run |

"Stuck after" is measured from the job's start or its last `ctx.progress()` (a run reports one per item; a
website check one between its drift and coverage parts). Verify's 14 minutes stays under the 15-minute window the
app applies from `startedAt`, which the worker resets when the job starts (4.4). An awaited job's ceiling in the
api-server is its start window plus its stuck limit plus ten seconds.

### 4.3 The worker (`@robot/worker`, a new package)

`packages/worker/src/index.ts` loads the repo `.env`, sets `CAPTURES_DIR` to the api-server's
`public/captures` unless set (the api-server serves those files; Docker will share a volume, item 2), installs the
browser gate, starts the job runner and the website-check scheduler, and handles `SIGINT`/`SIGTERM` (and, for
smokes on Windows, a stop file, `WORKER_STOP_FILE`). Everything else lives in `@robot/api` `src/jobs/` (the
handlers are api code, and the api's own tests need the runner in-process); `@robot/api` exports it as
`@robot/api/jobs`. The worker package is the only one that needs Chromium at runtime.

**Lanes.** Three lanes, each with its own concurrency and job types, so a long run never holds up a Verify and
neither holds up a "mark this page" capture: `interactive` (`WORKER_INTERACTIVE`, default 3), `background`
(`WORKER_CONCURRENCY`, default 2), `runs` (`WORKER_RUNS`, default 1). A lane claims only while it has a free
slot, free memory is at least `WORKER_MIN_FREE_MB` (default 1024), and the worker is not stopping. A type may cap
its own concurrency (`website-check`: 1).

**The browser gate.** `withBrowserSession` asks a process-wide gate (`setBrowserGate`) before launching. The
worker's gate allows `WORKER_BROWSERS` (default 3) live Chromium processes in total, serves waiting
interactive jobs before background before runs, waits while free memory is under `WORKER_MIN_FREE_MB` (at most
two minutes, then launches anyway — a launch that then fails is today's "We couldn't open a browser…"), refuses
a nested session (a job opening a second browser from inside its first — none does today; refusing it keeps a
job from deadlocking on itself), and tracks each open browser by job so it can close them when the job is
stopped. With no gate set (scripts, tests) `withBrowserSession` behaves as today. Each session is still its own
Chromium, as today; sharing one process between sessions is item 3's.

**Job context.** The runner runs each handler inside an `AsyncLocalStorage` context `{ jobId, type, lane,
attempt, signal, progress() }`. Rows a job inserts are stamped with `currentJob()?.jobId` (so a drift check's
own captures, or a website check's drift and coverage rows, belong to it), and the gate reads the lane and job.

**Lease and heartbeat.** Lease `WORKER_LEASE_MS` (default 60 000), renewed every quarter lease for every job
the worker holds. A renewal that finds the lease lost (another worker reaped it) aborts the job here. Every
worker reaps (4.1) every 15 seconds and once at start, so a crashed worker's jobs are picked up within about
75 seconds. Worker id: `<WORKER_NAME or hostname>:<pid>:<random>`.

**Retries.** A job that comes back from a crash (its lease expired) or from a handler that threw is retried
after `30 s × 2^(attempt-1)` while attempts remain, then failed with the job's sentence. Handlers keep today's
rule — they catch every page or business failure and write it to their row ("The page could not be read.",
"We couldn't open a browser…") — so a throw out of a handler means the database or the process went wrong, which
is worth one retry.

**Stuck jobs.** A job past its "stuck after" is aborted: its `signal` fires and the gate closes its browsers
(the hung Playwright call rejects). A run is then retried (it resumes, 4.4); every other type is failed
terminal with its sentence — never retried in a process where the stuck attempt may still be unwinding. The
lane slot is freed at once.

**Shutdown.** Stop claiming; wait up to `WORKER_SHUTDOWN_MS` (default 25 000) for running jobs; then abort the
rest, close every browser the gate opened, and give their jobs back (`queued`, `attempts - 1`, `run_after =
now()`); exit. A hard kill (`tsx watch` restarting on Windows, Task Manager, the watchdog) is the crash path.

**The scheduler** (`WEBSITE_CHECKS=on`, as today, now in the worker): the hourly sweep claims at most six due
websites (`claimDueWebsite`, unchanged, `SKIP LOCKED`) and enqueues one `website-check` job each; the job runs
`checkWebsite` as today (drift, then coverage, inline). The api-server no longer has a timer.

### 4.4 The api-server and the handlers

`api-server/src/index.ts` calls `forbidBrowserLaunch()` (`@robot/browser`, re-exported from `@robot/api/jobs`)
before serving: from then on `PlaywrightBrowser.launch` throws `BrowserForbiddenError` in that process. It no
longer starts the scheduler.

Every start in 3.1 enqueues instead of firing, in the transaction that writes its row; every procedure in 3.2
enqueues and awaits its job. Concretely:

- **Capture.** `startProofPageCapture` inserts the row and enqueues `proof-page-capture` in one transaction
  (`fire: false` keeps today's inline use for the drift check and scripts). The handler skips a row that is no
  longer `capturing`; its final writes are conditional on the row still `capturing`.
- **Verify.** `startVerificationRow` (under the website row lock, as today) inserts the verification and
  enqueues `verify` with its options (`onlyKeys`, `free`, `origin`, `captureRefs`) in the same transaction —
  used by `sources.verify` and `startRefreshVerify`. The handler skips a completed row, sets `startedAt = now()`
  (the clock starts with the work, as a capture's does), runs `runSourceVerification`, whose final update is now
  conditional on `completed_at IS NULL` (a stopped attempt writes nothing). The coverage check and the
  `verify`-trigger drift check it starts are enqueued; the drift check carries the stored capture refs in its
  payload (`storedRefs`) instead of a function.
- **Drift and coverage.** `startDriftCheck` / `startCoverageCheck` insert and enqueue in one transaction (a
  scheduled check runs them inline inside its `website-check` job, priority 30, and they belong to that job). A retried drift check also starts the re-verify for refreshes an
  earlier attempt applied but never linked to a re-verify (`value_refreshes` of this check with no
  `verification_id`), so a crash between a refresh and its re-verify does not lose the re-verify.
- **Runs.** `crawl.execute`, `probeAndSample` and `backfill` keep their guards and `markRunExtracting`, then
  enqueue `run` (`{ runId, limit?, repairSweep? }`, key `run:<runId>`: one executor per run; a second Execute
  while one is queued or running returns `started: true` and adds nothing). The handler requeues the run's
  `running` items — all of them on a retry (the key guarantees the previous attempt was this run's only
  executor), the 30-minute ones on a first attempt (an operator CLI may be working the run) — and calls
  `startExecution`, which reports progress per item and stops between items, without finalising, when aborted.
- **Plan.** The procedure checks the website can be planned, inserts the `planning` run stamped with the job and
  enqueues `plan` in one transaction, then awaits; `planSource` takes the run id instead of inserting one.
- **Awaited procedures** (listing check, reachability, mark transfer, variants detection, links near) move their
  bodies, unchanged, into handler functions; the router keeps the org check and maps `JobUnavailableError` to the
  answer it gives today when the browser crashed (`unreadListingPage({ kind: 'crashed' })` + `BROWSER_UNAVAILABLE`
  for the listing check and reachability; `TRPCError INTERNAL_SERVER_ERROR` with `BROWSER_UNAVAILABLE` for the rest).

### 4.5 Stall rules become job-aware; a terminal job closes its rows

Every read-side stall rule — `resolveInFlightVerification`, `runFailure`, `resolveStalledProofPage`,
`startDriftCheck`/`latestDriftCheck`, `startCoverageCheck`/`latestCoverageCheck` — first asks whether the row's
`job_id` is live (`liveJobIds`). **A row whose job is live is never stalled**, however long it waited in the queue;
a row with no live job follows today's time rule unchanged (rows left by the old in-process code at deploy time,
and anything a bug strands). `requeueStaleRunningItems` is unchanged.

`closeJobRows(tx, jobId, { runSentence })` closes every non-terminal row stamped with a job: verification →
`error_message 'stalled'`, `completed_at`; drift and coverage → `failed`, `'stalled'`; capture → `failed`,
`'stalled'`; run → `failed` with the job's sentence (`cancelling` → `cancelled`). It runs in the transaction that
fails a job terminally, and at the start of a retry for every row the job owns except the one its payload names
(a website check's half-done drift row, a drift check's half-taken captures), so a retry starts clean.

## 5. Failure handling, case by case

| What happens | Before | After |
|---|---|---|
| The worker is killed mid-Verify | row `running` until a read 15 min later closes it `stalled` | lease expires (≤ 75 s), Verify runs again from the start; second crash: `stalled` |
| The worker is killed mid-run | items stuck `running`; customer clicks "Resume N stalled" after 30 min | lease expires, the run resumes by itself (up to 3 attempts), its `running` items requeued |
| A Playwright call hangs | row `running` until the stall window | job stopped at its limit, browser closed, row `stalled` (run: resumed) |
| Ten captures clicked at once | three run, seven wait; a wait over 3 min could read as stalled before M4's in-process set | three run (gate), the rest queued with a live job — never stalled while queued; started within 5 min or `stalled` |
| Memory low | Chromium launch fails, "We couldn't open a browser…" | no new job claimed and no new browser launched until memory frees (≤ 2 min wait per launch) |
| No worker running | — | background rows stay in progress with a live job until their start window passes, then `stalled`; awaited procedures answer as for a crashed browser after their ceiling; runs wait (no window) |
| The api-server restarts | every in-flight job dies | nothing in flight in the api-server; awaited requests are retried by the app as any failed request |
| A retried job after a crash | — | handlers skip a row that is already terminal; final writes are conditional on the row still in progress; a capture or Verify retried writes new capture files and orphans the old ones (as a "Take it again" does) |

## 6. What customers and staff see

Nothing new. The same rows, the same polling, the same sentences ("The screenshot took too long. Take it
again."; the Verify bar's stalled line; `COVERAGE_STALLED`; the drift check's stalled state), shown less often.
Two sentences are new because nothing wrote them before (customer copy, no internals — memory
`customer-copy-no-internals`):

- A run whose job failed after its attempts: **"This run stopped before it finished. Extract again to pick up
  where it left off."**
- A plan whose job failed: **"Finding the products stopped before it finished. Try again."**

A run now waits for the runs lane (`WORKER_RUNS`, default 1): a second website's run sits at "extracting" with no
progress until the first finishes. That is a behaviour change customers can notice; item 3 raises the lane.
Staff see jobs only in the database and the worker's log (one line per claim, finish, retry, failure).

## 7. Safety properties

1. The api-server process never launches Chromium: `forbidBrowserLaunch()` makes `PlaywrightBrowser.launch`
   throw there, and a test calls every procedure in 3.1 and 3.2 under it.
2. Every page load and every in-browser script for the api goes through a job; there is no `void` start of a
   browser job left in `@robot/api` outside the runner.
3. A status row and its job are written in one transaction — there is never a row without its job, or a job
   pointing at no row.
4. One Verify per website at a time: unchanged (the row lock and in-flight check in `startVerificationRow`); a
   queued Verify is in flight for that check, because its job is live.
5. One executor per run (`run:<runId>` key); one job per row (`verify:<id>`, `capture:<id>`, …).
6. A stopped or reaped attempt cannot overwrite a newer outcome: final writes are conditional on the row still in
   progress; a stuck non-run job is never retried in the same process.
7. No worker claims outside its `JOB_QUEUE`; tests use their own queue and delete their rows.
8. The worker opens at most `WORKER_BROWSERS` Chromium processes, never starts one under `WORKER_MIN_FREE_MB`
   (beyond a two-minute wait), and closes every one it opened on shutdown.
9. No new paid call: the worker runs the same handlers with the same keys; a keyless worker is keyless.

## 8. Dev and the isolated pair

- `pnpm dev:all` starts the worker too (turbo runs `@robot/worker`'s `dev`, `tsx watch src/index.ts`);
  `pnpm dev:all:noai` unsets `ANTHROPIC_API_KEY` for it as for the api-server.
- The isolated pair for smokes gets its own worker on its own queue, with the api-server's env:
  `cd packages/worker && ANTHROPIC_API_KEY= JEV_SHADOW= TYPESAFE_API_KEY= WEBSITE_CHECKS=off JOB_QUEUE=isolated-4100 WORKER_STOP_FILE=<scratch>/worker.stop npx tsx src/index.ts`,
  and the api-server adds `JOB_QUEUE=isolated-4100`. Stop it by creating the stop file (graceful: its browsers
  close) — a hard kill on Windows can leave Chromium behind.
- Marko's running dev servers keep the old code until he restarts `pnpm dev:all` after the merge; the migration
  only adds a table and nullable columns, which the old code ignores.

## 9. Migration path (deploy)

1. `pnpm db:migrate` (0020: a table, five nullable columns, indexes — no rewrite of existing rows).
2. Restart: `pnpm dev:all` now runs api-server, app and worker. Work in flight in the old api-server died with it,
   as any restart does today; its rows have no `job_id`, so the old time rules close them on the next read.
   Runs it left `extracting` resume when the customer clicks Resume (an Execute that now enqueues).
3. Nothing to backfill.

## 10. Testing

- **Queue** (`@robot/api`, real Postgres, own queue): idempotent enqueue per key; claim order (priority, then
  `run_after`), type filter, `run_after` and `expires_at` respected, other queues invisible; lease renewal and
  loss; complete/fail conditional on the lease; retry with backoff; terminal failure closes rows in each of the
  five tables; reaping an expired lease (retry, then terminal); expiry of a queued job; purge; `liveJobIds`.
- **Gate:** at most N sessions; interactive served first; memory wait (injected free-memory reader); nested
  session refused; a job's browsers closed on abort; `closeAll` on shutdown.
- **Runner:** lanes and their caps; per-type cap; stuck job aborted and failed (non-run) or retried (run);
  shutdown waits, then gives jobs back; retry start closes the job's other rows; **in-process crash recovery**:
  a job claimed by a runner that then stops heartbeating is reaped and completed by a second runner.
- **Crash recovery across processes** (`@robot/worker`): a real worker process (`WORKER_TEST_JOBS=1` registers a
  `test-sleep` type) claims a job and is killed; a second worker process finishes it on attempt 2; with one
  attempt allowed, the job ends `failed`/`stalled`.
- **Capture end to end** (`@robot/worker`): an in-process runner with the real gate captures a page served by a
  local `node:http` server; the row ends `captured`; after shutdown the gate reports no open browser.
- **Handlers and routers:** each start enqueues (in its transaction, row stamped); each handler, run in-process by
  the test runner with today's fakes, writes what today's background body wrote; job-aware stall rules (a row
  with a queued job older than the window stays in progress; one without follows the time rule); drift retry
  re-verifies unlinked refreshes; run retry requeues and resumes; awaited procedures return the handler's answer
  and map `JobUnavailableError`.
- **The api-server starts no browser** (`@robot/api-server`): with `forbidBrowserLaunch()` on and a fake worker
  answering jobs, every procedure in 3.1 and 3.2 returns, enqueues the expected job type, and nothing launches.
- **Smoke:** the route smoke (`pnpm test:ui:app`) on the isolated pair plus its worker — the smoke's captures,
  finder, reachability line, mark transfers and wall backoff now all go through that worker. And a free live
  check: `packages/worker/src/live-check.ts` runs reachability and listing-check jobs on three public sites
  through an in-process worker and prints their verdicts.

## 11. Not in this spec

- Hosting: Docker images, Compose, a shared captures volume, health endpoints (item 2; item 9's watchdog).
- Run speed: several websites in parallel, shared Chromium processes, lean captures (item 3). The runs lane stays
  at one by default.
- A staff view of jobs; LISTEN/NOTIFY wake-ups (polling at 500 ms is enough for one worker).
- Moving the host backoff into the database (needed only with several workers).

## 12. Open for Marko

None blocks the work; each has the default this spec uses.

- **Runs wait their turn.** With `WORKER_RUNS=1`, a second website's run waits at "extracting" until the first
  ends (today they ran side by side, each with its own Chromium). Keep 1 until item 3, or default to 2?
- **The two new sentences** in §6 — wording as written unless Marko changes it.
