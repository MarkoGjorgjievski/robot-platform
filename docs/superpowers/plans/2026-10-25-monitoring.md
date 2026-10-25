# Monitoring basics — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the platform's health, stuck work and errors visible: a worker heartbeat and `/readyz`, health endpoints for every service, structured redacted logs on the paths that matter, a stuck-job watchdog, an error-reporting hook, and an ops Queue view — so a week of local scheduled checks can be reviewed.

**Architecture:** `@robot/db` gains a `workers` table, `jobs.progress_at` (migration `0025`, additive) and `migrationCount()`. `@robot/api` gains `src/monitoring/`: `redact.ts` + `log.ts` (`@robot/api/log`: `createLog(scope)`, `LOG_FORMAT` / `LOG_LEVEL`), `version.ts` + `errors.ts` (`@robot/api/errors`: `reportError`, rate-limited POST to `ERROR_REPORT_URL`, process handlers), `heartbeat.ts`, `attention.ts` (backlog / silent / dead-worker queries), `watchdog.ts`, `readiness.ts` and `queue-view.ts` (`@robot/api/monitoring`). The job runner writes `progress_at` (throttled), logs through the logger and reports terminal faults; `ops.queue` serves the Queue view. `@robot/api-server` gains a request log, Hono and tRPC `onError` reporting, process handlers and `GET /readyz`. `@robot/worker` beats, runs the watchdog, answers `WORKER_HEALTH_PORT` and installs process handlers. `@robot/app` gains `/ops/queue` and a `/healthz` in `serve.mjs`; Compose gains worker and app healthchecks. `packages/worker/src/live-monitoring.ts` is the free live check.

**Tech Stack:** TypeScript ESM; Drizzle + Postgres (postgres-js), drizzle-kit; Hono 4 + `@hono/trpc-server`; tRPC v11 + zod 3 + superjson; `node:http`; vitest; TanStack Start/Router + React 19, Tailwind v4 (app); Playwright (smokes); Docker Compose.

**Spec:** `docs/superpowers/specs/2026-10-25-monitoring-design.md`

**Planner's notes:** seven tasks, in order; none runs in parallel (Tasks 2–6 all touch `@robot/api`). Task 1 is the database; Task 2 the logger and redaction (everything later logs through it); Task 3 the error hook (Task 4's runner reports through it); Task 4 the heartbeat, `progress_at` and the runner's lines; Task 5 the watchdog, `/readyz` and the request log (consumes Task 4's `DEAD_WORKER_MS`, `jobs.progress_at`); Task 6 `ops.queue` and the Queue view (consumes Task 5's `findAttention`); Task 7 Compose, the live check, docs and the gate. Line numbers were read on `feat/monitoring` @ `a27d2928` and are approximate — find code by the quoted text. Work only in `C:\Users\Marko\Documents\projects\robot-platform-monitoring` (bash: `/c/Users/Marko/Documents/projects/robot-platform-monitoring`, written `$W` below — set `W=/c/Users/Marko/Documents/projects/robot-platform-monitoring` in each shell). Decisions the spec left open are under "Settled here" at the end; every task's reviewer reads them.

## Global Constraints

- **The heartbeat** (spec §2.1, verbatim): a `workers` table holds `id` (the worker id, e.g. `host:pid:rand`), `queue`, `started_at`, `beat_at`, `version` (the git sha if known, else the package version), `browsers` (in use / max), `lanes` (jsonb: running per lane) and `website_checks` / `recurring_runs` (booleans). The worker upserts its row every 30 s and deletes it on a clean stop. A row whose `beat_at` is older than 2 minutes is a dead worker; rows older than 1 day are purged by any worker.
- **Readiness** (§2.1, verbatim): the api-server gains `GET /readyz` (no auth). It answers 200 `{ status: 'ok', checks }` or 503 with the failing checks. `db`: `SELECT 1` within 2 s. `migrations`: the count of rows in `drizzle.__drizzle_migrations` is at least the number of migration files bundled in `@robot/db`. `worker`: at least one worker row for this api-server's `JOB_QUEUE` with `beat_at` within 2 minutes. `queue`: no `queued` job on this queue whose `run_after` is more than 10 minutes in the past (a backlog nobody is taking — "Settled here" 1).
- **Liveness** (§2.1): `/healthz` stays pure liveness, as today. The worker gains an optional `WORKER_HEALTH_PORT`: a tiny `node:http` server on 127.0.0.1 answering `GET /healthz` with 200 while its job loop, heartbeat and lease renewal are running, and 503 while it is stopping. Compose sets it (`4001`, internal) and adds a worker healthcheck. The app's `serve.mjs` answers `GET /healthz` 200, with a Compose healthcheck too.
- **The logger** (§2.2, verbatim): `@robot/api/log` exports `createLog(scope)` returning `{ debug, info, warn, error }(message, fields?)`. `LOG_FORMAT=json`: one JSON object per line, `{ t: ISO, level, scope, msg, ...fields }`. Default `text`: `[scope] msg key=value …`, readable as today. `LOG_LEVEL` (default `info`) filters.
- **Redaction** (§2.2, verbatim): every field and message passes through `redact`: `redactProxy` and `redactSmtp` for URL userinfo; keys matching `/pass(word)?|secret|token|authorization|cookie|sig/i` replaced by `"***"`; Error values logged as `{ name, message, stack }`, redacted.
- **Moved to the logger** (§2.2, verbatim): the api-server request log of method, path without the query string, status, duration and client IP, at `info`; `/healthz` and `/readyz` at `debug`; the job runner (`claimed`, `done`, `retry`, `failed`, `lost the lease`, `reaped`); the worker startup and stop; the new watchdog and error hook; the website-checks and recurring sweeps. The rest of the codebase keeps `console.*`.
- **Progress** (§2.3, verbatim): `jobs` gains `progress_at timestamptz`, written by `ctx.progress()` at most every 15 s and by claim (= `started_at`).
- **The watchdog** (§2.3, verbatim): every 60 s each worker runs `watchJobs(queue)` and logs at `warn`, once per job per hour (deduped in memory): **backlog** — a `queued` job whose `run_after` is more than 10 minutes in the past, with type, age and lane; **silent** — a `running` job whose `progress_at` is older than half its policy's `stuckMs`, and still holding a live lease; **dead workers** — worker rows older than 2 minutes while jobs of this queue are `running` under that worker's id. The api-server runs no timer; with no worker, `/readyz` reports `worker` and `queue` failing and the ops Queue view shows it.
- **The error hook** (§2.4, verbatim): `reportError(err, context)` (`@robot/api/errors`) logs at `error` through the logger. The api-server reports from Hono `onError` (500 answers), tRPC `onError` for `INTERNAL_SERVER_ERROR`, `unhandledRejection` and `uncaughtException`; the worker from a job's terminal failure, `unhandledRejection` and `uncaughtException`. When `ERROR_REPORT_URL` is set it POSTs `{ t, service: 'api-server'|'worker', level: 'error', message, stack, context, version, host }` as JSON: redacted; 5 s timeout; fire-and-forget, never throwing; at most 30 a minute per process, with extra reports dropped and counted in the next one; `ERROR_REPORT_TOKEN` sent as `Authorization: Bearer <token>` when set. An `uncaughtException` still exits the process after reporting (best-effort flush, 2 s).
- **Ops: Queue** (§2.5, verbatim): `/ops/queue` (operators only, `ops.queue`), refreshed every 15 s, shows **Workers** (each worker row with id, queue, version, beat age — red past 2 minutes —, browsers, lanes and switches), **Jobs by type and status** (counts, the oldest queued age and the longest-running age), **Attention** (the backlog, silent and dead-worker items, each with its type, age, the website or run it belongs to — linked —, and the last error) and **Recent failures** (the last 20 failed jobs with type, attempts, error — redacted — and finished time). `ops.queue` gets its row in `packages/api/src/isolation/procedure-classes.ts` (`{ class: 'ops' }`); the procedure sweep fails otherwise.
- **What a customer sees** (§2.6): nothing changes. `/readyz` tells an anonymous caller only status names and booleans: no job details, no ids, no hosts.
- **Safety properties** (§3, verbatim): 1. No log line, error report or ops view carries a credential or secret; a redaction test runs over every logger and reporter path. 2. Monitoring never changes a job's outcome: the watchdog only logs; the heartbeat and `progress_at` writes are best-effort and never fail a job. 3. `/readyz` reveals nothing beyond check names and their state. 4. The error hook can never take a process down or flood a receiver.
- **New environment** (document in `CLAUDE.md` and `.env.example`): `LOG_FORMAT`, `LOG_LEVEL`, `ERROR_REPORT_URL`, `ERROR_REPORT_TOKEN`, `WORKER_HEALTH_PORT`. No other new variable.
- **No paid call, no real receiver:** every process this plan starts runs with `ANTHROPIC_API_KEY= JEV_SHADOW= TYPESAFE_API_KEY= SMTP_URL= DEFAULT_PROXY_URL=`; every `ERROR_REPORT_URL` is a local receiver on 127.0.0.1 (`startErrorReceiver`, Task 3) or `127.0.0.1:9` (nothing listening).
- **Marko's data and servers:** never start, stop or restart his dev servers (:3000/:4000) or his worker, never stop or recreate the `robot-platform-db` container, never write a dev-DB row outside tests (every test row lives on the test file's own `JOB_QUEUE`, a `workers` row on it, or a throwaway org it deletes). Migration `0025` is additive (a new table, a nullable column) and is applied to the dev database in Task 1; `main`'s code ignores both.
- **Tests:** Postgres is the `robot-platform-db` container (`docker start robot-platform-db` if stopped); api, api-server and worker tests get a per-file `JOB_QUEUE` automatically (their `test-setup/job-queue.ts`, which Task 4 extends to delete that queue's `workers` rows). One file at a time while working (`cd packages/<pkg> && npx vitest run <file>`); full suites serially with `npx vitest run --no-file-parallelism`. Never `pnpm -r test`.
- **Memory is tight (~2.5 GB free):** one heavy job at a time — never two vitest suites, a Chromium test, the live check, a `vite build` or the smoke pair and anything else, at once.
- **ESM:** relative imports carry `.js` in `@robot/db`, `@robot/api`, `@robot/api-server`, `@robot/worker`; none in `@robot/app`.
- **Commits:** by explicit path (`git add <paths>` then `git commit`), never `git add -A` / `git add .`; never stage `packages/app/src/routeTree.gen.ts` — except in Task 6 Step 9, which stages it with only the `/ops/queue` route's own lines ("Settled here" 15); every message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Line endings:** files in this repo are CRLF on this machine — edit with tools that keep them (the Edit tool does); new files may be LF.

## Review Focus

1. **A queue that is busy, not stuck** (`WEBSITE_CHECKS=on` queues every due website at once behind `website-check`'s `maxConcurrent: 1`; a second run waits hours behind `WORKER_RUNS=1`) — a person expects `/readyz` to stay 200 and the watchdog to stay quiet while that lane is working, and to fire only when nobody takes the lane's work. → Task 5 test "RF1: a queued job behind a busy lane is not a backlog; the same job with its lane idle is".
2. **Secrets no key names** (a Postgres URL with its password inside an error's `cause`, a signed export link's `sig=` in a message, `Authorization: Bearer …` inside a text field, the `ANTHROPIC_API_KEY` value quoted in an error) — a person expects none of them in a log line or an error report. → Task 2 test "RF2: secrets in places no key names"; Task 3 test "RF2: a report's cause chain and text fields are redacted too".
3. **A field the logger cannot serialise** (a cyclic object, a `BigInt`, a getter that throws, a function, a sink that throws) — a person expects the line to be written with placeholders, and logging never to throw into the job or request that called it. → Task 2 test "RF3: a field that cannot be serialised still writes the line, and never throws".
4. **The database blinks while a worker runs** (the heartbeat's upsert and the `progress_at` write fail for a minute) — a person expects the worker to keep running its jobs, one warn line (not one per beat), "beating again" when it is back, and no job failed because of it. → Task 4 tests "RF4: a database that fails for a while — no throw, one warn line, then beating again" and "RF4: a progress write that fails never touches the job".
5. **A `WORKER_NAME` with `_` or `%`, and two workers on one queue** (the Compose `stack-worker` beside a dev worker; `WORKER_NAME=stack_worker`) — a person expects a dead worker's jobs to be attributed to that worker only, never to a live one whose id merely matches a `LIKE` pattern, and a stopping worker to delete only its own row. → Task 5 test "RF5: worker ids with LIKE wildcards are matched exactly"; Task 4 test "a stop removes only its own row, and rows older than a day are purged".

---

### Task 1: The `workers` table, `jobs.progress_at`, migration 0025 and `migrationCount()` (`@robot/db`) — spec §2.1 "The heartbeat", §2.1 "Readiness" (`migrations`), §2.3 "Progress"

**Files:**
- Modify: `packages/db/src/schema.ts` (`jobs`, ~line 536; a new `workers` table after it)
- Create: `packages/db/src/migrations.ts`
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/src/schema.test.ts`
- Generated: `packages/db/drizzle/0025_monitoring.sql`, `packages/db/drizzle/meta/0025_snapshot.json`, `packages/db/drizzle/meta/_journal.json`

**Interfaces:**
- Consumes: nothing.
- Produces: `jobs.progressAt` — `timestamp('progress_at', { withTimezone: true })`, nullable (`Date | null`); `workers` — `{ id: string (pk, varchar 200); queue: string (varchar 64); startedAt: Date; beatAt: Date (default now); version: string | null (varchar 64); browsers: unknown (jsonb, default {}; written `{ inUse: number; max: number }`); lanes: unknown (jsonb, default {}; written `Record<Lane, number>`); websiteChecks: boolean (default false); recurringRuns: boolean (default false) }`, index `workers_queue_beat_idx (queue, beat_at)`; `migrationCount(): number` exported from `@robot/db` — the entries of `drizzle/meta/_journal.json` (26 after this task).

- [ ] **Step 1: Write the failing test**

In `packages/db/src/schema.test.ts`, add `workers, migrationCount` to the `./index.js` import, add `import { readdirSync } from 'node:fs';` at the top, and append:

```ts
describe('monitoring (spec 2026-10-25 monitoring §2.1, §2.3)', () => {
  const queue = `schema-test-mon-${Date.now()}`;
  afterEach(async () => {
    await db.delete(workers).where(eq(workers.queue, queue));
    await db.delete(jobs).where(eq(jobs.queue, queue));
  });

  it('a worker row keeps its queue, version, browsers, lanes and switches; one row per id', async () => {
    const id = `host:1:${queue}`;
    const [w] = await db.insert(workers).values({
      id, queue, startedAt: new Date(), version: 'abc1234', browsers: { inUse: 1, max: 3 },
      lanes: { interactive: 1, background: 0, runs: 0 }, websiteChecks: true, recurringRuns: false,
    }).returning();
    expect(w).toMatchObject({ id, queue, version: 'abc1234', browsers: { inUse: 1, max: 3 }, lanes: { interactive: 1, background: 0, runs: 0 }, websiteChecks: true, recurringRuns: false });
    expect(w!.beatAt).toBeInstanceOf(Date);
    await expect(db.insert(workers).values({ id, queue, startedAt: new Date() })).rejects.toThrow();
    const [bare] = await db.insert(workers).values({ id: `${id}-bare`, queue, startedAt: new Date() }).returning();
    expect(bare).toMatchObject({ version: null, browsers: {}, lanes: {}, websiteChecks: false, recurringRuns: false });
  });

  it('a job has no progress until it is claimed', async () => {
    const [j] = await db.insert(jobs).values({ queue, type: 'verify' }).returning();
    expect(j!.progressAt).toBeNull();
  });

  it('the bundled migration count is the journal’s: one entry per .sql file', () => {
    const files = readdirSync(new URL('../drizzle', import.meta.url)).filter((f) => f.endsWith('.sql'));
    expect(migrationCount()).toBe(files.length);
    expect(migrationCount()).toBeGreaterThanOrEqual(26);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd $W/packages/db && npx vitest run src/schema.test.ts -t "monitoring"`
Expected: FAIL — `workers` and `migrationCount` are not exported.

- [ ] **Step 3: The columns, the table and the count**

In `packages/db/src/schema.ts`, `jobs`, after `startedAt: timestamp('started_at', { withTimezone: true }),` add:

```ts
  // Monitoring (spec 2026-10-25 §2.3): the last sign of life outside the worker's memory — set by a claim (= started_at)
  // and by ctx.progress() at most every 15 s. The watchdog and ops' Queue read it ("silent": older than half stuckMs).
  progressAt: timestamp('progress_at', { withTimezone: true }),
```

After the `jobs` table (before `// ─── Field holds and value refreshes`), add:

```ts
// ─── Workers (2026-10-25) ───────────────────────────────────────────────────
// One row per running worker (spec 2026-10-25 monitoring §2.1): upserted every 30 s, deleted on a clean stop. A beat
// older than 2 minutes is a dead worker; rows older than a day are purged by any worker. `id` is the runner's worker
// id (`host:pid:rand`) — a job's `locked_by` is that id, '#', and a claim token.
export const workers = pgTable('workers', {
  id: varchar('id', { length: 200 }).primaryKey(),
  queue: varchar('queue', { length: 64 }).notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  beatAt: timestamp('beat_at', { withTimezone: true }).defaultNow().notNull(),
  // The git sha if known, else the package version.
  version: varchar('version', { length: 64 }),
  // { inUse, max }
  browsers: jsonb('browsers').notNull().default({}),
  // Running jobs per lane: { interactive, background, runs }
  lanes: jsonb('lanes').notNull().default({}),
  websiteChecks: boolean('website_checks').notNull().default(false),
  recurringRuns: boolean('recurring_runs').notNull().default(false),
}, (table) => [
  index('workers_queue_beat_idx').on(table.queue, table.beatAt),
]);
```

(`boolean`, `jsonb`, `index` are already imported by the file — check the `drizzle-orm/pg-core` import line and add any that is missing.)

Create `packages/db/src/migrations.ts`:

```ts
// The migrations bundled in this package (drizzle/meta/_journal.json). /readyz compares the database's applied count
// (drizzle.__drizzle_migrations) with it (spec 2026-10-25 monitoring §2.1). The Docker images carry packages/db whole.
import { readFileSync } from 'node:fs';

let cached: number | null = null;

export function migrationCount(): number {
  if (cached === null) {
    const journal = JSON.parse(readFileSync(new URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8')) as { entries: unknown[] };
    cached = journal.entries.length;
  }
  return cached;
}
```

In `packages/db/src/index.ts`, after `export * from './schema';` add `export { migrationCount } from './migrations.js';`.

- [ ] **Step 4: Generate the migration and check it is additive**

```bash
cd $W && pnpm --filter @robot/db db:generate --name monitoring
cat $W/packages/db/drizzle/0025_monitoring.sql
```

Expected: `drizzle/0025_monitoring.sql` with exactly `CREATE TABLE "workers" (…)`, `ALTER TABLE "jobs" ADD COLUMN "progress_at" timestamp with time zone`, and `CREATE INDEX "workers_queue_beat_idx" …` — nothing else (no `DROP`, no `ALTER COLUMN`, no other table). If drizzle-kit asks a rename question or writes anything else, stop and fix the schema. `_journal.json` gains `idx: 25`, tag `0025_monitoring`. (If `pnpm` is "not recognized": `npm i -g pnpm@10.30.3` — memory `windows-dev-machine-setup`.)

- [ ] **Step 5: Apply it to the dev database and check**

```bash
cd $W/packages/db && npx drizzle-kit migrate
docker exec robot-platform-db psql -U postgres -d robot_platform -tc "SELECT count(*) FROM drizzle.__drizzle_migrations"
docker exec robot-platform-db psql -U postgres -d robot_platform -tc "\d workers"
docker exec robot-platform-db psql -U postgres -d robot_platform -tc "\d jobs" | grep progress_at
```

Expected: `26`; the `workers` table with the nine columns and its index; `progress_at | timestamp with time zone`. (Additive: `main`'s running code never reads either; no dump is needed.)

- [ ] **Step 6: Run the tests, type-check**

Run: `cd $W/packages/db && npx vitest run src/schema.test.ts`, then `npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
cd $W
git add packages/db/src/schema.ts packages/db/src/migrations.ts packages/db/src/index.ts packages/db/src/schema.test.ts packages/db/drizzle/0025_monitoring.sql packages/db/drizzle/meta/0025_snapshot.json packages/db/drizzle/meta/_journal.json
git commit -m "feat(db): workers heartbeat table, jobs.progress_at, migrationCount (migration 0025)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The logger and redaction (`@robot/api/log`) — spec §2.2 "The logger", "Formats", "Redaction", §3.1

**Files:**
- Create: `packages/api/src/monitoring/redact.ts`, `packages/api/src/monitoring/log.ts`
- Test: `packages/api/src/monitoring/log.test.ts`
- Modify: `packages/api/package.json` (exports `./log`)
- Modify: `packages/api/vitest.config.ts`, `packages/api-server/vitest.config.ts`, `packages/worker/vitest.config.ts` (quiet, local-only test env)

**Interfaces:**
- Consumes: `redactProxy(text: string): string` (`packages/api/src/proxy/proxy-url.ts`), `redactSmtp(text: string, url?: string | null): string` (`packages/api/src/email/smtp.ts`).
- Produces (`packages/api/src/monitoring/redact.ts`): `SECRET_KEY: RegExp` (`/pass(word)?|secret|token|authorization|cookie|sig/i`); `MASK = '***'`; `redactText(text: string, env?: Env): string`; `redactValue(value: unknown, env?: Env): unknown` (JSON-safe: strings redacted, keys masked, `Error` → `{ name, message, stack, cause? }`, `Date` → ISO, `bigint` → string, functions/symbols → `undefined`, cycles → `'[circular]'`, depth > 6 → `'[too deep]'`, a throwing getter → `'[unreadable]'`, arrays capped at 50).
- Produces (`packages/api/src/monitoring/log.ts`, exported as `@robot/api/log`): `type LogLevel = 'debug' | 'info' | 'warn' | 'error'`; `type LogFields = Record<string, unknown>`; `type Log = Record<LogLevel, (message: string, fields?: LogFields) => void>`; `type LogSink = (line: string, level: LogLevel) => void`; `createLog(scope: string, opts?: { sink?: LogSink; env?: Record<string, string | undefined> }): Log` (env read at each call; default sink: `console.error` for warn/error, `console.log` otherwise; never throws); `formatLine(level, scope, message, fields, format: 'json' | 'text', now?: Date, env?): string`; `logLevel(env?): LogLevel`; `logFormat(env?): 'json' | 'text'`.

- [ ] **Step 1: Write the failing tests**

`packages/api/src/monitoring/log.test.ts`:

```ts
// Spec 2026-10-25 monitoring §2.2 and §3.1: formats, levels, and redaction of keys, URLs and errors.
import { describe, expect, it } from 'vitest';
import { createLog, formatLine, type LogLevel } from './log.js';

const T = new Date('2026-10-25T12:00:00.000Z');
function capture(env: Record<string, string>) {
  const lines: Array<{ line: string; level: LogLevel }> = [];
  return { lines, log: createLog('test', { env, sink: (line, level) => lines.push({ line, level }) }) };
}

describe('the logger (spec 2026-10-25 monitoring §2.2)', () => {
  it('json: one object per line — t, level, scope, msg, then the fields', () => {
    expect(formatLine('info', 'jobs', 'claimed verify j1', { jobId: 'j1', attempt: 1 }, 'json', T))
      .toBe('{"t":"2026-10-25T12:00:00.000Z","level":"info","scope":"jobs","msg":"claimed verify j1","jobId":"j1","attempt":1}');
  });

  it('json: a field named like a reserved key never overwrites it', () => {
    expect(JSON.parse(formatLine('warn', 'x', 'm', { level: 'debug', msg: 'other', t: 1, scope: 'y' }, 'json', T))).toEqual({
      t: '2026-10-25T12:00:00.000Z', level: 'warn', scope: 'x', msg: 'm', field_level: 'debug', field_msg: 'other', field_t: 1, field_scope: 'y',
    });
  });

  it('text: [scope] msg key=value, quoted when needed; warn and error say so', () => {
    expect(formatLine('info', 'jobs', 'done verify j1', { jobId: 'j1', ms: 12, note: 'two words', gone: undefined }, 'text', T))
      .toBe('[jobs] done verify j1 jobId=j1 ms=12 note="two words"');
    expect(formatLine('warn', 'watchdog', 'silent', undefined, 'text', T)).toBe('[watchdog] WARN silent');
    expect(formatLine('error', 'errors', 'boom', { o: { a: 1 } }, 'text', T)).toBe('[errors] ERROR boom o={"a":1}');
  });

  it('LOG_LEVEL filters (default info, nonsense is info); LOG_FORMAT picks the format (default text)', () => {
    const d = capture({});
    d.log.debug('hidden'); d.log.info('shown');
    expect(d.lines.map((l) => l.line)).toEqual(['[test] shown']);
    const w = capture({ LOG_LEVEL: 'warn', LOG_FORMAT: 'json' });
    w.log.info('hidden'); w.log.warn('shown'); w.log.error('also');
    expect(w.lines.map((l) => [l.level, JSON.parse(l.line).msg])).toEqual([['warn', 'shown'], ['error', 'also']]);
    const n = capture({ LOG_LEVEL: 'loud', LOG_FORMAT: 'xml' });
    n.log.debug('x'); n.log.info('y');
    expect(n.lines.map((l) => l.line)).toEqual(['[test] y']);
  });

  it('redacts secret keys at any depth, URL userinfo in the message and the fields, and errors as name/message/stack', () => {
    const { lines, log } = capture({ LOG_FORMAT: 'json' });
    const err = new Error('connect to http://proxy-user:proxy-pass@gate.test:7000 failed');
    log.error('could not reach smtp://mail-user:mail-pass@smtp.test:587', {
      password: 'pw-one', apiToken: 'tok-one', Authorization: 'bearer-one', cookie: 'robot_session=sess-one', sig: 'sig-one',
      webhookSecret: 'hook-one', nested: { deeper: { pass: 'pw-two' } }, url: 'socks5://u:socks-pass@s.test:1080', error: err,
    });
    const out = lines[0]!.line;
    for (const s of ['pw-one', 'tok-one', 'bearer-one', 'sess-one', 'sig-one', 'hook-one', 'pw-two', 'proxy-pass', 'mail-pass', 'socks-pass', 'proxy-user', 'mail-user']) {
      expect(out).not.toContain(s);
    }
    const o = JSON.parse(out);
    expect(o).toMatchObject({
      msg: 'could not reach smtp://***@smtp.test:587', password: '***', apiToken: '***', Authorization: '***', cookie: '***', sig: '***',
      webhookSecret: '***', nested: { deeper: { pass: '***' } }, url: 'socks5://***@s.test:1080',
      error: { name: 'Error', message: 'connect to http://***@gate.test:7000 failed' },
    });
    expect(o.error.stack).toContain('http://***@gate.test:7000');
  });

  it('RF2: secrets in places no key names — a Postgres URL in a cause, a signed link, a Bearer header in text, a key from the environment', () => {
    const { lines, log } = capture({ LOG_FORMAT: 'json', ANTHROPIC_API_KEY: 'sk-ant-live-0123456789' });
    const cause = new Error('password authentication failed for postgresql://robot:db-pass-9@db.test:5432/robot');
    log.error('export link failed', {
      link: 'http://localhost:4000/export/run/r1?exp=1&sig=deadbeefcafe', header: 'Authorization: Bearer abc.def.ghi',
      note: 'key sk-ant-live-0123456789 rejected', error: new Error('outer', { cause }),
    });
    const out = lines[0]!.line;
    for (const s of ['db-pass-9', 'deadbeefcafe', 'abc.def.ghi', 'sk-ant-live-0123456789']) expect(out).not.toContain(s);
    const o = JSON.parse(out);
    expect(o.error.cause.message).toBe('password authentication failed for postgresql://***@db.test:5432/robot');
    expect(o.link).toBe('http://localhost:4000/export/run/r1?exp=1&sig=***');
    expect(o.header).toBe('Authorization: Bearer ***');
    expect(o.note).toBe('key *** rejected');
  });

  it('RF3: a field that cannot be serialised still writes the line, and never throws', () => {
    const { lines, log } = capture({ LOG_FORMAT: 'json' });
    const loop: Record<string, unknown> = { name: 'loop' };
    loop.self = loop;
    const getter = Object.defineProperty({}, 'boom', { enumerable: true, get() { throw new Error('getter'); } });
    expect(() => log.warn('odd fields', { loop, big: 10n, getter, fn: () => 1 })).not.toThrow();
    const o = JSON.parse(lines[0]!.line);
    expect(o).toMatchObject({ msg: 'odd fields', loop: { name: 'loop', self: '[circular]' }, big: '10', getter: { boom: '[unreadable]' } });
    expect('fn' in o).toBe(false);
    const text = capture({});
    text.log.info('text too', { loop, big: 10n });
    expect(text.lines[0]!.line).toBe('[test] text too loop={"name":"loop","self":"[circular]"} big=10');
    const throwing = createLog('test', { env: {}, sink: () => { throw new Error('disk full'); } });
    expect(() => throwing.error('still fine')).not.toThrow();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd $W/packages/api && npx vitest run src/monitoring/log.test.ts`
Expected: FAIL — `./log.js` does not exist.

- [ ] **Step 3: Redaction**

`packages/api/src/monitoring/redact.ts`:

```ts
// What every log line and error report passes through (spec 2026-10-25 monitoring §2.2 "Redaction", §3.1): URL
// userinfo (redactProxy, redactSmtp, then any scheme), secret query parameters and Bearer/Basic tokens in text, the
// values of the known secret env variables, and keys that name a secret. Never throws; the result is JSON-safe.
import { redactProxy } from '../proxy/proxy-url.js';
import { redactSmtp } from '../email/smtp.js';

type Env = Record<string, string | undefined>;

export const SECRET_KEY = /pass(word)?|secret|token|authorization|cookie|sig/i;
export const MASK = '***';
const MAX_DEPTH = 6;
const ANY_USERINFO = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/?#]*@/gi;
const SECRET_PARAM = /\b([\w-]*(?:pass(?:word)?|secret|token|sig)[\w-]*)=([^\s&"',;]+)/gi;
const AUTH_TOKEN = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/g;
/** Their values are replaced wherever they appear (a key quoted in an error message). Shorter than 8: not a key. */
const ENV_SECRETS = ['ANTHROPIC_API_KEY', 'TYPESAFE_API_KEY', 'ERROR_REPORT_TOKEN'];

export function redactText(text: string, env: Env = process.env): string {
  let out = redactSmtp(redactProxy(text), env.SMTP_URL ?? null);
  out = out.replace(ANY_USERINFO, `$1${MASK}@`).replace(SECRET_PARAM, `$1=${MASK}`).replace(AUTH_TOKEN, `$1 ${MASK}`);
  for (const name of ENV_SECRETS) {
    const v = (env[name] ?? '').trim();
    if (v.length >= 8) out = out.split(v).join(MASK);
  }
  return out;
}

export function redactValue(value: unknown, env: Env = process.env): unknown {
  const seen = new WeakSet<object>();
  const walk = (v: unknown, depth: number): unknown => {
    if (typeof v === 'string') return redactText(v, env);
    if (typeof v === 'bigint') return v.toString();
    if (v === null || v === undefined || typeof v === 'number' || typeof v === 'boolean') return v;
    if (typeof v === 'function' || typeof v === 'symbol') return undefined;
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? 'Invalid Date' : v.toISOString();
    if (typeof v !== 'object') return String(v);
    if (seen.has(v)) return '[circular]';
    if (depth >= MAX_DEPTH) return '[too deep]';
    seen.add(v);
    if (v instanceof Error) {
      const out: Record<string, unknown> = { name: v.name, message: redactText(v.message, env), stack: v.stack ? redactText(v.stack, env) : undefined };
      const cause = (v as { cause?: unknown }).cause;
      if (cause !== undefined) out.cause = walk(cause, depth + 1);
      return out;
    }
    if (Array.isArray(v)) return v.slice(0, 50).map((x) => walk(x, depth + 1));
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v)) {
      if (SECRET_KEY.test(k)) { out[k] = MASK; continue; }
      try { out[k] = walk((v as Record<string, unknown>)[k], depth + 1); } catch { out[k] = '[unreadable]'; }
    }
    return out;
  };
  try { return walk(value, 0); } catch { return '[unreadable]'; }
}
```

- [ ] **Step 4: The logger**

`packages/api/src/monitoring/log.ts`:

```ts
// The structured logger (spec 2026-10-25 monitoring §2.2): `createLog(scope)` → { debug, info, warn, error }(message,
// fields?). LOG_FORMAT=json writes one object per line ({ t, level, scope, msg, ...fields }); the default text writes
// `[scope] msg key=value …` (warn and error with their level after the scope, so they can be found). LOG_LEVEL
// (default info) filters. Every message and field is redacted first. A log line never throws.
import { redactText, redactValue } from './redact.js';

type Env = Record<string, string | undefined>;
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFields = Record<string, unknown>;
export type Log = Record<LogLevel, (message: string, fields?: LogFields) => void>;
export type LogSink = (line: string, level: LogLevel) => void;

const RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const RESERVED = new Set(['t', 'level', 'scope', 'msg']);

export function logLevel(env: Env = process.env): LogLevel {
  const v = (env.LOG_LEVEL ?? '').trim().toLowerCase();
  return v in RANK ? (v as LogLevel) : 'info';
}

export function logFormat(env: Env = process.env): 'json' | 'text' {
  return (env.LOG_FORMAT ?? '').trim().toLowerCase() === 'json' ? 'json' : 'text';
}

const defaultSink: LogSink = (line, level) => {
  if (level === 'warn' || level === 'error') console.error(line);
  else console.log(line);
};

function safeJson(v: unknown): string {
  try { return JSON.stringify(v) ?? 'null'; } catch { return '"[unserialisable]"'; }
}

function textValue(v: unknown): string {
  if (typeof v === 'string') return /^[^\s"=]+$/.test(v) ? v : JSON.stringify(v);
  if (v === null || typeof v === 'number' || typeof v === 'boolean') return String(v);
  return safeJson(v);
}

export function formatLine(level: LogLevel, scope: string, message: string, fields: LogFields | undefined, format: 'json' | 'text', now: Date = new Date(), env: Env = process.env): string {
  const msg = redactText(String(message), env);
  const clean = (fields ? redactValue(fields, env) : {}) as LogFields;
  const entries = Object.entries(clean && typeof clean === 'object' ? clean : {}).filter(([, v]) => v !== undefined);
  if (format === 'json') {
    const out: LogFields = { t: now.toISOString(), level, scope, msg };
    for (const [k, v] of entries) out[RESERVED.has(k) ? `field_${k}` : k] = v;
    return safeJson(out);
  }
  const head = level === 'warn' || level === 'error' ? `[${scope}] ${level.toUpperCase()} ${msg}` : `[${scope}] ${msg}`;
  return entries.length ? `${head} ${entries.map(([k, v]) => `${k}=${textValue(v)}`).join(' ')}` : head;
}

export function createLog(scope: string, opts: { sink?: LogSink; env?: Env } = {}): Log {
  const write = (level: LogLevel) => (message: string, fields?: LogFields) => {
    try {
      const env = opts.env ?? process.env;
      if (RANK[level] < RANK[logLevel(env)]) return;
      (opts.sink ?? defaultSink)(formatLine(level, scope, message, fields, logFormat(env), new Date(), env), level);
    } catch { /* a log line never throws into its caller */ }
  };
  return { debug: write('debug'), info: write('info'), warn: write('warn'), error: write('error') };
}
```

In `packages/api/package.json` `exports`, after `"./jobs": "./src/jobs/index.ts",` add `"./log": "./src/monitoring/log.ts",`.

- [ ] **Step 5: Quiet, local-only test env in the three packages that run jobs**

Each of `packages/api/vitest.config.ts`, `packages/api-server/vitest.config.ts`, `packages/worker/vitest.config.ts`: extend the `env` object with `LOG_FORMAT: '', LOG_LEVEL: 'warn', ERROR_REPORT_URL: '', ERROR_REPORT_TOKEN: ''` (whatever `.env` says: no test posts an error report, and request/claim lines do not flood the output; a test that reads lines passes its own `env` to `createLog`). Add to each file's top comment: `Logs at warn and no error reports (spec 2026-10-25 monitoring), whatever .env says.`

- [ ] **Step 6: Run the tests, type-check**

Run: `cd $W/packages/api && npx vitest run src/monitoring/log.test.ts`, then `npx tsc --noEmit`
Expected: PASS (7 tests), no type errors.

- [ ] **Step 7: Commit**

```bash
cd $W
git add packages/api/src/monitoring/redact.ts packages/api/src/monitoring/log.ts packages/api/src/monitoring/log.test.ts packages/api/package.json packages/api/vitest.config.ts packages/api-server/vitest.config.ts packages/worker/vitest.config.ts
git commit -m "feat(api): structured, redacted logger (@robot/api/log) — LOG_FORMAT, LOG_LEVEL

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The error hook (`@robot/api/errors`) and its api-server and process sources — spec §2.4, §3.1, §3.4, §4 "Unit" (`reportError`), §4 "API and server" (Hono `onError`)

**Files:**
- Create: `packages/api/src/monitoring/version.ts`, `packages/api/src/monitoring/errors.ts`, `packages/api/src/monitoring/fixtures/crash.ts`, `packages/api/src/test-helpers/error-receiver.ts`
- Test: `packages/api/src/monitoring/errors.test.ts`
- Modify: `packages/api/package.json` (exports `./errors`, `./test-helpers/error-receiver`)
- Modify: `packages/api-server/src/app.ts` (`AppDeps.reportError`, `AppDeps.router`, `app.onError`, tRPC `onError`), `packages/api-server/src/index.ts`, `packages/api-server/src/app.test.ts`
- Modify: `packages/worker/src/index.ts` (process handlers)

**Interfaces:**
- Consumes: `createLog`, `type Log` (Task 2); `redactText`, `redactValue` (Task 2).
- Produces (`packages/api/src/monitoring/version.ts`): `serviceVersion(): string` — the git short sha (`git rev-parse --short HEAD`, once, 2 s), else `@robot/api`'s package.json version, else `'unknown'`.
- Produces (`packages/api/src/monitoring/errors.ts`, exported as `@robot/api/errors`): `type ErrorReport = { t: string; service: string; level: 'error'; message: string; stack: string | null; context: Record<string, unknown>; version: string; host: string; dropped?: number }`; `REPORTS_PER_MINUTE = 30`; `REPORT_TIMEOUT_MS = 5000`; `FLUSH_ON_EXIT_MS = 2000`; `createErrorReporter(opts: { service: () => string; env?: () => Record<string, string | undefined>; fetch?: typeof fetch; now?: () => number; log?: Log; perMinute?: number; timeoutMs?: number }): { report(err: unknown, context?: Record<string, unknown>): Promise<void>; flush(ms: number): Promise<void> }` (`report` never rejects); `configureErrorReports(opts: { service: 'api-server' | 'worker' }): void`; `reportError(err: unknown, context?: Record<string, unknown>): Promise<void>`; `flushErrorReports(ms?: number): Promise<void>`; `installProcessHandlers(service: 'api-server' | 'worker'): void` (once per process).
- Produces (`packages/api/src/test-helpers/error-receiver.ts`, exported as `@robot/api/test-helpers/error-receiver`): `type ReceivedReport = { body: any; raw: string; headers: IncomingHttpHeaders }`; `startErrorReceiver(opts?: { status?: number; delayMs?: number }): Promise<{ url: string; reports: ReceivedReport[]; close(): Promise<void> }>` (a report is recorded when its body has arrived, before it is answered).
- Produces (`@robot/api-server` `createApp`): `AppDeps` gains `reportError: (err: unknown, context: Record<string, unknown>) => unknown` (default `reportError`) and `router: AnyTRPCRouter` (default `appRouter`; tests only).

- [ ] **Step 1: Write the failing tests**

`packages/api/src/monitoring/fixtures/crash.ts`:

```ts
// Spawned by errors.test.ts: installs the process handlers, then throws (or rejects) once.
import { installProcessHandlers } from '../errors.js';

installProcessHandlers('worker');
if (process.argv[2] === 'reject') {
  void Promise.reject(new Error('rejected: postgresql://robot:fixture-secret@db.test/robot'));
  setTimeout(() => process.exit(0), 1500);
} else {
  setTimeout(() => { throw new Error('crashed: http://u:fixture-secret@gate.test:7000'); }, 10);
}
```

`packages/api/src/monitoring/errors.test.ts`:

```ts
// Spec 2026-10-25 monitoring §2.4, §3.4, §4 "Unit": the POST's shape, the token, the timeout, the rate limit, never throwing.
import { afterEach, describe, expect, it } from 'vitest';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createErrorReporter, REPORTS_PER_MINUTE } from './errors.js';
import { createLog, type LogLevel } from './log.js';
import { startErrorReceiver } from '../test-helpers/error-receiver.js';

type Receiver = Awaited<ReturnType<typeof startErrorReceiver>>;
let receivers: Receiver[] = [];
afterEach(async () => { await Promise.all(receivers.map((r) => r.close())); receivers = []; });
const receiver = async (o: { status?: number; delayMs?: number } = {}) => { const r = await startErrorReceiver(o); receivers.push(r); return r; };
const quiet = () => {
  const lines: Array<{ line: string; level: LogLevel }> = [];
  return { lines, log: createLog('errors', { env: { LOG_FORMAT: 'json' }, sink: (line, level) => lines.push({ line, level }) }) };
};

describe('reportError (spec 2026-10-25 monitoring §2.4)', () => {
  it('POSTs one redacted report with the service, version, host and the Bearer token, and logs it at error', async () => {
    const r = await receiver();
    const { lines, log } = quiet();
    const rep = createErrorReporter({ service: () => 'worker', env: () => ({ ERROR_REPORT_URL: r.url, ERROR_REPORT_TOKEN: 'report-token-1' }), log });
    await rep.report(new Error('lost http://u:rep-pass@gate.test:7000'), { jobId: 'j1', token: 'ctx-token', url: 'smtp://m:mail-pass@smtp.test:25' });
    expect(r.reports).toHaveLength(1);
    const { body, headers, raw } = r.reports[0]!;
    expect(headers['content-type']).toContain('application/json');
    expect(headers.authorization).toBe('Bearer report-token-1');
    expect(Object.keys(body).sort()).toEqual(['context', 'host', 'level', 'message', 'service', 'stack', 't', 'version']);
    expect(body).toMatchObject({
      service: 'worker', level: 'error', message: 'lost http://***@gate.test:7000', host: os.hostname(),
      context: { jobId: 'j1', token: '***', url: 'smtp://***@smtp.test:25' },
    });
    expect(typeof body.version).toBe('string');
    expect(body.version.length).toBeGreaterThan(0);
    expect(new Date(body.t).toISOString()).toBe(body.t);
    expect(body.stack).toContain('http://***@gate.test:7000');
    expect(lines).toHaveLength(1);
    expect(lines[0]!.level).toBe('error');
    for (const s of ['rep-pass', 'ctx-token', 'mail-pass', 'report-token-1']) {
      expect(raw).not.toContain(s);
      expect(lines[0]!.line).not.toContain(s);
    }
  });

  it('RF2: a report’s cause chain and text fields are redacted too', async () => {
    const r = await receiver();
    const rep = createErrorReporter({ service: () => 'api-server', env: () => ({ ERROR_REPORT_URL: r.url }), log: quiet().log });
    const cause = new Error('auth failed for postgresql://robot:cause-pass@db.test:5432/robot');
    await rep.report(new Error('outer', { cause }), { link: '/export/run/r1?sig=cafebabe1234', header: 'Bearer zzz.yyy' });
    expect(r.reports[0]!.raw).not.toMatch(/cause-pass|cafebabe1234|zzz\.yyy/);
  });

  it('no token: no Authorization header; no URL: logged, nothing sent', async () => {
    const r = await receiver();
    await createErrorReporter({ service: () => 'worker', env: () => ({ ERROR_REPORT_URL: r.url }), log: quiet().log }).report(new Error('x'));
    expect(r.reports[0]!.headers.authorization).toBeUndefined();
    const { lines, log } = quiet();
    let called = 0;
    await createErrorReporter({ service: () => 'worker', env: () => ({}), fetch: (async () => { called++; return new Response(null); }) as typeof fetch, log }).report(new Error('only logged'));
    expect(called).toBe(0);
    expect(JSON.parse(lines[0]!.line)).toMatchObject({ level: 'error', scope: 'errors', msg: 'only logged' });
  });

  it('a receiver that hangs, answers 500, or is not there: report resolves within the timeout, warns, never throws', async () => {
    const slow = await receiver({ delayMs: 10_000 });
    const a = quiet();
    const t0 = Date.now();
    await createErrorReporter({ service: () => 'worker', env: () => ({ ERROR_REPORT_URL: slow.url }), log: a.log, timeoutMs: 200 }).report(new Error('slow'));
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(a.lines.some((l) => l.level === 'warn')).toBe(true);
    const failing = await receiver({ status: 500 });
    const b = quiet();
    await createErrorReporter({ service: () => 'worker', env: () => ({ ERROR_REPORT_URL: failing.url }), log: b.log }).report(new Error('500'));
    expect(b.lines.some((l) => l.level === 'warn' && l.line.includes('500'))).toBe(true);
    const gone = await startErrorReceiver();
    await gone.close();
    await expect(createErrorReporter({ service: () => 'worker', env: () => ({ ERROR_REPORT_URL: gone.url }), log: quiet().log }).report(new Error('gone'))).resolves.toBeUndefined();
  });

  it('at most 30 a minute; the rest are dropped and counted in the next one', async () => {
    const r = await receiver();
    let now = 1_000_000;
    const rep = createErrorReporter({ service: () => 'api-server', env: () => ({ ERROR_REPORT_URL: r.url }), now: () => now, log: quiet().log });
    await Promise.all(Array.from({ length: 35 }, (_, i) => rep.report(new Error(`e${i}`))));
    expect(r.reports).toHaveLength(REPORTS_PER_MINUTE);
    expect(r.reports.every((x) => x.body.dropped === undefined)).toBe(true);
    now += 60_001;
    await rep.report(new Error('after'));
    expect(r.reports).toHaveLength(31);
    expect(r.reports[30]!.body).toMatchObject({ message: 'after', dropped: 5 });
  });

  it('never throws, whatever it is given', async () => {
    const rep = createErrorReporter({
      service: () => 'worker', env: () => ({ ERROR_REPORT_URL: 'http://127.0.0.1:9/x' }),
      fetch: (() => { throw new Error('sync'); }) as unknown as typeof fetch, log: quiet().log,
    });
    const odd = { toString() { throw new Error('no'); } };
    for (const v of [undefined, null, 'plain string', 42, odd, Object.create(null)]) await expect(rep.report(v)).resolves.toBeUndefined();
  });
});

describe('process handlers (spec 2026-10-25 monitoring §2.4)', () => {
  const fixture = fileURLToPath(new URL('./fixtures/crash.ts', import.meta.url));
  const pkg = fileURLToPath(new URL('../..', import.meta.url));
  const run = (mode: string, url: string) => new Promise<number | null>((resolve) => {
    const child = spawn(process.execPath, ['--import', 'tsx', fixture, mode], { cwd: pkg, stdio: 'ignore', env: { ...process.env, ERROR_REPORT_URL: url, LOG_LEVEL: 'error' } });
    child.once('exit', (code) => resolve(code));
  });

  it('an uncaught exception is reported, redacted, and then the process exits 1', async () => {
    const r = await receiver();
    expect(await run('throw', r.url)).toBe(1);
    expect(r.reports).toHaveLength(1);
    expect(r.reports[0]!.body).toMatchObject({ service: 'worker', context: { origin: 'uncaughtException' } });
    expect(r.reports[0]!.raw).not.toContain('fixture-secret');
  }, 30_000);

  it('an unhandled rejection is reported and the process goes on', async () => {
    const r = await receiver();
    expect(await run('reject', r.url)).toBe(0);
    expect(r.reports).toHaveLength(1);
    expect(r.reports[0]!.body).toMatchObject({ service: 'worker', context: { origin: 'unhandledRejection' } });
    expect(r.reports[0]!.raw).not.toContain('fixture-secret');
  }, 30_000);
});
```

In `packages/api-server/src/app.test.ts`, add `import { initTRPC, TRPCError } from '@trpc/server';` and append:

```ts
describe('errors (spec 2026-10-25 monitoring §2.4)', () => {
  it('a route that throws answers 500 with no detail, and is reported once with its method and path only', async () => {
    const seen: Array<[unknown, Record<string, unknown>]> = [];
    const app = createApp({ reportError: (err, ctx) => { seen.push([err, ctx]); } });
    app.get('/boom', () => { throw new Error('boom at http://u:route-secret@db.test:5432'); });
    const res = await app.request('/boom?token=abc');
    expect(res.status).toBe(500);
    expect(await res.text()).toBe('{"error":"Internal error"}');
    expect(seen).toHaveLength(1);
    expect((seen[0]![0] as Error).message).toContain('boom');
    expect(seen[0]![1]).toEqual({ method: 'GET', path: '/boom' });
  });

  it('tRPC reports INTERNAL_SERVER_ERROR with its path and type, never its input; a refusal is not reported', async () => {
    const t = initTRPC.create();
    const router = t.router({
      broken: t.procedure.query(() => { throw new Error('db exploded'); }),
      refused: t.procedure.query(() => { throw new TRPCError({ code: 'FORBIDDEN', message: 'no' }); }),
    });
    const seen: Array<[unknown, Record<string, unknown>]> = [];
    const app = createApp({ router, reportError: (err, ctx) => { seen.push([err, ctx]); } });
    expect((await app.request('/trpc/broken?input=%7B%22password%22%3A%22x%22%7D')).status).toBe(500);
    expect((await app.request('/trpc/refused')).status).toBe(403);
    expect(seen).toHaveLength(1);
    expect((seen[0]![0] as Error).message).toBe('db exploded');
    expect(seen[0]![1]).toEqual({ path: 'broken', type: 'query' });
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd $W/packages/api && npx vitest run src/monitoring/errors.test.ts`, then `cd $W/packages/api-server && npx vitest run src/app.test.ts -t "errors"`
Expected: FAIL — `./errors.js` and the receiver do not exist; `createApp` takes no `reportError` / `router`, and a thrown route answers Hono's default text.

- [ ] **Step 3: The version and the receiver**

`packages/api/src/monitoring/version.ts`:

```ts
// What a heartbeat and an error report say they run (spec 2026-10-25 monitoring §2.1): the git short sha when a
// checkout is there, else @robot/api's package version (the Docker images carry no .git). Read once.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let cached: string | null = null;

export function serviceVersion(): string {
  if (cached !== null) return cached;
  try {
    const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: fileURLToPath(new URL('.', import.meta.url)), timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
    if (/^[0-9a-f]{7,40}$/.test(sha)) return (cached = sha);
  } catch { /* no git here: the package version */ }
  try {
    cached = String((JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version?: string }).version ?? 'unknown');
  } catch { cached = 'unknown'; }
  return cached;
}
```

`packages/api/src/test-helpers/error-receiver.ts`:

```ts
// A local error receiver for tests and the monitoring live check (spec 2026-10-25 §4): records every POST (body,
// raw text, headers) as soon as its body has arrived, then answers `status` (default 204), after `delayMs` if given.
import { createServer, type IncomingHttpHeaders } from 'node:http';

export type ReceivedReport = { body: any; raw: string; headers: IncomingHttpHeaders };

export async function startErrorReceiver(opts: { status?: number; delayMs?: number } = {}): Promise<{ url: string; reports: ReceivedReport[]; close(): Promise<void> }> {
  const reports: ReceivedReport[] = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => { raw += chunk; });
    req.on('end', () => {
      let body: unknown = null;
      try { body = JSON.parse(raw); } catch { /* kept raw */ }
      reports.push({ body, raw, headers: req.headers });
      const answer = () => { if (!res.writableEnded) { res.writeHead(opts.status ?? 204); res.end(); } };
      if (opts.delayMs) setTimeout(answer, opts.delayMs).unref(); else answer();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${port}/report`,
    reports,
    close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}
```

- [ ] **Step 4: The reporter**

`packages/api/src/monitoring/errors.ts`:

```ts
// The error hook (spec 2026-10-25 monitoring §2.4): `reportError(err, context)` logs at error and, with
// ERROR_REPORT_URL set, POSTs one redacted JSON report — 5 s timeout, fire-and-forget, never throwing, at most 30 a
// minute per process (the rest dropped and counted in the next one), ERROR_REPORT_TOKEN as a Bearer header. A generic
// hook: a Sentry or Logtail ingestion endpoint, or our own receiver. Env is read at each report.
import os from 'node:os';
import { createLog, type Log } from './log.js';
import { redactText, redactValue } from './redact.js';
import { serviceVersion } from './version.js';

type Env = Record<string, string | undefined>;
export type ErrorReport = {
  t: string; service: string; level: 'error'; message: string; stack: string | null;
  context: Record<string, unknown>; version: string; host: string; dropped?: number;
};
export type ErrorReporter = { report(err: unknown, context?: Record<string, unknown>): Promise<void>; flush(ms: number): Promise<void> };

export const REPORTS_PER_MINUTE = 30;
export const REPORT_TIMEOUT_MS = 5000;
export const FLUSH_ON_EXIT_MS = 2000;
const MAX_MESSAGE = 2000;
const MAX_STACK = 8000;

function asError(err: unknown): Error {
  if (err instanceof Error) return err;
  let text: string;
  try { text = typeof err === 'string' ? err : JSON.stringify(err) ?? String(err); } catch {
    try { text = String(err); } catch { text = '[unprintable]'; }
  }
  return new Error(text);
}

export function createErrorReporter(opts: {
  service: () => string; env?: () => Env; fetch?: typeof fetch; now?: () => number; log?: Log; perMinute?: number; timeoutMs?: number;
}): ErrorReporter {
  const log = opts.log ?? createLog('errors');
  const now = opts.now ?? Date.now;
  const sent: number[] = [];
  let dropped = 0;
  const inFlight = new Set<Promise<void>>();
  return {
    report(err, context = {}) {
      try {
        const e = asError(err);
        const message = redactText(e.message).slice(0, MAX_MESSAGE);
        const ctx = (redactValue(context) ?? {}) as Record<string, unknown>;
        log.error(message, { ...ctx, error: e });
        const env = (opts.env ?? (() => process.env))();
        const url = (env.ERROR_REPORT_URL ?? '').trim();
        if (!url) return Promise.resolve();
        const at = now();
        while (sent.length > 0 && at - sent[0]! >= 60_000) sent.shift();
        if (sent.length >= (opts.perMinute ?? REPORTS_PER_MINUTE)) { dropped++; return Promise.resolve(); }
        sent.push(at);
        const body: ErrorReport = {
          t: new Date(at).toISOString(), service: opts.service(), level: 'error', message,
          stack: e.stack ? redactText(e.stack).slice(0, MAX_STACK) : null, context: ctx, version: serviceVersion(), host: os.hostname(),
          ...(dropped > 0 ? { dropped } : {}),
        };
        dropped = 0;
        const token = (env.ERROR_REPORT_TOKEN ?? '').trim();
        const p = (opts.fetch ?? fetch)(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(opts.timeoutMs ?? REPORT_TIMEOUT_MS),
        }).then(
          (res) => { void res.body?.cancel().catch(() => {}); if (!res.ok) log.warn(`error report answered ${res.status}`); },
          (postErr: unknown) => log.warn('error report could not be sent', { reason: postErr instanceof Error ? postErr.message : String(postErr) }),
        ).catch(() => {});
        inFlight.add(p);
        void p.finally(() => inFlight.delete(p));
        return p;
      } catch {
        return Promise.resolve();
      }
    },
    async flush(ms) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([Promise.allSettled([...inFlight]), new Promise((r) => { timer = setTimeout(r, ms); })]);
      clearTimeout(timer);
    },
  };
}

let service = 'unknown';
const reporter = createErrorReporter({ service: () => service });

/** Which service this process's reports name. The worker calls it in `startWorker`; both servers via `installProcessHandlers`. */
export function configureErrorReports(opts: { service: 'api-server' | 'worker' }): void {
  service = opts.service;
}

export function reportError(err: unknown, context?: Record<string, unknown>): Promise<void> {
  return reporter.report(err, context);
}

export function flushErrorReports(ms: number = FLUSH_ON_EXIT_MS): Promise<void> {
  return reporter.flush(ms);
}

let installed = false;

/** An unhandled rejection is reported and the process goes on; an uncaught exception is reported, flushed (≤ 2 s), and the process exits 1. */
export function installProcessHandlers(name: 'api-server' | 'worker'): void {
  configureErrorReports({ service: name });
  if (installed) return;
  installed = true;
  process.on('unhandledRejection', (reason) => { void reportError(reason, { origin: 'unhandledRejection' }); });
  process.on('uncaughtException', (err) => {
    void reportError(err, { origin: 'uncaughtException' });
    void flushErrorReports(FLUSH_ON_EXIT_MS).finally(() => process.exit(1));
  });
}
```

In `packages/api/package.json` `exports`, after `"./log"` add `"./errors": "./src/monitoring/errors.ts",` and after `"./test-helpers/seed-coverage-check"` add `"./test-helpers/error-receiver": "./src/test-helpers/error-receiver.ts",`.

- [ ] **Step 5: The api-server reports, and both processes install the handlers**

`packages/api-server/src/app.ts`:
- imports: `import { HTTPException } from 'hono/http-exception';`, `import type { AnyTRPCRouter } from '@trpc/server';`, `import { reportError as defaultReportError } from '@robot/api/errors';`
- `AppDeps` gains:

```ts
  /** Spec 2026-10-25 monitoring §2.4: where a 500 and a tRPC INTERNAL_SERVER_ERROR are reported (method/path or path/type only — never input). */
  reportError: (err: unknown, context: Record<string, unknown>) => unknown;
  /** Tests only: the tRPC router mounted at /trpc (default appRouter). */
  router: AnyTRPCRouter;
```

- in `createApp`, after `const loadWebhookSecret = …`: `const report = deps.reportError ?? defaultReportError;`, and right after `const app = new Hono();`:

```ts
  // Spec 2026-10-25 monitoring §2.4: an exception a route did not handle is a 500 with no detail, reported once.
  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    void Promise.resolve(report(err, { method: c.req.method, path: c.req.path })).catch(() => {});
    return c.json({ error: 'Internal error' }, 500);
  });
```

- in `trpcServer({ … })`: `router: (deps.router ?? appRouter) as typeof appRouter,` and add:

```ts
      // Spec 2026-10-25 monitoring §2.4: only a fault — never a refusal, never the input.
      onError: ({ error, path, type }) => {
        if (error.code !== 'INTERNAL_SERVER_ERROR') return;
        void Promise.resolve(report(error.cause ?? error, { path: path ?? null, type })).catch(() => {});
      },
```

`packages/api-server/src/index.ts`, right after the `.env` `try { loadEnvFile(…) } catch {…}` block:

```ts
// Spec 2026-10-25 monitoring §2.4: an unhandled rejection is reported; an uncaught exception is reported, then exits 1.
const { installProcessHandlers } = await import('@robot/api/errors');
installProcessHandlers('api-server');
```

`packages/worker/src/index.ts`: after its `.env` block add the same two lines with `installProcessHandlers('worker');`, and delete `process.on('unhandledRejection', (err) => console.error('[worker] unhandled rejection:', err));`.

- [ ] **Step 6: Run the tests, type-check**

Run: `cd $W/packages/api && npx vitest run src/monitoring/errors.test.ts src/monitoring/log.test.ts`, then `npx tsc --noEmit`; `cd $W/packages/api-server && npx vitest run src/app.test.ts`, then `npx tsc --noEmit`; `cd $W/packages/worker && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
cd $W
git add packages/api/src/monitoring/version.ts packages/api/src/monitoring/errors.ts packages/api/src/monitoring/errors.test.ts packages/api/src/monitoring/fixtures/crash.ts packages/api/src/test-helpers/error-receiver.ts packages/api/package.json packages/api-server/src/app.ts packages/api-server/src/index.ts packages/api-server/src/app.test.ts packages/worker/src/index.ts
git commit -m "feat(api): error hook — reportError POSTs redacted, rate-limited reports; api-server onError and process handlers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The worker heartbeat, `WORKER_HEALTH_PORT`, `progress_at`, and the runner's lines to the logger — spec §2.1 "The heartbeat", "Liveness", §2.2 "Moved to the logger", §2.3 "Progress", §2.4 (the worker's terminal failures), §3.2, §4 "Worker"

**Files:**
- Create: `packages/api/src/monitoring/heartbeat.ts`, `packages/api/src/monitoring/index.ts`
- Test: `packages/api/src/monitoring/heartbeat.test.ts`
- Modify: `packages/api/package.json` (exports `./monitoring`)
- Modify: `packages/api/src/jobs/queue.ts` (`claimJob` sets `progress_at`; `markProgress`), `packages/api/src/jobs/queue.test.ts`
- Modify: `packages/api/src/jobs/runner.ts` (throttled `progress_at`, `lanes()`, levels, `report`), `packages/api/src/jobs/runner.test.ts`
- Modify: `packages/api/src/jobs/test-jobs.ts` (`TEST_JOB_POLICIES`, `test-hang`, `test-throw`)
- Modify: `packages/api/src/verify/website-checks.ts`, `packages/api/src/recurring/sweep.ts` (their lines to the logger)
- Modify: `packages/api/src/test-setup/job-queue.ts`, `packages/api-server/src/test-setup/job-queue.ts`, `packages/worker/src/test-setup/job-queue.ts` (delete the file's `workers` rows too)
- Create: `packages/worker/src/health.ts`, `packages/worker/src/health.test.ts`, `packages/worker/src/monitoring.test.ts`
- Modify: `packages/worker/src/config.ts`, `packages/worker/src/config.test.ts`, `packages/worker/src/worker.ts`, `packages/worker/src/index.ts`

**Interfaces:**
- Consumes: `workers`, `jobs.progressAt` (Task 1); `createLog`, `type Log`, `type LogLevel`, `type LogFields` (Task 2); `reportError`, `configureErrorReports` (Task 3); `serviceVersion` (Task 3); `startErrorReceiver` (Task 3, tests).
- Produces (`packages/api/src/monitoring/heartbeat.ts`): `HEARTBEAT_MS = 30_000`; `DEAD_WORKER_MS = 120_000`; `WORKER_ROW_TTL_MS = 86_400_000`; `type WorkerState = { browsers: { inUse: number; max: number }; lanes: Record<Lane, number>; websiteChecks: boolean; recurringRuns: boolean }`; `type HeartbeatRow = { id: string; queue: string; startedAt: Date; version: string } & WorkerState`; `writeBeat(row: HeartbeatRow): Promise<void>` (upsert + purge rows older than a day); `removeWorkerRow(id: string): Promise<void>`; `type Heartbeat = { lastBeatAt(): number | null; beat(): Promise<boolean>; stop(): Promise<void> }`; `startHeartbeat(opts: { workerId: string; queue: string; version: string; state: () => WorkerState; everyMs?: number; log?: Log; write?: (row: HeartbeatRow) => Promise<void>; remove?: (id: string) => Promise<void> }): Heartbeat` (beats at once, then every `everyMs`; never throws).
- Produces (`@robot/api/monitoring`, `packages/api/src/monitoring/index.ts`): re-exports `startHeartbeat`, `DEAD_WORKER_MS`, `HEARTBEAT_MS`, `type Heartbeat`, `type WorkerState`, `serviceVersion` (Task 5 adds the watchdog and readiness, Task 6 the queue view).
- Produces (`packages/api/src/jobs/queue.ts`): `claimJob` also sets `progress_at = now()`; `markProgress(id: string, owner: string): Promise<void>`.
- Produces (`packages/api/src/jobs/runner.ts`): `RunnerOptions.progressWriteMs?: number` (default 15 000); `RunnerOptions.report?: (err: unknown, context: Record<string, unknown>) => unknown` (default `reportError`, but none when `log` is given and `report` is not); `JobRunner.lanes(): Record<Lane, number>`. A terminal failure that is a fault (serialized kind `error` or `unavailable`, or `trpc` `INTERNAL_SERVER_ERROR`) is reported with `{ jobId, type, attempt, queue, workerId }`; a stuck job failed for good with `new Error('stalled: no progress for <stuckMs> ms')`; a reaped one with no attempts left with `new Error('stalled: its worker stopped answering')` and `{ jobId, queue, workerId }`.
- Produces (`packages/api/src/jobs/test-jobs.ts`): `TEST_JOB_POLICIES: Record<string, JobPolicy>` for `test-sleep`, `test-sleep-once`, `test-hang` (background, 1 attempt, `stuckMs` 60 000: never calls progress, ends only when stopped) and `test-throw` (background, 1 attempt: throws `test-throw: could not reach http://live-user:live-secret@proxy.test:7000`).
- Produces (`packages/worker/src/health.ts`): `type HealthServer = { port: number; close(): Promise<void> }`; `startHealthServer(opts: { port: number; healthy: () => boolean; host?: string }): Promise<HealthServer>` (127.0.0.1; `GET|HEAD /healthz` → 200 `{"status":"ok"}` / 503 `{"status":"unavailable"}`; else 404; rejects when the port is taken).
- Produces (`packages/worker`): `WorkerConfig.healthPort: number | null` (`WORKER_HEALTH_PORT`, 0–65535; 0 = any free port; else null); `type WorkerDeps = { freeMb?: () => number; heartbeatMs?: number; watchEveryMs?: number }`; `Worker` gains `heartbeat: Heartbeat`, `health: { port: number } | null`, `healthy(): boolean`.

- [ ] **Step 1: Write the failing tests**

`packages/api/src/monitoring/heartbeat.test.ts`:

```ts
// Spec 2026-10-25 monitoring §2.1, §3.2, §4 "Worker": the heartbeat upserts, refreshes, deletes on stop, purges, and
// never throws.
import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { db, workers } from '@robot/db';
import { jobQueueName } from '../jobs/queue.js';
import { startHeartbeat, type WorkerState } from './heartbeat.js';
import { createLog, type LogLevel } from './log.js';

const q = () => jobQueueName();
const row = async (id: string) => db.query.workers.findFirst({ where: eq(workers.id, id) });
const until = async (pred: () => Promise<boolean>, ms = 10_000) => {
  const t = Date.now() + ms;
  while (!(await pred())) { if (Date.now() > t) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 25)); }
};
const state = (): WorkerState => ({ browsers: { inUse: 1, max: 3 }, lanes: { interactive: 1, background: 0, runs: 0 }, websiteChecks: false, recurringRuns: true });
const capture = () => {
  const lines: Array<{ line: string; level: LogLevel }> = [];
  return { lines, log: createLog('heartbeat', { env: { LOG_FORMAT: 'json', LOG_LEVEL: 'debug' }, sink: (line, level) => lines.push({ line, level }) }) };
};
const id = () => `hb-test:${process.pid}:${randomUUID().slice(0, 8)}`;
afterEach(async () => { await db.delete(workers).where(eq(workers.queue, q())); });

describe('the heartbeat (spec 2026-10-25 monitoring §2.1)', () => {
  it('upserts its row at once and on every beat, keeps started_at, and deletes the row on stop', async () => {
    const me = id();
    const hb = startHeartbeat({ workerId: me, queue: q(), version: 'v-test', state, everyMs: 100, log: capture().log });
    await until(async () => !!(await row(me)));
    const first = (await row(me))!;
    expect(first).toMatchObject({ queue: q(), version: 'v-test', browsers: { inUse: 1, max: 3 }, lanes: { interactive: 1, background: 0, runs: 0 }, websiteChecks: false, recurringRuns: true });
    await until(async () => (await row(me))!.beatAt.getTime() > first.beatAt.getTime());
    expect((await row(me))!.startedAt.getTime()).toBe(first.startedAt.getTime());
    expect(hb.lastBeatAt()).not.toBeNull();
    await hb.stop();
    expect(await row(me)).toBeUndefined();
  });

  it('a stop removes only its own row, and rows older than a day are purged', async () => {
    const other = id();
    await db.insert(workers).values({ id: other, queue: q(), startedAt: new Date() });
    const stale = id();
    await db.insert(workers).values({ id: stale, queue: q(), startedAt: new Date(), beatAt: sql`now() - interval '25 hours'` });
    const me = id();
    const hb = startHeartbeat({ workerId: me, queue: q(), version: 'v', state, everyMs: 60_000, log: capture().log });
    await until(async () => !!(await row(me)));
    expect(await row(stale)).toBeUndefined();
    await hb.stop();
    expect(await row(me)).toBeUndefined();
    expect(await row(other)).toBeDefined();
  });

  it('RF4: a database that fails for a while — no throw, one warn line, then beating again', async () => {
    let failures = 3;
    const { lines, log } = capture();
    const hb = startHeartbeat({
      workerId: 'rf4', queue: 'rf4', version: 'v', state, everyMs: 30, log, remove: async () => {},
      write: async () => { if (failures-- > 0) throw new Error('connect ECONNREFUSED postgresql://robot:rf4-pass@db.test:5432'); },
    });
    await until(async () => hb.lastBeatAt() !== null);
    await hb.stop();
    expect(lines.filter((l) => l.level === 'warn')).toHaveLength(1);
    expect(lines.some((l) => l.level === 'info' && l.line.includes('beating again'))).toBe(true);
    expect(lines.map((l) => l.line).join('\n')).not.toContain('rf4-pass');
  });

  it('a state that throws is a failed beat, not a crash', async () => {
    const { lines, log } = capture();
    const hb = startHeartbeat({ workerId: 'bad-state', queue: 'x', version: 'v', state: () => { throw new Error('gate gone'); }, everyMs: 30, log, write: async () => {}, remove: async () => {} });
    await new Promise((r) => setTimeout(r, 120));
    await hb.stop();
    expect(hb.lastBeatAt()).toBeNull();
    expect(lines.filter((l) => l.level === 'warn')).toHaveLength(1);
  });
});
```

In `packages/api/src/jobs/queue.test.ts` (it has `q`, `get`, `claimJob`, `enqueueJob`, `db` in scope; add `markProgress` to the `./queue.js` import), append inside the file's top-level `describe` or as a new one:

```ts
describe('progress_at (spec 2026-10-25 monitoring §2.3)', () => {
  it('a claim sets it to the claim’s start; markProgress moves it for this claim only', async () => {
    const { id } = await enqueueJob(db, { type: 'verify', payload: {} });
    const job = (await claimJob({ queue: q(), workerId: 'w-progress', types: ['verify'], leaseMs: 60_000 }))!;
    const claimed = await get(id);
    expect(claimed.progressAt).not.toBeNull();
    expect(claimed.progressAt!.getTime()).toBe(claimed.startedAt!.getTime());
    await new Promise((r) => setTimeout(r, 20));
    await markProgress(id, 'someone-else#x');
    expect((await get(id)).progressAt!.getTime()).toBe(claimed.progressAt!.getTime());
    await markProgress(id, job.lockedBy!);
    expect((await get(id)).progressAt!.getTime()).toBeGreaterThan(claimed.progressAt!.getTime());
  });
});
```

In `packages/api/src/jobs/runner.test.ts`, add `import { TRPCError } from '@trpc/server';` and `import { CaptureProblemError } from '@robot/scraper';`, and append inside `describe('startJobRunner', …)`:

```ts
  it('ctx.progress() writes progress_at at most every progressWriteMs (spec 2026-10-25 monitoring §2.3)', async () => {
    const { id } = await enqueueJob(db, { type: 'ticking', payload: {} });
    const at = async () => (await get(id)).progressAt!.getTime();
    const seen: number[] = [];
    start({ ticking: { policy: policy(), run: async (_p, ctx) => {
      seen.push(await at());
      ctx.progress();
      await new Promise((r) => setTimeout(r, 50));
      seen.push(await at());
      await new Promise((r) => setTimeout(r, 400));
      ctx.progress();
      await new Promise((r) => setTimeout(r, 150));
      seen.push(await at());
      return 'ok';
    } } }, { progressWriteMs: 300 });
    await until(async () => (await get(id)).status === 'done');
    expect(seen[1]).toBe(seen[0]);
    expect(seen[2]).toBeGreaterThan(seen[0]!);
  }, JOB_TEST_MS);

  it('RF4: a progress write that fails never touches the job', async () => {
    const { id } = await enqueueJob(db, { type: 'stolen-progress', payload: {} });
    start({ 'stolen-progress': { policy: policy(), run: async (_p, ctx) => {
      // Another claim's owner now: every progress write misses (as a failed write would), and the job still finishes.
      await db.update(jobs).set({ lockedBy: 'other:1#00000000' }).where(eq(jobs.id, ctx.jobId));
      for (let i = 0; i < 3; i++) { ctx.progress(); await new Promise((r) => setTimeout(r, 30)); }
      await db.update(jobs).set({ lockedBy: ctx.claim }).where(eq(jobs.id, ctx.jobId));
      return 'ok';
    } } }, { progressWriteMs: 0 });
    await until(async () => (await get(id)).status === 'done');
  }, JOB_TEST_MS);

  it('a terminal fault is reported once with the job’s ids and no payload; a retry, a capture problem and a refusal are not (spec 2026-10-25 monitoring §2.4)', async () => {
    const reports: Array<{ err: unknown; ctx: Record<string, unknown> }> = [];
    const report = (err: unknown, ctx: Record<string, unknown>) => { reports.push({ err, ctx }); };
    const boom = await enqueueJob(db, { type: 'boom-twice', payload: { url: 'http://u:payload-pass@x.test' }, maxAttempts: 2 });
    const blocked = await enqueueJob(db, { type: 'blocked', payload: {} });
    const refused = await enqueueJob(db, { type: 'refused', payload: {} });
    const r = start({
      'boom-twice': { policy: policy({ maxAttempts: 2 }), run: async () => { throw new Error('db went away'); } },
      blocked: { policy: policy(), run: async () => { throw new CaptureProblemError('This website turned us away.'); } },
      refused: { policy: policy(), run: async () => { throw new TRPCError({ code: 'NOT_FOUND', message: 'gone' }); } },
    }, { report, lanes: { interactive: 1, background: 3, runs: 1 } });
    await until(async () => (await Promise.all([boom.id, blocked.id, refused.id].map(get))).every((j) => j.status === 'failed'));
    await new Promise((res) => setTimeout(res, 100));
    expect(reports).toHaveLength(1);
    expect((reports[0]!.err as Error).message).toBe('db went away');
    expect(reports[0]!.ctx).toEqual({ jobId: boom.id, type: 'boom-twice', attempt: 2, queue: q(), workerId: r.workerId });
  }, JOB_TEST_MS);

  it('a job stopped as stuck for good is reported as stalled', async () => {
    const reports: Array<{ err: unknown; ctx: Record<string, unknown> }> = [];
    const { id } = await enqueueJob(db, { type: 'wedged', payload: {} });
    start({ wedged: { policy: policy({ stuckMs: 100 }), run: (_p, ctx) => new Promise((_, reject) => ctx.signal.addEventListener('abort', () => reject(new Error('stopped')))) } },
      { report: (err, ctx) => { reports.push({ err, ctx }); } });
    await until(async () => (await get(id)).status === 'failed');
    await until(async () => reports.length === 1);
    expect((reports[0]!.err as Error).message).toBe('stalled: no progress for 100 ms');
    expect(reports[0]!.ctx).toMatchObject({ jobId: id, type: 'wedged' });
  }, JOB_TEST_MS);

  it('lanes() counts the jobs running per lane', async () => {
    const { id } = await enqueueJob(db, { type: 'held', payload: {} });
    let release!: () => void;
    const r = start({ held: { policy: policy({ lane: 'background' }), run: () => new Promise<void>((res) => { release = res; }) } });
    await until(async () => (await get(id)).status === 'running');
    await until(async () => r.lanes().background === 1);
    expect(r.lanes()).toEqual({ interactive: 0, background: 1, runs: 0 });
    release();
    await until(async () => r.lanes().background === 0);
  }, JOB_TEST_MS);
```

`packages/worker/src/health.test.ts`:

```ts
// Spec 2026-10-25 monitoring §2.1 "Liveness": WORKER_HEALTH_PORT's server.
import { describe, it, expect } from 'vitest';
import { startHealthServer } from './health.js';

describe('the worker health server', () => {
  it('GET /healthz: 200 while healthy, 503 when not (or when asking throws); 404 elsewhere', async () => {
    let ok = true;
    let throws = false;
    const h = await startHealthServer({ port: 0, healthy: () => { if (throws) throw new Error('x'); return ok; } });
    try {
      const at = (p: string) => fetch(`http://127.0.0.1:${h.port}${p}`);
      let res = await at('/healthz');
      expect([res.status, await res.json()]).toEqual([200, { status: 'ok' }]);
      expect(res.headers.get('cache-control')).toBe('no-store');
      ok = false;
      res = await at('/healthz?x=1');
      expect([res.status, await res.json()]).toEqual([503, { status: 'unavailable' }]);
      throws = true;
      expect((await at('/healthz')).status).toBe(503);
      expect((await at('/other')).status).toBe(404);
    } finally { await h.close(); }
  });

  it('a port in use is an error the caller can catch', async () => {
    const a = await startHealthServer({ port: 0, healthy: () => true });
    try { await expect(startHealthServer({ port: a.port, healthy: () => true })).rejects.toThrow(); } finally { await a.close(); }
  });
});
```

`packages/worker/src/monitoring.test.ts`:

```ts
// Spec 2026-10-25 monitoring §4 "Worker": the heartbeat row, WORKER_HEALTH_PORT (200, then 503 while stopping), and a
// terminal failure reported. Test jobs only: no browser, no page.
import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, jobs, workers } from '@robot/db';
import { enqueueJob, jobQueueName } from '@robot/api/jobs';
import { startErrorReceiver } from '@robot/api/test-helpers/error-receiver';
import { readWorkerConfig } from './config.js';
import { startWorker } from './worker.js';
import { startHealthServer } from './health.js';

const config = (env: Record<string, string> = {}) => readWorkerConfig({
  JOB_QUEUE: jobQueueName(), WORKER_TEST_JOBS: '1', WORKER_HEALTH_PORT: '0', WORKER_MIN_FREE_MB: '0', WORKER_POLL_MS: '50',
  WORKER_SHUTDOWN_MS: '1500', WEBSITE_CHECKS: 'off', RECURRING_RUNS: 'off', ...env,
});
const until = async (pred: () => Promise<boolean>, ms = 30_000) => {
  const t = Date.now() + ms;
  while (!(await pred())) { if (Date.now() > t) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 50)); }
};
const rowOf = (id: string) => db.query.workers.findFirst({ where: eq(workers.id, id) });

describe('the worker’s monitoring (spec 2026-10-25 monitoring §2.1, §2.4)', () => {
  it('beats into its row, answers 200 on its health port, 503 while it stops, and removes its row', async () => {
    const w = await startWorker(config(), { heartbeatMs: 200 });
    try {
      const me = w.runner.workerId;
      await until(async () => !!(await rowOf(me)));
      expect(await rowOf(me)).toMatchObject({ queue: jobQueueName(), browsers: { inUse: 0, max: 3 }, websiteChecks: false, recurringRuns: false });
      const health = `http://127.0.0.1:${w.health!.port}/healthz`;
      expect((await fetch(health)).status).toBe(200);
      const { id } = await enqueueJob(db, { type: 'test-sleep', payload: { ms: 10_000 } });
      await until(async () => (await db.query.jobs.findFirst({ where: eq(jobs.id, id) }))?.status === 'running');
      await until(async () => ((await rowOf(me))?.lanes as { background?: number } | undefined)?.background === 1);
      const stopping = w.stop();
      expect((await fetch(health)).status).toBe(503);
      await stopping;
      expect(await rowOf(me)).toBeUndefined();
      await expect(fetch(health)).rejects.toThrow();
    } finally { await w.stop(); }
  });

  it('a health port already taken: the worker runs without it, and still beats', async () => {
    const taken = await startHealthServer({ port: 0, healthy: () => true });
    const w = await startWorker(config({ WORKER_HEALTH_PORT: String(taken.port) }), { heartbeatMs: 200 });
    try {
      expect(w.health).toBeNull();
      await until(async () => !!(await rowOf(w.runner.workerId)));
    } finally { await w.stop(); await taken.close(); }
  });

  it('a job that fails for good reaches ERROR_REPORT_URL once, as the worker, redacted', async () => {
    const receiver = await startErrorReceiver();
    const saved = process.env.ERROR_REPORT_URL;
    process.env.ERROR_REPORT_URL = receiver.url;
    const w = await startWorker(config(), { heartbeatMs: 200 });
    try {
      const { id } = await enqueueJob(db, { type: 'test-throw', payload: {} });
      await until(async () => receiver.reports.some((r) => r.body?.context?.jobId === id));
      await new Promise((r) => setTimeout(r, 500));
      const mine = receiver.reports.filter((r) => r.body?.context?.jobId === id);
      expect(mine).toHaveLength(1);
      expect(mine[0]!.body).toMatchObject({ service: 'worker', message: 'test-throw: could not reach http://***@proxy.test:7000', context: { jobId: id, type: 'test-throw', attempt: 1, queue: jobQueueName() } });
      expect(mine[0]!.raw).not.toContain('live-secret');
    } finally {
      await w.stop();
      if (saved === undefined) delete process.env.ERROR_REPORT_URL; else process.env.ERROR_REPORT_URL = saved;
      await receiver.close();
    }
  });
});
```

In `packages/worker/src/config.test.ts`: in "the spec defaults" add `healthPort: null` to the expected object; in "reads every knob" add `WORKER_HEALTH_PORT: '4001'` to the env and `healthPort: 4001` to the expected; and append:

```ts
  it('WORKER_HEALTH_PORT: 0–65535 (0 = any free port), anything else is off', () => {
    expect(readWorkerConfig({ WORKER_HEALTH_PORT: '0' }).healthPort).toBe(0);
    for (const v of ['', 'x', '-1', '70000', '40.5']) expect(readWorkerConfig({ WORKER_HEALTH_PORT: v }).healthPort).toBeNull();
  });
```

- [ ] **Step 2: Run them to see them fail**

Run, one at a time: `cd $W/packages/api && npx vitest run src/monitoring/heartbeat.test.ts`; `npx vitest run src/jobs/queue.test.ts -t "progress_at"`; `npx vitest run src/jobs/runner.test.ts`; `cd $W/packages/worker && npx vitest run src/health.test.ts src/config.test.ts`; `npx vitest run src/monitoring.test.ts`
Expected: FAIL — no `heartbeat.js`, `markProgress`, `progressWriteMs`, `report`, `lanes()`, `health.js`, `healthPort`, `test-throw`.

- [ ] **Step 3: The heartbeat and the `monitoring` export**

`packages/api/src/monitoring/heartbeat.ts`:

```ts
// The worker heartbeat (spec 2026-10-25 monitoring §2.1): the row in `workers`, upserted at start and every 30 s on
// the database's clock, deleted on a clean stop; a beat older than 2 minutes is a dead worker; every beat purges rows
// older than a day. Best-effort (§3.2): a failed beat is one warn line per streak and never touches a job.
import { sql } from 'drizzle-orm';
import { db } from '@robot/db';
import type { Lane } from '../jobs/types.js';
import { createLog, type Log } from './log.js';

export const HEARTBEAT_MS = 30_000;
export const DEAD_WORKER_MS = 120_000;
export const WORKER_ROW_TTL_MS = 86_400_000;

export type WorkerState = { browsers: { inUse: number; max: number }; lanes: Record<Lane, number>; websiteChecks: boolean; recurringRuns: boolean };
export type HeartbeatRow = { id: string; queue: string; startedAt: Date; version: string } & WorkerState;
export type Heartbeat = { lastBeatAt(): number | null; beat(): Promise<boolean>; stop(): Promise<void> };

export async function writeBeat(row: HeartbeatRow): Promise<void> {
  await db.execute(sql`INSERT INTO workers (id, queue, started_at, beat_at, version, browsers, lanes, website_checks, recurring_runs)
    VALUES (${row.id}, ${row.queue}, ${row.startedAt.toISOString()}::timestamptz, now(), ${row.version},
            ${JSON.stringify(row.browsers)}::jsonb, ${JSON.stringify(row.lanes)}::jsonb, ${row.websiteChecks}, ${row.recurringRuns})
    ON CONFLICT (id) DO UPDATE SET beat_at = now(), queue = EXCLUDED.queue, version = EXCLUDED.version, browsers = EXCLUDED.browsers,
      lanes = EXCLUDED.lanes, website_checks = EXCLUDED.website_checks, recurring_runs = EXCLUDED.recurring_runs`);
  await db.execute(sql`DELETE FROM workers WHERE beat_at < now() - make_interval(secs => ${WORKER_ROW_TTL_MS / 1000})`);
}

export async function removeWorkerRow(id: string): Promise<void> {
  await db.execute(sql`DELETE FROM workers WHERE id = ${id}`);
}

export function startHeartbeat(opts: {
  workerId: string; queue: string; version: string; state: () => WorkerState; everyMs?: number; log?: Log;
  write?: (row: HeartbeatRow) => Promise<void>; remove?: (id: string) => Promise<void>;
}): Heartbeat {
  const log = opts.log ?? createLog('heartbeat');
  const write = opts.write ?? writeBeat;
  const startedAt = new Date();
  let last: number | null = null;
  let failing = false;
  let stopped = false;
  let inFlight: Promise<boolean> | null = null;
  const beat = (): Promise<boolean> => {
    if (stopped) return Promise.resolve(false);
    inFlight ??= (async () => {
      try {
        await write({ id: opts.workerId, queue: opts.queue, startedAt, version: opts.version, ...opts.state() });
        last = Date.now();
        if (failing) { failing = false; log.info('beating again', { workerId: opts.workerId }); }
        return true;
      } catch (err) {
        if (!failing) { failing = true; log.warn('heartbeat failed; trying again every beat', { workerId: opts.workerId, error: err }); }
        return false;
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  };
  void beat();
  const timer = setInterval(() => void beat(), opts.everyMs ?? HEARTBEAT_MS);
  timer.unref?.();
  return {
    lastBeatAt: () => last,
    beat,
    async stop() {
      stopped = true;
      clearInterval(timer);
      await inFlight?.catch(() => false);
      await (opts.remove ?? removeWorkerRow)(opts.workerId)
        .catch((err: unknown) => log.warn('could not remove the worker row', { workerId: opts.workerId, error: err }));
    },
  };
}
```

`packages/api/src/monitoring/index.ts`:

```ts
// What the worker and the api-server need for monitoring (spec 2026-10-25): the heartbeat, the watchdog, readiness.
export { startHeartbeat, DEAD_WORKER_MS, HEARTBEAT_MS, type Heartbeat, type WorkerState } from './heartbeat.js';
export { serviceVersion } from './version.js';
```

In `packages/api/package.json` `exports`, after `"./errors"` add `"./monitoring": "./src/monitoring/index.ts",`.

- [ ] **Step 4: `progress_at` in the queue**

`packages/api/src/jobs/queue.ts`, `claimJob`'s `UPDATE jobs AS j SET …`: after `started_at = now()` add `, progress_at = now()`. After `renewLease` add:

```ts
/** Spec 2026-10-25 monitoring §2.3: the job's last progress, outside the worker's memory. This claim's only; best-effort. */
export async function markProgress(id: string, owner: string): Promise<void> {
  await db.execute(sql`UPDATE jobs SET progress_at = now() WHERE id = ${id} AND locked_by = ${owner} AND status = 'running'`);
}
```

- [ ] **Step 5: The test jobs**

Replace `packages/api/src/jobs/test-jobs.ts` with:

```ts
// Registered only with WORKER_TEST_JOBS=1 (the worker's crash-recovery and monitoring tests, the monitoring live
// check): they sleep, hang or throw; they load no page. Their policies are known to the watchdog and ops' Queue view
// (monitoring/attention.ts), so a hanging one reads as silent there.
import type { Registry } from './runner.js';
import type { JobPolicy } from './types.js';

const BG = { lane: 'background', priority: 10, startWithinMs: null } as const;

export const TEST_JOB_POLICIES: Record<string, JobPolicy> = {
  'test-sleep': { ...BG, maxAttempts: 2, stuckMs: 10 * 60_000 },
  'test-sleep-once': { ...BG, maxAttempts: 1, stuckMs: 10 * 60_000 },
  // Never reports progress: silent after 30 s, stopped as stuck at 60 s.
  'test-hang': { ...BG, maxAttempts: 1, stuckMs: 60_000 },
  'test-throw': { ...BG, maxAttempts: 1, stuckMs: 60_000 },
};

/** The message test-throw fails with: a proxy URL with a password, which every report and log line must redact. */
export const TEST_THROW_MESSAGE = 'test-throw: could not reach http://live-user:live-secret@proxy.test:7000';

const sleepJob = (type: string): Registry[string] => ({
  policy: TEST_JOB_POLICIES[type]!,
  run: (p: { ms: number; finishOnAttempt?: number }, ctx) => {
    if (p.finishOnAttempt !== undefined && ctx.attempt >= p.finishOnAttempt) return Promise.resolve({ attempt: ctx.attempt });
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => resolve({ attempt: ctx.attempt }), p.ms);
      ctx.signal.addEventListener('abort', () => { clearTimeout(t); reject(new Error('stopped')); });
    });
  },
});

export function testJobDefinitions(): Registry {
  return {
    'test-sleep': sleepJob('test-sleep'),
    'test-sleep-once': sleepJob('test-sleep-once'),
    'test-hang': {
      policy: TEST_JOB_POLICIES['test-hang']!,
      run: (_p: unknown, ctx) => new Promise((_, reject) => ctx.signal.addEventListener('abort', () => reject(new Error('stopped')))),
    },
    'test-throw': { policy: TEST_JOB_POLICIES['test-throw']!, run: async () => { throw new Error(TEST_THROW_MESSAGE); } },
  };
}
```

- [ ] **Step 6: The runner — progress, lanes, levels, reports**

`packages/api/src/jobs/runner.ts`:
- imports: add `import { createLog, type LogFields, type LogLevel } from '../monitoring/log.js';`, `import { reportError } from '../monitoring/errors.js';`, `markProgress` to the `./queue.js` import, and change `import type { JobPolicy, Lane } from './types.js';` (unchanged) — `serializeError` is already imported.
- `RunnerOptions` gains:

```ts
  /** Spec 2026-10-25 monitoring §2.3: `ctx.progress()` writes `jobs.progress_at` at most this often (default 15 s). */
  progressWriteMs?: number;
  /** Spec 2026-10-25 monitoring §2.4: where a terminal fault is reported. Default `reportError` — none when `log` is given and this is not (tests, inline scripts). */
  report?: (err: unknown, context: Record<string, unknown>) => unknown;
```

- `export type JobRunner = { workerId: string; active(): number; lanes(): Record<Lane, number>; stop(graceMs?: number): Promise<void> };`
- `type Active` gains `progressWrittenAt: number;` (and `start` initialises it with `progressWrittenAt: Date.now()` — the claim wrote it).
- In `startJobRunner`, replace `const log = opts.log ?? ((line: string) => console.log(\`[worker] ${line}\`));` with:

```ts
  // Spec 2026-10-25 monitoring §2.2: the runner's lines go through the logger at their level; a caller's own `log`
  // (tests, inline scripts) gets the same text lines.
  const jobsLog = createLog('jobs');
  const say = (level: LogLevel, line: string, fields?: LogFields) => (opts.log ? opts.log(line) : jobsLog[level](line, fields));
  const report = opts.report ?? (opts.log ? null : reportError);
  /** Spec 2026-10-25 §2.4, §3.2: a terminal fault is reported; an answer (a capture problem, a refusal) is not. Never throws. */
  const fault = (err: unknown, context: Record<string, unknown>) => {
    if (!report) return;
    try {
      const s = serializeError(err);
      if (s.kind === 'capture-problem' || (s.kind === 'trpc' && s.code !== 'INTERNAL_SERVER_ERROR')) return;
      void Promise.resolve(report(err, { ...context, queue: opts.queue, workerId })).catch(() => {});
    } catch { /* reporting never changes an outcome */ }
  };
  const progressWriteMs = opts.progressWriteMs ?? 15_000;
```

- `ctx.progress` becomes:

```ts
      progress: () => {
        a.lastProgress = Date.now();
        if (a.lastProgress - a.progressWrittenAt < progressWriteMs) return;
        a.progressWrittenAt = a.lastProgress;
        // Best-effort (spec 2026-10-25 §3.2): a write that fails, or finds the job another claim's, never touches the job.
        void markProgress(job.id, owner(job)).catch(() => {});
      },
```

- Every `log(…)` call becomes `say(level, sameText, fields)` — the text unchanged (the runner tests match it):

| Line (text unchanged) | Level | Fields | Also |
|---|---|---|---|
| `lost the lease on ${job.type} ${job.id} before ${what}` (`lostBefore`) | `warn` | `{ jobId, type }` | |
| `claimed …` | `info` | `{ jobId, type, attempt: job.attempts, maxAttempts: job.maxAttempts }` | |
| `retry … after: …` | `warn` | `{ jobId, type, attempt, error: msg(err) }` | |
| `failed ${job.type} ${job.id}: …` | `error` | `{ jobId, type, attempt, error: msg(err) }` | `fault(err, { jobId: job.id, type: job.type, attempt: job.attempts })` |
| `could not record the failure of …` / `could not record the answer of …` | `error` | `{ jobId, error: msg(recordErr) }` | |
| `done …` | `info` | `{ jobId, type }` | |
| `after ${job.type} ${job.id} failed: …` | `warn` | `{ jobId, type, error }` | |
| `claim failed: …` | `error` | `{ error: msg(err) }` | |
| `lost the lease on … ; stopped it here` | `warn` | `{ jobId, type }` | |
| `stuck ${type} ${id}: no progress for … ms` | `warn` | `{ jobId, type, stuckMs }` | when it was failed for good (the `else` branch, `recorded`): `fault(new Error(\`stalled: no progress for ${a.def.policy.stuckMs} ms\`), { jobId: a.job.id, type: a.job.type, attempt: a.job.attempts })` |
| `could not stop …` | `error` | `{ jobId, error }` | |
| `reaped ${id}: … retrying` | `warn` | `{ jobId: id }` | |
| `reaped ${id}: … no attempts left` | `warn` | `{ jobId: id }` | `fault(new Error('stalled: its worker stopped answering'), { jobId: id })` |
| `expired ${id}: not started in time` | `warn` | `{ jobId: id }` | |
| `reap failed: …` | `error` | `{ error }` | |
| `gave back … (shutdown)` | `info` | `{ jobId, type }` | |

  For the stuck branch, keep a local `let failedForGood = false;` set to `true` in the `else` (terminal) branch, and after `if (recorded) say('warn', …)` add `if (recorded && failedForGood) fault(…)`.
- In the returned object add `lanes: () => ({ interactive: count((a) => a.def.policy.lane === 'interactive'), background: count((a) => a.def.policy.lane === 'background'), runs: count((a) => a.def.policy.lane === 'runs') }),`.

- [ ] **Step 7: The sweeps' lines and the test setups**

`packages/api/src/verify/website-checks.ts`: `import { createLog } from '../monitoring/log.js';` and `const log = createLog('website-checks');` below the imports; `console.error(\`[website-checks] ${id ?? 'claim'} failed:\`, err);` → `log.error(\`${id ?? 'claim'} failed\`, { sourceId: id, error: err });`; in `startWebsiteChecks`' `tick`, `try { await sweep(); } catch (err) { console.error('[website-checks] sweep failed:', err); }` → `try { const queued = await sweep(); if (Array.isArray(queued) && queued.length > 0) log.info(\`queued ${queued.length} website check(s)\`, { count: queued.length }); } catch (err) { log.error('sweep failed', { error: err }); }`.

`packages/api/src/recurring/sweep.ts`: `import { createLog } from '../monitoring/log.js';`, `const log = createLog('recurring');`; the three `console.error` calls become `log.error(\`website ${id}: its scheduled run could not start; next time ${next.toISOString()}\`, { sourceId: id, error: err });`, `log.error(\`sweep: ${err.message}\`, { sourceId: err.sourceId, error: err.cause });` and, in `startRecurringRuns`' `tick`, `try { const outcomes = await sweep(); const started = Array.isArray(outcomes) ? outcomes.filter((o) => (o as { outcome?: string }).outcome === 'started').length : 0; if (started > 0) log.info(\`started ${started} scheduled run(s)\`, { count: started }); } catch (err) { log.error('sweep failed', { error: err }); }`. (The default sink writes error lines with `console.error`, so `start-recurring.test.ts` and `sweep.test.ts`' `console.error` spies still see them.)

Each of the three `test-setup/job-queue.ts` files: in `afterAll`, after the `DELETE FROM jobs …` line add `await db.execute(sql\`DELETE FROM workers WHERE queue = ${process.env.JOB_QUEUE!}\`);`, and add `and its workers rows (a killed test worker leaves one)` to the top comment's last sentence.

- [ ] **Step 8: The worker — config, health server, heartbeat, startup and stop lines**

`packages/worker/src/config.ts`: `WorkerConfig` gains `healthPort: number | null;`; add

```ts
/** WORKER_HEALTH_PORT (spec 2026-10-25 monitoring §2.1): 1–65535, or 0 for any free port (tests); else no server. */
const port = (env: Env, name: string): number | null => {
  const raw = (env[name] ?? '').trim();
  const n = Number(raw);
  return raw !== '' && Number.isInteger(n) && n >= 0 && n <= 65535 ? n : null;
};
```

and `healthPort: port(env, 'WORKER_HEALTH_PORT'),` in `readWorkerConfig` (after `stopFile`).

`packages/worker/src/health.ts`:

```ts
// WORKER_HEALTH_PORT (spec 2026-10-25 monitoring §2.1): GET /healthz on 127.0.0.1 — 200 while the worker's job loop,
// heartbeat and lease renewal run, 503 while it stops (or when it cannot reach its database). Nothing else.
import { createServer } from 'node:http';

export type HealthServer = { port: number; close(): Promise<void> };

export async function startHealthServer(opts: { port: number; healthy: () => boolean; host?: string }): Promise<HealthServer> {
  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    if ((req.method !== 'GET' && req.method !== 'HEAD') || path !== '/healthz') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end('{"status":"not found"}');
      return;
    }
    let ok = false;
    try { ok = opts.healthy(); } catch { ok = false; }
    res.writeHead(ok ? 200 : 503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ status: ok ? 'ok' : 'unavailable' }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, opts.host ?? '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  const { port } = server.address() as { port: number };
  return { port, close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }) };
}
```

Replace `packages/worker/src/worker.ts` with:

```ts
// The worker (spec 2026-10-23 §4.3): the only process with browsers. One gate limits them; the runner
// claims this queue's jobs; with WEBSITE_CHECKS=on, the hourly sweep enqueues due website checks; unless RECURRING_RUNS=off, the minute sweep starts each website's scheduled run.
// Monitoring (spec 2026-10-25): it beats into `workers` every 30 s, answers WORKER_HEALTH_PORT, and reports its terminal faults.
import {
  createBrowserGate, setBrowserGate, startJobRunner, jobRegistry, startWebsiteChecks, enqueueDueWebsiteChecks, startRecurringRuns, mailOn,
  type JobRunner, type WorkerBrowserGate,
} from '@robot/api/jobs';
import { configureErrorReports } from '@robot/api/errors';
import { createLog } from '@robot/api/log';
import { DEAD_WORKER_MS, serviceVersion, startHeartbeat, type Heartbeat } from '@robot/api/monitoring';
import type { WorkerConfig } from './config.js';
import { startHealthServer, type HealthServer } from './health.js';

export type Worker = { runner: JobRunner; gate: WorkerBrowserGate; heartbeat: Heartbeat; health: { port: number } | null; healthy(): boolean; stop(): Promise<void> };
export type WorkerDeps = { freeMb?: () => number; heartbeatMs?: number; watchEveryMs?: number };

const log = createLog('worker');

export async function startWorker(config: WorkerConfig, deps: WorkerDeps = {}): Promise<Worker> {
  configureErrorReports({ service: 'worker' });
  const gate = createBrowserGate({ max: config.browsers, minFreeMb: config.minFreeMb, ...(deps.freeMb ? { freeMb: deps.freeMb } : {}) });
  setBrowserGate(gate);
  const runner = startJobRunner({
    queue: config.queue, registry: jobRegistry({ testJobs: config.testJobs }), lanes: config.lanes,
    leaseMs: config.leaseMs, pollMs: config.pollMs, retryBaseMs: config.retryBaseMs, minFreeMb: config.minFreeMb,
    ...(deps.freeMb ? { freeMb: deps.freeMb } : {}), browsers: gate, ...(config.name ? { workerName: config.name } : {}),
  });
  const stopChecks = startWebsiteChecks({ env: { WEBSITE_CHECKS: config.websiteChecks ? 'on' : 'off' }, sweep: () => enqueueDueWebsiteChecks() });
  const stopRecurring = startRecurringRuns({ enabled: config.recurringRuns });
  const heartbeat = startHeartbeat({
    workerId: runner.workerId, queue: config.queue, version: serviceVersion(), ...(deps.heartbeatMs ? { everyMs: deps.heartbeatMs } : {}),
    state: () => ({ browsers: { inUse: gate.open(), max: config.browsers }, lanes: runner.lanes(), websiteChecks: config.websiteChecks, recurringRuns: config.recurringRuns }),
  });
  let stopping = false;
  const startedAt = Date.now();
  // Spec 2026-10-25 §2.1: working = started, not stopping, and its database answered a beat in the last 2 minutes.
  const healthy = () => !stopping && Date.now() - (heartbeat.lastBeatAt() ?? startedAt) < DEAD_WORKER_MS;
  let health: HealthServer | null = null;
  if (config.healthPort !== null) {
    try {
      health = await startHealthServer({ port: config.healthPort, healthy });
    } catch (err) {
      // Monitoring never stops the work (spec §3.2): no health port, the worker runs on.
      log.error('the health port could not be opened; running without it', { port: config.healthPort, error: err });
    }
  }
  log.info(`${runner.workerId} on queue "${config.queue}": browsers ${config.browsers}; lanes interactive ${config.lanes.interactive}, background ${config.lanes.background}, runs ${config.lanes.runs}; min free memory ${config.minFreeMb} MB; website checks ${config.websiteChecks ? 'on (hourly)' : 'off'}; recurring runs ${config.recurringRuns ? 'on (every minute)' : 'off'}; mail ${mailOn() ? 'on' : 'off'}; health ${health ? `127.0.0.1:${health.port}` : 'off'}`,
    { workerId: runner.workerId, queue: config.queue, version: serviceVersion() });
  let stopped: Promise<void> | null = null;
  return {
    runner, gate, heartbeat, health: health ? { port: health.port } : null, healthy,
    stop() {
      // Once: a second call (SIGINT during a stop-file stop) waits for the first.
      stopped ??= (async () => {
        stopping = true;
        stopChecks();
        stopRecurring();
        await runner.stop(config.shutdownMs);
        await gate.closeAll();
        setBrowserGate(null);
        await heartbeat.stop();
        await health?.close();
        log.info(`${runner.workerId} stopped`, { workerId: runner.workerId });
      })();
      return stopped;
    },
  };
}
```

`packages/worker/src/index.ts`: add `const { createLog } = await import('@robot/api/log'); const log = createLog('worker');` after the `installProcessHandlers` lines; `console.log(\`[worker] stopping (${why})\`);` → `log.info(\`stopping (${why})\`, { reason: why });`; `console.error('[worker] stop failed:', err);` → `log.error('stop failed', { error: err });`.

- [ ] **Step 9: Run the tests, type-check**

Run, one at a time: `cd $W/packages/api && npx vitest run src/monitoring/heartbeat.test.ts src/jobs/queue.test.ts`; `npx vitest run src/jobs/runner.test.ts`; `npx vitest run src/recurring/start-recurring.test.ts src/recurring/sweep.test.ts`; `npx vitest run src/verify/website-checks.test.ts src/verify/website-checks-sweep.test.ts`; `npx tsc --noEmit`. `cd $W/packages/worker && npx vitest run src/health.test.ts src/config.test.ts`; `npx vitest run src/monitoring.test.ts`; `npx vitest run src/crash-recovery.test.ts`; `npx tsc --noEmit`. `cd $W/packages/api-server && npx tsc --noEmit`.
Expected: PASS, no type errors. Then `docker exec robot-platform-db psql -U postgres -d robot_platform -tc "SELECT count(*) FROM workers WHERE queue LIKE 'test-%'"` → `0`.

- [ ] **Step 10: Commit**

```bash
cd $W
git add packages/api/src/monitoring/heartbeat.ts packages/api/src/monitoring/heartbeat.test.ts packages/api/src/monitoring/index.ts packages/api/package.json packages/api/src/jobs/queue.ts packages/api/src/jobs/queue.test.ts packages/api/src/jobs/runner.ts packages/api/src/jobs/runner.test.ts packages/api/src/jobs/test-jobs.ts packages/api/src/verify/website-checks.ts packages/api/src/recurring/sweep.ts packages/api/src/test-setup/job-queue.ts packages/api-server/src/test-setup/job-queue.ts packages/worker/src/test-setup/job-queue.ts packages/worker/src/health.ts packages/worker/src/health.test.ts packages/worker/src/monitoring.test.ts packages/worker/src/config.ts packages/worker/src/config.test.ts packages/worker/src/worker.ts packages/worker/src/index.ts
git commit -m "feat(worker): heartbeat row, WORKER_HEALTH_PORT, progress_at, runner lines through the logger, terminal faults reported

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The stuck-job watchdog, `/readyz` and the api-server request log — spec §2.1 "Readiness", §2.2 (the request log), §2.3 "The checks", "No worker at all", §2.6, §3.3, §4 "Unit" (the watchdog), §4 "API and server" (`/readyz`, the request log)

**Files:**
- Create: `packages/api/src/monitoring/attention.ts`, `packages/api/src/monitoring/watchdog.ts`, `packages/api/src/monitoring/readiness.ts`
- Test: `packages/api/src/monitoring/attention.test.ts`, `packages/api/src/monitoring/readiness.test.ts`
- Modify: `packages/api/src/monitoring/index.ts`
- Create: `packages/api-server/src/request-log.ts`
- Modify: `packages/api-server/src/app.ts` (`AppDeps.log`, `AppDeps.readiness`, the request log, `GET /readyz`), `packages/api-server/src/app.test.ts`
- Modify: `packages/worker/src/worker.ts` (the watchdog)

**Interfaces:**
- Consumes: `DEAD_WORKER_MS` (Task 4); `jobs.progressAt`, `workers`, `migrationCount` (Task 1); `JOB_POLICIES`, `type JobPolicy`, `type Lane` (`jobs/types.ts`); `TEST_JOB_POLICIES` (Task 4); `redactText`, `createLog`, `type Log` (Task 2); `clientIpOf` (`packages/api-server/src/client-ip.ts`).
- Produces (`packages/api/src/monitoring/attention.ts`): `BACKLOG_MS = 600_000`; `type AttentionKind = 'backlog' | 'silent' | 'dead-worker'`; `type AttentionItem = { kind: AttentionKind; jobId: string; type: string; lane: Lane | null; ageMs: number; workerId: string | null; sourceId: string | null; websiteName: string | null; runId: string | null; lastError: string | null }` (`ageMs`: backlog — since due; silent — since its last progress; dead-worker — since that worker's last beat; `lastError` redacted, ≤ 500 chars); `policyOf(type: string): JobPolicy | null`; `findBacklog(queue: string, opts?: { limit?: number }): Promise<AttentionItem[]>` (no subjects); `findAttention(queue: string): Promise<AttentionItem[]>` (backlog, then silent, then dead-worker, each with its website and run).
- Produces (`packages/api/src/monitoring/watchdog.ts`): `WATCH_EVERY_MS = 60_000`; `WARN_AGAIN_MS = 3_600_000`; `watchJobs(queue: string, opts: { log: Log; seen: Map<string, number>; now?: () => number; find?: (queue: string) => Promise<AttentionItem[]> }): Promise<AttentionItem[]>` (the items it warned about); `startWatchdog(opts: { queue: string; everyMs?: number; log?: Log }): () => void`.
- Produces (`packages/api/src/monitoring/readiness.ts`): `READY_TIMEOUT_MS = 2000`; `type ReadinessChecks = { db: boolean; migrations: boolean; worker: boolean; queue: boolean }`; `type Readiness = { ok: boolean; checks: ReadinessChecks }`; `readiness(opts: { queue: string; ping?: () => Promise<unknown>; expectedMigrations?: () => number; timeoutMs?: number }): Promise<Readiness>`.
- Produces (`@robot/api/monitoring`): also `readiness`, `type Readiness`, `startWatchdog`, `watchJobs`, `findAttention`, `type AttentionItem`.
- Produces (`@robot/api-server`): `requestLog(log: Log): MiddlewareHandler`; `AppDeps` gains `log: Log` (default `createLog('api-server')`) and `readiness: () => Promise<Readiness>` (default `readiness({ queue: jobQueueName() })`); `GET /readyz` → 200 `{ status: 'ok', checks }` / 503 `{ status: 'unavailable', checks }`, `cache-control: no-store`.

- [ ] **Step 1: Write the failing tests**

`packages/api/src/monitoring/attention.test.ts`:

```ts
// Spec 2026-10-25 monitoring §2.3, §4 "Unit": the watchdog's queries with seeded rows — backlog, silent, dead worker,
// dedupe. Every row is on this file's own JOB_QUEUE.
import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { db, jobs, runs, workers } from '@robot/db';
import { jobQueueName } from '../jobs/queue.js';
import { createTestSource, deleteTestSource } from '../test-helpers/source.js';
import { findAttention, type AttentionItem } from './attention.js';
import { watchJobs } from './watchdog.js';
import { createLog, type LogLevel } from './log.js';

const q = () => jobQueueName();
const ago = (s: number) => sql`now() - make_interval(secs => ${s})`;
const ahead = (s: number) => sql`now() + make_interval(secs => ${s})`;
const running = (over: Partial<typeof jobs.$inferInsert> = {}) => ({
  queue: q(), type: 'reachability', status: 'running', attempts: 1, lockedBy: 'w:1:aaaa#t1', lockedUntil: ahead(30), startedAt: ago(60), progressAt: ago(5), ...over,
});
afterEach(async () => {
  await db.delete(jobs).where(eq(jobs.queue, q()));
  await db.delete(workers).where(eq(workers.queue, q()));
});

describe('what needs attention (spec 2026-10-25 monitoring §2.3)', () => {
  it('backlog: a queued job due more than 10 minutes ago whose lane nobody is working', async () => {
    const [old] = await db.insert(jobs).values({ queue: q(), type: 'reachability', runAfter: ago(11 * 60) }).returning();
    await db.insert(jobs).values({ queue: q(), type: 'reachability', runAfter: ago(9 * 60) });
    await db.insert(jobs).values({ queue: q(), type: 'reachability', runAfter: ahead(60) });
    const items = await findAttention(q());
    expect(items).toEqual([expect.objectContaining({ kind: 'backlog', jobId: old!.id, type: 'reachability', lane: 'interactive', workerId: null })]);
    expect(items[0]!.ageMs).toBeGreaterThan(10 * 60_000);
  });

  it('RF1: a queued job behind a busy lane is not a backlog; the same job with its lane idle is', async () => {
    // website-check: background, at most one at a time — the rest wait their turn while it works.
    await db.insert(jobs).values(running({ type: 'website-check', lockedBy: 'w:1:aaaa#t1' }));
    const [waiting] = await db.insert(jobs).values({ queue: q(), type: 'website-check', runAfter: ago(40 * 60) }).returning();
    // A second run behind WORKER_RUNS=1.
    await db.insert(jobs).values(running({ type: 'run', lockedBy: 'w:1:aaaa#t2' }));
    await db.insert(jobs).values({ queue: q(), type: 'run', runAfter: ago(3 * 3600) });
    // Another lane's work does not make interactive work busy.
    const [interactive] = await db.insert(jobs).values({ queue: q(), type: 'reachability', runAfter: ago(11 * 60) }).returning();
    expect((await findAttention(q())).map((i) => [i.kind, i.jobId])).toEqual([['backlog', interactive!.id]]);
    // The background lane goes idle: nothing running there, its last claim 11 minutes ago.
    await db.update(jobs).set({ status: 'done', lockedBy: null, lockedUntil: null, startedAt: ago(11 * 60), finishedAt: ago(10 * 60) })
      .where(sql`${jobs.queue} = ${q()} AND ${jobs.type} = 'website-check' AND ${jobs.status} = 'running'`);
    expect((await findAttention(q())).filter((i) => i.kind === 'backlog').map((i) => i.jobId).sort()).toEqual([interactive!.id, waiting!.id].sort());
  });

  it('silent: running with a live lease and no progress for over half its stuckMs; recent progress or a lapsed lease is not', async () => {
    // reachability's stuckMs is 60 s: silent past 30 s.
    const [quiet] = await db.insert(jobs).values(running({ progressAt: ago(40) })).returning();
    await db.insert(jobs).values(running({ lockedBy: 'w:1:aaaa#t2', progressAt: ago(10) }));
    await db.insert(jobs).values(running({ lockedBy: 'w:1:aaaa#t3', progressAt: ago(40), lockedUntil: ago(5) }));
    const items = await findAttention(q());
    expect(items).toEqual([expect.objectContaining({ kind: 'silent', jobId: quiet!.id, workerId: 'w:1:aaaa', lane: 'interactive' })]);
    expect(items[0]!.ageMs).toBeGreaterThanOrEqual(39_000);
  });

  it('dead worker: a running job under a worker row whose beat is more than 2 minutes old', async () => {
    await db.insert(workers).values({ id: 'dead:1:aaaa', queue: q(), startedAt: new Date(), beatAt: ago(180) });
    await db.insert(workers).values({ id: 'live:1:bbbb', queue: q(), startedAt: new Date() });
    const [orphan] = await db.insert(jobs).values(running({ lockedBy: 'dead:1:aaaa#t1', lockedUntil: ago(60), progressAt: ago(170) })).returning();
    await db.insert(jobs).values(running({ lockedBy: 'live:1:bbbb#t1' }));
    const items = await findAttention(q());
    expect(items).toEqual([expect.objectContaining({ kind: 'dead-worker', jobId: orphan!.id, workerId: 'dead:1:aaaa' })]);
    expect(items[0]!.ageMs).toBeGreaterThanOrEqual(179_000);
  });

  it('RF5: worker ids with LIKE wildcards are matched exactly', async () => {
    await db.insert(workers).values({ id: 'w_1%:9:aaaa', queue: q(), startedAt: new Date(), beatAt: ago(300) });
    await db.insert(workers).values({ id: 'wX1Z:9:aaaa', queue: q(), startedAt: new Date() });
    const [mine] = await db.insert(jobs).values(running({ lockedBy: 'w_1%:9:aaaa#t1', lockedUntil: ago(10) })).returning();
    await db.insert(jobs).values(running({ lockedBy: 'wX1Z:9:aaaa#t2' }));
    expect((await findAttention(q())).map((i) => [i.kind, i.jobId, i.workerId])).toEqual([['dead-worker', mine!.id, 'w_1%:9:aaaa']]);
  });

  it('names the website and the run a job belongs to, and redacts its last error', async () => {
    const sourceId = await createTestSource({ schema: [] });
    try {
      const [run] = await db.insert(runs).values({ sourceId, status: 'pending' }).returning();
      const [j] = await db.insert(jobs).values({ queue: q(), type: 'run', payload: { runId: run!.id }, runAfter: ago(11 * 60), error: 'lost http://u:last-pass@h.test:1' }).returning();
      const [byRow] = await db.insert(jobs).values({ queue: q(), type: 'plan', payload: { sourceId: 'not-a-uuid' }, runAfter: ago(12 * 60) }).returning();
      await db.update(runs).set({ jobId: byRow!.id }).where(eq(runs.id, run!.id));
      const items = await findAttention(q());
      expect(items.find((i) => i.jobId === j!.id)).toMatchObject({ sourceId, runId: run!.id, websiteName: expect.any(String), lastError: 'lost http://***@h.test:1' });
      expect(items.find((i) => i.jobId === byRow!.id)).toMatchObject({ sourceId, runId: run!.id });
    } finally { await deleteTestSource(sourceId); }
  });
});

describe('watchJobs (spec 2026-10-25 monitoring §2.3)', () => {
  const capture = () => {
    const lines: Array<{ line: string; level: LogLevel }> = [];
    return { lines, log: createLog('watchdog', { env: { LOG_FORMAT: 'json' }, sink: (line, level) => lines.push({ line, level }) }) };
  };
  const item = (over: Partial<AttentionItem> = {}): AttentionItem => ({
    kind: 'silent', jobId: 'j1', type: 'verify', lane: 'background', ageMs: 500_000, workerId: 'w:1:a', sourceId: null, websiteName: null, runId: null,
    lastError: 'retry after http://u:wd-pass@h.test:1', ...over,
  });

  it('warns once per job and kind per hour, at warn, with its fields, redacted', async () => {
    const { lines, log } = capture();
    const seen = new Map<string, number>();
    let now = 1_000_000;
    const find = async () => [item(), item({ kind: 'dead-worker' })];
    expect(await watchJobs('q', { log, seen, now: () => now, find })).toHaveLength(2);
    now += 30 * 60_000;
    expect(await watchJobs('q', { log, seen, now: () => now, find })).toHaveLength(0);
    now += 31 * 60_000;
    expect(await watchJobs('q', { log, seen, now: () => now, find })).toHaveLength(2);
    expect(lines).toHaveLength(4);
    expect(lines.every((l) => l.level === 'warn')).toBe(true);
    expect(JSON.parse(lines[0]!.line)).toMatchObject({ scope: 'watchdog', kind: 'silent', jobId: 'j1', type: 'verify', lane: 'background', ageMs: 500_000 });
    expect(JSON.parse(lines[0]!.line).msg).toBe('silent: verify j1 running with no progress for 500 s');
    expect(lines.map((l) => l.line).join('\n')).not.toContain('wd-pass');
  });

  it('against seeded rows: a backlog job is warned once across two sweeps', async () => {
    await db.insert(jobs).values({ queue: q(), type: 'reachability', runAfter: ago(11 * 60) });
    const { lines, log } = capture();
    const seen = new Map<string, number>();
    await watchJobs(q(), { log, seen });
    await watchJobs(q(), { log, seen });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!.line).msg).toMatch(/^backlog: reachability [0-9a-f-]{36} due 11 min ago and nobody is taking it$/);
  });
});
```

`packages/api/src/monitoring/readiness.test.ts`:

```ts
// Spec 2026-10-25 monitoring §2.1 "Readiness": each check failing on its own.
import { afterEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db, jobs, workers } from '@robot/db';
import { jobQueueName } from '../jobs/queue.js';
import { readiness } from './readiness.js';

const q = () => jobQueueName();
afterEach(async () => {
  await db.delete(jobs).where(eq(jobs.queue, q()));
  await db.delete(workers).where(eq(workers.queue, q()));
});
const beating = () => db.insert(workers).values({ id: `ready:${q()}`, queue: q(), startedAt: new Date() });

describe('readiness (spec 2026-10-25 monitoring §2.1)', () => {
  it('ok when the database answers, migrations are applied, a worker beats on this queue and nothing waits', async () => {
    await beating();
    expect(await readiness({ queue: q() })).toEqual({ ok: true, checks: { db: true, migrations: true, worker: true, queue: true } });
  });

  it('worker: failing with no row, only a beat older than 2 minutes, or only another queue’s worker', async () => {
    expect((await readiness({ queue: q() })).checks.worker).toBe(false);
    await db.insert(workers).values({ id: `old:${q()}`, queue: q(), startedAt: new Date(), beatAt: sql`now() - interval '3 minutes'` });
    await db.insert(workers).values({ id: `elsewhere:${q()}`, queue: `${q()}-other`.slice(0, 64), startedAt: new Date() });
    try {
      expect(await readiness({ queue: q() })).toEqual({ ok: false, checks: { db: true, migrations: true, worker: false, queue: true } });
    } finally { await db.delete(workers).where(eq(workers.id, `elsewhere:${q()}`)); }
  });

  it('queue: failing with a job due over 10 minutes that nobody takes', async () => {
    await beating();
    await db.insert(jobs).values({ queue: q(), type: 'verify', runAfter: sql`now() - interval '11 minutes'` });
    expect(await readiness({ queue: q() })).toEqual({ ok: false, checks: { db: true, migrations: true, worker: true, queue: false } });
  });

  it('migrations: failing when the database has fewer than are bundled', async () => {
    await beating();
    expect(await readiness({ queue: q(), expectedMigrations: () => 10_000 })).toEqual({ ok: false, checks: { db: true, migrations: false, worker: true, queue: true } });
  });

  it('db: failing — and nothing else read — when the ping fails, or takes longer than the timeout', async () => {
    const t0 = Date.now();
    expect(await readiness({ queue: q(), ping: () => new Promise(() => {}), timeoutMs: 200 })).toEqual({ ok: false, checks: { db: false, migrations: false, worker: false, queue: false } });
    expect(Date.now() - t0).toBeLessThan(1500);
    expect((await readiness({ queue: q(), ping: async () => { throw new Error('ECONNREFUSED'); } })).checks).toEqual({ db: false, migrations: false, worker: false, queue: false });
  });
});
```

In `packages/api-server/src/app.test.ts`, add `import { eq, sql } from 'drizzle-orm';` (merge with its existing `eq` import), `workers, jobs` to the `@robot/db` import, `import { jobQueueName } from '@robot/api/jobs';`, `import { createLog } from '@robot/api/log';`, and append:

```ts
describe('/readyz (spec 2026-10-25 monitoring §2.1, §2.6)', () => {
  afterEach(async () => {
    await db.delete(workers).where(eq(workers.queue, jobQueueName()));
    await db.delete(jobs).where(eq(jobs.queue, jobQueueName()));
  });
  const allOk = { db: true, migrations: true, worker: true, queue: true };

  it('503 naming each check when no worker beats on this queue; no-store', async () => {
    const res = await createApp().request('/readyz');
    expect(res.status).toBe(503);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ status: 'unavailable', checks: { db: true, migrations: true, worker: false, queue: true } });
  });

  it('200 once a worker beats; 503 (queue) with a job nobody takes', async () => {
    await db.insert(workers).values({ id: `readyz:${jobQueueName()}`, queue: jobQueueName(), startedAt: new Date() });
    const ok = await createApp().request('/readyz');
    expect([ok.status, await ok.json()]).toEqual([200, { status: 'ok', checks: allOk }]);
    await db.insert(jobs).values({ queue: jobQueueName(), type: 'verify', runAfter: sql`now() - interval '11 minutes'` });
    const late = await createApp().request('/readyz');
    expect([late.status, await late.json()]).toEqual([503, { status: 'unavailable', checks: { ...allOk, queue: false } }]);
  });

  it('a readiness that throws: 503 with every check false, and the answer names no host, id or error', async () => {
    const res = await createApp({ readiness: async () => { throw new Error('connect ECONNREFUSED 10.0.0.5:5432'); } }).request('/readyz');
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ status: 'unavailable', checks: { db: false, migrations: false, worker: false, queue: false } });
    expect(text).not.toMatch(/10\.0\.0\.5|ECONNREFUSED/);
  });

  it('/healthz stays liveness: 200 whatever readiness says', async () => {
    const res = await createApp({ readiness: async () => { throw new Error('down'); } }).request('/healthz');
    expect([res.status, await res.json()]).toEqual([200, { status: 'ok' }]);
  });
});

describe('the request log (spec 2026-10-25 monitoring §2.2)', () => {
  const capture = () => {
    const lines: Array<Record<string, unknown>> = [];
    return { lines, log: createLog('api-server', { env: { LOG_FORMAT: 'json', LOG_LEVEL: 'debug' }, sink: (line) => lines.push(JSON.parse(line)) }) };
  };
  const ready = async () => ({ ok: true, checks: { db: true, migrations: true, worker: true, queue: true } });

  it('method, path without the query, status, duration and client IP at info; /healthz and /readyz at debug', async () => {
    const { lines, log } = capture();
    const app = createApp({ log, readiness: ready });
    await app.request('/nope?token=q-secret&x=1');
    await app.request('/healthz?probe=1');
    await app.request('/readyz');
    expect(lines.map((l) => [l.level, l.method, l.path, l.status])).toEqual([['info', 'GET', '/nope', 404], ['debug', 'GET', '/healthz', 200], ['debug', 'GET', '/readyz', 200]]);
    expect(lines[0]).toMatchObject({ scope: 'api-server', ip: 'unknown', msg: expect.stringMatching(/^GET \/nope 404 \d+ ms$/) });
    expect(typeof lines[0]!.ms).toBe('number');
    expect(JSON.stringify(lines)).not.toContain('q-secret');
  });

  it('a tRPC call is logged by its path only — never its input or the session cookie', async () => {
    const { lines, log } = capture();
    await createApp({ log, readiness: ready }).request('/trpc/auth.me?input=%7B%22password%22%3A%22in-secret%22%7D', { headers: { cookie: 'robot_session=cookie-secret' } });
    expect(lines[0]).toMatchObject({ method: 'GET', path: '/trpc/auth.me' });
    expect(JSON.stringify(lines)).not.toMatch(/in-secret|cookie-secret/);
  });

  it('the IP is the last X-Forwarded-For entry only with TRUST_PROXY=on', async () => {
    const saved = process.env.TRUST_PROXY;
    try {
      const { lines, log } = capture();
      process.env.TRUST_PROXY = 'on';
      await createApp({ log, readiness: ready }).request('/nope', { headers: { 'x-forwarded-for': '198.51.100.1, 203.0.113.9' } });
      process.env.TRUST_PROXY = '';
      await createApp({ log, readiness: ready }).request('/nope', { headers: { 'x-forwarded-for': '203.0.113.9' } });
      expect(lines.map((l) => l.ip)).toEqual(['203.0.113.9', 'unknown']);
    } finally {
      if (saved === undefined) delete process.env.TRUST_PROXY; else process.env.TRUST_PROXY = saved;
    }
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd $W/packages/api && npx vitest run src/monitoring/attention.test.ts`; `npx vitest run src/monitoring/readiness.test.ts`; `cd $W/packages/api-server && npx vitest run src/app.test.ts -t "readyz|request log"`
Expected: FAIL — no `attention.js`, `watchdog.js`, `readiness.js`; `/readyz` is 404 and nothing is logged.

- [ ] **Step 3: What needs attention**

`packages/api/src/monitoring/attention.ts`:

```ts
// What needs attention on a queue (spec 2026-10-25 monitoring §2.3), read by the watchdog, /readyz's `queue` check
// and ops' Queue view. Ages are on the database's clock. Read-only: nothing here changes a job.
//   backlog     queued, due more than 10 minutes ago, and its lane is idle on this queue — nothing of the lane running,
//               nothing of it claimed in the last 10 minutes ("a backlog nobody is taking"; plan "Settled here" 1)
//   silent      running under a live lease, no progress for more than half its policy's stuckMs
//   dead-worker running under a worker whose row's beat is more than 2 minutes old (matched exactly, never by LIKE)
import { sql } from 'drizzle-orm';
import { db } from '@robot/db';
import { JOB_POLICIES, type JobPolicy, type Lane } from '../jobs/types.js';
import { TEST_JOB_POLICIES } from '../jobs/test-jobs.js';
import { DEAD_WORKER_MS } from './heartbeat.js';
import { redactText } from './redact.js';

export const BACKLOG_MS = 10 * 60_000;
const DEFAULT_STUCK_MS = 15 * 60_000;
const UUID = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

export type AttentionKind = 'backlog' | 'silent' | 'dead-worker';
export type AttentionItem = {
  kind: AttentionKind; jobId: string; type: string; lane: Lane | null; ageMs: number; workerId: string | null;
  sourceId: string | null; websiteName: string | null; runId: string | null; lastError: string | null;
};

export function policyOf(type: string): JobPolicy | null {
  return (JOB_POLICIES as Record<string, JobPolicy>)[type] ?? TEST_JOB_POLICIES[type] ?? null;
}

type Raw = { id: string; type: string; error: string | null; age_ms: number | string; worker_id: string | null };
const rows = <T>(r: unknown) => r as T[];
const item = (kind: AttentionKind, j: Raw): AttentionItem => ({
  kind, jobId: j.id, type: j.type, lane: policyOf(j.type)?.lane ?? null, ageMs: Math.round(Number(j.age_ms)), workerId: j.worker_id,
  sourceId: null, websiteName: null, runId: null, lastError: j.error ? redactText(j.error).slice(0, 500) : null,
});

export async function findBacklog(queue: string, opts: { limit?: number } = {}): Promise<AttentionItem[]> {
  const waiting = rows<Raw>(await db.execute(sql`SELECT id, type, error, NULL::text AS worker_id,
      (extract(epoch FROM now() - run_after) * 1000)::float8 AS age_ms
    FROM jobs WHERE queue = ${queue} AND status = 'queued' AND run_after < now() - make_interval(secs => ${BACKLOG_MS / 1000})
    ORDER BY run_after LIMIT 200`));
  if (waiting.length === 0) return [];
  const moving = rows<{ type: string }>(await db.execute(sql`SELECT DISTINCT type FROM jobs WHERE queue = ${queue}
    AND (status = 'running' OR started_at > now() - make_interval(secs => ${BACKLOG_MS / 1000}))`));
  const busy = new Set(moving.map((m) => policyOf(m.type)?.lane).filter((l): l is Lane => !!l));
  return waiting.filter((j) => { const lane = policyOf(j.type)?.lane; return !lane || !busy.has(lane); })
    .slice(0, opts.limit ?? 50).map((j) => item('backlog', j));
}

async function findSilent(queue: string): Promise<AttentionItem[]> {
  const live = rows<Raw>(await db.execute(sql`SELECT id, type, error, split_part(locked_by, '#', 1) AS worker_id,
      (extract(epoch FROM now() - coalesce(progress_at, started_at)) * 1000)::float8 AS age_ms
    FROM jobs WHERE queue = ${queue} AND status = 'running' AND locked_until > now() ORDER BY started_at LIMIT 200`));
  return live.filter((j) => Number(j.age_ms) > (policyOf(j.type)?.stuckMs ?? DEFAULT_STUCK_MS) / 2).map((j) => item('silent', j));
}

async function findDeadWorkerJobs(queue: string): Promise<AttentionItem[]> {
  const orphaned = rows<Raw>(await db.execute(sql`SELECT j.id, j.type, j.error, w.id AS worker_id,
      (extract(epoch FROM now() - w.beat_at) * 1000)::float8 AS age_ms
    FROM jobs j JOIN workers w ON w.id = split_part(j.locked_by, '#', 1)
    WHERE j.queue = ${queue} AND j.status = 'running' AND w.beat_at < now() - make_interval(secs => ${DEAD_WORKER_MS / 1000})
    ORDER BY w.beat_at LIMIT 200`));
  return orphaned.map((j) => item('dead-worker', j));
}

/** The website (payload `sourceId`, else the status row stamped with the job) and the run (payload `runId`, else the run stamped with it). */
async function withSubjects(items: AttentionItem[]): Promise<AttentionItem[]> {
  if (items.length === 0) return items;
  const ids = sql.join([...new Set(items.map((i) => i.jobId))].map((id) => sql`${id}::uuid`), sql`, `);
  const found = rows<{ id: string; source_id: string | null; run_id: string | null; website_name: string | null }>(await db.execute(sql`
    WITH s AS (
      SELECT j.id,
        coalesce(
          CASE WHEN j.payload->>'sourceId' ~* ${UUID} THEN (j.payload->>'sourceId')::uuid END,
          (SELECT r.source_id FROM runs r WHERE r.job_id = j.id LIMIT 1),
          (SELECT c.source_id FROM captures c WHERE c.job_id = j.id LIMIT 1),
          (SELECT v.source_id FROM source_verifications v WHERE v.job_id = j.id LIMIT 1),
          (SELECT d.source_id FROM drift_checks d WHERE d.job_id = j.id LIMIT 1),
          (SELECT cc.source_id FROM coverage_checks cc WHERE cc.job_id = j.id LIMIT 1),
          (SELECT r.source_id FROM runs r WHERE j.payload->>'runId' ~* ${UUID} AND r.id = (j.payload->>'runId')::uuid)) AS source_id,
        coalesce(
          CASE WHEN j.payload->>'runId' ~* ${UUID} THEN (j.payload->>'runId')::uuid END,
          (SELECT r.id FROM runs r WHERE r.job_id = j.id LIMIT 1)) AS run_id
      FROM jobs j WHERE j.id IN (${ids}))
    SELECT s.id, s.source_id, s.run_id, src.name AS website_name FROM s LEFT JOIN sources src ON src.id = s.source_id`));
  const by = new Map(found.map((f) => [String(f.id), f]));
  return items.map((i) => {
    const f = by.get(i.jobId);
    return f ? { ...i, sourceId: f.source_id ? String(f.source_id) : null, runId: f.run_id ? String(f.run_id) : null, websiteName: f.website_name } : i;
  });
}

export async function findAttention(queue: string): Promise<AttentionItem[]> {
  const [backlog, silent, dead] = await Promise.all([findBacklog(queue), findSilent(queue), findDeadWorkerJobs(queue)]);
  return withSubjects([...backlog, ...silent, ...dead]);
}
```

(`captures.source_id`, `source_verifications.source_id`, `drift_checks.source_id`, `coverage_checks.source_id` and every `job_id` exist — `schema.test.ts`' "every status-row table carries a nullable job_id".)

- [ ] **Step 4: The watchdog and readiness**

`packages/api/src/monitoring/watchdog.ts`:

```ts
// The stuck-job watchdog (spec 2026-10-25 monitoring §2.3): every 60 s each worker reads what needs attention on its
// queue and warns once per job and kind per hour (in memory). It only logs (§3.2).
import { createLog, type Log } from './log.js';
import { findAttention, type AttentionItem } from './attention.js';

export const WATCH_EVERY_MS = 60_000;
export const WARN_AGAIN_MS = 3_600_000;

const minutes = (ms: number) => Math.max(1, Math.round(ms / 60_000));

function sentence(i: AttentionItem): string {
  switch (i.kind) {
    case 'backlog': return `backlog: ${i.type} ${i.jobId} due ${minutes(i.ageMs)} min ago and nobody is taking it`;
    case 'silent': return `silent: ${i.type} ${i.jobId} running with no progress for ${Math.round(i.ageMs / 1000)} s`;
    case 'dead-worker': return `dead worker: ${i.type} ${i.jobId} is running under ${i.workerId}, which last beat ${minutes(i.ageMs)} min ago`;
  }
}

export async function watchJobs(queue: string, opts: {
  log: Log; seen: Map<string, number>; now?: () => number; find?: (queue: string) => Promise<AttentionItem[]>;
}): Promise<AttentionItem[]> {
  const now = (opts.now ?? Date.now)();
  for (const [key, at] of opts.seen) if (now - at >= WARN_AGAIN_MS) opts.seen.delete(key);
  const warned: AttentionItem[] = [];
  for (const i of await (opts.find ?? findAttention)(queue)) {
    const key = `${i.kind}:${i.jobId}`;
    if (opts.seen.has(key)) continue;
    opts.seen.set(key, now);
    warned.push(i);
    opts.log.warn(sentence(i), {
      kind: i.kind, jobId: i.jobId, type: i.type, lane: i.lane, ageMs: i.ageMs, workerId: i.workerId,
      sourceId: i.sourceId, runId: i.runId, lastError: i.lastError,
    });
  }
  return warned;
}

export function startWatchdog(opts: { queue: string; everyMs?: number; log?: Log }): () => void {
  const log = opts.log ?? createLog('watchdog');
  const seen = new Map<string, number>();
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await watchJobs(opts.queue, { log, seen }); } catch (err) { log.warn('the watchdog could not read the queue', { error: err }); } finally { running = false; }
  };
  const timer = setInterval(() => void tick(), opts.everyMs ?? WATCH_EVERY_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}
```

`packages/api/src/monitoring/readiness.ts`:

```ts
// GET /readyz's checks (spec 2026-10-25 monitoring §2.1): db (SELECT 1 within 2 s), migrations (applied ≥ bundled),
// worker (a beat on this queue within 2 minutes), queue (no backlog nobody is taking). Names and booleans only (§3.3).
// A database that does not answer fails every check without reading the others.
import { sql } from 'drizzle-orm';
import { db, migrationCount } from '@robot/db';
import { DEAD_WORKER_MS } from './heartbeat.js';
import { findBacklog } from './attention.js';

export const READY_TIMEOUT_MS = 2000;
export type ReadinessChecks = { db: boolean; migrations: boolean; worker: boolean; queue: boolean };
export type Readiness = { ok: boolean; checks: ReadinessChecks };

function within<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([p, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms); })])
    .finally(() => clearTimeout(timer));
}

export async function readiness(opts: { queue: string; ping?: () => Promise<unknown>; expectedMigrations?: () => number; timeoutMs?: number }): Promise<Readiness> {
  const ms = opts.timeoutMs ?? READY_TIMEOUT_MS;
  const checks: ReadinessChecks = { db: false, migrations: false, worker: false, queue: false };
  try {
    await within(Promise.resolve().then(() => (opts.ping ?? (() => db.execute(sql`SELECT 1`)))()), ms);
    checks.db = true;
  } catch {
    return { ok: false, checks };
  }
  const [m, w, q] = await Promise.allSettled([
    within(db.execute(sql`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`), ms),
    within(db.execute(sql`SELECT 1 FROM workers WHERE queue = ${opts.queue}
      AND beat_at > now() - make_interval(secs => ${DEAD_WORKER_MS / 1000}) LIMIT 1`), ms),
    within(findBacklog(opts.queue, { limit: 1 }), ms),
  ]);
  checks.migrations = m.status === 'fulfilled' && Number((m.value as unknown as Array<{ n: number }>)[0]?.n ?? 0) >= (opts.expectedMigrations ?? migrationCount)();
  checks.worker = w.status === 'fulfilled' && (w.value as unknown as unknown[]).length > 0;
  checks.queue = q.status === 'fulfilled' && q.value.length === 0;
  return { ok: checks.db && checks.migrations && checks.worker && checks.queue, checks };
}
```

Append to `packages/api/src/monitoring/index.ts`:

```ts
export { readiness, type Readiness, type ReadinessChecks } from './readiness.js';
export { startWatchdog, watchJobs } from './watchdog.js';
export { findAttention, type AttentionItem } from './attention.js';
```

- [ ] **Step 5: The request log and `/readyz` in the api-server; the watchdog in the worker**

`packages/api-server/src/request-log.ts`:

```ts
// The api-server's request log (spec 2026-10-25 monitoring §2.2): method, path without the query string, status,
// duration and client IP — at info, /healthz and /readyz at debug. Never a query, a body, a header or a cookie.
import type { MiddlewareHandler } from 'hono';
import type { Log } from '@robot/api/log';
import { clientIpOf } from './client-ip.js';

const QUIET = new Set(['/healthz', '/readyz']);

export function requestLog(log: Log): MiddlewareHandler {
  return async (c, next) => {
    const started = performance.now();
    try {
      await next();
    } finally {
      const fields = { method: c.req.method, path: c.req.path, status: c.res.status, ms: Math.round(performance.now() - started), ip: clientIpOf(c) };
      (QUIET.has(fields.path) ? log.debug : log.info)(`${fields.method} ${fields.path} ${fields.status} ${fields.ms} ms`, fields);
    }
  };
}
```

`packages/api-server/src/app.ts`:
- imports: `import { createLog, type Log } from '@robot/api/log';`, `import { readiness as checkReadiness, type Readiness } from '@robot/api/monitoring';`, `import { jobQueueName } from '@robot/api/jobs';`, `import { requestLog } from './request-log.js';`
- `AppDeps` gains:

```ts
  /** Spec 2026-10-25 monitoring §2.2: the request log's logger (default `createLog('api-server')`). */
  log: Log;
  /** Spec 2026-10-25 monitoring §2.1: /readyz's checks (default: this process's JOB_QUEUE). */
  readiness: () => Promise<Readiness>;
```

- in `createApp`: `const log = deps.log ?? createLog('api-server');` and `const ready = deps.readiness ?? (() => checkReadiness({ queue: jobQueueName() }));`; right after `app.onError(…)` (Task 3) and before the CORS `app.use`: `app.use('*', requestLog(log));`; after `app.get('/healthz', …)`:

```ts
  // Readiness (spec 2026-10-25 monitoring §2.1, §2.6): no auth; check names and booleans only — no ids, hosts or errors.
  app.get('/readyz', async (c) => {
    let r: Readiness;
    try { r = await ready(); } catch { r = { ok: false, checks: { db: false, migrations: false, worker: false, queue: false } }; }
    c.header('cache-control', 'no-store');
    return c.json({ status: r.ok ? 'ok' : 'unavailable', checks: r.checks }, r.ok ? 200 : 503);
  });
```

`packages/worker/src/worker.ts`: add `startWatchdog` to the `@robot/api/monitoring` import; after `const heartbeat = startHeartbeat(…)` add `const stopWatch = startWatchdog({ queue: config.queue, ...(deps.watchEveryMs ? { everyMs: deps.watchEveryMs } : {}) });`; in `stop()`, after `stopRecurring();` add `stopWatch();`; in the file's monitoring comment line add `, and its watchdog warns about stuck work every 60 s`.

- [ ] **Step 6: Run the tests, type-check**

Run, one at a time: `cd $W/packages/api && npx vitest run src/monitoring/attention.test.ts src/monitoring/readiness.test.ts`; `npx tsc --noEmit`; `cd $W/packages/api-server && npx vitest run src/app.test.ts`; `npx tsc --noEmit`; `cd $W/packages/worker && npx vitest run src/monitoring.test.ts`; `npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
cd $W
git add packages/api/src/monitoring/attention.ts packages/api/src/monitoring/attention.test.ts packages/api/src/monitoring/watchdog.ts packages/api/src/monitoring/readiness.ts packages/api/src/monitoring/readiness.test.ts packages/api/src/monitoring/index.ts packages/api-server/src/request-log.ts packages/api-server/src/app.ts packages/api-server/src/app.test.ts packages/worker/src/worker.ts
git commit -m "feat(api): stuck-job watchdog, /readyz, and the api-server request log

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `ops.queue` and `/ops/queue` (`@robot/api`, `@robot/app`; the staff smoke) — spec §2.5, §2.6, §4 "API and server" (`ops.queue`, the classification), §4 "App"

**Files:**
- Create: `packages/api/src/monitoring/queue-view.ts`, `packages/api/src/monitoring/queue-view.test.ts`
- Modify: `packages/api/src/routers/ops.ts` (`queue`), `packages/api/src/isolation/procedure-classes.ts` (`'ops.queue'`), `packages/api/src/monitoring/index.ts`
- Create: `packages/app/src/lib/ops-queue-view.ts`, `packages/app/src/lib/ops-queue-view.test.ts`, `packages/app/src/routes/_app/ops/queue.tsx`
- Modify: `packages/app/src/components/shell/ops-sidebar.tsx` (the Queue link), `packages/app/src/routes/_app.tsx` (`OpsBreadcrumb`), `packages/app/src/staff-smoke.test.ts`, `packages/app/src/routes-smoke.test.ts`
- Regenerated: `packages/app/src/routeTree.gen.ts` (only the `/ops/queue` lines)

**Interfaces:**
- Consumes: `findAttention`, `type AttentionItem` (Task 5); `DEAD_WORKER_MS` (Task 4); `redactText` (Task 2); `jobQueueName` (`jobs/queue.ts`); `opsProcedure` (`trpc.ts`).
- Produces (`packages/api/src/monitoring/queue-view.ts`): `type QueueWorker = { id: string; queue: string; version: string | null; startedAt: Date; beatAt: Date; beatAgeMs: number; dead: boolean; browsers: { inUse: number; max: number }; lanes: Partial<Record<Lane, number>>; websiteChecks: boolean; recurringRuns: boolean }`; `type QueueTypeRow = { type: string; queued: number; running: number; done: number; failed: number; oldestQueuedMs: number | null; longestRunningMs: number | null }` (done/failed: the last 24 hours); `type QueueFailure = { jobId: string; type: string; attempts: number; maxAttempts: number; error: string | null; finishedAt: Date | null; agoMs: number | null }`; `type QueueOverview = { queue: string; workers: QueueWorker[]; types: QueueTypeRow[]; attention: AttentionItem[]; failures: QueueFailure[] }`; `queueOverview(queue: string): Promise<QueueOverview>`.
- Produces (`ops.queue`): `opsProcedure.query(() => queueOverview(jobQueueName()))` — no input.
- Produces (`packages/app/src/lib/ops-queue-view.ts`): the re-declared shapes; `QUEUE_REFRESH_MS = 15_000`; `STALE_BEAT_MS = 120_000`; `WORKERS_EMPTY`, `TYPES_EMPTY`, `ATTENTION_EMPTY`, `FAILURES_EMPTY`; `ATTENTION_LABELS`; `durationText(ms: number | null): string`; `workerRowsView(workers, thisQueue)`, `typeRowsView(types)`, `attentionRowsView(items)`, `failureRowsView(failures)`.

- [ ] **Step 1: Write the failing tests**

`packages/api/src/monitoring/queue-view.test.ts`:

```ts
// Spec 2026-10-25 monitoring §2.5, §4 "API and server": ops.queue's shape and operator-only access.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { db, jobs, workers } from '@robot/db';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from '../routers/index.js';
import { jobQueueName } from '../jobs/queue.js';
import { signedInCaller, type SignedIn } from '../test-helpers/identity.js';

const q = () => jobQueueName();
const codeOf = async (p: Promise<unknown>) => { try { await p; return 'OK'; } catch (e) { return e instanceof TRPCError ? e.code : String(e); } };
let op: SignedIn;
let customer: SignedIn;
const saved = process.env.OPS_EMAILS;
beforeAll(async () => {
  op = await signedInCaller('ops-queue-op');
  customer = await signedInCaller('ops-queue-cust');
  process.env.OPS_EMAILS = op.user.email;
});
afterAll(async () => {
  if (saved === undefined) delete process.env.OPS_EMAILS; else process.env.OPS_EMAILS = saved;
  await op.cleanup();
  await customer.cleanup();
});
afterEach(async () => {
  await db.delete(jobs).where(eq(jobs.queue, q()));
  await db.delete(workers).where(eq(workers.queue, q()));
});

describe('ops.queue (spec 2026-10-25 monitoring §2.5)', () => {
  it('gives an operator the workers, the jobs by type, what needs attention and the last failures — redacted', async () => {
    const id = `oq:1:${randomUUID().slice(0, 8)}`;
    await db.insert(workers).values({ id, queue: q(), startedAt: new Date(), version: 'v-oq', browsers: { inUse: 1, max: 3 }, lanes: { interactive: 0, background: 1, runs: 0 }, websiteChecks: true, recurringRuns: false });
    await db.insert(workers).values({ id: `${id}-dead`, queue: q(), startedAt: new Date(), beatAt: sql`now() - interval '5 minutes'` });
    const [late] = await db.insert(jobs).values({ queue: q(), type: 'reachability', runAfter: sql`now() - interval '11 minutes'` }).returning();
    await db.insert(jobs).values({ queue: q(), type: 'verify', status: 'done', startedAt: sql`now() - interval '2 minutes'`, finishedAt: sql`now() - interval '1 minute'` });
    const [failed] = await db.insert(jobs).values({ queue: q(), type: 'verify', status: 'failed', attempts: 2, maxAttempts: 2, error: 'could not reach http://u:oq-secret@h.test:1', finishedAt: sql`now()` }).returning();
    const out = await op.caller.ops.queue();
    expect(out.queue).toBe(q());
    expect(out.workers.find((w) => w.id === id)).toMatchObject({ queue: q(), version: 'v-oq', dead: false, browsers: { inUse: 1, max: 3 }, lanes: { background: 1 }, websiteChecks: true, recurringRuns: false });
    expect(out.workers.find((w) => w.id === id)!.beatAgeMs).toBeLessThan(60_000);
    expect(out.workers.find((w) => w.id === `${id}-dead`)).toMatchObject({ dead: true });
    expect(out.types.find((t) => t.type === 'reachability')).toMatchObject({ queued: 1, running: 0, done: 0, failed: 0, longestRunningMs: null });
    expect(out.types.find((t) => t.type === 'reachability')!.oldestQueuedMs).toBeGreaterThan(10 * 60_000);
    expect(out.types.find((t) => t.type === 'verify')).toMatchObject({ queued: 0, running: 0, done: 1, failed: 1, oldestQueuedMs: null });
    expect(out.attention).toEqual([expect.objectContaining({ kind: 'backlog', jobId: late!.id, type: 'reachability' })]);
    expect(out.failures[0]).toMatchObject({ jobId: failed!.id, type: 'verify', attempts: 2, maxAttempts: 2, error: 'could not reach http://***@h.test:1' });
    expect(out.failures[0]!.finishedAt).toBeInstanceOf(Date);
    expect(JSON.stringify(out)).not.toContain('oq-secret');
  });

  it('a queue with nothing on it answers empty lists, not an error', async () => {
    const out = await op.caller.ops.queue();
    expect(out.types).toEqual([]);
    expect(out.attention).toEqual([]);
    expect(out.failures).toEqual([]);
  });

  it('is FORBIDDEN to a customer and UNAUTHORIZED signed out', async () => {
    expect(await codeOf(customer.caller.ops.queue())).toBe('FORBIDDEN');
    expect(await codeOf(createCallerFactory(appRouter)({ db, session: null }).ops.queue())).toBe('UNAUTHORIZED');
  });
});
```

`packages/app/src/lib/ops-queue-view.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  ATTENTION_LABELS, attentionRowsView, durationText, failureRowsView, typeRowsView, workerRowsView,
  type QueueAttention, type QueueFailure, type QueueTypeRow, type QueueWorker,
} from './ops-queue-view';

const worker = (over: Partial<QueueWorker> = {}): QueueWorker => ({
  id: 'host:12:abcd1234', queue: 'default', version: 'a27d292', startedAt: new Date('2026-10-25T10:00:00Z'), beatAt: new Date('2026-10-25T12:00:00Z'),
  beatAgeMs: 12_000, dead: false, browsers: { inUse: 1, max: 3 }, lanes: { interactive: 1, background: 0 }, websiteChecks: true, recurringRuns: false, ...over,
});

describe('the ops Queue view (spec 2026-10-25 monitoring §2.5)', () => {
  it('reads durations short', () => {
    expect([null, Number.NaN, 400, 12_000, 59_499, 61_000, 3 * 3_600_000, 3 * 3_600_000 + 5 * 60_000, 50 * 3_600_000].map(durationText))
      .toEqual(['—', '—', '0 s', '12 s', '59 s', '1 min', '3 h', '3 h 5 min', '2 d']);
  });

  it('labels each worker; a beat past 2 minutes is stale', () => {
    expect(workerRowsView([worker()], 'default')[0]).toEqual({
      id: 'host:12:abcd1234', queue: 'default', thisQueue: true, version: 'a27d292', beatLabel: '12 s ago', stale: false,
      browsersLabel: '1 / 3', lanesLabel: 'interactive 1 · background 0 · runs 0', switchesLabel: 'checks on · schedules off',
    });
    expect(workerRowsView([worker({ beatAgeMs: 121_000, version: null, queue: 'isolated-4100' })], 'default')[0]).toMatchObject({ stale: true, version: '—', thisQueue: false, beatLabel: '2 min ago' });
    expect(workerRowsView([worker({ dead: true, beatAgeMs: 1000 })], 'default')[0]!.stale).toBe(true);
  });

  it('labels jobs by type, attention items with their website and run, and failures', () => {
    const t: QueueTypeRow = { type: 'verify', queued: 2, running: 1, done: 10, failed: 1, oldestQueuedMs: 700_000, longestRunningMs: null };
    expect(typeRowsView([t])[0]).toEqual({ type: 'verify', queued: '2', running: '1', done: '10', failed: '1', oldestLabel: '11 min', longestLabel: '—' });
    const a: QueueAttention = { kind: 'silent', jobId: '0f1e2d3c-0000-4000-8000-000000000001', type: 'run', lane: 'runs', ageMs: 600_000, workerId: 'host:1:a', sourceId: '11111111-0000-4000-8000-000000000001', websiteName: 'Lamps', runId: '22222222-0000-4000-8000-000000000002', lastError: null };
    expect(attentionRowsView([a])[0]).toEqual({
      key: 'silent:0f1e2d3c-0000-4000-8000-000000000001', label: ATTENTION_LABELS.silent, type: 'run', ageLabel: '10 min', job: '0f1e2d3c',
      website: { sourceId: '11111111-0000-4000-8000-000000000001', name: 'Lamps' }, run: 'run 22222222', worker: 'host:1:a', error: '—',
    });
    expect(attentionRowsView([{ ...a, sourceId: null, websiteName: null, runId: null, workerId: null, lastError: 'stalled' }])[0]).toMatchObject({ website: null, run: null, worker: '—', error: 'stalled' });
    expect(ATTENTION_LABELS).toEqual({ backlog: 'Waiting, nobody is taking it', silent: 'Running, no progress', 'dead-worker': 'Its worker stopped answering' });
    const f: QueueFailure = { jobId: 'j1', type: 'verify', attempts: 2, maxAttempts: 2, error: 'stalled', finishedAt: new Date(), agoMs: 90_000 };
    expect(failureRowsView([f, { ...f, jobId: 'j2', error: null, agoMs: null }])).toEqual([
      { key: 'j1', type: 'verify', attemptsLabel: '2 of 2', error: 'stalled', finishedLabel: '1 min ago' },
      { key: 'j2', type: 'verify', attemptsLabel: '2 of 2', error: '—', finishedLabel: '—' },
    ]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd $W/packages/api && npx vitest run src/monitoring/queue-view.test.ts`; `cd $W/packages/app && npx vitest run src/lib/ops-queue-view.test.ts`
Expected: FAIL — `ops.queue` and `./ops-queue-view` do not exist.

- [ ] **Step 3: The overview and the procedure**

`packages/api/src/monitoring/queue-view.ts`:

```ts
// ops' Queue view (spec 2026-10-25 monitoring §2.5): every worker row (this queue first), this queue's jobs by type and
// status (done and failed: the last 24 hours), what needs attention, and the last 20 failures with their error
// redacted. Ages on the database's clock. Staff only (`ops.queue`); read-only.
import { sql } from 'drizzle-orm';
import { db } from '@robot/db';
import type { Lane } from '../jobs/types.js';
import { findAttention, type AttentionItem } from './attention.js';
import { DEAD_WORKER_MS } from './heartbeat.js';
import { redactText } from './redact.js';

export type QueueWorker = {
  id: string; queue: string; version: string | null; startedAt: Date; beatAt: Date; beatAgeMs: number; dead: boolean;
  browsers: { inUse: number; max: number }; lanes: Partial<Record<Lane, number>>; websiteChecks: boolean; recurringRuns: boolean;
};
export type QueueTypeRow = { type: string; queued: number; running: number; done: number; failed: number; oldestQueuedMs: number | null; longestRunningMs: number | null };
export type QueueFailure = { jobId: string; type: string; attempts: number; maxAttempts: number; error: string | null; finishedAt: Date | null; agoMs: number | null };
export type QueueOverview = { queue: string; workers: QueueWorker[]; types: QueueTypeRow[]; attention: AttentionItem[]; failures: QueueFailure[] };

const rows = <T>(r: unknown) => r as T[];
const date = (v: Date | string | null): Date | null => (v === null ? null : v instanceof Date ? v : new Date(v));
const ms = (v: unknown): number | null => (v === null || v === undefined ? null : Math.round(Number(v)));
const browsersOf = (v: unknown): { inUse: number; max: number } => {
  const b = (v ?? {}) as { inUse?: unknown; max?: unknown };
  return { inUse: Number(b.inUse ?? 0), max: Number(b.max ?? 0) };
};

export async function queueOverview(queue: string): Promise<QueueOverview> {
  const [w, t, f, attention] = await Promise.all([
    db.execute(sql`SELECT id, queue, version, started_at, beat_at, browsers, lanes, website_checks, recurring_runs,
        (extract(epoch FROM now() - beat_at) * 1000)::float8 AS beat_age_ms,
        beat_at < now() - make_interval(secs => ${DEAD_WORKER_MS / 1000}) AS dead
      FROM workers ORDER BY (queue = ${queue}) DESC, beat_at DESC LIMIT 50`),
    db.execute(sql`SELECT type,
        count(*) FILTER (WHERE status = 'queued')::int AS queued,
        count(*) FILTER (WHERE status = 'running')::int AS running,
        count(*) FILTER (WHERE status = 'done' AND finished_at > now() - interval '1 day')::int AS done,
        count(*) FILTER (WHERE status = 'failed' AND finished_at > now() - interval '1 day')::int AS failed,
        (extract(epoch FROM now() - min(run_after) FILTER (WHERE status = 'queued' AND run_after <= now())) * 1000)::float8 AS oldest_queued_ms,
        (extract(epoch FROM now() - min(started_at) FILTER (WHERE status = 'running')) * 1000)::float8 AS longest_running_ms
      FROM jobs WHERE queue = ${queue}
      GROUP BY type
      HAVING count(*) FILTER (WHERE status IN ('queued', 'running') OR finished_at > now() - interval '1 day') > 0
      ORDER BY type`),
    db.execute(sql`SELECT id, type, attempts, max_attempts, error, finished_at,
        (extract(epoch FROM now() - finished_at) * 1000)::float8 AS ago_ms
      FROM jobs WHERE queue = ${queue} AND status = 'failed' ORDER BY finished_at DESC NULLS LAST LIMIT 20`),
    findAttention(queue),
  ]);
  return {
    queue,
    workers: rows<Record<string, unknown>>(w).map((r) => ({
      id: String(r.id), queue: String(r.queue), version: (r.version as string | null) ?? null,
      startedAt: date(r.started_at as Date | string)!, beatAt: date(r.beat_at as Date | string)!, beatAgeMs: ms(r.beat_age_ms) ?? 0, dead: r.dead === true,
      browsers: browsersOf(r.browsers), lanes: (r.lanes ?? {}) as Partial<Record<Lane, number>>,
      websiteChecks: r.website_checks === true, recurringRuns: r.recurring_runs === true,
    })),
    types: rows<Record<string, unknown>>(t).map((r) => ({
      type: String(r.type), queued: Number(r.queued), running: Number(r.running), done: Number(r.done), failed: Number(r.failed),
      oldestQueuedMs: ms(r.oldest_queued_ms), longestRunningMs: ms(r.longest_running_ms),
    })),
    attention,
    failures: rows<Record<string, unknown>>(f).map((r) => ({
      jobId: String(r.id), type: String(r.type), attempts: Number(r.attempts), maxAttempts: Number(r.max_attempts),
      error: r.error ? redactText(String(r.error)).slice(0, 500) : null, finishedAt: date((r.finished_at as Date | string | null) ?? null), agoMs: ms(r.ago_ms),
    })),
  };
}
```

Append to `packages/api/src/monitoring/index.ts`: `export { queueOverview, type QueueOverview } from './queue-view.js';`

`packages/api/src/routers/ops.ts`: imports `import { jobQueueName } from '../jobs/queue.js';` and `import { queueOverview } from '../monitoring/queue-view.js';`; after `orgs: …` (before the router's closing `});`):

```ts

  /**
   * The queue (spec 2026-10-25 monitoring §2.5): every worker's heartbeat, this api-server's JOB_QUEUE by type and
   * status, what needs attention (the watchdog's backlog / silent / dead-worker) and the last 20 failures, redacted.
   * Read-only; refreshed by the app every 15 s.
   */
  queue: opsProcedure.query(() => queueOverview(jobQueueName())),
```

`packages/api/src/isolation/procedure-classes.ts`: after `'ops.orgs': …` add `'ops.queue': { class: 'ops' },`.

- [ ] **Step 4: Run the api tests**

Run: `cd $W/packages/api && npx vitest run src/monitoring/queue-view.test.ts`; then `npx vitest run src/isolation/procedure-sweep.test.ts`; then `npx tsc --noEmit`
Expected: PASS (the sweep has `ops.queue` FORBIDDEN to a customer), no type errors.

- [ ] **Step 5: The app's view**

`packages/app/src/lib/ops-queue-view.ts`:

```ts
// The ops Queue view (spec 2026-10-25 monitoring §2.5): staff only. Pure. Mirrors `ops.queue`'s answer (the app's
// views re-declare the api's shapes, like ops-orgs-view.ts).
export type QueueLane = 'interactive' | 'background' | 'runs';
export type QueueWorker = {
  id: string; queue: string; version: string | null; startedAt: Date; beatAt: Date; beatAgeMs: number; dead: boolean;
  browsers: { inUse: number; max: number }; lanes: Partial<Record<QueueLane, number>>; websiteChecks: boolean; recurringRuns: boolean;
};
export type QueueTypeRow = { type: string; queued: number; running: number; done: number; failed: number; oldestQueuedMs: number | null; longestRunningMs: number | null };
export type QueueAttention = {
  kind: 'backlog' | 'silent' | 'dead-worker'; jobId: string; type: string; lane: QueueLane | null; ageMs: number; workerId: string | null;
  sourceId: string | null; websiteName: string | null; runId: string | null; lastError: string | null;
};
export type QueueFailure = { jobId: string; type: string; attempts: number; maxAttempts: number; error: string | null; finishedAt: Date | null; agoMs: number | null };
export type QueueOverview = { queue: string; workers: QueueWorker[]; types: QueueTypeRow[]; attention: QueueAttention[]; failures: QueueFailure[] };

export const QUEUE_REFRESH_MS = 15_000;
/** A beat older than this reads red: the worker has stopped answering (spec §2.1's 2 minutes). */
export const STALE_BEAT_MS = 120_000;
export const WORKERS_EMPTY = 'No worker has beaten in the last day. Nothing on this queue is being run.';
export const TYPES_EMPTY = 'No jobs on this queue in the last day.';
export const ATTENTION_EMPTY = 'Nothing needs attention.';
export const FAILURES_EMPTY = 'No failed jobs.';
export const ATTENTION_LABELS = {
  backlog: 'Waiting, nobody is taking it',
  silent: 'Running, no progress',
  'dead-worker': 'Its worker stopped answering',
} as const;
const LANES: QueueLane[] = ['interactive', 'background', 'runs'];

export function durationText(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '—';
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
  return `${Math.floor(h / 24)} d`;
}

export function workerRowsView(workers: readonly QueueWorker[], thisQueue: string) {
  return workers.map((w) => ({
    id: w.id, queue: w.queue, thisQueue: w.queue === thisQueue, version: w.version ?? '—',
    beatLabel: `${durationText(w.beatAgeMs)} ago`, stale: w.dead || w.beatAgeMs > STALE_BEAT_MS,
    browsersLabel: `${w.browsers.inUse} / ${w.browsers.max}`,
    lanesLabel: LANES.map((l) => `${l} ${w.lanes[l] ?? 0}`).join(' · '),
    switchesLabel: `checks ${w.websiteChecks ? 'on' : 'off'} · schedules ${w.recurringRuns ? 'on' : 'off'}`,
  }));
}

export function typeRowsView(types: readonly QueueTypeRow[]) {
  return types.map((t) => ({
    type: t.type, queued: String(t.queued), running: String(t.running), done: String(t.done), failed: String(t.failed),
    oldestLabel: durationText(t.oldestQueuedMs), longestLabel: durationText(t.longestRunningMs),
  }));
}

export function attentionRowsView(items: readonly QueueAttention[]) {
  return items.map((i) => ({
    key: `${i.kind}:${i.jobId}`, label: ATTENTION_LABELS[i.kind], type: i.type, ageLabel: durationText(i.ageMs), job: i.jobId.slice(0, 8),
    website: i.sourceId ? { sourceId: i.sourceId, name: i.websiteName ?? i.sourceId.slice(0, 8) } : null,
    run: i.runId ? `run ${i.runId.slice(0, 8)}` : null, worker: i.workerId ?? '—', error: i.lastError ?? '—',
  }));
}

export function failureRowsView(failures: readonly QueueFailure[]) {
  return failures.map((f) => ({
    key: f.jobId, type: f.type, attemptsLabel: `${f.attempts} of ${f.maxAttempts}`, error: f.error ?? '—',
    finishedLabel: f.agoMs === null ? '—' : `${durationText(f.agoMs)} ago`,
  }));
}
```

Run: `cd $W/packages/app && npx vitest run src/lib/ops-queue-view.test.ts` → PASS.

- [ ] **Step 6: The route, the sidebar link and the breadcrumb**

`packages/app/src/routes/_app/ops/queue.tsx`:

```tsx
import type { ReactNode } from 'react';
import { Link, createFileRoute, redirect } from '@tanstack/react-router';
import { Page } from '../../../components/page';
import { Skeleton } from '../../../components/ui/skeleton';
import {
  ATTENTION_EMPTY, FAILURES_EMPTY, QUEUE_REFRESH_MS, TYPES_EMPTY, WORKERS_EMPTY,
  attentionRowsView, failureRowsView, typeRowsView, workerRowsView, type QueueOverview,
} from '../../../lib/ops-queue-view';
import { trpc } from '../../../lib/trpc';
import { useUnauthorizedRedirect } from '../../../lib/use-unauthorized-redirect';

/**
 * Queue (spec 2026-10-25 monitoring §2.5): the workers' heartbeats, this server's jobs by type, what needs attention
 * and the last failures. Read-only, every 15 s. The server's FORBIDDEN on `ops.queue` is the real gate; a non-operator
 * is sent away first.
 */
export const Route = createFileRoute('/_app/ops/queue')({
  beforeLoad: ({ context }) => {
    if (!context.session.isOperator) throw redirect({ to: '/projects' });
  },
  component: OpsQueuePage,
});

const TH = 'px-3 py-2 text-left text-sm font-normal whitespace-nowrap text-muted-foreground';
const THN = 'px-3 py-2 text-right text-sm font-normal whitespace-nowrap text-muted-foreground';
const TD = 'px-3 py-2.5 align-top';
const NUM = 'px-3 py-2.5 text-right font-mono tabular-nums whitespace-nowrap';
const ROW = 'border-b border-line last:border-0';

function Section({ title, testId, empty, children }: { title: string; testId: string; empty: string | null; children: ReactNode }) {
  return (
    <section data-testid={testId} className="rise mb-4 rounded-[6px] border border-line bg-panel [box-shadow:var(--shadow)]">
      <h2 className="border-b border-line px-4 py-3 text-base font-medium">{title}</h2>
      {empty ? <p className="px-4 py-6 text-center text-base text-muted-foreground">{empty}</p> : <div className="overflow-x-auto">{children}</div>}
    </section>
  );
}

function OpsQueuePage() {
  const query = trpc.ops.queue.useQuery(undefined, { refetchInterval: QUEUE_REFRESH_MS, refetchOnWindowFocus: true });
  const unauthorized = useUnauthorizedRedirect(query);
  if (unauthorized) return null;
  const data = query.data as QueueOverview | undefined;

  if (query.isError) {
    return (
      <Page title="Queue" subtitle="The workers and the jobs on this server's queue.">
        <p role="alert" className="rise text-base text-fail">The queue could not be loaded. Try again.</p>
      </Page>
    );
  }
  if (!data) {
    return (
      <Page title="Queue" subtitle="The workers and the jobs on this server's queue.">
        <Skeleton className="h-40 w-full bg-raised" />
      </Page>
    );
  }
  const workers = workerRowsView(data.workers, data.queue);
  const types = typeRowsView(data.types);
  const attention = attentionRowsView(data.attention);
  const failures = failureRowsView(data.failures);

  return (
    <Page title="Queue" subtitle={`The workers and the jobs on this server's queue (${data.queue}), every 15 seconds.`}>
      <Section title="Workers" testId="queue-workers" empty={workers.length === 0 ? WORKERS_EMPTY : null}>
        <table className="w-full min-w-[860px] border-collapse text-base">
          <thead><tr className="border-b border-line">
            <th className={TH}>Worker</th><th className={TH}>Queue</th><th className={TH}>Version</th><th className={TH}>Last beat</th>
            <th className={THN}>Browsers</th><th className={TH}>Running</th><th className={TH}>Switches</th>
          </tr></thead>
          <tbody>
            {workers.map((w) => (
              <tr key={w.id} data-stale={String(w.stale)} className={ROW}>
                <td className={`${TD} font-mono text-sm`}>{w.id}</td>
                <td className={`${TD} font-mono text-sm`}>{w.queue}{w.thisQueue ? <span className="ml-2 text-muted-foreground">(this server)</span> : null}</td>
                <td className={`${TD} font-mono text-sm`}>{w.version}</td>
                <td className={`${TD} whitespace-nowrap ${w.stale ? 'text-fail' : ''}`}>{w.beatLabel}{w.stale ? ' — stopped answering' : ''}</td>
                <td className={NUM}>{w.browsersLabel}</td>
                <td className={`${TD} text-sm text-muted-foreground`}>{w.lanesLabel}</td>
                <td className={`${TD} text-sm text-muted-foreground`}>{w.switchesLabel}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Jobs" testId="queue-types" empty={types.length === 0 ? TYPES_EMPTY : null}>
        <table className="w-full min-w-[720px] border-collapse text-base">
          <thead><tr className="border-b border-line">
            <th className={TH}>Type</th><th className={THN}>Queued</th><th className={THN}>Running</th><th className={THN}>Done (24 h)</th>
            <th className={THN}>Failed (24 h)</th><th className={THN}>Oldest waiting</th><th className={THN}>Longest running</th>
          </tr></thead>
          <tbody>
            {types.map((t) => (
              <tr key={t.type} className={ROW}>
                <td className={`${TD} font-mono text-sm`}>{t.type}</td>
                <td className={NUM}>{t.queued}</td><td className={NUM}>{t.running}</td><td className={NUM}>{t.done}</td>
                <td className={NUM}>{t.failed}</td><td className={NUM}>{t.oldestLabel}</td><td className={NUM}>{t.longestLabel}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Needs attention" testId="queue-attention" empty={attention.length === 0 ? ATTENTION_EMPTY : null}>
        <table className="w-full min-w-[860px] border-collapse text-base">
          <thead><tr className="border-b border-line">
            <th className={TH}>What</th><th className={TH}>Type</th><th className={THN}>For</th><th className={TH}>Website</th>
            <th className={TH}>Job</th><th className={TH}>Worker</th><th className={TH}>Last error</th>
          </tr></thead>
          <tbody>
            {attention.map((a) => (
              <tr key={a.key} className={ROW}>
                <td className={`${TD} text-fail`}>{a.label}</td>
                <td className={`${TD} font-mono text-sm`}>{a.type}</td>
                <td className={NUM}>{a.ageLabel}</td>
                <td className={TD}>
                  {a.website ? <Link to="/ops/websites/$sourceId" params={{ sourceId: a.website.sourceId }} className="underline-offset-2 hover:underline">{a.website.name}</Link> : '—'}
                  {a.run ? <span className="ml-2 font-mono text-sm text-muted-foreground">{a.run}</span> : null}
                </td>
                <td className={`${TD} font-mono text-sm`}>{a.job}</td>
                <td className={`${TD} font-mono text-sm text-muted-foreground`}>{a.worker}</td>
                <td className={`${TD} max-w-[320px] text-sm break-words text-muted-foreground`}>{a.error}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Recent failures" testId="queue-failures" empty={failures.length === 0 ? FAILURES_EMPTY : null}>
        <table className="w-full min-w-[720px] border-collapse text-base">
          <thead><tr className="border-b border-line">
            <th className={TH}>Type</th><th className={THN}>Attempts</th><th className={TH}>Error</th><th className={THN}>Finished</th>
          </tr></thead>
          <tbody>
            {failures.map((f) => (
              <tr key={f.key} className={ROW}>
                <td className={`${TD} font-mono text-sm`}>{f.type}</td>
                <td className={NUM}>{f.attemptsLabel}</td>
                <td className={`${TD} max-w-[480px] text-sm break-words text-muted-foreground`}>{f.error}</td>
                <td className={NUM}>{f.finishedLabel}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </Page>
  );
}
```

`packages/app/src/components/shell/ops-sidebar.tsx`: add `Activity` to the `lucide-react` import, and after the Organisations `<Link …>…</Link>`:

```tsx
          <Link
            to="/ops/queue"
            onClick={onNavigate}
            className="flex items-center gap-2.5 rounded-[6px] px-2 py-1.5 text-base text-muted-foreground hover:text-text"
            activeProps={{ className: 'bg-raised font-medium text-text!' }}
          >
            <Activity className="size-4 shrink-0" />
            Queue
          </Link>
```

`packages/app/src/routes/_app.tsx`, `OpsBreadcrumb`, after the `if (pathname === '/ops/orgs') { … }` block:

```tsx
  if (pathname === '/ops/queue') {
    return (
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
        <Link to="/ops" search={backSearch} className="truncate hover:text-text">
          Ops
        </Link>
        <span aria-hidden className="text-muted-foreground">/</span>
        <b className="truncate font-medium text-text">Queue</b>
      </nav>
    );
  }
```

- [ ] **Step 7: The smokes**

`packages/app/src/staff-smoke.test.ts`, after step 6b (`await shoot(page, 'staff-ops-orgs.png');`) and before the `pageErrors` check:

```ts
    // 6c. Ops → Queue (spec 2026-10-25 monitoring §2.5): this pair's worker beats on isolated-4100 and is not stale;
    // no view shows a credential.
    await page.goto(`${APP}/ops/queue`, { waitUntil: 'networkidle', timeout: 30_000 });
    await page.getByRole('heading', { name: 'Queue', exact: true }).waitFor({ timeout: 20_000 });
    const workersBox = page.getByTestId('queue-workers');
    await expect.poll(() => workersBox.innerText(), { timeout: 20_000, message: 'the pair’s worker is not on the Queue page' }).toContain('isolated-4100');
    const ours = workersBox.locator('tbody tr', { hasText: 'isolated-4100' }).first();
    expect(await ours.getAttribute('data-stale'), 'the pair’s worker reads as stopped').toBe('false');
    for (const id of ['queue-types', 'queue-attention', 'queue-failures']) await page.getByTestId(id).waitFor({ timeout: 10_000 });
    expect(await page.locator('main').innerText()).not.toMatch(/:\/\/[^\s/@]*:[^\s/@]*@/);
    await shoot(page, 'staff-ops-queue.png');
```

`packages/app/src/routes-smoke.test.ts`, in "a fresh throwaway account never sees ops mode, and /ops redirects it to /projects", after `await page.waitForURL(\`${APP}/projects\`, { timeout: 30_000 });`:

```ts
    // Spec 2026-10-25 monitoring §2.6: the Queue page is staff-only too.
    await page.goto(`${APP}/ops/queue`, { waitUntil: 'networkidle', timeout: 30_000 });
    await page.waitForURL(`${APP}/projects`, { timeout: 30_000 });
```

(Both smokes run only in Task 7's gate, against the isolated pair.)

- [ ] **Step 8: App tests**

Run: `cd $W/packages/app && npx vitest run src/lib/ops-queue-view.test.ts src/customer-copy-sweep.test.ts`
Expected: PASS (the sweep finds no forbidden word in the new strings).

- [ ] **Step 9: Regenerate the route tree, type-check**

The new file route needs its entry in `src/routeTree.gen.ts` (the router plugin writes it when Vite starts). In the background: `cd $W/packages/app && npx vite dev --port 3199`; wait until `grep -c "ops/queue" $W/packages/app/src/routeTree.gen.ts` prints more than 0; then stop it by port, never :3000/:4000:

```powershell
Get-NetTCPConnection -LocalPort 3199 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -Confirm:$false }
```

Then `cd $W/packages/app && npx tsc --noEmit` → no type errors. `git diff packages/app/src/routeTree.gen.ts` must show only the `/ops/queue` route's lines (its import, its `update(…)` block and its entries in the path maps and unions); anything else — restore it (`git checkout -- packages/app/src/routeTree.gen.ts`) and regenerate.

- [ ] **Step 10: Commit**

```bash
cd $W
git add packages/api/src/monitoring/queue-view.ts packages/api/src/monitoring/queue-view.test.ts packages/api/src/monitoring/index.ts packages/api/src/routers/ops.ts packages/api/src/isolation/procedure-classes.ts packages/app/src/lib/ops-queue-view.ts packages/app/src/lib/ops-queue-view.test.ts packages/app/src/routes/_app/ops/queue.tsx packages/app/src/components/shell/ops-sidebar.tsx packages/app/src/routes/_app.tsx packages/app/src/staff-smoke.test.ts packages/app/src/routes-smoke.test.ts packages/app/src/routeTree.gen.ts
git commit -m "feat(ops): Queue — workers' heartbeats, jobs by type, what needs attention, recent failures (ops.queue)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Health in Compose and `serve.mjs`, the live check, docs, the merge gate, the merge (`CLAUDE.md` "Autonomous runs") — spec §1 "Done when", §2.1 "Liveness" (Compose, `serve.mjs`), §4 "Compose", §4 "Live check", §5

**Files:**
- Modify: `packages/app/serve.mjs` (`/healthz`), `docker-compose.yml` (worker `WORKER_HEALTH_PORT` + healthcheck, app healthcheck)
- Create: `packages/worker/src/live-monitoring.ts`
- Modify: `CLAUDE.md`; `.env.example`; `docs/superpowers/specs/2026-10-25-monitoring-design.md` (Status); `docs/handoff.md`; `docs/queue.md`

**Interfaces:**
- Consumes: every earlier task; `createBenchDatabase` (`packages/worker/src/bench/bench-db.ts`), `benchSignIn` (`packages/worker/src/bench/seed.ts`), `startErrorReceiver` (Task 3), `TEST_THROW_MESSAGE` semantics (Task 4: the secret is `live-secret`), `createApp` (`packages/api-server/src/app.ts`, imported by file URL).
- Produces: `packages/worker/src/live-monitoring.ts`; `docs/testing/results/2026-10-25-monitoring/live-monitoring.json`; a branch that passes the gate; `main` fast-forwarded and pushed.

- [ ] **Step 1: `serve.mjs` answers `/healthz`; Compose checks the worker and the app**

`packages/app/serve.mjs`: in the request handler, first thing inside `try {` after `const url = new URL(…);`:

```js
    // Liveness (spec 2026-10-25 monitoring §2.1): the process answers; nothing behind it is asked.
    if (url.pathname === '/healthz' && (req.method === 'GET' || req.method === 'HEAD')) {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      return res.end(req.method === 'HEAD' ? undefined : '{"status":"ok"}');
    }
```

`docker-compose.yml`, `worker`: in `environment`, after `WORKER_NAME: stack-worker` add

```yaml
      # Liveness (spec 2026-10-25 monitoring §2.1): 127.0.0.1 inside the container only, for the healthcheck below.
      WORKER_HEALTH_PORT: "4001"
```

and after `stop_grace_period: 30s`:

```yaml
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:4001/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
      interval: 10s
      timeout: 3s
      retries: 6
      start_period: 30s
```

`app`: after `init: true` add

```yaml
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
      interval: 10s
      timeout: 3s
      retries: 6
      start_period: 20s
```

(The api's healthcheck stays on `/healthz`: `/readyz` needs a worker, and the app waits for the api to be healthy — "Settled here" 12. `ERROR_REPORT_URL` / `ERROR_REPORT_TOKEN` reach the stack only through `./stack.env`, like every key; nothing in the file names them.)

Run: `cd $W && docker compose config -q && echo compose-ok`
Expected: `compose-ok` (no output from `config -q`).

- [ ] **Step 2: The live check**

`packages/worker/src/live-monitoring.ts`:

```ts
// The monitoring live check (spec 2026-10-25 monitoring §4 "Live check"). Free, local, keyless: a throwaway database,
// an in-process worker with WORKER_HEALTH_PORT and the test jobs, a local error receiver, and the api-server app
// in-process. It checks: /readyz is ok with the worker beating; a job made to hang shows as silent in ops.queue and in
// a watchdog warn line; a job made to throw reaches the receiver once, redacted; stopping the worker turns /readyz to
// 503 (`worker`) within 2 minutes; the logger's lines parse as JSON with LOG_FORMAT=json. No browser, no page.
//   cd packages/worker && npx tsx src/live-monitoring.ts
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadEnvFile } from 'node:process';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = join(here, '..', '..', '..');
const OUT = join(repo, 'docs', 'testing', 'results', '2026-10-25-monitoring');
try { loadEnvFile(join(repo, '.env')); } catch { /* no .env: the default URL below */ }
/** In test-throw's message (packages/api/src/jobs/test-jobs.ts): it must reach no report and no line. */
const SECRET = 'live-secret';
const TOKEN = 'live-report-token-0001';
process.env.JOB_QUEUE = `live-monitoring-${randomUUID()}`.slice(0, 64);
// Keyless and quiet: no AI, no Jev, no mail, no checks, no schedules, no proxy; JSON logs at debug (the request log's
// /readyz lines are debug); the receiver's token.
Object.assign(process.env, {
  ANTHROPIC_API_KEY: '', JEV_SHADOW: '', TYPESAFE_API_KEY: '', SMTP_URL: '', WEBSITE_CHECKS: 'off', RECURRING_RUNS: 'off', DEFAULT_PROXY_URL: '',
  LOG_FORMAT: 'json', LOG_LEVEL: 'debug', ERROR_REPORT_TOKEN: TOKEN,
});

// Every line this process writes, kept (and still printed): the JSON and secret checks read them.
const written: string[] = [];
for (const stream of [process.stdout, process.stderr]) {
  const original = stream.write.bind(stream) as (...a: unknown[]) => boolean;
  stream.write = ((chunk: unknown, ...rest: unknown[]) => {
    written.push(...String(chunk).split(/\r?\n/).filter(Boolean));
    return original(chunk, ...rest);
  }) as typeof stream.write;
}
type Line = { t: string; level: string; scope: string; msg: string; [k: string]: unknown };
/** The logger's lines: they, and only they, start with `{"t":` (other code still prints with console.*). */
const LOGGER_LINE = '{"t":';
const jsonLines = (): Line[] => written.filter((l) => l.startsWith(LOGGER_LINE)).flatMap((l) => { try { return [JSON.parse(l) as Line]; } catch { return []; } });

async function until<T>(what: string, ms: number, probe: () => Promise<T | null | undefined | false>): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await probe();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}
const freePort = () => new Promise<number>((resolve, reject) => {
  const s = createServer();
  s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address() as { port: number }; s.close(() => resolve(port)); });
});

let exitCode = 0;
const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];
const check = (name: string, ok: boolean, detail?: string) => {
  checks.push({ name, ok, ...(detail ? { detail } : {}) });
  console.log(`[live-monitoring] ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) exitCode = 1;
};

const { createBenchDatabase } = await import('./bench/bench-db.js');
let bench: Awaited<ReturnType<typeof createBenchDatabase>> | null = null;
let receiver: { url: string; reports: Array<{ body: any; raw: string; headers: Record<string, unknown> }>; close(): Promise<void> } | null = null;
let worker: { stop(): Promise<void> } | null = null;
const summary: Record<string, unknown> = {};
try {
  bench = await createBenchDatabase(process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/robot_platform');
  // Before anything imports @robot/db: every row of this check goes to the throwaway database.
  process.env.DATABASE_URL = bench.url;

  const { startErrorReceiver } = await import('@robot/api/test-helpers/error-receiver');
  receiver = await startErrorReceiver();
  process.env.ERROR_REPORT_URL = receiver.url;

  const email = `live-monitoring-op-${Date.now()}@example.com`;
  process.env.OPS_EMAILS = email;
  const { benchSignIn } = await import('./bench/seed.js');
  const op = await benchSignIn(email);

  // The api-server's app, in-process (no port): /readyz on this check's queue.
  const { createApp } = (await import(pathToFileURL(join(repo, 'packages', 'api-server', 'src', 'app.ts')).href)) as { createApp: () => { fetch(r: Request): Promise<Response> } };
  const app = createApp();
  const readyz = async () => {
    const res = await app.fetch(new Request('http://localhost/readyz'));
    return { status: res.status, body: (await res.json()) as { status: string; checks: Record<string, boolean> } };
  };

  const before = await readyz();
  check('/readyz is 503 (worker) before any worker beats', before.status === 503 && before.body.checks.worker === false, JSON.stringify(before.body));

  const healthPort = await freePort();
  const { readWorkerConfig } = await import('./config.js');
  const { startWorker } = await import('./worker.js');
  const w = await startWorker(
    { ...readWorkerConfig({ JOB_QUEUE: process.env.JOB_QUEUE, WORKER_HEALTH_PORT: String(healthPort), WORKER_MIN_FREE_MB: '0' }), websiteChecks: false, recurringRuns: false, testJobs: true },
    { heartbeatMs: 2000, watchEveryMs: 3000 },
  );
  worker = w;
  const ok = await until('/readyz to be ok', 30_000, async () => { const r = await readyz(); return r.status === 200 ? r : null; });
  check('/readyz is ok with the worker beating', ok.body.status === 'ok' && Object.values(ok.body.checks).every((v) => v === true), JSON.stringify(ok.body));
  check('/readyz says only check names and booleans', JSON.stringify(Object.keys(ok.body)) === '["status","checks"]'
    && JSON.stringify(Object.keys(ok.body.checks).sort()) === '["db","migrations","queue","worker"]' && Object.values(ok.body.checks).every((v) => typeof v === 'boolean'));
  const health = await fetch(`http://127.0.0.1:${healthPort}/healthz`);
  check('the worker’s health port answers 200', health.status === 200, String(health.status));

  const { enqueueJob } = await import('@robot/api/jobs');
  const { db } = await import('@robot/db');
  const hang = await enqueueJob(db, { type: 'test-hang', payload: {} });
  const thrown = await enqueueJob(db, { type: 'test-throw', payload: {} });

  // 1. A job made to hang: silent past half its 60 s stuckMs — in ops.queue and in a watchdog warn line.
  const silent = await until('the hanging job to read as silent in ops.queue', 90_000, async () =>
    (await op.caller.ops.queue()).attention.find((a) => a.kind === 'silent' && a.jobId === hang.id) ?? null);
  check('a hanging job shows as silent in ops.queue', silent.type === 'test-hang' && silent.ageMs >= 30_000, `${Math.round(silent.ageMs / 1000)} s without progress`);
  const warn = await until('a watchdog warn line for it', 30_000, async () =>
    jsonLines().find((l) => l.scope === 'watchdog' && l.level === 'warn' && l.kind === 'silent' && l.jobId === hang.id) ?? null);
  check('…and in a watchdog warn line', !!warn, warn.msg);

  // 2. A job made to throw: one report, as the worker, with the token, redacted.
  await until('the receiver to get the thrown job', 60_000, async () => receiver!.reports.some((r) => r.body?.context?.jobId === thrown.id));
  await new Promise((r) => setTimeout(r, 5000));
  const mine = receiver.reports.filter((r) => r.body?.context?.jobId === thrown.id);
  check('a job made to throw reaches the receiver once', mine.length === 1, `${mine.length} report(s)`);
  const report = mine[0]!;
  check('…as the worker, with the Bearer token, redacted',
    report.body.service === 'worker' && report.headers.authorization === `Bearer ${TOKEN}` && !report.raw.includes(SECRET) && report.raw.includes('http://***@proxy.test:7000'),
    String(report.body.message));

  // 3. Stop the worker: its row goes, /readyz turns 503 (worker) within 2 minutes.
  const stopAt = Date.now();
  await w.stop();
  worker = null;
  const down = await until('/readyz to turn 503 (worker)', 2 * 60_000, async () => { const r = await readyz(); return r.status === 503 && r.body.checks.worker === false ? r : null; });
  check('stopping the worker turns /readyz to 503 (worker) within 2 minutes', Date.now() - stopAt < 2 * 60_000, `${Math.round((Date.now() - stopAt) / 1000)} s; ${JSON.stringify(down.body)}`);

  // 4. The lines: every logger line parses as JSON; the ones this check needs are there; no secret anywhere.
  const raw = written.filter((l) => l.startsWith(LOGGER_LINE));
  const parsed = jsonLines();
  check('every logger line parses as JSON with t, level, scope and msg', raw.length > 0 && parsed.length === raw.length
    && parsed.every((l) => typeof l.t === 'string' && typeof l.level === 'string' && typeof l.scope === 'string' && typeof l.msg === 'string'), `${parsed.length} line(s)`);
  const scopes = new Set(parsed.map((l) => l.scope));
  check('the worker, the runner, the watchdog, the error hook and the request log all wrote JSON', ['worker', 'jobs', 'watchdog', 'errors', 'api-server'].every((s) => scopes.has(s)), [...scopes].join(', '));
  check('no line carries the secret or the token', !written.some((l) => l.includes(SECRET) || l.includes(TOKEN)));

  Object.assign(summary, {
    readyzBefore: before.body, readyzOk: ok.body, readyzAfterStop: down.body, silent: { ageMs: silent.ageMs, msg: warn.msg },
    report: { service: report.body.service, message: report.body.message, version: report.body.version }, reports: receiver.reports.length,
    lines: parsed.length, scopes: [...scopes],
  });
} catch (err) {
  console.error('[live-monitoring] failed:', err);
  exitCode = 1;
} finally {
  await worker?.stop().catch(() => {});
  await receiver?.close().catch(() => {});
  const made = bench;
  if (made) await made.drop().catch((err) => { console.error(`[live-monitoring] could not drop ${made.name}:`, err); exitCode = 1; });
}
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'live-monitoring.json'), `${JSON.stringify({ at: new Date().toISOString(), ...summary, checks }, null, 1)}\n`);
console.log(`[live-monitoring] ${exitCode === 0 ? 'PASS' : 'FAIL'}`);
process.exit(exitCode);
```

Type-check: `cd $W/packages/worker && npx tsc --noEmit`. Expected: no errors. (The run itself is the gate's Step 7.)

- [ ] **Step 3: Commit the health checks and the live check**

```bash
cd $W
git add packages/app/serve.mjs docker-compose.yml packages/worker/src/live-monitoring.ts
git commit -m "feat: worker and app healthchecks in Compose, /healthz in serve.mjs; the monitoring live check

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Reviews are clean; trailers are right**

Confirm each task's review (and fix rounds) ended clean. Then:

```bash
cd $W && git log main..HEAD --format=%B | grep Co-Authored-By | sort | uniq -c
```

Expected: only `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Rewrite strays with `git rebase main --exec "bash <script>"` (memory `subagent-commit-trailers`).

- [ ] **Step 5: Full test run and type-check of every touched package** (one at a time — memory)

```bash
cd $W/packages/db && npx vitest run --no-file-parallelism && npx tsc --noEmit
cd $W/packages/api && npx vitest run --no-file-parallelism && npx tsc --noEmit
cd $W/packages/api-server && npx vitest run --no-file-parallelism && npx tsc --noEmit
cd $W/packages/worker && npx vitest run --no-file-parallelism && npx tsc --noEmit
cd $W/packages/app && npx vitest run --no-file-parallelism && npx tsc --noEmit
```

Expected: all PASS, no type errors (Postgres up; the smokes skip without `RUN_UI_SMOKE` / `RUN_STAFF_SMOKE`; `@robot/api-server` and `@robot/worker` call the api in-process). A Chromium file that times out only in the full run: re-run it alone. A real failure blocks the merge: fix it on the branch with a test. Then: `git status --short` — restore `packages/app/src/routeTree.gen.ts` if a run changed it; no test left a row: `SELECT queue, count(*) FROM jobs WHERE queue LIKE 'test-%' OR queue LIKE 'schema-test-%' GROUP BY queue` → none; `SELECT count(*) FROM workers WHERE queue <> 'default' AND queue <> 'isolated-4100'` → 0 (a `default` row is Marko's dev worker only once it runs this branch's code — after the merge); `SELECT count(*) FROM users WHERE email LIKE 'ops-queue-%'` → 0.

- [ ] **Step 6: `serve.mjs` answers `/healthz` (a build, then a curl; nothing else running)**

```bash
cd $W/packages/app && npx vite build
```

In the background: `cd $W/packages/app && PORT=3198 HOST=127.0.0.1 node serve.mjs`. Then `curl -s -i http://127.0.0.1:3198/healthz` → `HTTP/1.1 200` and `{"status":"ok"}`. Stop it by port, never :3000/:4000:

```powershell
Get-NetTCPConnection -LocalPort 3198 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -Confirm:$false }
```

`git status --short` must not list `packages/app/dist` (gitignored).

- [ ] **Step 7: The live check, on the final head** (run alone; nothing else heavy running)

```bash
cd $W/packages/worker && npx tsx src/live-monitoring.ts
```

Expected: every line `ok`, then `[live-monitoring] PASS` (about two minutes: the hang reads silent after 30 s); `docs/testing/results/2026-10-25-monitoring/live-monitoring.json` written. Read the JSON: the silent age ≥ 30 s, the report's message `test-throw: could not reach http://***@proxy.test:7000`, `readyzAfterStop.checks.worker` false. A FAIL blocks the merge: fix on the branch, re-run Step 5 for the touched packages, run this again. Then `SELECT datname FROM pg_database WHERE datname LIKE 'robot_bench_%'` → none left by this run.

- [ ] **Step 8: Whole-branch review**

The controller dispatches one reviewer on the most capable model over `git diff main...HEAD`, with the spec and this plan. Points to press: the migration (additive only: a table, an index, a nullable column); redaction on every path — the logger (message, fields, nested, errors and causes), the error report (message, stack, context), the runner's fields, the watchdog's fields, the heartbeat's warn, the request log (no query, no cookie, no body), ops' errors (`lastError`, failures), `/readyz` (names and booleans only, a thrown readiness never echoed) (§3.1, §3.3); monitoring never changes an outcome (§3.2) — `progress_at` and the heartbeat best-effort, `report` wrapped, the watchdog read-only, the health server's bind failure non-fatal, `say` never throwing, the runner's line texts unchanged; the reporter — 5 s timeout, never rejecting (a sync-throwing fetch, odd values), 30 a minute with `dropped`, the token only as a header and never in a line, the uncaught-exception exit after ≤ 2 s; what is reported and what is not ("Settled here" 4: faults only, never a payload or a tRPC input); the heartbeat — DB clock, upsert keeps `started_at`, purge, delete only its own row, warn once per streak; the health server — 127.0.0.1 only, 503 from the first moment of `stop()`; the attention queries — the busy-lane rule (RF1), `split_part` not `LIKE` (RF5), a lapsed lease is not silent, the `CASE`-guarded uuid casts, the subjects' fallbacks; readiness — db failure short-circuits, every check bounded by the timeout, `migrations` against the bundled journal; `ops.queue` — operators only, classified, this server's queue, workers of every queue; the app — no customer copy changed, the Queue route redirects a non-operator, `data-stale` only past 2 minutes; Compose — the worker's port internal, the api healthcheck still `/healthz`; the live check — throwaway database, local receiver, no browser. No open Critical or Important finding may remain; fix on the branch and re-run Step 5 for the touched packages (Step 7 if the worker, the runner or the monitoring module changed).

- [ ] **Step 9: The route smoke and the staff smoke, from the branch, on one isolated pair with its worker (gate 4: `@robot/app` and `@robot/api` changed)**

Both run against one pair whose api-server carries the staff smoke's throwaway operator. Check first: `grep -E '^(ORG_AI_CAP_USD|RATE_LIMITS|TRUST_PROXY|DEFAULT_PROXY_URL|ERROR_REPORT_URL|LOG_FORMAT|LOG_LEVEL)=' $W/.env` — if it prints anything, prefix the api-server and worker commands with `ORG_AI_CAP_USD= RATE_LIMITS= TRUST_PROXY=` (the commands below already empty `DEFAULT_PROXY_URL`, `ERROR_REPORT_URL` and the log settings).

A stop file for the worker: `/c/Users/Marko/AppData/Local/Temp/claude/worker-4100.stop` (delete it first if it exists). In the background, three processes (the api-server's and the worker's output to log files, for the checks below):

```bash
cd $W/packages/api-server && ANTHROPIC_API_KEY= JEV_SHADOW= TYPESAFE_API_KEY= SMTP_URL= DEFAULT_PROXY_URL= ERROR_REPORT_URL= LOG_FORMAT= LOG_LEVEL= WEBSITE_CHECKS=off JOB_QUEUE=isolated-4100 PORT=4100 APP_ORIGINS=http://localhost:3100 OPS_EMAILS=staff-smoke-op@example.com npx tsx src/index.ts > /c/Users/Marko/AppData/Local/Temp/claude/api-4100.log 2>&1
```

```bash
cd $W/packages/worker && ANTHROPIC_API_KEY= JEV_SHADOW= TYPESAFE_API_KEY= SMTP_URL= DEFAULT_PROXY_URL= ERROR_REPORT_URL= LOG_FORMAT= LOG_LEVEL= WEBSITE_CHECKS=off RECURRING_RUNS=off JOB_QUEUE=isolated-4100 WORKER_HEALTH_PORT=4101 WORKER_STOP_FILE=/c/Users/Marko/AppData/Local/Temp/claude/worker-4100.stop npx tsx src/index.ts > /c/Users/Marko/AppData/Local/Temp/claude/worker-4100.log 2>&1
```

```bash
cd $W/packages/app && VITE_API_URL=http://localhost:4100 npx vite dev --port 3100
```

Wait until `curl -s http://localhost:4100/healthz` answers `{"status":"ok"}`, the worker's log says `on queue "isolated-4100"` with `website checks off`, `recurring runs off`, `mail off` and `health 127.0.0.1:4101`, `curl -s http://127.0.0.1:4101/healthz` answers `{"status":"ok"}`, `curl -s http://localhost:4100/readyz` answers `{"status":"ok","checks":{"db":true,"migrations":true,"worker":true,"queue":true}}` (a stale `isolated-4100` job from an earlier run would fail `queue` — then `DELETE FROM jobs WHERE queue = 'isolated-4100'` and ask again), and `curl -s -o /dev/null -w "%{http_code}" http://localhost:3100/login` answers 200. Then, one after the other:

```bash
cd $W/packages/app && RUN_UI_SMOKE=1 APP_URL=http://localhost:3100 API_URL=http://localhost:4100 npx vitest run src/routes-smoke.test.ts
cd $W/packages/app && RUN_STAFF_SMOKE=1 STAFF_SMOKE_OPERATOR=staff-smoke-op@example.com APP_URL=http://localhost:3100 API_URL=http://localhost:4100 npx vitest run src/staff-smoke.test.ts
```

Expected: PASS, every test of both. Then on the logs: `grep -c "\[rate-limit\]" /c/Users/Marko/AppData/Local/Temp/claude/api-4100.log` → `0`; `grep -c "\[api-server\] GET /trpc/" /c/Users/Marko/AppData/Local/Temp/claude/api-4100.log` → more than 0 (the request log runs); `grep -cE "input=|robot_session=" /c/Users/Marko/AppData/Local/Temp/claude/api-4100.log` → `0` (no query string, no cookie); `grep -c "\[jobs\] claimed" /c/Users/Marko/AppData/Local/Temp/claude/worker-4100.log` → more than 0. Look at the screenshots: `staff-ops-queue.png` (the Workers table with the `isolated-4100` row "(this server)", its beat in seconds, not red; Jobs by type with the smoke's `proof-page-capture` and friends; "Nothing needs attention." or items that name their website; no address with a password), `staff-ops-orgs.png` and the rest unchanged, `app-*.png` (nothing moved for the customer).

Stop the worker with `touch /c/Users/Marko/AppData/Local/Temp/claude/worker-4100.stop` and wait for it to exit (`stopping (stop file)` in its log), then `curl -s -o /dev/null -w "%{http_code}" http://localhost:4100/readyz` → `503` (its row is gone). Then the two servers by port, never :3000/:4000:

```powershell
Get-NetTCPConnection -LocalPort 4100,3100 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -Confirm:$false }
```

If the worker has not exited 60 s after the stop file: `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*robot-platform-monitoring*packages*worker*src*index.ts*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -Confirm:$false }`. Then `DELETE FROM jobs WHERE queue = 'isolated-4100'` and `DELETE FROM workers WHERE queue = 'isolated-4100'` (via `npx tsx -e` with `@robot/db`, from `packages/worker`). Restore: `git checkout -- packages/app/src/routeTree.gen.ts docs/testing/screens` (the new staff screenshot is untracked: leave it for the digest to link, do not commit it).

- [ ] **Step 10: Docs**

Note the last code commit: `git log -1 --format=%h -- packages docker-compose.yml` → `<sha>`.

1. Spec — the Status paragraph's first sentence becomes ``**Status:** implemented on `feat/monitoring` and merged to `main` on <date> (`<sha>`); written 2026-10-25 under the standing approval …`` (keep the rest); add a **Proven:** sentence (the logger, error-hook, heartbeat, watchdog and readiness tests with counts from Step 5, the api-server's `/readyz`, request-log and `onError` tests, `ops.queue` and the procedure sweep, the worker's heartbeat / health-port / report test, both smokes and `staff-ops-queue.png`, `docker compose config -q`, the `serve.mjs` curl, the live check's checks and `live-monitoring.json`) and any **Deviations:** the reviews forced, plus "Settled here" below.
2. `CLAUDE.md`:
   - Commands, after the `pnpm --filter @robot/worker exec tsx src/live-check.ts` line: `` - `pnpm --filter @robot/worker exec tsx src/live-monitoring.ts` — free live check of monitoring (spec 2026-10-25): a throwaway database, an in-process worker with its health port and the test jobs, a local error receiver and the api-server app in-process — `/readyz`, a silent job in ops' Queue and a watchdog line, one redacted error report, `/readyz` 503 after the worker stops, JSON logs; writes `docs/testing/results/2026-10-25-monitoring/` `` and `` - `curl http://localhost:4000/readyz` — readiness (spec 2026-10-25 monitoring): 200 `{"status":"ok","checks":{…}}` when the database answers, migrations are applied, a worker on this `JOB_QUEUE` beat in the last 2 minutes and no job waits over 10 minutes with its lane idle; 503 naming the failing checks. `/healthz` stays liveness ``
   - The `pnpm test:ui:staff` line: add `ERROR_REPORT_URL=` beside `SMTP_URL=` on both the api-server and the worker.
   - The `docker compose up -d --build` line: add `ERROR_REPORT_URL`, `ERROR_REPORT_TOKEN` to the `./stack.env` key list, and `; the worker answers WORKER_HEALTH_PORT 4001 inside its container and the app /healthz, both with healthchecks` after "nightly backup".
   - Environment, after `DEFAULT_PROXY_URL`:
     - `` - `LOG_FORMAT` — `json`: one JSON object per line (`{ t, level, scope, msg, …fields }`); anything else: text, `[scope] msg key=value` (warn and error say so after the scope). Covers the api-server's request log, the job runner, the worker's start and stop, the watchdog, the error hook and the website-check and schedule sweeps; the rest still prints as before. Every message and field is redacted (URL passwords, secret keys and parameters, tokens) ``
     - `` - `LOG_LEVEL` — `debug` | `info` (default) | `warn` | `error`; `/healthz` and `/readyz` requests log at debug ``
     - `` - `ERROR_REPORT_URL` — where the api-server and the worker POST each error report as JSON (`{ t, service, level, message, stack, context, version, host }`, redacted; a Sentry/Logtail ingestion endpoint or your own receiver): Hono 500s, tRPC internal errors, a job's terminal fault, unhandled rejections and uncaught exceptions; 5 s timeout, at most 30 a minute per process (the rest counted as `dropped`), never throws. Unset: errors are only logged. Never a real receiver in tests ``
     - `` - `ERROR_REPORT_TOKEN` — sent as `Authorization: Bearer <token>` with each report when set ``
     - `` - `WORKER_HEALTH_PORT` — the worker answers `GET /healthz` on 127.0.0.1 at this port: 200 while it works (and its database answered a beat in the last 2 minutes), 503 while it stops; unset: no server; a port it cannot open is logged and the worker runs on. Compose sets 4001 ``
   - Key Technical Decisions, after the "Proxy support (2026-10-24)" bullet:

```markdown
- Monitoring basics (2026-10-25): each worker upserts a `workers` row every 30 s (queue, version, browsers, lanes, switches; deleted on a clean stop; a beat older than 2 minutes is a dead worker; rows older than a day purged) and answers `WORKER_HEALTH_PORT`; the api-server's `GET /readyz` (no auth, names and booleans only) checks the database, the migrations against `@robot/db`'s journal (`migrationCount()`), a beating worker on its `JOB_QUEUE`, and the queue; `/healthz` stays liveness everywhere (the app's `serve.mjs` too). `jobs.progress_at` (claim, and `ctx.progress()` at most every 15 s) lets anything outside the worker see "running but not moving": every 60 s each worker's watchdog (`packages/api/src/monitoring/`) warns once per job and kind per hour about a backlog (queued over 10 minutes with its lane idle — a busy lane is not a backlog), a silent job (no progress for half its `stuckMs` under a live lease) and a dead worker's jobs; it only logs. `@robot/api/log` (`createLog(scope)`, `LOG_FORMAT`, `LOG_LEVEL`) redacts every line (`redactProxy`, `redactSmtp`, any URL userinfo, secret keys and parameters, Bearer tokens, the known key values); `@robot/api/errors`' `reportError` logs and, with `ERROR_REPORT_URL`, POSTs a redacted report (5 s, ≤ 30 a minute, never throwing) from Hono and tRPC internal errors, a job's terminal fault (not a capture problem or a refusal; never a payload or an input) and the process handlers (an uncaught exception still exits after a ≤ 2 s flush). Staff read it all in ops → Queue (`ops.queue`, every 15 s). Customers see nothing new. Proven by `packages/worker/src/live-monitoring.ts`.
```

3. `.env.example` — after the `DEFAULT_PROXY_URL` block:

```
# Logs (spec 2026-10-25 monitoring): text (default, `[scope] msg key=value`) or json (one object per line), every line
# redacted; debug | info (default) | warn | error.
# LOG_FORMAT=text
# LOG_LEVEL=info
# Error reports: the api-server and the worker POST each error as redacted JSON here (a Sentry/Logtail ingestion
# endpoint or your own receiver), at most 30 a minute; the token goes as `Authorization: Bearer`. Unset: logged only.
# ERROR_REPORT_URL=
# ERROR_REPORT_TOKEN=
# The worker answers GET /healthz on 127.0.0.1:<port> (200 working, 503 stopping); unset: no server. Compose sets 4001.
# WORKER_HEALTH_PORT=
```

4. `docs/handoff.md` — the "Newest" line becomes `**Newest: [Monitoring basics (2026-10-25)](#monitoring-basics-2026-10-25).** Workers beat into the database and answer a health port; the api-server answers /readyz; logs can be JSON and are redacted; a watchdog warns about stuck work; errors can be POSTed to a receiver; staff see it all in ops → Queue. Merged <date>.` followed by `**Before it: [Proxy support (2026-10-24)](#proxy-support-2026-10-24).** …` (the old Newest line's sentence) and the old "Before it" demoted to "Before that". Insert before `## Proxy support (2026-10-24)` a section `## Monitoring basics (2026-10-25)` with: spec/plan paths; **What changed** (the heartbeat and `workers`; `/readyz`, the health ports and Compose; the logger and redaction, and what moved to it; `progress_at` and the watchdog; the error hook; ops → Queue — one paragraph each, from the spec and "Settled here"); **How it was proven** (test counts from Step 5, the live check and its JSON, the `serve.mjs` curl, `docker compose config -q`, both smokes and `staff-ops-queue.png`); **After pulling** (`pnpm db:migrate` — migration 0025 adds `workers` and `jobs.progress_at`; restart `pnpm dev:all`; optional: `LOG_FORMAT=json`, `ERROR_REPORT_URL`, `WORKER_HEALTH_PORT` in `.env`); **What NOT to redo** (never log a URL, a header, a payload or an input without `createLog` — it redacts, `console.*` does not; never let monitoring fail a job — every heartbeat, `progress_at`, report and watchdog path swallows its own errors; never answer `/readyz` with ids, hosts or error text; never report a capture problem or a refusal as an error; never match a worker id with `LIKE` — `split_part(locked_by, '#', 1)`; a new job type gets its lane and `stuckMs` in `JOB_POLICIES`, which the watchdog reads); **Open** (spec §5: metrics, alerting, moving every `console.*`, log shipping, tracing, a status page; the week of local checks — Needs Marko; the watchdog runs in each worker, so two workers on one queue both warn; `/readyz` sees only its own `JOB_QUEUE`).
5. `docs/queue.md` — move item 1 from **Next** to **Done** as `- <date> — Monitoring basics (\`<sha>\`): monitoring shipped; the local week of checks → Needs Marko. Worker heartbeat (workers table) and WORKER_HEALTH_PORT, /readyz, /healthz on the app, JSON and redacted logs (LOG_FORMAT, LOG_LEVEL), a stuck-job watchdog (jobs.progress_at), an error-report hook (ERROR_REPORT_URL), ops → Queue; live check docs/testing/results/2026-10-25-monitoring/live-monitoring.json. After merge: pnpm db:migrate, restart dev:all.`; renumber **Next**; in **Needs Marko** replace the line that begins `- **Turn the scheduled checks on?**` with exactly `- Turn WEBSITE_CHECKS=on in your .env, restart dev:all, and after a week read /ops/queue and the worker's warn lines` (the queue item's "done when"; nothing else in that list changes).

```bash
cd $W
git add docs/superpowers/specs/2026-10-25-monitoring-design.md CLAUDE.md .env.example docs/handoff.md docs/queue.md docs/testing/results/2026-10-25-monitoring/live-monitoring.json
git commit -m "docs: monitoring basics — shipped; handoff, decisions, env, queue, live check

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 11: Rebase on `main`, fast-forward `main`, push**

```bash
cd $W
git status --short
git fetch origin
git rebase main
```

If `main` moved, re-run Step 5 for the touched packages (Step 9 if an app/api file on `main` changed, Step 7 if a worker/runner file changed). If `main` gained a migration `0025`, regenerate ours to the next free index with `drizzle-kit generate` after rebasing the schema, never by hand-editing the journal (the `migrationCount` test reads the journal, so it follows). If `main` gained a procedure, the sweep fails until it has its row in `procedure-classes.ts` — classify it on this branch. If `main` gained a job type, give it its policy (the watchdog reads `JOB_POLICIES`). If `routeTree.gen.ts` conflicts, take `main`'s and regenerate as in Task 6 Step 9. The main checkout must be clean and on `main`:

```bash
git -C /c/Users/Marko/Documents/projects/robot-platform status --short
git -C /c/Users/Marko/Documents/projects/robot-platform rev-parse --abbrev-ref HEAD
```

If it is not clean (the snapshot showed `M packages/app/src/routeTree.gen.ts` there — a generated file the dev server rewrites; a `--ff-only` merge refuses only if it would overwrite it, and this branch touches it in Task 6 — so if that file is modified there, stop), or not on `main`, stop: write the item under **Needs Marko** in `docs/queue.md` ("branch ready, main checkout not clean: packages/app/src/routeTree.gen.ts is modified there") and do not merge. Otherwise:

```bash
git -C /c/Users/Marko/Documents/projects/robot-platform merge --ff-only feat/monitoring
git -C /c/Users/Marko/Documents/projects/robot-platform push origin main
```

Expected: a fast-forward and a push. Marko's dev servers are not restarted: they keep the old code until he restarts `pnpm dev:all` (migration 0025 is already on the dev database from Task 1; `pnpm db:migrate` is a no-op there) — say so in the run's digest. Do not run migrations or installs in the main checkout. Finally: no `isolated-4100` / `test-%` / `live-monitoring-%` jobs or `workers` rows, no `ops-queue-%` / `staff-smoke-%` / `live-monitoring-op-%` users, no `robot_bench_%` database left, nothing listening on :4100, :4101, :3100, :3198 or :3199.

---

## Settled here (spec ambiguities, decided for this plan)

1. **"A backlog nobody is taking"** (the `queue` readiness check and the watchdog's backlog): a `queued` job due more than 10 minutes ago counts only when its lane (from its policy) has nothing running on the queue and nothing claimed there in the last 10 minutes. A burst of website checks behind `maxConcurrent: 1`, or a second run behind `WORKER_RUNS=1`, is a busy lane, not a backlog — otherwise `WEBSITE_CHECKS=on` would turn `/readyz` red and flood the warn lines every hour, which is the week this item prepares. A type with no known policy always counts. With no worker at all nothing runs or is claimed, so every old job counts — the spec's "no worker" case.
2. **Redaction goes beyond the spec's list:** after `redactProxy` and `redactSmtp`, userinfo of any `scheme://` (a Postgres URL in an error), `name=value` pairs whose name has pass/secret/token/sig (a signed export link's `sig=`), `Bearer` / `Basic` tokens in text, and the literal values of `ANTHROPIC_API_KEY`, `TYPESAFE_API_KEY` and `ERROR_REPORT_TOKEN` (8+ characters). An Error is `{ name, message, stack }` plus its `cause`, each redacted. Unserialisable values become placeholders (`[circular]`, `[too deep]`, `[unreadable]`, a BigInt's digits; functions dropped). The key pattern is the spec's, verbatim, so a key such as `signal` is masked too — harmless.
3. **The text format** is the spec's `[scope] msg key=value …` with `WARN` / `ERROR` after the scope for those levels, so warn lines can be found without JSON; warn and error go to stderr. In JSON a field named `t`, `level`, `scope` or `msg` is written `field_<name>`. `LOG_LEVEL` or `LOG_FORMAT` with any other value is the default.
4. **What is reported.** The worker: a terminal failure that is a fault — the handler threw with no attempts left (serialized kind `error` or `unavailable`, or tRPC `INTERNAL_SERVER_ERROR`), a stuck job failed for good, a reaped job with no attempts left. A `CaptureProblemError` (a website that turned us away) and a client tRPC code are answers, not faults: logged, not reported. Context is `{ jobId, type, attempt, queue, workerId }` — never the payload. The api-server: Hono `onError` (`{ method, path }`) and tRPC `INTERNAL_SERVER_ERROR` (`{ path, type }`, never the input). A runner given its own `log` (tests, inline staff scripts) reports only through an explicit `report`.
5. **The process handlers.** `unhandledRejection` is reported and the process goes on (as the worker already did); `uncaughtException` is reported, flushed for at most 2 s, and the process exits 1. A report carries `dropped` only when reports were dropped since the last one sent; message ≤ 2,000 and stack ≤ 8,000 characters. `reportError` reads `ERROR_REPORT_URL` / `_TOKEN` at each report.
6. **The heartbeat and the health port.** The first beat is at start, then every 30 s; `beat_at` is the database's `now()`; every beat purges rows older than a day; a failing beat warns once per streak and says "beating again". The health port answers 200 while the worker is started, not stopping, and its database answered a beat in the last 2 minutes (or it started less than 2 minutes ago) — "running" read as "doing work"; 503 from the first moment of `stop()`. A port it cannot bind is logged at error and the worker runs on (§3.2). `WORKER_HEALTH_PORT=0` picks any free port (tests only).
7. **The Queue view's scope.** Workers: every worker row (all queues, this server's queue first, marked "(this server)") — a Compose worker and a dev worker are both visible. Jobs, attention and failures: this api-server's `JOB_QUEUE` only. Done and failed counts are the last 24 hours; the oldest queued age counts only jobs already due. A website is linked to `/ops/websites/$sourceId`; a run is named by its short id beside it (ops has no run page). The website comes from the payload's `sourceId`, else the status row stamped with the job (`runs`, `captures`, `source_verifications`, `drift_checks`, `coverage_checks`), else the payload's run.
8. **The watchdog's dedupe** is per job and kind per hour, in each worker's memory: a job that is first a backlog and later silent is warned about twice; two workers on one queue each warn once.
9. **A third export.** Beside `@robot/api/log` and `@robot/api/errors`, `@robot/api/monitoring` carries the heartbeat, the watchdog, readiness and the queue view (the worker and the api-server import it); `@robot/api/test-helpers/error-receiver` serves the tests and the live check.
10. **The version** is `git rev-parse --short HEAD` (once, 2 s) or `@robot/api`'s package.json version; no new environment variable.
11. **Test jobs.** `test-hang` (never reports progress; `stuckMs` 60 s) and `test-throw` (throws a message with a proxy password) join `test-sleep` under `WORKER_TEST_JOBS=1`; their policies (`TEST_JOB_POLICIES`) are known to the watchdog and ops, so the live check's hang reads silent there.
12. **`/readyz`'s body** is `{ status: 'ok' | 'unavailable', checks: { db, migrations, worker, queue } }`, every check a boolean and always present ("with the failing checks" read as: the false ones are failing); `cache-control: no-store`; a database that does not answer within 2 s fails every check without reading the rest; a readiness that throws answers the same, never its error. Compose's api healthcheck stays `/healthz`: `/readyz` needs a worker, and the app waits on a healthy api.
13. **`serve.mjs`'s `/healthz`** is proven by a build and a curl in the gate, not a unit test: `serve.mjs` imports the built bundle at start.
14. **Migration 0025** is additive (the `workers` table, its index, `jobs.progress_at`) and is applied to the dev database in Task 1 so the api tests can use it; `main`'s running code never reads either, so no dump is taken.
15. **`routeTree.gen.ts`:** the new file route needs its generated entry or the app does not type-check on a clean checkout; Task 6 stages the regenerated file with only the `/ops/queue` lines (precedent: the metering plan's `/ops/orgs`). Everywhere else the rule stands.
16. **The request log** uses Hono's `c.req.path` (no query string), `clientIpOf` (the `TRUST_PROXY` rule; `unknown` in-process) and whole milliseconds; a tRPC batch is one line with its comma-joined path. It is the first middleware, so a CORS preflight and a 500 are logged too.
