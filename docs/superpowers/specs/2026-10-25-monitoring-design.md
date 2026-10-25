# Monitoring basics — design

**Status:** written 2026-10-25 under the standing approval (`CLAUDE.md`, "Autonomous runs"; `docs/queue.md` item 1,
"Monitoring basics"). Plan: `docs/superpowers/plans/2026-10-25-monitoring.md`. Branch `feat/monitoring` from `main` @
`d7c53eef`, worktree `C:\Users\Marko\Documents\projects\robot-platform-monitoring`.

## 1. Why

The queue item: health endpoints, structured logs, a stuck-job watchdog, an error-tracking hook; scheduled website
checks on locally. **Done when:** tests; a week of local checks reviewed.

**Not done here.** Turning the scheduled checks on in Marko's local servers, and reviewing a week of them, need his dev
servers and a week. They go to Needs Marko. This item ships everything that makes that week reviewable.

What the audit (2026-10-25) found:

- **Health.** `/healthz` (api-server) checks nothing. The worker has no HTTP surface and no heartbeat anywhere. The
  app's `serve.mjs` has no health route. In Compose only Postgres and the api have healthchecks.
- **Logging.**
  - About 500 `console.*` lines with `[prefix]` text: no levels, no JSON, no request log.
  - Three redaction helpers: `redactProxy`, `redactSmtp`, and the webhook code never logs secrets.
- **Stuck jobs.**
  - The reaper runs only inside a live worker, so with no worker a `queued` job sits forever and nothing says so.
  - A job's last progress lives only in its worker's memory. Nothing outside it can see "running but not moving".
- **Errors.**
  - There is no Hono `onError` and no error tracking.
  - The worker catches `unhandledRejection` but not `uncaughtException`. The api-server and app catch neither.
- **Ops.** There is no queue view.

## 2. The design

### 2.1 Worker heartbeat and readiness

**The heartbeat.**
- A `workers` table holds `id` (the worker id, e.g. `host:pid:rand`), `queue`, `started_at`, `beat_at`, `version`
  (the git sha if known, else the package version), `browsers` (in use / max), `lanes` (jsonb: running per lane) and
  `website_checks` / `recurring_runs` (booleans).
- The worker upserts its row every 30 s and deletes it on a clean stop. A row whose `beat_at` is older than 2 minutes
  is a dead worker; rows older than 1 day are purged by any worker.

**Readiness.** The api-server gains `GET /readyz` (no auth). It answers 200 `{ status: 'ok', checks }` or 503 with the
failing checks:

| Check | How |
|---|---|
| `db` | `SELECT 1` within 2 s |
| `migrations` | the count of rows in `drizzle.__drizzle_migrations` is at least the number of migration files bundled in `@robot/db` |
| `worker` | at least one worker row for this api-server's `JOB_QUEUE` with `beat_at` within 2 minutes |
| `queue` | no `queued` job on this queue whose `run_after` is more than 10 minutes in the past (a backlog nobody is taking) |

**Liveness.**
- `/healthz` stays pure liveness, as today.
- The worker gains an optional `WORKER_HEALTH_PORT`: a tiny `node:http` server on 127.0.0.1 answering `GET /healthz`
  with 200 while its job loop, heartbeat and lease renewal are running, and 503 while it is stopping. Compose sets it
  (`4001`, internal) and adds a worker healthcheck.
- The app's `serve.mjs` answers `GET /healthz` 200, with a Compose healthcheck too.

### 2.2 Structured logs

**The logger.** `@robot/api/log` exports `createLog(scope)` returning `{ debug, info, warn, error }(message, fields?)`.

**Formats.**
- `LOG_FORMAT=json`: one JSON object per line, `{ t: ISO, level, scope, msg, ...fields }`.
- Default `text`: `[scope] msg key=value …`, readable as today.
- `LOG_LEVEL` (default `info`) filters.

**Redaction.** Every field and message passes through `redact`:
- `redactProxy` and `redactSmtp` for URL userinfo;
- keys matching `/pass(word)?|secret|token|authorization|cookie|sig/i` replaced by `"***"`;
- Error values logged as `{ name, message, stack }`, redacted.

**Moved to the logger** (the rest of the codebase keeps `console.*` for now):
- the api-server: a request log of method, path without the query string, status, duration and client IP, at
  `info`; `/healthz` and `/readyz` at `debug`;
- the job runner (`claimed`, `done`, `retry`, `failed`, `lost the lease`, `reaped`);
- the worker startup and stop;
- the new watchdog and error hook;
- the website-checks and recurring sweeps.

### 2.3 The stuck-job watchdog

**Progress outside the worker's memory.** `jobs` gains `progress_at timestamptz`, written by `ctx.progress()` at most
every 15 s and by claim (= `started_at`).

**The checks.** Every 60 s each worker runs `watchJobs(queue)` and logs at `warn`, once per job per hour (deduped in
memory):
- **backlog:** a `queued` job whose `run_after` is more than 10 minutes in the past, with type, age and lane;
- **silent:** a `running` job whose `progress_at` is older than half its policy's `stuckMs`, and still holding a live
  lease. The runner's own stuck check acts at `stuckMs`; this is the early warning.
- **dead workers:** worker rows older than 2 minutes while jobs of this queue are `running` under that worker's id.

**No worker at all.** The api-server cannot run a timer by design. Instead, `/readyz` reports `worker` and `queue`
failing, and the ops Queue view shows it.

### 2.4 The error hook

`reportError(err, context)` (`@robot/api/errors`) logs at `error` through the logger.

**Where it reports from.** The api-server reports through `ERROR_REPORT_URL`; the worker reports to the same URL.
- the api-server: Hono `onError` (500 answers), tRPC `onError` for `INTERNAL_SERVER_ERROR`, `unhandledRejection` and
  `uncaughtException`;
- the worker: a job's terminal failure, `unhandledRejection` and `uncaughtException`.

**The POST.** When `ERROR_REPORT_URL` is set it POSTs `{ t, service: 'api-server'|'worker', level: 'error', message,
stack, context, version, host }` as JSON:
- redacted;
- 5 s timeout;
- fire-and-forget, never throwing;
- at most 30 a minute per process, with extra reports dropped and counted in the next one;
- `ERROR_REPORT_TOKEN` sent as `Authorization: Bearer <token>` when set.

This is a generic hook: a Sentry or Logtail ingestion endpoint, or our own receiver. An `uncaughtException` still exits
the process after reporting (best-effort flush, 2 s).

### 2.5 Ops: Queue

`/ops/queue` (operators only, `ops.queue`), refreshed every 15 s, shows:
- **Workers:** each worker row with id, queue, version, beat age (red past 2 minutes), browsers, lanes and switches.
- **Jobs by type and status:** counts, the oldest queued age and the longest-running age.
- **Attention:** the backlog, silent and dead-worker items from §2.3, each with its type, age, the website or run it
  belongs to (linked), and the last error.
- **Recent failures:** the last 20 failed jobs with type, attempts, error (redacted) and finished time.

### 2.6 What a customer sees

Nothing changes for customers. `/readyz` tells an anonymous caller only status names and booleans: no job details, no
ids, no hosts.

## 3. Safety properties

1. No log line, error report or ops view carries a credential or secret. A redaction test runs over every logger and
   reporter path.
2. Monitoring never changes a job's outcome. The watchdog only logs; the heartbeat and `progress_at` writes are
   best-effort and never fail a job.
3. `/readyz` reveals nothing beyond check names and their state.
4. The error hook can never take a process down or flood a receiver.

## 4. Testing

- **Unit:**
  - the logger (formats, levels, redaction of keys, URLs and errors);
  - `reportError` (POST shape, token, timeout, rate limit, never throwing);
  - the watchdog's queries with seeded rows (backlog, silent, dead worker, dedupe).
- **API and server:**
  - `/readyz` with each check failing;
  - the request log (no query strings, IP);
  - Hono `onError` reporting;
  - the `ops.queue` shape and operator-only access;
  - the classification table entry for `ops.queue`.
- **Worker:**
  - heartbeat upsert, refresh and delete on stop;
  - `WORKER_HEALTH_PORT` answering 200, then 503 while stopping;
  - `progress_at` written by `ctx.progress()` (throttled);
  - a terminal failure reported.
- **App:** the `/ops/queue` view function; the staff smoke opens `/ops/queue`.
- **Compose:** `docker compose config -q` validates.
- **Live check (free):** `packages/worker/src/live-monitoring.ts` uses a throwaway database, an in-process worker with
  `WORKER_HEALTH_PORT`, a local error receiver and the api-server app in-process. It checks that:
  - `/readyz` is ok with the worker beating;
  - a job made to hang shows as silent in `ops.queue` and in a watchdog warn line;
  - a job made to throw reaches the receiver once, redacted;
  - stopping the worker turns `/readyz` to 503 (`worker`) within 2 minutes;
  - the log lines parse as JSON with `LOG_FORMAT=json`.

## 5. Not in this spec

- Metrics (Prometheus) and dashboards.
- Alerting (paging, email to staff).
- Moving every `console.*` call to the logger.
- Log shipping.
- Tracing.
- A customer status page.
- Turning `WEBSITE_CHECKS` on in Marko's servers and reviewing a week of checks (Needs Marko; this branch adds what
  that review reads: the watchdog lines and the Queue view).
