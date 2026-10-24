# Recurring extraction — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A website can carry a weekly schedule and a webhook: the worker starts its run at the scheduled time, every finished run of such a website writes a CSV/JSON/XLSX snapshot, and a signed `run.finished` POST with signed download links goes to the customer's endpoint.

**Architecture:** `@robot/db` gains five `sources` columns and two tables (`run_files`, `webhook_deliveries`) in migration `0021`. `@robot/api` gets two new folders: `src/recurring/` (the pure schedule maths, the worker's claim-and-advance sweep, the `scheduled-run` job) and `src/delivery/` (URL safety, signing, the safe POST, the `run-delivery` job, the snapshot files). `buildFinalise` queues one `run-delivery` job after a run settles; `sources.update` / `sources.get` / `sources.rotateWebhookSecret` / `runs.getWithDetails` carry the new fields. The api-server's export route serves a snapshot with the session (`?snapshot=1`) or with a signed link. `@robot/worker` starts the sweep (`RECURRING_RUNS`, default on). `@robot/app` gets the Settings tab's Schedule and Webhook rows, the "scheduled" run label and the run page's webhook line.

**Tech Stack:** TypeScript ESM; Drizzle + Postgres (postgres-js, drizzle-kit migrations); tRPC v11 + zod 3; Hono (api-server); `node:http`/`node:https`/`node:dns`/`node:net`/`node:crypto` (no new dependency); vitest; TanStack Start + React 19 + Tailwind v4 + shadcn/Base UI; Playwright (route smoke); tsx.

**Spec:** `docs/superpowers/specs/2026-10-24-recurring-extraction-design.md`

**Planner's notes:** nine tasks, in order (each consumes the one before it; 4–7 all touch `@robot/api`/api-server and must not run in parallel). Line numbers were read on `feat/recurring-extraction` @ `5cfe292e` and are approximate — find code by the quoted text. Work only in `C:\Users\Marko\Documents\projects\robot-platform-recurring` (bash: `/c/Users/Marko/Documents/projects/robot-platform-recurring`). Decisions the spec left open are listed under "Settled here" at the end of this plan; the reviewer of each task reads them.

## Global Constraints

- **Schedule** (spec §3.1, verbatim): `{ days: number[]; time: 'HH:MM'; timeZone: string }`; `days` ISO weekdays (1 = Monday … 7 = Sunday), at least one, no duplicates; `time` 24-hour; `timeZone` an IANA name `Intl.DateTimeFormat` accepts; no schedule = `null` (the default). `nextRunAt(schedule, after)` is pure, no library, the first instant **strictly after** `after` whose wall-clock time in `timeZone` is a listed day at `time`; a wall time in a spring-forward gap runs at the first instant after the gap; a wall time that happens twice runs once, at the first occurrence. `next_run_at` is recomputed from now whenever the schedule is saved and after each due sweep (a worker that was down for a week runs a website once, not seven times).
- **Sweep** (§3.2): every 60 s in the worker; off only when `RECURRING_RUNS` is `off` (default on; the isolated smoke pair sets `off`); claims due websites one at a time with `FOR UPDATE SKIP LOCKED`; at most 6 per sweep. Eligibility in this order, with these customer sentences: website not active → skipped `paused` "Skipped: the website is paused."; `requireCertification` refuses → skipped `not_certified` "Skipped: the website needs verifying first."; a listing website never confirmed → skipped `not_confirmed` "Skipped: run Extract once by hand first."; a run of this website `planning`, `extracting` or `cancelling` → skipped `busy` "Skipped: the last run was still going."; otherwise started, "Started <time>." with a link to the run. A refusal is recorded and never retried before the next scheduled time.
- **Starting** (§3.2): one transaction writes a `planning` run row with `input_label = 'scheduled'` and a `scheduled-run` job (background lane, priority 20, 1 attempt, no start deadline; key `scheduled-run:<runId>`). The handler plans like `crawl.plan` (`planSource(db, sourceId, { probe: false, runId })`, the website's run limits); a plan with no detail items stays a failed plan run with its own reason; otherwise it calls `startRunJob`. `schedule_last = { at, outcome, reason?, runId? }`, `reason` one of `paused | not_certified | not_confirmed | busy`. Starting a run by hand does not touch the schedule.
- **The file** (§3.3): when a run settles terminal (`completed`, `partial`, `failed` with at least one row, `cancelled` with at least one row) and its website has a schedule or a webhook, `buildFinalise` enqueues one `run-delivery` job (lane background, priority 15, at most 5 attempts; key `run-delivery:<runId>`), in its own try/catch like drift flagging. The handler first writes CSV, JSON and XLSX with the existing export functions, one row each in `run_files` (`run_id`, `format`, `bytes` bytea, `rows`, `created_at`; unique `(run_id, format)`; an existing row is replaced) — plus `filename` (Settled 1).
- **Downloads** (§3.3): with the session `GET /export/runs/<runId>.<fmt>?snapshot=1` (org-gated as today; the run page's download buttons are unchanged and stay live); with a signed link `GET /export/runs/<runId>.<fmt>?expires=<unix s>&sig=<hex>`, no session, `sig = HMAC-SHA256(website webhook secret, "<runId>.<fmt>.<expires>")`; a wrong or expired signature answers 404; a website with no secret has no signed links; links in a webhook expire after 7 days.
- **Webhook** (§3.4): the secret is 32 random bytes, hex, plain text in `sources.webhook_secret`, generated on the first non-null save; `null` clears the URL and keeps the secret; `sources.rotateWebhookSecret` replaces it. Body keys exactly `event` (`"run.finished"`), `deliveryId`, `runId`, `status` (`completed|partial|failed|cancelled`), `scheduled`, `website {id,name}`, `project {id,name}`, `startedAt`, `completedAt`, `rows`, `failedItems`, `files {csv,json,xlsx}`, `filesExpireAt`. Headers: `Content-Type: application/json`; `User-Agent: robot-platform-webhook/1`; `X-Robot-Event: run.finished`; `X-Robot-Delivery: <deliveryId>` (the same on every retry of one run's delivery); `X-Robot-Signature: sha256=<hex HMAC-SHA256(secret, raw body)>`. Links absolute, on `PUBLIC_API_URL` (default `http://localhost:4000`).
- **Safety** (§3.4): when saving — `http:` or `https:` only, no credentials in the URL, at most 2,000 characters; a literal IP or `localhost` that is loopback, private, link-local, CGNAT, multicast or unspecified (IPv4 and IPv6, including v4-mapped) is refused with "Use a public web address."; when sending — `node:http(s)` with a `lookup` that resolves the host and refuses those same ranges for every address it returns; no redirects (a 3xx is a failed delivery); a 10 s timeout for the whole request; the response body read up to 64 KB and discarded. `WEBHOOK_ALLOW_PRIVATE=on` lifts the range check (tests, the local live check, Docker); off by default. A 2xx is delivered; anything else is a failed attempt, retried with the job's backoff (30 s, doubling), 5 attempts, then given up; each attempt one `webhook_deliveries` row (`run_id`, `delivery_id`, `attempt`, `ok`, `status_code` nullable, `error`, `at`). A failed delivery never changes the run's status or rows.
- **What a customer sees** (§3.6): Settings, after "Run limits": **"Schedule"** — an Off / Every day / Weekdays / Choose days select (days as toggle chips), a time field, a time-zone select defaulting to the browser's (`Intl.DateTimeFormat().resolvedOptions().timeZone`), Save; below it "Next run: Monday 27 October, 06:00 (Europe/Berlin)" and the last outcome sentence; **"Webhook"** — a URL field with Save and a Remove action; once saved "Signing secret" with a masked value, Show / Copy, and "Replace secret"; one help line "We send a POST with the run's results and download links when a run finishes." Run page, one line under the downloads, from the latest attempt: "Webhook delivered <time>." / "Webhook not delivered yet — trying again." / "Webhook could not be delivered." — no status code, no host, no error text; staff (`showsMoney`) also see the stored `status_code` and `error`. A scheduled run reads "scheduled" in the runs tables and on the run page where a manual run shows nothing. An unknown time zone answers "Choose a time zone from the list."
- **Customer copy:** no money, no HTTP codes, no hosts, never "budget" — `packages/app/src/customer-copy-sweep.test.ts` stays green. A mutation's message reaches a customer only through `mutationErrorText`, so every refusal is a `BAD_REQUEST` carrying one plain sentence — never zod's JSON, never `https://`, an IP or a host name (`captureWords` would swap it for "Something went wrong").
- **No paid AI.** Nothing in this feature calls a model; every process this plan starts runs with `ANTHROPIC_API_KEY= JEV_SHADOW= TYPESAFE_API_KEY=`.
- **Marko's data and servers:** never start, stop or restart his dev servers (:3000/:4000) or his worker; never write a dev-DB row outside tests. The dev database is shared with tests: every sweep call in a test passes `only: [<its own website ids>]` (a bare sweep would claim real websites); a test makes a website due (`next_run_at` in the past) immediately before it claims it, and deletes it in `finally`; every in-process or child worker this repo starts on the dev database runs with `recurringRuns: false` / `RECURRING_RUNS=off`. Migration `0021` is applied to the dev database with `drizzle-kit migrate` (additive: nullable columns and new tables only; `main`'s code ignores them).
- **Tests:** Postgres is the `robot-platform-db` container (`docker start robot-platform-db`); api tests get a per-file `JOB_QUEUE` automatically (`packages/api/src/test-setup/job-queue.ts`). One file at a time while working (`cd packages/<pkg> && npx vitest run <file>`); full suites serially with `npx vitest run --no-file-parallelism`. Never `pnpm -r test`.
- **ESM:** relative imports carry `.js` in `@robot/db`, `@robot/api`, `@robot/api-server`, `@robot/worker`; none in `@robot/app`.
- **Commits:** by explicit path (`git add <paths>` then `git commit`), never `git add -A` / `git add .`; never stage `packages/app/src/routeTree.gen.ts`; every message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Line endings:** files in this repo are CRLF on this machine — edit with tools that keep them (the Edit tool does); new files may be LF.

## Review Focus

1. **A receiver that redirects** (a 302 to an internal address — the usual way around an address check) — a person expects a failed attempt and the second address never contacted. → Task 3 test "RF1: a redirect is a failed delivery and is never followed".
2. **A public-looking name that resolves to a private address** (DNS pointing at 127.0.0.1, or one private address among public ones), and odd spellings of a loopback literal (`2130706433`, `0x7f.0.0.1`, `[::ffff:127.0.0.1]`) — a person expects them refused, at send and at save. → Task 3 tests "RF2: a name that resolves to a private address is refused at connect", "RF2: one private address among public ones is enough to refuse", and the `refuses %s` table in `webhook-url.test.ts`.
3. **A receiver that hangs, or streams an endless body** — a person expects the attempt to end within the limit and the job never to hang. → Task 3 tests "RF3: a receiver that never answers fails at the timeout" and "RF3: an endless 2xx body is read up to the cap, and the delivery counts".
4. **Backfills, samples and empty failures** — a person expects a backfill (repair) run to re-deliver its parent (the parent's id and files, not a second "run"), a sample never to post, and a failed run with no rows never to post. → Task 6 test "RF4: a backfill delivers its parent; a sample and a failed run with no rows deliver nothing".
5. **A link replayed on another format, and a snapshot asked for before it exists** — a person expects 404, never another format's file and never the live file. → Task 7 tests "RF5: a link signed for the CSV does not open the JSON" and "RF5: ?snapshot=1 before the file is written is 404, never the live file".

---

### Task 1: The schema and migration 0021 (`@robot/db`) — spec §3.1–§3.4

**Files:**
- Modify: `packages/db/src/schema.ts` (import line 1; `sources` columns after `nextCheckAt` ~line 185 and its index list ~line 188; new tables after `runItemsRelations` ~line 739)
- Test: `packages/db/src/schema.test.ts`
- Generated: `packages/db/drizzle/0021_recurring_extraction.sql`, `packages/db/drizzle/meta/0021_snapshot.json`, `packages/db/drizzle/meta/_journal.json`

**Interfaces:**
- Consumes: nothing.
- Produces: `sources.schedule` (jsonb, nullable), `sources.nextRunAt` (timestamptz, nullable), `sources.scheduleLast` (jsonb, nullable), `sources.webhookUrl` (text, nullable), `sources.webhookSecret` (text, nullable); index `sources_next_run_at_idx` on `next_run_at` where `schedule IS NOT NULL`. Tables, both `ON DELETE CASCADE` from `runs`: `runFiles` (`id`, `runId`, `format` varchar(8), `filename` text, `bytes` `Buffer` (bytea), `rows` int, `createdAt`; unique `run_files_run_format_idx (run_id, format)`) and `webhookDeliveries` (`id`, `runId`, `deliveryId` uuid, `attempt` int, `ok` bool, `statusCode` int nullable, `error` text nullable, `at`; index `webhook_deliveries_run_at_idx (run_id, at)`). All exported from `@robot/db` (its index re-exports the schema).

- [ ] **Step 1: Write the failing test** — append to `packages/db/src/schema.test.ts` (add `runFiles, webhookDeliveries` to the import from `./index.js`):

```ts
describe('recurring extraction columns (spec 2026-10-24)', () => {
  it('a website keeps its schedule, next run, last outcome and webhook', async () => {
    const schedule = { days: [1], time: '06:00', timeZone: 'Europe/Berlin' };
    const next = new Date('2026-10-26T05:00:00Z');
    const { orgId: seeded, source } = await seedSource({
      schedule, nextRunAt: next, scheduleLast: { at: '2026-10-19T04:00:00.000Z', outcome: 'skipped', reason: 'busy' },
      webhookUrl: 'https://hooks.example.com/robot', webhookSecret: 'ab'.repeat(32),
    });
    orgId = seeded;
    const [row] = await db.select().from(sources).where(eq(sources.id, source.id));
    expect(row!.schedule).toEqual(schedule);
    expect(row!.nextRunAt!.toISOString()).toBe(next.toISOString());
    expect(row!.scheduleLast).toMatchObject({ outcome: 'skipped', reason: 'busy' });
    expect(row!.webhookUrl).toBe('https://hooks.example.com/robot');
    expect(row!.webhookSecret).toHaveLength(64);
  });

  it('a website without them reads null everywhere', async () => {
    const { orgId: seeded, source } = await seedSource();
    orgId = seeded;
    const [row] = await db.select().from(sources).where(eq(sources.id, source.id));
    expect([row!.schedule, row!.nextRunAt, row!.scheduleLast, row!.webhookUrl, row!.webhookSecret]).toEqual([null, null, null, null, null]);
  });

  it('a run keeps one file per format, its bytes intact, replaced on conflict', async () => {
    const { orgId: seeded, source } = await seedSource();
    orgId = seeded;
    const [run] = await db.insert(runs).values({ sourceId: source.id, status: 'completed' }).returning();
    const first = Buffer.from([0xef, 0xbb, 0xbf, 0x61, 0x0d, 0x0a]);
    await db.insert(runFiles).values({ runId: run!.id, format: 'csv', filename: 'a.csv', bytes: first, rows: 1 });
    await expect(db.insert(runFiles).values({ runId: run!.id, format: 'csv', filename: 'b.csv', bytes: first, rows: 1 })).rejects.toThrow();
    const second = Buffer.from([0x00, 0xff, 0x10]);
    await db.insert(runFiles).values({ runId: run!.id, format: 'csv', filename: 'b.csv', bytes: second, rows: 2 })
      .onConflictDoUpdate({ target: [runFiles.runId, runFiles.format], set: { filename: 'b.csv', bytes: second, rows: 2 } });
    const rows = await db.select().from(runFiles).where(eq(runFiles.runId, run!.id));
    expect(rows).toHaveLength(1);
    expect(Buffer.isBuffer(rows[0]!.bytes)).toBe(true);
    expect(rows[0]!.bytes.equals(second)).toBe(true);
    expect(rows[0]).toMatchObject({ format: 'csv', filename: 'b.csv', rows: 2 });
  });

  it('a webhook attempt is one row, and files and attempts go with their run', async () => {
    const { orgId: seeded, source } = await seedSource();
    orgId = seeded;
    const [run] = await db.insert(runs).values({ sourceId: source.id, status: 'completed' }).returning();
    const deliveryId = '7d4f2b1a-3333-4333-8333-333333333333';
    await db.insert(webhookDeliveries).values([
      { runId: run!.id, deliveryId, attempt: 1, ok: false, statusCode: 500, error: 'answered 500' },
      { runId: run!.id, deliveryId, attempt: 2, ok: true, statusCode: 200, error: null },
    ]);
    await db.insert(runFiles).values({ runId: run!.id, format: 'json', filename: 'a.json', bytes: Buffer.from('{}'), rows: 0 });
    const attempts = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.runId, run!.id));
    expect(attempts.map((a) => [a.attempt, a.ok, a.statusCode])).toEqual(expect.arrayContaining([[1, false, 500], [2, true, 200]]));
    await db.delete(runs).where(eq(runs.id, run!.id));
    expect(await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.runId, run!.id))).toEqual([]);
    expect(await db.select().from(runFiles).where(eq(runFiles.runId, run!.id))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-recurring/packages/db && npx vitest run src/schema.test.ts`
Expected: FAIL — `runFiles` / `webhookDeliveries` are undefined and the `sources` columns do not exist.

- [ ] **Step 3: The schema**

In `packages/db/src/schema.ts`, line 1: add `customType` to the `drizzle-orm/pg-core` import. Under the imports:

```ts
/** Postgres `bytea` (drizzle-orm 0.44 has no built-in one): a Buffer in and out (postgres-js). */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });
```

In `sources`, after the `nextCheckAt` column:

```ts
  // Recurring extraction (spec 2026-10-24 §3.1): { days: number[] (ISO, 1 = Monday); time: 'HH:MM'; timeZone }
  // or null (no schedule). `next_run_at`: when the worker's sweep next starts a run (null: never);
  // `schedule_last`: the last sweep's outcome { at, outcome: 'started' | 'skipped', reason?, runId? }.
  schedule: jsonb('schedule'),
  nextRunAt: timestamp('next_run_at', { withTimezone: true }),
  scheduleLast: jsonb('schedule_last'),
  // Where a finished run is posted (§3.4), and the secret that signs the post and its file links
  // (32 random bytes, hex; made on the first save, kept when the address is removed).
  webhookUrl: text('webhook_url'),
  webhookSecret: text('webhook_secret'),
```

and in its index list, after `index('sources_is_sandbox_idx')…`:

```ts
  index('sources_next_run_at_idx').on(table.nextRunAt).where(sql`${table.schedule} IS NOT NULL`),
```

After `runItemsRelations`:

```ts
// ─── Run files and webhook deliveries (2026-10-24) ──────────────────────────
// Recurring extraction (spec 2026-10-24 §3.3–§3.4): a settled run's file, one row per format, written by its
// `run-delivery` job — the snapshot a webhook's links download (a later backfill's own delivery replaces it) —
// and one row per webhook attempt.

export const runFiles = pgTable('run_files', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id').notNull().references(() => runs.id, { onDelete: 'cascade' }),
  // 'csv' | 'json' | 'xlsx'
  format: varchar('format', { length: 8 }).notNull(),
  // The download's name, as the live export names it (exportFilename).
  filename: text('filename').notNull(),
  bytes: bytea('bytes').notNull(),
  rows: integer('rows').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('run_files_run_format_idx').on(table.runId, table.format),
]);

export const webhookDeliveries = pgTable('webhook_deliveries', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id').notNull().references(() => runs.id, { onDelete: 'cascade' }),
  // The same on every attempt of one run's delivery (the `X-Robot-Delivery` header).
  deliveryId: uuid('delivery_id').notNull(),
  attempt: integer('attempt').notNull(),
  ok: boolean('ok').notNull(),
  // Null when nothing answered (a refused address, a timeout, a connection error). Staff only.
  statusCode: integer('status_code'),
  error: text('error'),
  at: timestamp('at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('webhook_deliveries_run_at_idx').on(table.runId, table.at),
]);
```

- [ ] **Step 4: Generate and apply the migration**

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-recurring && pnpm --filter @robot/db db:generate --name recurring_extraction
cd /c/Users/Marko/Documents/projects/robot-platform-recurring/packages/db && npx drizzle-kit migrate
```

(`db:generate` is `drizzle-kit generate`; pnpm appends `--name`.) Expected: `drizzle/0021_recurring_extraction.sql` with five `ALTER TABLE "sources" ADD COLUMN …`, `CREATE TABLE "run_files"`, `CREATE TABLE "webhook_deliveries"`, their two foreign keys `ON DELETE cascade`, `CREATE UNIQUE INDEX "run_files_run_format_idx"`, `CREATE INDEX "webhook_deliveries_run_at_idx"` and `CREATE INDEX "sources_next_run_at_idx" … WHERE "sources"."schedule" IS NOT NULL` — and nothing else (no `DROP`, no rename, no other table). Read the file before migrating; if drizzle-kit asks an interactive rename question or the SQL has anything else, stop and fix the schema. `_journal.json` gains entry `idx: 21`, tag `0021_recurring_extraction`.

- [ ] **Step 5: Run the test and the type-check**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-recurring/packages/db && npx vitest run src/schema.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-recurring
git add packages/db/src/schema.ts packages/db/src/schema.test.ts packages/db/drizzle/0021_recurring_extraction.sql packages/db/drizzle/meta/0021_snapshot.json packages/db/drizzle/meta/_journal.json
git commit -m "feat(db): a website's schedule and webhook; run files and webhook deliveries

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The schedule — validation and `nextRunAt` (`@robot/api` `src/recurring/schedule.ts`) — spec §3.1

**Files:**
- Create: `packages/api/src/recurring/schedule.ts`
- Test: `packages/api/src/recurring/schedule.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type Schedule = { days: number[]; time: string; timeZone: string }`
  - `type SkipReason = 'paused' | 'not_certified' | 'not_confirmed' | 'busy'`
  - `type ScheduleLast = { at: string; outcome: 'started' | 'skipped'; reason?: SkipReason; runId?: string }`
  - `const SCHEDULED_LABEL = 'scheduled'` (the run's `input_label`)
  - `const TIME_ZONE_MESSAGE = 'Choose a time zone from the list.'`
  - `isTimeZone(tz: string): boolean`
  - `parseSchedule(raw: unknown): { ok: true; schedule: Schedule } | { ok: false; message: string }` — days sorted ascending, the time zone as `Intl` resolves it.
  - `nextRunAt(schedule: Schedule, after: Date): Date`

- [ ] **Step 1: Write the failing test** — `packages/api/src/recurring/schedule.test.ts`:

```ts
// Spec 2026-10-24 §3.1: the next run of a weekly schedule, in its own time zone, across DST — pure.
import { describe, it, expect } from 'vitest';
import { isTimeZone, nextRunAt, parseSchedule, TIME_ZONE_MESSAGE, type Schedule } from './schedule.js';

const s = (days: number[], time: string, timeZone: string): Schedule => ({ days, time, timeZone });
const next = (sch: Schedule, after: string) => nextRunAt(sch, new Date(after)).toISOString();

describe('nextRunAt — days and zones', () => {
  it('the next listed day at the time, in the zone (Saturday 24 October 2026 to Monday)', () => {
    // Berlin is CET (+1) from 25 October; Kolkata +5:30 all year; New York EDT (-4) until 1 November.
    expect(next(s([1], '06:00', 'Europe/Berlin'), '2026-10-24T12:00:00Z')).toBe('2026-10-26T05:00:00.000Z');
    expect(next(s([1], '06:00', 'Asia/Kolkata'), '2026-10-24T12:00:00Z')).toBe('2026-10-26T00:30:00.000Z');
    expect(next(s([1], '06:00', 'America/New_York'), '2026-10-24T12:00:00Z')).toBe('2026-10-26T10:00:00.000Z');
  });
  it('today while the time is still ahead; strictly after, so the instant itself is next week', () => {
    // Saturday 24 October 12:00 in Berlin (CEST, +2) is 10:00Z.
    expect(next(s([6], '12:00', 'Europe/Berlin'), '2026-10-24T09:59:00Z')).toBe('2026-10-24T10:00:00.000Z');
    expect(next(s([6], '12:00', 'Europe/Berlin'), '2026-10-24T10:00:00Z')).toBe('2026-10-31T11:00:00.000Z');
  });
  it('weekdays from a Friday evening is Monday; every day past today’s time is tomorrow', () => {
    expect(next(s([1, 2, 3, 4, 5], '06:00', 'Europe/Berlin'), '2026-10-23T18:00:00Z')).toBe('2026-10-26T05:00:00.000Z');
    expect(next(s([1, 2, 3, 4, 5, 6, 7], '06:00', 'Europe/Berlin'), '2026-10-24T05:00:00Z')).toBe('2026-10-25T05:00:00.000Z');
  });
  it('a worker down for a week: one next time, from now', () => {
    // Wednesday 4 November → Monday 9 November 06:00 IST.
    expect(next(s([1], '06:00', 'Asia/Kolkata'), '2026-11-04T00:00:00Z')).toBe('2026-11-09T00:30:00.000Z');
  });
});

describe('nextRunAt — DST', () => {
  it('Berlin spring-forward gap: 02:30 on Sunday 29 March runs at 03:00 CEST, the first instant after the gap', () => {
    expect(next(s([7], '02:30', 'Europe/Berlin'), '2026-03-28T12:00:00Z')).toBe('2026-03-29T01:00:00.000Z');
  });
  it('Berlin fall-back overlap: 02:30 on Sunday 25 October runs once, at the first (CEST) one', () => {
    expect(next(s([7], '02:30', 'Europe/Berlin'), '2026-10-24T12:00:00Z')).toBe('2026-10-25T00:30:00.000Z');
    // Between the two 02:30s it is not due again that night: next Sunday, 02:30 CET.
    expect(next(s([7], '02:30', 'Europe/Berlin'), '2026-10-25T01:00:00Z')).toBe('2026-11-01T01:30:00.000Z');
  });
  it('New York: 02:30 on 8 March runs at 03:00 EDT; 01:30 on 1 November at the first (EDT) one', () => {
    expect(next(s([7], '02:30', 'America/New_York'), '2026-03-07T12:00:00Z')).toBe('2026-03-08T07:00:00.000Z');
    expect(next(s([7], '01:30', 'America/New_York'), '2026-10-31T12:00:00Z')).toBe('2026-11-01T05:30:00.000Z');
  });
  it('Lord Howe’s 30-minute shift: the gap on 4 October, the overlap on 5 April', () => {
    // +10:30 → +11 at 02:00 local on 4 October 2026 (15:30Z on the 3rd): 02:15 does not exist that night.
    expect(next(s([7], '02:15', 'Australia/Lord_Howe'), '2026-10-03T00:00:00Z')).toBe('2026-10-03T15:30:00.000Z');
    // +11 → +10:30 at 02:00 local on 5 April 2026 (15:00Z on the 4th): 01:45 happens twice; the first is +11.
    expect(next(s([7], '01:45', 'Australia/Lord_Howe'), '2026-04-04T00:00:00Z')).toBe('2026-04-04T14:45:00.000Z');
  });
  it('Kolkata has no DST: the same UTC time across Europe’s change', () => {
    expect(next(s([7], '06:00', 'Asia/Kolkata'), '2026-03-28T12:00:00Z')).toBe('2026-03-29T00:30:00.000Z');
    expect(next(s([7], '06:00', 'Asia/Kolkata'), '2026-03-29T12:00:00Z')).toBe('2026-04-05T00:30:00.000Z');
  });
});

describe('parseSchedule', () => {
  it('accepts a schedule, its days sorted', () => {
    expect(parseSchedule({ days: [5, 1], time: '06:00', timeZone: 'Europe/Berlin' }))
      .toEqual({ ok: true, schedule: { days: [1, 5], time: '06:00', timeZone: 'Europe/Berlin' } });
  });
  it.each([
    [{ days: [], time: '06:00', timeZone: 'UTC' }, 'Choose at least one day.'],
    [{ days: [1, 1], time: '06:00', timeZone: 'UTC' }, 'Choose each day once.'],
    [{ days: [0], time: '06:00', timeZone: 'UTC' }, 'Choose days from Monday to Sunday.'],
    [{ days: [8], time: '06:00', timeZone: 'UTC' }, 'Choose days from Monday to Sunday.'],
    [{ days: [1.5], time: '06:00', timeZone: 'UTC' }, 'Choose days from Monday to Sunday.'],
    [{ days: [1], time: '6:00', timeZone: 'UTC' }, 'Use a time like 06:00.'],
    [{ days: [1], time: '24:00', timeZone: 'UTC' }, 'Use a time like 06:00.'],
    [{ days: [1], time: '06:60', timeZone: 'UTC' }, 'Use a time like 06:00.'],
    [{ days: [1], time: '06:00', timeZone: 'Mars/Olympus_Mons' }, TIME_ZONE_MESSAGE],
    [{ days: [1], time: '06:00', timeZone: '' }, TIME_ZONE_MESSAGE],
    [null, 'That schedule could not be saved.'],
    ['every monday', 'That schedule could not be saved.'],
  ])('refuses %j with one sentence', (raw, message) => {
    expect(parseSchedule(raw)).toEqual({ ok: false, message });
  });
  it('isTimeZone is what Intl accepts', () => {
    expect(isTimeZone('Europe/Berlin')).toBe(true);
    expect(isTimeZone('Australia/Lord_Howe')).toBe(true);
    expect(isTimeZone('Europe/Atlantis')).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-recurring/packages/api && npx vitest run src/recurring/schedule.test.ts`
Expected: FAIL — `./schedule.js` does not exist.

- [ ] **Step 3: Implement** — `packages/api/src/recurring/schedule.ts`:

```ts
// packages/api/src/recurring/schedule.ts
// A website's schedule (spec 2026-10-24 §3.1): ISO weekdays, a 24-hour wall time, an IANA time zone. Pure, and
// Intl only (no library): a wall time in a spring-forward gap runs at the first instant after the gap; one that
// happens twice (fall-back) runs once, at its first occurrence.
import { z } from 'zod';

export type Schedule = { days: number[]; time: string; timeZone: string };
export type SkipReason = 'paused' | 'not_certified' | 'not_confirmed' | 'busy';
/** `sources.schedule_last`: what the last sweep did with the website. */
export type ScheduleLast = { at: string; outcome: 'started' | 'skipped'; reason?: SkipReason; runId?: string };
/** The `input_label` of a run a schedule started (beside 'probe' and 'backfill'). */
export const SCHEDULED_LABEL = 'scheduled';

export const TIME_ZONE_MESSAGE = 'Choose a time zone from the list.';
const NOT_A_SCHEDULE = 'That schedule could not be saved.';
const NO_DAY = 'Choose at least one day.';
const DAY_RANGE = 'Choose days from Monday to Sunday.';
const TIME_MESSAGE = 'Use a time like 06:00.';
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const scheduleSchema = z.object({
  days: z.array(z.number({ invalid_type_error: DAY_RANGE }).int(DAY_RANGE).min(1, DAY_RANGE).max(7, DAY_RANGE), { required_error: NO_DAY, invalid_type_error: NO_DAY })
    .min(1, NO_DAY)
    .refine((d) => new Set(d).size === d.length, 'Choose each day once.'),
  time: z.string({ required_error: TIME_MESSAGE, invalid_type_error: TIME_MESSAGE }).regex(TIME, TIME_MESSAGE),
  timeZone: z.string({ required_error: TIME_ZONE_MESSAGE, invalid_type_error: TIME_ZONE_MESSAGE })
    .min(1, TIME_ZONE_MESSAGE).max(100, TIME_ZONE_MESSAGE).refine(isTimeZone, TIME_ZONE_MESSAGE),
}, { required_error: NOT_A_SCHEDULE, invalid_type_error: NOT_A_SCHEDULE });

/** The customer's schedule, or the one sentence that says what is wrong with it (shown as is). */
export function parseSchedule(raw: unknown): { ok: true; schedule: Schedule } | { ok: false; message: string } {
  const r = scheduleSchema.safeParse(raw);
  if (!r.success) return { ok: false, message: r.error.issues[0]?.message ?? NOT_A_SCHEDULE };
  const timeZone = new Intl.DateTimeFormat('en-US', { timeZone: r.data.timeZone }).resolvedOptions().timeZone;
  return { ok: true, schedule: { days: [...r.data.days].sort((a, b) => a - b), time: r.data.time, timeZone } };
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

type Wall = { y: number; mo: number; d: number; h: number; mi: number; s: number };
function wallAt(t: number, timeZone: string): Wall {
  const parts = formatter(timeZone).formatToParts(new Date(t));
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { y: get('year'), mo: get('month'), d: get('day'), h: get('hour') % 24, mi: get('minute'), s: get('second') };
}

/** The zone's offset at instant `t`, in ms (its wall clock read as UTC, minus the instant), to the second. */
function offsetAt(t: number, timeZone: string): number {
  const w = wallAt(t, timeZone);
  return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) - Math.floor(t / 1000) * 1000;
}

const DAY_MS = 86_400_000;

/** The instant the zone's clocks read y-mo-d h:mi; in a gap, the first instant after it; read twice, the first. */
function instantOf(y: number, mo: number, d: number, h: number, mi: number, timeZone: string): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const before = offsetAt(guess - DAY_MS, timeZone);
  const after = offsetAt(guess + DAY_MS, timeZone);
  const hits = [...new Set([before, after])]
    .map((o) => guess - o)
    .filter((t) => { const w = wallAt(t, timeZone); return w.y === y && w.mo === mo && w.d === d && w.h === h && w.mi === mi; });
  if (hits.length > 0) return Math.min(...hits);
  // A gap: the transition lies between the two readings; find its first instant on the new offset.
  let lo = guess - Math.max(before, after);
  let hi = guess - Math.min(before, after);
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (offsetAt(mid, timeZone) === after) hi = mid; else lo = mid;
  }
  return hi;
}

/** The first instant strictly after `after` whose wall clock in `timeZone` is a listed day at `time` (spec §3.1). */
export function nextRunAt(schedule: Schedule, after: Date): Date {
  const [hh, mm] = schedule.time.split(':').map(Number) as [number, number];
  const from = after.getTime();
  const start = wallAt(from, schedule.timeZone);
  // Today and the next eight local days cover every weekday, today's included once its time has passed.
  for (let i = 0; i <= 8; i++) {
    const day = new Date(Date.UTC(start.y, start.mo - 1, start.d + i));
    const iso = ((day.getUTCDay() + 6) % 7) + 1;
    if (!schedule.days.includes(iso)) continue;
    const t = instantOf(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hh, mm, schedule.timeZone);
    if (t > from) return new Date(t);
  }
  throw new Error(`nextRunAt: no day in ${JSON.stringify(schedule.days)}`);
}
```

- [ ] **Step 4: Run the tests**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-recurring/packages/api && npx vitest run src/recurring/schedule.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors. A DST case that fails is a bug in `instantOf` — fix the code, never the expected instant (each was worked out from the zone's 2026 rule in its comment).

- [ ] **Step 5: Commit**

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-recurring
git add packages/api/src/recurring/schedule.ts packages/api/src/recurring/schedule.test.ts
git commit -m "feat(api): a website's weekly schedule and its next run, across DST

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Webhook safety, signing and the safe POST (`@robot/api` `src/delivery/`) — spec §3.3–§3.4

**Files:**
- Create: `packages/api/src/delivery/webhook-url.ts`, `packages/api/src/delivery/signing.ts`, `packages/api/src/delivery/webhook-post.ts`
- Test: `packages/api/src/delivery/webhook-url.test.ts`, `packages/api/src/delivery/signing.test.ts`, `packages/api/src/delivery/webhook-post.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (`webhook-url.ts`): `PUBLIC_ADDRESS_MESSAGE = 'Use a public web address.'`; `WEBHOOK_URL_MAX = 2000`; `isPrivateAddress(ip: string): boolean`; `hostIsPrivateLiteral(hostname: string): boolean`; `webhookPrivateAllowed(env?: Record<string, string | undefined>): boolean` (`WEBHOOK_ALLOW_PRIVATE=on`); `checkWebhookUrl(raw: string, opts?: { allowPrivate?: boolean }): { ok: true; url: string } | { ok: false; message: string }`.
- Produces (`signing.ts`): `LINK_TTL_S = 604800`; `newWebhookSecret(): string`; `bodySignature(secret: string, body: string): string` (`sha256=<hex>`); `fileSignature(secret: string, runId: string, format: string, expires: number): string`; `signedFileUrl(base: string, secret: string, runId: string, format: string, expires: number): string`; `checkFileSignature(a: { secret: string | null; runId: string; format: string; expires: string | undefined; sig: string | undefined; nowS?: number }): boolean`; `publicApiUrl(env?: Record<string, string | undefined>): string`.
- Produces (`webhook-post.ts`): `WEBHOOK_TIMEOUT_MS = 10000`; `WEBHOOK_MAX_RESPONSE_BYTES = 65536`; `type PostResult = { ok: boolean; statusCode: number | null; error: string | null }`; `type Resolve = (hostname: string, cb: (err: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void) => void`; `checkingLookup(allowPrivate: boolean, resolve?: Resolve): LookupFunction`; `postWebhook(url: string, body: string, headers: Record<string, string>, opts?: { allowPrivate?: boolean; timeoutMs?: number; maxBytes?: number; resolve?: Resolve }): Promise<PostResult>` — never rejects.

- [ ] **Step 1: Write the failing tests**

`packages/api/src/delivery/webhook-url.test.ts`:

```ts
// Spec 2026-10-24 §3.4 "Safety", when saving: which addresses a webhook may name. Pure.
import { describe, it, expect } from 'vitest';
import { checkWebhookUrl, hostIsPrivateLiteral, isPrivateAddress, PUBLIC_ADDRESS_MESSAGE, webhookPrivateAllowed } from './webhook-url.js';

describe('isPrivateAddress — the range table', () => {
  it.each([
    '127.0.0.1', '127.255.255.254', '10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.0.1', '169.254.169.254',
    '100.64.0.1', '100.127.255.255', '0.0.0.0', '224.0.0.1', '239.255.255.255', '255.255.255.255',
    '::', '::1', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1',
    '::ffff:127.0.0.1', '::ffff:7f00:1', '0:0:0:0:0:ffff:a00:1', '::ffff:192.168.1.1',
    'not-an-address',
  ])('%s is refused', (ip) => expect(isPrivateAddress(ip)).toBe(true));
  it.each(['8.8.8.8', '1.1.1.1', '172.32.0.1', '100.128.0.1', '93.184.216.34', '2606:4700::1111', '::ffff:8.8.8.8', '2001:4860:4860::8888'])(
    '%s is public', (ip) => expect(isPrivateAddress(ip)).toBe(false),
  );
});

describe('checkWebhookUrl', () => {
  it('accepts a public address and hands it back normalised', () => {
    expect(checkWebhookUrl('  HTTPS://Hooks.Example.com/robot?x=1 ')).toEqual({ ok: true, url: 'https://hooks.example.com/robot?x=1' });
    expect(checkWebhookUrl('http://8.8.8.8:8080/hook').ok).toBe(true);
    expect(checkWebhookUrl('http://[2606:4700::1111]/hook').ok).toBe(true);
  });
  it.each([
    'http://127.0.0.1/hook', 'http://localhost:8080/hook', 'http://LOCALHOST./hook', 'http://app.localhost/', 'http://10.1.2.3/',
    'http://192.168.1.1/', 'http://169.254.169.254/latest/meta-data', 'http://100.64.0.1/', 'http://0.0.0.0/', 'http://224.0.0.1/',
    'http://[::1]/', 'http://[::]/', 'http://[fe80::1]/', 'http://[fd00::1]/', 'http://[ff02::1]/',
    'http://[::ffff:127.0.0.1]/', 'http://[::ffff:a00:1]/', 'http://2130706433/', 'http://0x7f.0.0.1/', 'http://127.1/',
  ])('refuses %s', (u) => expect(checkWebhookUrl(u)).toEqual({ ok: false, message: PUBLIC_ADDRESS_MESSAGE }));
  it.each([
    ['', 'Enter a web address.'],
    ['hooks.example.com/robot', 'Enter the full web address, starting with http or https.'],
    ['ftp://hooks.example.com/robot', 'Enter the full web address, starting with http or https.'],
    ['javascript:alert(1)', 'Enter the full web address, starting with http or https.'],
    ['https://user:pass@hooks.example.com/robot', 'Leave the user name and password out of the address.'],
    ['https://user@hooks.example.com/robot', 'Leave the user name and password out of the address.'],
    [`https://hooks.example.com/${'a'.repeat(2000)}`, 'Use a web address of at most 2,000 characters.'],
  ])('%s → %s', (u, message) => expect(checkWebhookUrl(u)).toEqual({ ok: false, message }));
  it('WEBHOOK_ALLOW_PRIVATE lifts the range check only', () => {
    expect(checkWebhookUrl('http://127.0.0.1:9/x', { allowPrivate: true })).toEqual({ ok: true, url: 'http://127.0.0.1:9/x' });
    expect(checkWebhookUrl('ftp://127.0.0.1/x', { allowPrivate: true }).ok).toBe(false);
    expect(webhookPrivateAllowed({ WEBHOOK_ALLOW_PRIVATE: 'on' })).toBe(true);
    expect(webhookPrivateAllowed({ WEBHOOK_ALLOW_PRIVATE: ' ON ' })).toBe(true);
    expect(webhookPrivateAllowed({ WEBHOOK_ALLOW_PRIVATE: '1' })).toBe(false);
    expect(webhookPrivateAllowed({})).toBe(false);
  });
  it('hostIsPrivateLiteral leaves names to the send-time lookup', () => {
    expect(hostIsPrivateLiteral('hooks.example.com')).toBe(false);
    expect(hostIsPrivateLiteral('[::1]')).toBe(true);
  });
});
```

`packages/api/src/delivery/signing.test.ts`:

```ts
// Spec 2026-10-24 §3.3–§3.4: the body signature and the signed file links. Pure.
import { createHmac } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { bodySignature, checkFileSignature, fileSignature, LINK_TTL_S, newWebhookSecret, publicApiUrl, signedFileUrl } from './signing.js';

const SECRET = 'a'.repeat(64);
const RUN = '3f1c2b4a-1111-4111-8111-111111111111';
const EXP = 2_000_000_000;

describe('signing', () => {
  it('the body signature is sha256= and the hex HMAC-SHA256 of the raw body', () => {
    expect(bodySignature(SECRET, '{"a":1}')).toBe(`sha256=${createHmac('sha256', SECRET).update('{"a":1}').digest('hex')}`);
  });
  it('a file signature is the HMAC of "<runId>.<fmt>.<expires>"', () => {
    expect(fileSignature(SECRET, RUN, 'csv', EXP)).toBe(createHmac('sha256', SECRET).update(`${RUN}.csv.${EXP}`).digest('hex'));
  });
  it('a signed link is absolute, names the run and format, and checks back', () => {
    const url = signedFileUrl('http://api.test/', SECRET, RUN, 'csv', EXP);
    expect(url).toBe(`http://api.test/export/runs/${RUN}.csv?expires=${EXP}&sig=${fileSignature(SECRET, RUN, 'csv', EXP)}`);
    const q = new URL(url).searchParams;
    expect(checkFileSignature({ secret: SECRET, runId: RUN, format: 'csv', expires: q.get('expires')!, sig: q.get('sig')!, nowS: EXP - 1 })).toBe(true);
  });
  const good = { secret: SECRET as string | null, runId: RUN, format: 'csv', expires: String(EXP) as string | undefined, sig: fileSignature(SECRET, RUN, 'csv', EXP) as string | undefined, nowS: EXP - 60 };
  it.each([
    ['another run', { runId: '9a8b7c6d-2222-4222-8222-222222222222' }],
    ['another format', { format: 'json' }],
    ['a replaced secret', { secret: 'b'.repeat(64) }],
    ['no secret', { secret: null }],
    ['expired', { nowS: EXP }],
    ['a tampered signature', { sig: `${good.sig!.slice(0, -1)}${good.sig!.endsWith('0') ? '1' : '0'}` }],
    ['a short signature', { sig: 'abc' }],
    ['no signature', { sig: undefined }],
    ['no expiry', { expires: undefined }],
    ['an expiry that is not a whole number', { expires: '2e9' }],
  ])('refuses %s', (_why, change) => {
    expect(checkFileSignature({ ...good, ...change })).toBe(false);
  });
  it('links live seven days', () => expect(LINK_TTL_S).toBe(7 * 86_400));
  it('a secret is 32 random bytes, hex', () => {
    const a = newWebhookSecret();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(newWebhookSecret()).not.toBe(a);
  });
  it('PUBLIC_API_URL, default http://localhost:4000, without a trailing slash', () => {
    expect(publicApiUrl({})).toBe('http://localhost:4000');
    expect(publicApiUrl({ PUBLIC_API_URL: 'https://api.example.com/ ' })).toBe('https://api.example.com');
  });
});
```

`packages/api/src/delivery/webhook-post.test.ts`:

```ts
// Spec 2026-10-24 §3.4 "Safety", when sending: one POST, no redirects, a time limit, a read cap, and an address
// check on what the name resolves to. Local servers on 127.0.0.1 only.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it, expect, afterEach } from 'vitest';
import { postWebhook, type Resolve } from './webhook-post.js';

type Received = { method: string; headers: IncomingMessage['headers']; body: string };
const servers: Array<{ close(): Promise<void> }> = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((s) => s.close())); });

async function serve(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const received: Received[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c: string) => { body += c; });
    req.on('end', () => { received.push({ method: req.method ?? '', headers: req.headers, body }); handler(req, res); });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  const handle = {
    port, url: `http://127.0.0.1:${port}/hook`, received,
    close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }),
  };
  servers.push(handle);
  return handle;
}
const to = (address: string): Resolve => (_h, cb) => cb(null, [{ address, family: address.includes(':') ? 6 : 4 }]);

describe('postWebhook', () => {
  it('posts the body with the headers given; a 2xx is delivered', async () => {
    const s = await serve((_q, res) => res.writeHead(204).end());
    const r = await postWebhook(s.url, '{"x":1}', { 'Content-Type': 'application/json', 'X-Robot-Event': 'run.finished' }, { allowPrivate: true });
    expect(r).toEqual({ ok: true, statusCode: 204, error: null });
    expect(s.received).toMatchObject([{ method: 'POST', body: '{"x":1}', headers: { 'content-type': 'application/json', 'x-robot-event': 'run.finished', 'content-length': '7' } }]);
  });
  it('a 500 is a failed attempt with its code', async () => {
    const s = await serve((_q, res) => res.writeHead(500).end('nope'));
    expect(await postWebhook(s.url, '{}', {}, { allowPrivate: true })).toMatchObject({ ok: false, statusCode: 500 });
  });
  it('RF1: a redirect is a failed delivery and is never followed', async () => {
    const inner = await serve((_q, res) => res.writeHead(200).end());
    const outer = await serve((_q, res) => res.writeHead(302, { Location: inner.url }).end());
    const r = await postWebhook(outer.url, '{}', {}, { allowPrivate: true });
    expect(r).toMatchObject({ ok: false, statusCode: 302 });
    expect(inner.received).toHaveLength(0);
  });
  it('RF3: a receiver that never answers fails at the timeout', async () => {
    const s = await serve(() => { /* never answers */ });
    const t0 = Date.now();
    const r = await postWebhook(s.url, '{}', {}, { allowPrivate: true, timeoutMs: 300 });
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(r).toMatchObject({ ok: false, statusCode: null });
    expect(r.error).toMatch(/no answer within/);
  });
  it('RF3: an endless 2xx body is read up to the cap, and the delivery counts', async () => {
    const s = await serve((_q, res) => {
      res.writeHead(200);
      const timer = setInterval(() => { if (!res.destroyed) res.write('x'.repeat(512)); else clearInterval(timer); }, 2);
      res.on('close', () => clearInterval(timer));
    });
    const t0 = Date.now();
    const r = await postWebhook(s.url, '{}', {}, { allowPrivate: true, maxBytes: 4096, timeoutMs: 5000 });
    expect(r).toEqual({ ok: true, statusCode: 200, error: null });
    expect(Date.now() - t0).toBeLessThan(4000);
  });
  it('refuses a loopback literal without the flag; the server never sees it', async () => {
    const s = await serve((_q, res) => res.writeHead(200).end());
    const r = await postWebhook(s.url, '{}', {});
    expect(r).toMatchObject({ ok: false, statusCode: null });
    expect(r.error).toMatch(/private/);
    expect(s.received).toHaveLength(0);
  });
  it('RF2: a name that resolves to a private address is refused at connect', async () => {
    const s = await serve((_q, res) => res.writeHead(200).end());
    const r = await postWebhook(`http://hooks.test:${s.port}/hook`, '{}', {}, { resolve: to('127.0.0.1') });
    expect(r).toMatchObject({ ok: false, statusCode: null });
    expect(r.error).toMatch(/private/);
    expect(s.received).toHaveLength(0);
  });
  it('RF2: one private address among public ones is enough to refuse', async () => {
    const both: Resolve = (_h, cb) => cb(null, [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.5', family: 4 }]);
    const r = await postWebhook('http://hooks.test:9/hook', '{}', {}, { resolve: both, timeoutMs: 2000 });
    expect(r).toMatchObject({ ok: false, statusCode: null });
    expect(r.error).toMatch(/private/);
  });
  it('with the flag, the address the lookup checked is the one it connects to', async () => {
    const s = await serve((_q, res) => res.writeHead(200).end());
    const r = await postWebhook(`http://hooks.test:${s.port}/hook`, '{}', {}, { allowPrivate: true, resolve: to('127.0.0.1') });
    expect(r.ok).toBe(true);
    expect(s.received).toHaveLength(1);
  });
  it('a closed port or a bad address is a failed attempt, never a throw', async () => {
    const s = await serve((_q, res) => res.writeHead(200).end());
    const port = s.port;
    await servers.pop()!.close();
    expect(await postWebhook(`http://127.0.0.1:${port}/hook`, '{}', {}, { allowPrivate: true })).toMatchObject({ ok: false, statusCode: null });
    expect(await postWebhook('not a url', '{}', {})).toMatchObject({ ok: false, statusCode: null });
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-recurring/packages/api && npx vitest run src/delivery/webhook-url.test.ts src/delivery/signing.test.ts src/delivery/webhook-post.test.ts`
Expected: FAIL — the three modules do not exist.

- [ ] **Step 3: Implement `webhook-url.ts`**

```ts
// packages/api/src/delivery/webhook-url.ts
// Which addresses a webhook may go to (spec 2026-10-24 §3.4 "Safety"): http or https, no credentials, at most
// 2,000 characters, and never loopback, private, link-local, CGNAT, multicast or unspecified — IPv4 and IPv6,
// v4-mapped included. A name is checked again at send time against what it resolves to (webhook-post.ts).
// `WEBHOOK_ALLOW_PRIVATE=on` lifts the range check (tests, the local live check, Docker). Pure.
import { BlockList, isIP } from 'node:net';

export const PUBLIC_ADDRESS_MESSAGE = 'Use a public web address.';
export const WEBHOOK_URL_MAX = 2000;
const FULL_ADDRESS = 'Enter the full web address, starting with http or https.';
const TOO_LONG = 'Use a web address of at most 2,000 characters.';

const blocked = new BlockList();
const V4: Array<[string, number]> = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.168.0.0', 16], ['224.0.0.0', 4], ['240.0.0.0', 4],
];
const V6: Array<[string, number]> = [['::', 96], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8]];
for (const [net, bits] of V4) blocked.addSubnet(net, bits, 'ipv4');
for (const [net, bits] of V6) blocked.addSubnet(net, bits, 'ipv6');

/** `::ffff:a.b.c.d`, in any spelling, as its IPv4 address; null for any other address. */
function v4Mapped(ip: string): string | null {
  let canonical: string;
  try { canonical = new URL(`http://[${ip}]/`).hostname.slice(1, -1); } catch { return null; }
  const m = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(canonical);
  if (!m) return null;
  const hi = parseInt(m[1]!, 16);
  const lo = parseInt(m[2]!, 16);
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

/** True for an address no webhook may reach; anything that is not an address is refused too. */
export function isPrivateAddress(ip: string): boolean {
  try {
    const kind = isIP(ip);
    if (kind === 4) return blocked.check(ip, 'ipv4');
    if (kind === 6) {
      const v4 = v4Mapped(ip);
      return v4 ? blocked.check(v4, 'ipv4') : blocked.check(ip, 'ipv6');
    }
  } catch { /* an address BlockList cannot read: refused */ }
  return true;
}

/** A URL hostname that is `localhost` or a literal address in those ranges. A name is the lookup's to check. */
export function hostIsPrivateLiteral(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1').replace(/\.$/, '');
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  return isIP(h) !== 0 && isPrivateAddress(h);
}

export function webhookPrivateAllowed(env: Record<string, string | undefined> = process.env): boolean {
  return (env.WEBHOOK_ALLOW_PRIVATE ?? '').trim().toLowerCase() === 'on';
}

/** The address as it is stored (WHATWG-normalised), or the one sentence a customer reads. */
export function checkWebhookUrl(raw: string, opts: { allowPrivate?: boolean } = {}): { ok: true; url: string } | { ok: false; message: string } {
  const text = raw.trim();
  if (text === '') return { ok: false, message: 'Enter a web address.' };
  if (text.length > WEBHOOK_URL_MAX) return { ok: false, message: TOO_LONG };
  let u: URL;
  try { u = new URL(text); } catch { return { ok: false, message: FULL_ADDRESS }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, message: FULL_ADDRESS };
  if (u.username || u.password) return { ok: false, message: 'Leave the user name and password out of the address.' };
  if (!opts.allowPrivate && hostIsPrivateLiteral(u.hostname)) return { ok: false, message: PUBLIC_ADDRESS_MESSAGE };
  const url = u.toString();
  if (url.length > WEBHOOK_URL_MAX) return { ok: false, message: TOO_LONG };
  return { ok: true, url };
}
```

- [ ] **Step 4: Implement `signing.ts`**

```ts
// packages/api/src/delivery/signing.ts
// The webhook's signatures (spec 2026-10-24 §3.3–§3.4): `X-Robot-Signature: sha256=<hex HMAC-SHA256(secret, raw body)>`,
// and a file link's `sig = HMAC-SHA256(secret, "<runId>.<fmt>.<expires>")`, `expires` in unix seconds. Pure.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Links in a webhook expire after 7 days. */
export const LINK_TTL_S = 7 * 86_400;

/** 32 random bytes, hex. */
export function newWebhookSecret(): string {
  return randomBytes(32).toString('hex');
}

export function bodySignature(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

export function fileSignature(secret: string, runId: string, format: string, expires: number): string {
  return createHmac('sha256', secret).update(`${runId}.${format}.${expires}`).digest('hex');
}

export function signedFileUrl(base: string, secret: string, runId: string, format: string, expires: number): string {
  return `${base.replace(/\/+$/, '')}/export/runs/${runId}.${format}?expires=${expires}&sig=${fileSignature(secret, runId, format, expires)}`;
}

/** Whether a link opens this run's file in this format: the website's current secret, and not expired. */
export function checkFileSignature(a: { secret: string | null; runId: string; format: string; expires: string | undefined; sig: string | undefined; nowS?: number }): boolean {
  if (!a.secret || !a.expires || !a.sig) return false;
  if (!/^\d{1,12}$/.test(a.expires) || !/^[0-9a-f]{64}$/i.test(a.sig)) return false;
  const expires = Number(a.expires);
  if (expires <= (a.nowS ?? Math.floor(Date.now() / 1000))) return false;
  const want = Buffer.from(fileSignature(a.secret, a.runId, a.format, expires), 'hex');
  return timingSafeEqual(want, Buffer.from(a.sig, 'hex'));
}

/** The api-server as a webhook's receiver reaches it: the file links are built on it. */
export function publicApiUrl(env: Record<string, string | undefined> = process.env): string {
  return (env.PUBLIC_API_URL ?? '').trim().replace(/\/+$/, '') || 'http://localhost:4000';
}
```

- [ ] **Step 5: Implement `webhook-post.ts`**

```ts
// packages/api/src/delivery/webhook-post.ts
// One webhook POST (spec 2026-10-24 §3.4): `node:http(s)` with a `lookup` that resolves the host and refuses the
// private ranges for every address it returns — the address it checked is the one connected to, so a DNS answer
// that changes between a check and the connect cannot slip through. No redirects (a 3xx is a failed delivery);
// one time limit for the whole request; the answer read up to a cap and discarded. Never rejects.
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import type { LookupFunction } from 'node:net';
import { hostIsPrivateLiteral, isPrivateAddress } from './webhook-url.js';

export const WEBHOOK_TIMEOUT_MS = 10_000;
export const WEBHOOK_MAX_RESPONSE_BYTES = 64 * 1024;
const PRIVATE = 'the address is a private or loopback network address';

/** The stored outcome of one attempt; `error` is staff-only text. */
export type PostResult = { ok: boolean; statusCode: number | null; error: string | null };
export type Resolve = (hostname: string, cb: (err: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void) => void;

const systemResolve: Resolve = (hostname, cb) => dnsLookup(hostname, { all: true }, cb);

export function checkingLookup(allowPrivate: boolean, resolve: Resolve = systemResolve): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname, (err, addresses) => {
      if (err) return callback(err, '', 0);
      const want = options.family === 4 || options.family === 6 ? options.family : 0;
      const list = addresses.filter((a) => !want || a.family === want);
      if (list.length === 0) return callback(Object.assign(new Error(`${hostname} has no address`), { code: 'ENOTFOUND' }), '', 0);
      if (!allowPrivate && list.some((a) => isPrivateAddress(a.address))) {
        return callback(Object.assign(new Error(PRIVATE), { code: 'EPRIVATE' }), '', 0);
      }
      if (options.all) return callback(null, list);
      callback(null, list[0]!.address, list[0]!.family);
    });
  };
}

export async function postWebhook(
  url: string,
  body: string,
  headers: Record<string, string>,
  opts: { allowPrivate?: boolean; timeoutMs?: number; maxBytes?: number; resolve?: Resolve } = {},
): Promise<PostResult> {
  const allowPrivate = opts.allowPrivate ?? false;
  const timeoutMs = opts.timeoutMs ?? WEBHOOK_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? WEBHOOK_MAX_RESPONSE_BYTES;
  let u: URL;
  try { u = new URL(url); } catch { return { ok: false, statusCode: null, error: 'not a valid address' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, statusCode: null, error: 'not an http or https address' };
  // A literal address never goes through `lookup`: it is checked here.
  if (!allowPrivate && hostIsPrivateLiteral(u.hostname)) return { ok: false, statusCode: null, error: PRIVATE };
  const send = u.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise<PostResult>((resolve) => {
    let settled = false;
    const done = (r: PostResult) => { if (settled) return; settled = true; clearTimeout(timer); resolve(r); };
    const req = send(u, {
      method: 'POST',
      headers: { ...headers, 'Content-Length': String(Buffer.byteLength(body)) },
      lookup: checkingLookup(allowPrivate, opts.resolve),
      agent: false,
    }, (res) => {
      const status = res.statusCode ?? 0;
      let read = 0;
      const finish = () => done(
        status >= 200 && status < 300 ? { ok: true, statusCode: status, error: null }
        : status >= 300 && status < 400 ? { ok: false, statusCode: status, error: 'answered with a redirect, which is not followed' }
        : { ok: false, statusCode: status, error: `answered ${status}` },
      );
      res.on('data', (chunk: Buffer) => { read += chunk.length; if (read >= maxBytes) { finish(); res.destroy(); } });
      res.on('end', finish);
      res.on('close', finish);
      res.on('error', finish);
    });
    const timer = setTimeout(() => {
      done({ ok: false, statusCode: null, error: `no answer within ${Math.round(timeoutMs / 100) / 10} s` });
      req.destroy();
    }, timeoutMs);
    req.on('error', (err) => done({ ok: false, statusCode: null, error: (err.message || String(err)).slice(0, 500) }));
    req.end(body);
  });
}
```

- [ ] **Step 6: Run the tests**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-recurring/packages/api && npx vitest run src/delivery/webhook-url.test.ts src/delivery/signing.test.ts src/delivery/webhook-post.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors. If this `@types/node` types `options.family` as `number | 'IPv4' | 'IPv6'`, compare both spellings (`=== 4 || === 'IPv4'` → 4) rather than casting. If BlockList refuses an entry the table expects public (or the reverse), the range list is wrong — fix `V4`/`V6`, not the table.

- [ ] **Step 7: Commit**

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-recurring
git add packages/api/src/delivery/webhook-url.ts packages/api/src/delivery/webhook-url.test.ts packages/api/src/delivery/signing.ts packages/api/src/delivery/signing.test.ts packages/api/src/delivery/webhook-post.ts packages/api/src/delivery/webhook-post.test.ts
git commit -m "feat(api): webhook address safety, signatures and a POST that checks what it connects to

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The API — schedule and webhook on a website, the delivery state on a run (`@robot/api` routers) — spec §3.5

**Files:**
- Create: `packages/api/src/delivery/delivery-state.ts`
- Modify: `packages/api/src/routers/sources.ts` (`get` ~line 290, `update` ~line 324, a new `rotateWebhookSecret` after `update`), `packages/api/src/routers/runs.ts` (`getWithDetails`), `packages/api/src/auth/staff-actions.ts` (`'sources.update'` entry, new `'sources.rotateWebhookSecret'`)
- Test: `packages/api/src/routers/sources-recurring.test.ts` (new), `packages/api/src/auth/staff-actions.test.ts` (the sentence table)

**Interfaces:**
- Consumes: Task 1 columns and `webhookDeliveries`; Task 2 `parseSchedule`, `nextRunAt`, `Schedule`, `ScheduleLast`; Task 3 `checkWebhookUrl`, `webhookPrivateAllowed`, `newWebhookSecret`.
- Produces:
  - `delivery-state.ts`: `RUN_DELIVERY_ATTEMPTS = 5`; `type DeliveryState = 'delivered' | 'retrying' | 'failed'`; `type RunDelivery = { state: DeliveryState; at: Date; statusCode?: number | null; error?: string | null }`; `deliveryOf(latest: { ok: boolean; attempt: number; at: Date; statusCode: number | null; error: string | null } | undefined, staff: boolean): RunDelivery | null`; `loadRunDelivery(dbh: Database, runId: string, staff: boolean): Promise<RunDelivery | null>`.
  - `sources.update` input gains `schedule?: { days: number[]; time: string; timeZone: string } | null` and `webhookUrl?: string | null`; a refusal is `BAD_REQUEST` with the sentence.
  - `sources.rotateWebhookSecret({ id }) → { webhookSecret: string }`.
  - `sources.get` gains `schedule: Schedule | null`, `nextRunAt: Date | null`, `scheduleLast: ScheduleLast | null`, `webhookUrl: string | null`, `webhookSecret: string | null`.
  - `runs.getWithDetails` gains `delivery: RunDelivery | null` (`statusCode`/`error` only for `ctx.isOperator || !!ctx.session.staff`).

- [ ] **Step 1: Write the failing tests**

`packages/api/src/routers/sources-recurring.test.ts`:

```ts
// Spec 2026-10-24 §3.5: a website's schedule and webhook through sources.update / get / rotateWebhookSecret, and a
// run's delivery state through runs.getWithDetails — org-scoped, customer sentences, staff detail for staff only.
import { describe, it, expect, afterAll, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, runs, sources, webhookDeliveries } from '@robot/db';
import { signedInCaller } from '../test-helpers/identity.js';
import { createProjectWithSource } from '../test-helpers/customer-source.js';
import { nextRunAt } from '../recurring/schedule.js';

const me = await signedInCaller('recurring-api');
const other = await signedInCaller('recurring-api-other');
afterAll(async () => { await me.cleanup(); await other.cleanup(); });

const MONDAY = { days: [1], time: '06:00', timeZone: 'Europe/Berlin' };
const site = (tag: string) => createProjectWithSource(me.caller, { tag: `recurring-api-${tag}`, fields: [{ name: 'Price', type: 'money' }] });
const read = (projectSlug: string, sourceSlug: string) => me.caller.sources.get({ projectSlug, sourceSlug });

describe('sources.update — schedule', () => {
  it('saves a schedule, its days sorted, and its next run from now', async () => {
    const f = await site('save');
    try {
      const before = new Date();
      await me.caller.sources.update({ id: f.sourceId, schedule: { ...MONDAY, days: [5, 1] } });
      const got = await read(f.projectSlug, f.sourceSlug);
      expect(got.schedule).toEqual({ ...MONDAY, days: [1, 5] });
      expect(got.nextRunAt!.toISOString()).toBe(nextRunAt({ ...MONDAY, days: [1, 5] }, before).toISOString());
      expect(got.scheduleLast).toBeNull();
    } finally { await f.cleanup(); }
  });
  it.each([
    [{ ...MONDAY, timeZone: 'Mars/Olympus_Mons' }, 'Choose a time zone from the list.'],
    [{ ...MONDAY, days: [1, 1] }, 'Choose each day once.'],
    [{ ...MONDAY, days: [] }, 'Choose at least one day.'],
    [{ ...MONDAY, time: '6am' }, 'Use a time like 06:00.'],
  ])('refuses %j with its sentence and changes nothing', async (schedule, message) => {
    const f = await site('refuse');
    try {
      await expect(me.caller.sources.update({ id: f.sourceId, schedule })).rejects.toMatchObject({ code: 'BAD_REQUEST', message });
      expect((await read(f.projectSlug, f.sourceSlug)).schedule).toBeNull();
    } finally { await f.cleanup(); }
  });
  it('null turns it off: no schedule, no next run', async () => {
    const f = await site('off');
    try {
      await me.caller.sources.update({ id: f.sourceId, schedule: MONDAY });
      await me.caller.sources.update({ id: f.sourceId, schedule: null });
      const got = await read(f.projectSlug, f.sourceSlug);
      expect([got.schedule, got.nextRunAt]).toEqual([null, null]);
    } finally { await f.cleanup(); }
  });
});

describe('sources.update — webhook', () => {
  it('the first save makes a secret; another address keeps it; removing the address keeps it too', async () => {
    const f = await site('hook');
    try {
      await me.caller.sources.update({ id: f.sourceId, webhookUrl: 'https://hooks.example.com/robot' });
      const first = await read(f.projectSlug, f.sourceSlug);
      expect(first.webhookUrl).toBe('https://hooks.example.com/robot');
      expect(first.webhookSecret).toMatch(/^[0-9a-f]{64}$/);
      await me.caller.sources.update({ id: f.sourceId, webhookUrl: 'https://hooks.example.com/other' });
      expect((await read(f.projectSlug, f.sourceSlug)).webhookSecret).toBe(first.webhookSecret);
      await me.caller.sources.update({ id: f.sourceId, webhookUrl: null });
      const removed = await read(f.projectSlug, f.sourceSlug);
      expect(removed.webhookUrl).toBeNull();
      expect(removed.webhookSecret).toBe(first.webhookSecret);
    } finally { await f.cleanup(); }
  });
  it.each([
    ['http://127.0.0.1:9/hook', 'Use a public web address.'],
    ['http://[::ffff:10.0.0.1]/hook', 'Use a public web address.'],
    ['ftp://hooks.example.com/robot', 'Enter the full web address, starting with http or https.'],
    ['https://user:pass@hooks.example.com/robot', 'Leave the user name and password out of the address.'],
  ])('refuses %s with its sentence', async (webhookUrl, message) => {
    const f = await site('hook-refuse');
    try {
      await expect(me.caller.sources.update({ id: f.sourceId, webhookUrl })).rejects.toMatchObject({ code: 'BAD_REQUEST', message });
      const got = await read(f.projectSlug, f.sourceSlug);
      expect([got.webhookUrl, got.webhookSecret]).toEqual([null, null]);
    } finally { await f.cleanup(); }
  });
  it('WEBHOOK_ALLOW_PRIVATE=on lets a local address save', async () => {
    const f = await site('hook-private');
    vi.stubEnv('WEBHOOK_ALLOW_PRIVATE', 'on');
    try {
      await me.caller.sources.update({ id: f.sourceId, webhookUrl: 'http://127.0.0.1:9/hook' });
      expect((await read(f.projectSlug, f.sourceSlug)).webhookUrl).toBe('http://127.0.0.1:9/hook');
    } finally { vi.unstubAllEnvs(); await f.cleanup(); }
  });
  it('rotateWebhookSecret hands back a new secret and stores it', async () => {
    const f = await site('rotate');
    try {
      await me.caller.sources.update({ id: f.sourceId, webhookUrl: 'https://hooks.example.com/robot' });
      const before = (await read(f.projectSlug, f.sourceSlug)).webhookSecret;
      const { webhookSecret } = await me.caller.sources.rotateWebhookSecret({ id: f.sourceId });
      expect(webhookSecret).toMatch(/^[0-9a-f]{64}$/);
      expect(webhookSecret).not.toBe(before);
      expect((await read(f.projectSlug, f.sourceSlug)).webhookSecret).toBe(webhookSecret);
    } finally { await f.cleanup(); }
  });
  it('another organisation can neither change nor rotate it', async () => {
    const f = await site('scope');
    try {
      await expect(other.caller.sources.update({ id: f.sourceId, schedule: MONDAY })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(other.caller.sources.update({ id: f.sourceId, webhookUrl: 'https://hooks.example.com/x' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(other.caller.sources.rotateWebhookSecret({ id: f.sourceId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      const got = await read(f.projectSlug, f.sourceSlug);
      expect([got.schedule, got.webhookUrl, got.webhookSecret]).toEqual([null, null, null]);
    } finally { await f.cleanup(); }
  });
});

describe('runs.getWithDetails — delivery', () => {
  const DELIVERY = '7d4f2b1a-3333-4333-8333-333333333333';
  async function runWith(f: { sourceId: string }, attempts: Array<{ attempt: number; ok: boolean; statusCode: number | null; error: string | null }>) {
    const [run] = await db.insert(runs).values({ sourceId: f.sourceId, status: 'completed', completedAt: new Date() }).returning({ id: runs.id });
    for (const [i, a] of attempts.entries()) {
      await db.insert(webhookDeliveries).values({ runId: run!.id, deliveryId: DELIVERY, ...a, at: new Date(Date.now() - (attempts.length - i) * 1000) });
    }
    return run!.id;
  }
  it('null with no attempt; delivered, retrying and failed from the latest one; no code or error for a customer', async () => {
    const f = await site('delivery');
    try {
      expect((await me.caller.runs.getWithDetails({ id: await runWith(f, []) }))!.delivery).toBeNull();
      const delivered = (await me.caller.runs.getWithDetails({ id: await runWith(f, [{ attempt: 1, ok: false, statusCode: 500, error: 'answered 500' }, { attempt: 2, ok: true, statusCode: 200, error: null }]) }))!.delivery;
      expect(delivered).toEqual({ state: 'delivered', at: expect.any(Date) });
      const retrying = (await me.caller.runs.getWithDetails({ id: await runWith(f, [{ attempt: 2, ok: false, statusCode: 503, error: 'answered 503' }]) }))!.delivery;
      expect(retrying).toEqual({ state: 'retrying', at: expect.any(Date) });
      const failed = (await me.caller.runs.getWithDetails({ id: await runWith(f, [{ attempt: 5, ok: false, statusCode: null, error: 'no answer within 10 s' }]) }))!.delivery;
      expect(failed).toEqual({ state: 'failed', at: expect.any(Date) });
    } finally { await f.cleanup(); }
  });
  it('staff read the stored code and error', async () => {
    const f = await site('delivery-staff');
    const saved = process.env.OPS_EMAILS;
    process.env.OPS_EMAILS = me.user.email;
    try {
      const id = await runWith(f, [{ attempt: 2, ok: false, statusCode: 503, error: 'answered 503' }]);
      expect((await me.caller.runs.getWithDetails({ id }))!.delivery).toEqual({ state: 'retrying', at: expect.any(Date), statusCode: 503, error: 'answered 503' });
    } finally {
      if (saved === undefined) delete process.env.OPS_EMAILS; else process.env.OPS_EMAILS = saved;
      await f.cleanup();
    }
  });
});
```

(`sources.get`'s `nextRunAt` is a `Date`: a server-side caller gets it unserialised.)

In `packages/api/src/auth/staff-actions.test.ts`, the `it.each` sentence table: after the row `['sources.update', { id: 's', isActive: false }, undefined, undefined, "Changed Nike's settings"],` add:

```ts
    ['sources.update', { id: 's', schedule: { days: [1], time: '06:00', timeZone: 'Europe/Berlin' } }, undefined, undefined, 'Set the schedule of Nike'],
    ['sources.update', { id: 's', schedule: null }, undefined, undefined, 'Turned off the schedule of Nike'],
    ['sources.update', { id: 's', webhookUrl: 'https://hooks.example.com/robot' }, undefined, undefined, 'Set the webhook of Nike'],
    ['sources.update', { id: 's', webhookUrl: null }, undefined, undefined, 'Removed the webhook of Nike'],
    ['sources.rotateWebhookSecret', { id: 's' }, undefined, undefined, 'Replaced the webhook signing secret of Nike'],
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-recurring/packages/api && npx vitest run src/routers/sources-recurring.test.ts src/auth/staff-actions.test.ts`
Expected: FAIL — `schedule`/`webhookUrl` are stripped by the input schema (nothing saved), `rotateWebhookSecret` does not exist, `delivery` is undefined, the new sentences do not match, and "STAFF_ACTIONS has a key for every mutation" fails once the procedure exists.

- [ ] **Step 3: `delivery-state.ts`**

```ts
// packages/api/src/delivery/delivery-state.ts
// What the run page says about a run's webhook (spec 2026-10-24 §3.4 "What is shown"), from its latest attempt:
// delivered, retrying (a failed attempt with attempts left) or failed (the last attempt failed). Staff also read
// the stored status code and error; a customer never does.
import { desc, eq } from 'drizzle-orm';
import { webhookDeliveries, type Database } from '@robot/db';

/** The `run-delivery` job's attempts (jobs/types.ts pins its policy to this). */
export const RUN_DELIVERY_ATTEMPTS = 5;

export type DeliveryState = 'delivered' | 'retrying' | 'failed';
export type RunDelivery = { state: DeliveryState; at: Date; statusCode?: number | null; error?: string | null };

export function deliveryOf(
  latest: { ok: boolean; attempt: number; at: Date; statusCode: number | null; error: string | null } | undefined,
  staff: boolean,
): RunDelivery | null {
  if (!latest) return null;
  const state: DeliveryState = latest.ok ? 'delivered' : latest.attempt < RUN_DELIVERY_ATTEMPTS ? 'retrying' : 'failed';
  return staff ? { state, at: latest.at, statusCode: latest.statusCode, error: latest.error } : { state, at: latest.at };
}

export async function loadRunDelivery(dbh: Database, runId: string, staff: boolean): Promise<RunDelivery | null> {
  const [latest] = await dbh
    .select({ ok: webhookDeliveries.ok, attempt: webhookDeliveries.attempt, at: webhookDeliveries.at, statusCode: webhookDeliveries.statusCode, error: webhookDeliveries.error })
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.runId, runId))
    .orderBy(desc(webhookDeliveries.at), desc(webhookDeliveries.attempt))
    .limit(1);
  return deliveryOf(latest, staff);
}
```

- [ ] **Step 4: `sources.update`, `sources.get`, `sources.rotateWebhookSecret`**

In `packages/api/src/routers/sources.ts` imports: add `type SQL` to the `drizzle-orm` import, and

```ts
import { nextRunAt, parseSchedule, type Schedule, type ScheduleLast } from '../recurring/schedule.js';
import { checkWebhookUrl, webhookPrivateAllowed } from '../delivery/webhook-url.js';
import { newWebhookSecret } from '../delivery/signing.js';
```

In `get`'s returned object, after `variantSetup: …,`:

```ts
        // Recurring extraction (spec 2026-10-24 §3.5): the Settings tab's Schedule and Webhook rows.
        schedule: s.schedule as Schedule | null, nextRunAt: s.nextRunAt, scheduleLast: s.scheduleLast as ScheduleLast | null,
        webhookUrl: s.webhookUrl, webhookSecret: s.webhookSecret,
```

In `update`'s input object, after `budget: budgetShape.optional(),`:

```ts
        // Spec 2026-10-24 §3.5: the shape here; the customer's sentence comes from parseSchedule / checkWebhookUrl below
        // (a zod refusal would reach the app as JSON).
        schedule: z.object({ days: z.array(z.number()), time: z.string(), timeZone: z.string() }).nullable().optional(),
        webhookUrl: z.string().max(10_000).nullable().optional(),
```

In its mutation, replace `const { id, ...rest } = input;` with:

```ts
      const { id, schedule, webhookUrl, ...rest } = input;

      // Recurring extraction (spec 2026-10-24 §3.5): validated before anything is written; each refusal is one sentence.
      const recurring: { schedule?: Schedule | null; nextRunAt?: Date | null; webhookUrl?: string | null; webhookSecret?: SQL } = {};
      if (schedule !== undefined) {
        if (schedule === null) {
          recurring.schedule = null;
          recurring.nextRunAt = null;
        } else {
          const parsed = parseSchedule(schedule);
          if (!parsed.ok) throw new TRPCError({ code: 'BAD_REQUEST', message: parsed.message });
          recurring.schedule = parsed.schedule;
          recurring.nextRunAt = nextRunAt(parsed.schedule, new Date());
        }
      }
      if (webhookUrl !== undefined) {
        if (webhookUrl === null) {
          // The secret stays: links already sent keep opening.
          recurring.webhookUrl = null;
        } else {
          const checked = checkWebhookUrl(webhookUrl, { allowPrivate: webhookPrivateAllowed() });
          if (!checked.ok) throw new TRPCError({ code: 'BAD_REQUEST', message: checked.message });
          recurring.webhookUrl = checked.url;
          // Made on the first save only.
          recurring.webhookSecret = sql`coalesce(${sources.webhookSecret}, ${newWebhookSecret()})`;
        }
      }
```

and change the `.set(...)` to `.set({ ...rest, ...parametersPatch, ...recurring, updatedAt: new Date() })`.

After the `update` procedure:

```ts
  /**
   * A new webhook signing secret (spec 2026-10-24 §3.4): posts are signed with it from now on, and every file link
   * signed with the old one stops opening. Not on the staff deny list — rotating is safe — and logged in staff mode.
   */
  rotateWebhookSecret: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await sourceInOrg(ctx, input.id);
      const [row] = await ctx.db
        .update(sources)
        .set({ webhookSecret: newWebhookSecret(), updatedAt: new Date() })
        .where(eq(sources.id, input.id))
        .returning({ webhookSecret: sources.webhookSecret });
      if (!row?.webhookSecret) throw new TRPCError({ code: 'NOT_FOUND', message: `Website ${input.id} not found` });
      return { webhookSecret: row.webhookSecret };
    }),
```

- [ ] **Step 5: `runs.getWithDetails`**

In `packages/api/src/routers/runs.ts`: `import { loadRunDelivery } from '../delivery/delivery-state.js';`. Extend the `Promise.all` destructuring to `const [latestCapture, extractionRows, [rowTotal], backfillRuns, delivery] = await Promise.all([` and add as its last element:

```ts
        // The webhook line under the downloads (spec 2026-10-24 §3.4): staff also read the stored code and error.
        loadRunDelivery(ctx.db, input.id, ctx.isOperator || !!ctx.session.staff),
```

and in the returned object, after `backfillRuns,`:

```ts
        // Null until a webhook attempt was made for this run.
        delivery,
```

- [ ] **Step 6: The staff sentences**

In `packages/api/src/auth/staff-actions.ts` replace the `'sources.update'` entry with:

```ts
  'sources.update': {
    describe: ({ input, target }) => {
      if (input.schedule !== undefined) return input.schedule === null ? `Turned off the schedule of ${site(target)}` : `Set the schedule of ${site(target)}`;
      if (input.webhookUrl !== undefined) return input.webhookUrl === null ? `Removed the webhook of ${site(target)}` : `Set the webhook of ${site(target)}`;
      return `Changed ${site(target)}'s settings`;
    },
  },
  'sources.rotateWebhookSecret': { describe: ({ target }) => `Replaced the webhook signing secret of ${site(target)}` },
```

(`resolveTarget` already reads `input.id` as the website for both.)

- [ ] **Step 7: Run the tests**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-recurring/packages/api && npx vitest run src/routers/sources-recurring.test.ts src/auth/staff-actions.test.ts src/auth/staff-guard.test.ts src/routers/sources.test.ts src/routers/runs.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 8: Commit**

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-recurring
git add packages/api/src/delivery/delivery-state.ts packages/api/src/routers/sources.ts packages/api/src/routers/runs.ts packages/api/src/auth/staff-actions.ts packages/api/src/auth/staff-actions.test.ts packages/api/src/routers/sources-recurring.test.ts
git commit -m "feat(api): a website's schedule and webhook through sources.update, and a run's webhook state

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The sweep and the `scheduled-run` job; the worker starts it (`@robot/api` `src/recurring/`, `@robot/worker`) — spec §3.2

**Files:**
- Create: `packages/api/src/recurring/sweep.ts`, `packages/api/src/recurring/scheduled-run.ts`
- Modify: `packages/api/src/jobs/types.ts` (policy + payload), `packages/api/src/jobs/handlers.ts` (registry), `packages/api/src/jobs/index.ts` (exports); `packages/worker/src/config.ts`, `packages/worker/src/config.test.ts`, `packages/worker/src/worker.ts`, `packages/worker/src/live-check.ts` (line 25), `packages/worker/src/capture-e2e.test.ts` (line 29), `packages/worker/src/crash-recovery.test.ts` (the spawn `env`, line 25), `packages/worker/src/bench/run-speed.ts` (line 56)
- Test: `packages/api/src/recurring/sweep.test.ts`, `packages/api/src/recurring/start-recurring.test.ts`, `packages/api/src/recurring/scheduled-run.test.ts`

**Interfaces:**
- Consumes: Task 2 `parseSchedule`, `nextRunAt`, `SCHEDULED_LABEL`, `ScheduleLast`, `SkipReason`; `requireCertification(db, sourceId)` (`crawl/require-certification.ts`, throws a `TRPCError`); `planSource(db, sourceId, { probe, runId })` (`crawl/plan-source.ts`, returns `PlanSourceResult` `{ runId; status: 'planned' | 'failed'; itemCount; … }`); `startRunJob(db, { runId })` (`jobs/handlers/run.ts`); `enqueue(tx, type, payload, { key })` (`jobs/enqueue.ts`).
- Produces:
  - `jobs/types.ts`: `JOB_POLICIES['scheduled-run'] = { lane: 'background', priority: 20, maxAttempts: 1, stuckMs: 15 * MIN, startWithinMs: null, runSentence: PLAN_STOPPED }`; `JobPayloads['scheduled-run'] = { sourceId: string; runId: string }`.
  - `sweep.ts`: `RECURRING_SWEEP_LIMIT = 6`; `type SweepOutcome = ScheduleLast & { sourceId: string }`; `recurringRunsEnabled(env?): boolean`; `sweepOne(opts?: { only?: string[] }): Promise<SweepOutcome | null>`; `sweepDueSchedules(opts?: { limit?: number; only?: string[] }): Promise<SweepOutcome[]>`; `startRecurringRuns(opts: { enabled: boolean; intervalMs?: number; firstDelayMs?: number; sweep?: () => Promise<unknown> }): () => void` (first sweep after 10 s, then every 60 s, never two at once).
  - `scheduled-run.ts`: `NOTHING_PLANNED = 'This run found no products to extract.'`; `runScheduledRun(p: JobPayloads['scheduled-run'], deps?: { plan?: typeof planSource; start?: typeof startRunJob }): Promise<{ started: boolean }>`.
  - `@robot/api/jobs` exports `startRecurringRuns`, `sweepDueSchedules`.
  - `WorkerConfig.recurringRuns: boolean` (`RECURRING_RUNS` not `off`).

- [ ] **Step 1: Write the failing tests**

`packages/api/src/recurring/sweep.test.ts`:

```ts
// Spec 2026-10-24 §3.2, §4.1–4.3. DB-backed against the shared dev database: every sweep passes `only` (a bare
// sweep would claim real websites), and a website is made due right before the sweep that claims it.
import { describe, it, expect, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db, runs, sources } from '@robot/db';
import type { CertifiedPath } from '@robot/scraper';
import { signedInCaller } from '../test-helpers/identity.js';
import { createProjectWithSource } from '../test-helpers/customer-source.js';
import { seedPassingVerification } from '../test-helpers/seed-coverage-check.js';
import { jobsOf } from '../test-helpers/jobs.js';
import { JOB_POLICIES } from '../jobs/types.js';
import { recurringRunsEnabled, sweepDueSchedules } from './sweep.js';
import { SCHEDULED_LABEL } from './schedule.js';

const me = await signedInCaller('recurring-sweep');
afterAll(async () => { await me.cleanup(); });
const LD: CertifiedPath = { source: 'json-ld', path: 'offers.price', transform: 'identity' };
const EVERY_DAY = { days: [1, 2, 3, 4, 5, 6, 7], time: '06:00', timeZone: 'Europe/Berlin' };

/** A website (certified unless told otherwise) with a schedule, due `agoMs` ago. */
async function scheduled(tag: string, opts: { certified?: boolean; agoMs?: number; patch?: Partial<typeof sources.$inferInsert> } = {}) {
  const host = `test-recurring-${tag}.example.com`;
  const urls = [1, 2, 3].map((n) => `https://${host}/p/${n}`);
  const f = await createProjectWithSource(me.caller, {
    tag: `recurring-${tag}`, urls, fields: [{ name: 'Price', type: 'money' }],
    expected: { Price: Object.fromEntries(urls.map((u, i) => [u, `${i + 1}.00`])) },
  });
  if (opts.certified !== false) await seedPassingVerification(f.sourceId, { [f.keys.Price!]: [LD] });
  await db.update(sources).set({ schedule: EVERY_DAY, nextRunAt: new Date(Date.now() - (opts.agoMs ?? 1000)), ...opts.patch }).where(eq(sources.id, f.sourceId));
  return f;
}
const sourceRow = async (id: string) => (await db.query.sources.findFirst({ where: eq(sources.id, id), columns: { nextRunAt: true, scheduleLast: true } }))!;
const scheduledRuns = (sourceId: string) => db.query.runs.findMany({ where: and(eq(runs.sourceId, sourceId), eq(runs.inputLabel, SCHEDULED_LABEL)) });

describe('sweepDueSchedules', () => {
  it('starts a due certified website: a planning run labelled scheduled, its scheduled-run job, the next time from now', async () => {
    const f = await scheduled('start');
    try {
      const [out, ...rest] = await sweepDueSchedules({ only: [f.sourceId] });
      expect(rest).toEqual([]);
      expect(out).toMatchObject({ sourceId: f.sourceId, outcome: 'started', runId: expect.any(String) });
      const [run] = await scheduledRuns(f.sourceId);
      expect(run).toMatchObject({ id: out!.runId, status: 'planning', inputLabel: 'scheduled' });
      const job = (await jobsOf('scheduled-run')).find((j) => j.key === `scheduled-run:${run!.id}`)!;
      expect(job).toMatchObject({ payload: { sourceId: f.sourceId, runId: run!.id }, priority: 20, maxAttempts: 1, expiresAt: null, status: 'queued' });
      expect(run!.jobId).toBe(job.id);
      const src = await sourceRow(f.sourceId);
      expect(src.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
      expect(src.nextRunAt!.getTime()).toBeLessThan(Date.now() + 2 * 86_400_000);
      expect(src.scheduleLast).toMatchObject({ outcome: 'started', runId: run!.id });
      expect(JOB_POLICIES['scheduled-run']).toMatchObject({ lane: 'background', priority: 20, maxAttempts: 1, startWithinMs: null });
    } finally { await f.cleanup(); }
  });

  it('leaves a website that is not due yet, and one whose schedule was turned off', async () => {
    const later = await scheduled('later', { agoMs: -3_600_000 });
    const off = await scheduled('off', { patch: { schedule: null } });
    try {
      expect(await sweepDueSchedules({ only: [later.sourceId, off.sourceId] })).toEqual([]);
      expect(await scheduledRuns(later.sourceId)).toEqual([]);
      expect(await scheduledRuns(off.sourceId)).toEqual([]);
    } finally { await later.cleanup(); await off.cleanup(); }
  });

  it.each([
    ['paused', { patch: { isActive: false } }],
    ['not_certified', { certified: false }],
    ['not_confirmed', { patch: { listingMode: 'listing_to_detail', confirmedAt: null } }],
  ] as const)('skips %s: recorded, no run, not retried before the next time', async (reason, opts) => {
    const f = await scheduled(`skip-${reason}`, opts as Parameters<typeof scheduled>[1]);
    try {
      expect(await sweepDueSchedules({ only: [f.sourceId] })).toEqual([{ sourceId: f.sourceId, at: expect.any(String), outcome: 'skipped', reason }]);
      expect(await scheduledRuns(f.sourceId)).toEqual([]);
      const src = await sourceRow(f.sourceId);
      expect(src.scheduleLast).toMatchObject({ outcome: 'skipped', reason });
      expect(src.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
      expect(await sweepDueSchedules({ only: [f.sourceId] })).toEqual([]);
    } finally { await f.cleanup(); }
  });

  it.each(['planning', 'extracting', 'cancelling'])('skips busy while a run is %s', async (status) => {
    const f = await scheduled(`busy-${status}`);
    try {
      await db.insert(runs).values({ sourceId: f.sourceId, status });
      expect(await sweepDueSchedules({ only: [f.sourceId] })).toEqual([{ sourceId: f.sourceId, at: expect.any(String), outcome: 'skipped', reason: 'busy' }]);
      expect(await scheduledRuns(f.sourceId)).toEqual([]);
    } finally { await f.cleanup(); }
  });

  it('a product-URL website needs no confirmation', async () => {
    const f = await scheduled('detail', { patch: { listingMode: 'detail', confirmedAt: null } });
    try {
      expect((await sweepDueSchedules({ only: [f.sourceId] }))[0]).toMatchObject({ outcome: 'started' });
    } finally { await f.cleanup(); }
  });

  it('two sweeps at once start one run (§4.2)', async () => {
    const f = await scheduled('race');
    try {
      const [a, b] = await Promise.all([sweepDueSchedules({ only: [f.sourceId] }), sweepDueSchedules({ only: [f.sourceId] })]);
      expect([...a, ...b]).toHaveLength(1);
      expect(await scheduledRuns(f.sourceId)).toHaveLength(1);
    } finally { await f.cleanup(); }
  });

  it('a worker down for a week fires once, and the next time is from now (§4.3)', async () => {
    const f = await scheduled('week', { agoMs: 7 * 86_400_000 });
    try {
      expect(await sweepDueSchedules({ only: [f.sourceId] })).toHaveLength(1);
      expect(await sweepDueSchedules({ only: [f.sourceId] })).toEqual([]);
      expect(await scheduledRuns(f.sourceId)).toHaveLength(1);
      expect((await sourceRow(f.sourceId)).nextRunAt!.getTime()).toBeGreaterThan(Date.now());
    } finally { await f.cleanup(); }
  });

  it('at most the limit per sweep, the most overdue first', async () => {
    const a = await scheduled('limit-a', { agoMs: 120_000 });
    const b = await scheduled('limit-b', { agoMs: 60_000 });
    try {
      const first = await sweepDueSchedules({ only: [a.sourceId, b.sourceId], limit: 1 });
      expect(first.map((o) => o.sourceId)).toEqual([a.sourceId]);
      expect((await sweepDueSchedules({ only: [a.sourceId, b.sourceId] })).map((o) => o.sourceId)).toEqual([b.sourceId]);
    } finally { await a.cleanup(); await b.cleanup(); }
  });

  it('an empty only claims nothing', async () => {
    expect(await sweepDueSchedules({ only: [] })).toEqual([]);
  });

  it('RECURRING_RUNS: on unless off', () => {
    expect(recurringRunsEnabled({})).toBe(true);
    expect(recurringRunsEnabled({ RECURRING_RUNS: 'on' })).toBe(true);
    expect(recurringRunsEnabled({ RECURRING_RUNS: 'off' })).toBe(false);
    expect(recurringRunsEnabled({ RECURRING_RUNS: ' OFF ' })).toBe(false);
  });
});
```

`packages/api/src/recurring/start-recurring.test.ts`:

```ts
// Spec 2026-10-24 §3.2: the worker's timer — off sets none; on sweeps 10 s after start, then every 60 s, never two at once.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { startRecurringRuns } from './sweep.js';

afterEach(() => { vi.useRealTimers(); });

describe('startRecurringRuns', () => {
  it('off: no timer, no sweep', () => {
    vi.useFakeTimers();
    const sweep = vi.fn(async () => []);
    const stop = startRecurringRuns({ enabled: false, sweep });
    vi.advanceTimersByTime(10 * 60_000);
    expect(sweep).not.toHaveBeenCalled();
    stop();
  });
  it('on: a first sweep after 10 s, then one a minute, never two at once; stop ends it', async () => {
    vi.useFakeTimers();
    let release: () => void = () => {};
    const sweep = vi.fn(() => new Promise<void>((r) => { release = r; }));
    const stop = startRecurringRuns({ enabled: true, sweep });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(sweep).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(sweep).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sweep).toHaveBeenCalledTimes(1); // the first is still running
    release();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sweep).toHaveBeenCalledTimes(2);
    stop();
    release();
    await vi.advanceTimersByTimeAsync(180_000);
    expect(sweep).toHaveBeenCalledTimes(2);
  });
  it('a sweep that throws is logged and the next one still runs', async () => {
    vi.useFakeTimers();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const sweep = vi.fn(async () => { throw new Error('db down'); });
    const stop = startRecurringRuns({ enabled: true, sweep, firstDelayMs: 10, intervalMs: 100 });
    await vi.advanceTimersByTimeAsync(220);
    expect(sweep.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(errors).toHaveBeenCalled();
    stop();
    errors.mockRestore();
  });
});
```

`packages/api/src/recurring/scheduled-run.test.ts`:

```ts
// Spec 2026-10-24 §3.2 "Starting": the scheduled-run job plans like crawl.plan, then starts the run — stubbed planner.
import { describe, it, expect, afterAll, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, runs } from '@robot/db';
import { signedInCaller } from '../test-helpers/identity.js';
import { createProjectWithSource } from '../test-helpers/customer-source.js';
import { jobRegistry } from '../jobs/handlers.js';
import { JOB_POLICIES } from '../jobs/types.js';
import type { planSource } from '../crawl/plan-source.js';
import type { startRunJob } from '../jobs/handlers/run.js';
import { NOTHING_PLANNED, runScheduledRun } from './scheduled-run.js';

const me = await signedInCaller('scheduled-run');
afterAll(async () => { await me.cleanup(); });

const planned = (status: 'planned' | 'failed', itemCount: number) => vi.fn(async (_db: unknown, _s: string, o: { runId?: string }) => ({
  runId: o.runId!, status, itemCount, listingPages: 0, warnings: [], errors: [], inputs: [], cacheWarm: true,
})) as unknown as typeof planSource & ReturnType<typeof vi.fn>;

async function withRun(status: string, errorMessage: string | null = null) {
  const f = await createProjectWithSource(me.caller, { tag: 'scheduled-run', fields: [{ name: 'Price', type: 'money' }] });
  const [run] = await db.insert(runs).values({ sourceId: f.sourceId, status, inputLabel: 'scheduled', errorMessage }).returning({ id: runs.id });
  return { ...f, runId: run!.id };
}

describe('runScheduledRun', () => {
  it('plans at full limits on the run it was given, and starts the run when products were found', async () => {
    const f = await withRun('planning');
    try {
      const plan = planned('planned', 3);
      const start = vi.fn(async () => 'job-1') as unknown as typeof startRunJob & ReturnType<typeof vi.fn>;
      expect(await runScheduledRun({ sourceId: f.sourceId, runId: f.runId }, { plan, start })).toEqual({ started: true });
      expect(plan).toHaveBeenCalledWith(db, f.sourceId, { probe: false, runId: f.runId });
      expect(start).toHaveBeenCalledWith(db, { runId: f.runId });
    } finally { await f.cleanup(); }
  });
  it('a failed plan stays failed with its own reason; nothing starts', async () => {
    const f = await withRun('failed', 'The listing page could not be read.');
    try {
      const start = vi.fn() as unknown as typeof startRunJob & ReturnType<typeof vi.fn>;
      expect(await runScheduledRun({ sourceId: f.sourceId, runId: f.runId }, { plan: planned('failed', 0), start })).toEqual({ started: false });
      expect(start).not.toHaveBeenCalled();
      expect(await db.query.runs.findFirst({ where: eq(runs.id, f.runId), columns: { status: true, errorMessage: true } }))
        .toEqual({ status: 'failed', errorMessage: 'The listing page could not be read.' });
    } finally { await f.cleanup(); }
  });
  it('a plan that found no products is closed failed with a sentence, not left planned', async () => {
    const f = await withRun('planned');
    try {
      const start = vi.fn() as unknown as typeof startRunJob & ReturnType<typeof vi.fn>;
      expect(await runScheduledRun({ sourceId: f.sourceId, runId: f.runId }, { plan: planned('planned', 0), start })).toEqual({ started: false });
      expect(start).not.toHaveBeenCalled();
      expect(await db.query.runs.findFirst({ where: eq(runs.id, f.runId), columns: { status: true, errorMessage: true } }))
        .toEqual({ status: 'failed', errorMessage: NOTHING_PLANNED });
    } finally { await f.cleanup(); }
  });
  it('the worker knows the job, with its policy and its run as the row it owns', () => {
    const def = jobRegistry()['scheduled-run']!;
    expect(def.policy).toBe(JOB_POLICIES['scheduled-run']);
    expect(def.subject?.({ sourceId: 's', runId: 'r' })).toEqual({ table: 'runs', id: 'r' });
  });
});
```

In `packages/worker/src/config.test.ts`: in "the spec defaults" add `recurringRuns: true` to the expected object (after `websiteChecks: false,`); in "reads every knob" add `RECURRING_RUNS: 'off'` to the env and `recurringRuns: false` to the expected object; and add:

```ts
  it('RECURRING_RUNS: on unless off', () => {
    expect(readWorkerConfig({ RECURRING_RUNS: 'on' }).recurringRuns).toBe(true);
    expect(readWorkerConfig({ RECURRING_RUNS: ' Off ' }).recurringRuns).toBe(false);
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-recurring/packages/api && npx vitest run src/recurring/sweep.test.ts src/recurring/start-recurring.test.ts src/recurring/scheduled-run.test.ts` and `cd ../worker && npx vitest run src/config.test.ts`
Expected: FAIL — `./sweep.js` and `./scheduled-run.js` do not exist; `recurringRuns` is missing from the config.

- [ ] **Step 3: The job type** — in `packages/api/src/jobs/types.ts`, in `JOB_POLICIES` after `'website-check'`:

```ts
  // Spec 2026-10-24 §3.2: plans a scheduled run (its run row is written with the job by the sweep), then starts it.
  'scheduled-run': { lane: 'background', priority: 20, maxAttempts: 1, stuckMs: 15 * MIN, startWithinMs: null, runSentence: PLAN_STOPPED },
```

and in `JobPayloads`: `'scheduled-run': { sourceId: string; runId: string };`

- [ ] **Step 4: The handler** — `packages/api/src/recurring/scheduled-run.ts`:

```ts
// packages/api/src/recurring/scheduled-run.ts
// The `scheduled-run` job (spec 2026-10-24 §3.2): plans the run the sweep wrote, exactly as `crawl.plan` does at
// the website's run limits (certified paths only, free), and starts it with `startRunJob`; from there it is an
// ordinary run. A plan that fails stays failed with its own reason; one that planned no products is closed failed
// with a sentence — a scheduled run is never left `planned` with nothing behind it.
import { and, eq } from 'drizzle-orm';
import { db, runs } from '@robot/db';
import { planSource } from '../crawl/plan-source.js';
import { startRunJob } from '../jobs/handlers/run.js';
import type { JobPayloads } from '../jobs/types.js';

export const NOTHING_PLANNED = 'This run found no products to extract.';

export async function runScheduledRun(
  p: JobPayloads['scheduled-run'],
  deps: { plan?: typeof planSource; start?: typeof startRunJob } = {},
): Promise<{ started: boolean }> {
  const result = await (deps.plan ?? planSource)(db, p.sourceId, { probe: false, runId: p.runId });
  if (result.status !== 'planned' || result.itemCount === 0) {
    if (result.status === 'planned') {
      await db.update(runs).set({ status: 'failed', errorMessage: NOTHING_PLANNED })
        .where(and(eq(runs.id, p.runId), eq(runs.status, 'planned')));
    }
    return { started: false };
  }
  await (deps.start ?? startRunJob)(db, { runId: p.runId });
  return { started: true };
}
```

- [ ] **Step 5: The sweep** — `packages/api/src/recurring/sweep.ts`:

```ts
// packages/api/src/recurring/sweep.ts
// The schedule sweep (spec 2026-10-24 §3.2): every minute the worker claims due websites one at a time
// (`FOR UPDATE SKIP LOCKED`, so two workers never start the same run), moves `next_run_at` on from now (a worker
// that was down fires each website once), records the outcome in `schedule_last` and — when the website may run —
// writes a `planning` run labelled `scheduled` and its `scheduled-run` job, all in one transaction. A refusal is
// recorded and waits for the next scheduled time. `only` restricts a sweep to those websites: every test passes it.
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { db, runs, sources, type Database } from '@robot/db';
import { requireCertification } from '../crawl/require-certification.js';
import { enqueue } from '../jobs/enqueue.js';
import type { DbOrTx } from '../jobs/queue.js';
import { nextRunAt, parseSchedule, SCHEDULED_LABEL, type ScheduleLast, type SkipReason } from './schedule.js';

/** At most this many websites per sweep. */
export const RECURRING_SWEEP_LIMIT = 6;
const SWEEP_EVERY_MS = 60_000;
const FIRST_SWEEP_MS = 10_000;
/** A run in these states is still going: the schedule waits for its next time. */
const GOING = ['planning', 'extracting', 'cancelling'];

export type SweepOutcome = ScheduleLast & { sourceId: string };

/** On unless `RECURRING_RUNS` is `off`. */
export function recurringRunsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.RECURRING_RUNS ?? '').trim().toLowerCase() !== 'off';
}

/** The first rule a claimed website breaks (spec §3.2's table, in its order), or null when it may run. */
async function skipReason(tx: DbOrTx, s: { id: string; isActive: boolean; listingMode: string | null; confirmedAt: Date | null }): Promise<SkipReason | null> {
  if (!s.isActive) return 'paused';
  try {
    await requireCertification(tx as unknown as Database, s.id);
  } catch (err) {
    if (err instanceof TRPCError) return 'not_certified';
    throw err;
  }
  if (s.listingMode === 'listing_to_detail' && !s.confirmedAt) return 'not_confirmed';
  const going = await tx.query.runs.findFirst({ where: and(eq(runs.sourceId, s.id), inArray(runs.status, GOING)), columns: { id: true } });
  return going ? 'busy' : null;
}

/** One due website: claimed, moved on, its outcome recorded, and its run started when it may run. Null: none due. */
export async function sweepOne(opts: { only?: string[] } = {}): Promise<SweepOutcome | null> {
  if (opts.only && opts.only.length === 0) return null;
  const only = opts.only ? sql`AND id IN (${sql.join(opts.only.map((id) => sql`${id}::uuid`), sql`, `)})` : sql``;
  return db.transaction(async (tx) => {
    const picked = (await tx.execute(sql`
      SELECT id FROM sources
       WHERE schedule IS NOT NULL AND next_run_at IS NOT NULL AND next_run_at <= now() ${only}
       ORDER BY next_run_at ASC, id
       LIMIT 1
       FOR UPDATE SKIP LOCKED`)) as unknown as Array<{ id: string }>;
    if (!picked[0]) return null;
    const id = String(picked[0].id);
    const s = (await tx.query.sources.findFirst({
      where: eq(sources.id, id),
      columns: { id: true, schedule: true, isActive: true, listingMode: true, confirmedAt: true },
    }))!;
    const at = new Date();
    const parsed = parseSchedule(s.schedule);
    if (!parsed.ok) {
      // A stored schedule that no longer reads never fires again, rather than once a minute.
      await tx.update(sources).set({ nextRunAt: null }).where(eq(sources.id, id));
      return { sourceId: id, at: at.toISOString(), outcome: 'skipped' };
    }
    const reason = await skipReason(tx, s);
    let last: ScheduleLast;
    if (reason) {
      last = { at: at.toISOString(), outcome: 'skipped', reason };
    } else {
      const runId = randomUUID();
      const jobId = await enqueue(tx, 'scheduled-run', { sourceId: id, runId }, { key: `scheduled-run:${runId}` });
      await tx.insert(runs).values({ id: runId, sourceId: id, status: 'planning', startedAt: at, inputLabel: SCHEDULED_LABEL, jobId });
      last = { at: at.toISOString(), outcome: 'started', runId };
    }
    await tx.update(sources).set({ nextRunAt: nextRunAt(parsed.schedule, at), scheduleLast: last }).where(eq(sources.id, id));
    return { sourceId: id, ...last };
  });
}

/** One sweep: due websites one at a time, at most `limit`. */
export async function sweepDueSchedules(opts: { limit?: number; only?: string[] } = {}): Promise<SweepOutcome[]> {
  const out: SweepOutcome[] = [];
  for (let i = 0; i < (opts.limit ?? RECURRING_SWEEP_LIMIT); i++) {
    const one = await sweepOne(opts.only ? { only: opts.only } : {});
    if (!one) break;
    out.push(one);
  }
  return out;
}

/** The worker's timer: a first sweep after `firstDelayMs`, then one every `intervalMs`; never two at once; off sets none. */
export function startRecurringRuns(opts: { enabled: boolean; intervalMs?: number; firstDelayMs?: number; sweep?: () => Promise<unknown> }): () => void {
  if (!opts.enabled) return () => {};
  const sweep = opts.sweep ?? (() => sweepDueSchedules());
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await sweep(); } catch (err) { console.error('[recurring] sweep failed:', err); } finally { running = false; }
  };
  let interval: ReturnType<typeof setInterval> | null = null;
  const first = setTimeout(() => {
    void tick();
    interval = setInterval(() => void tick(), opts.intervalMs ?? SWEEP_EVERY_MS);
    interval.unref?.();
  }, opts.firstDelayMs ?? FIRST_SWEEP_MS);
  first.unref?.();
  return () => { clearTimeout(first); if (interval) clearInterval(interval); };
}
```

- [ ] **Step 6: Registry and exports**

In `packages/api/src/jobs/handlers.ts`: `import { runScheduledRun } from '../recurring/scheduled-run.js';` and in the registry after `'website-check'`:

```ts
    // Its run row is written with the job by the sweep (recurring/sweep.ts); planning fills it in, then the run starts.
    'scheduled-run': {
      policy: JOB_POLICIES['scheduled-run'],
      subject: (p: JobPayloads['scheduled-run']) => ({ table: 'runs', id: p.runId }),
      run: (p: JobPayloads['scheduled-run']) => runScheduledRun(p),
    },
```

In `packages/api/src/jobs/index.ts` add: `export { startRecurringRuns, sweepDueSchedules } from '../recurring/sweep.js';`

- [ ] **Step 7: The worker**

`packages/worker/src/config.ts`: add `recurringRuns: boolean;` to `WorkerConfig` (after `websiteChecks`), and in `readWorkerConfig` after `websiteChecks: …,`:

```ts
    // Spec 2026-10-24 §3.2: the schedule sweep is on unless RECURRING_RUNS=off (the isolated smoke pair sets off).
    recurringRuns: (env.RECURRING_RUNS ?? '').trim().toLowerCase() !== 'off',
```

`packages/worker/src/worker.ts`: import `startRecurringRuns` from `@robot/api/jobs` too; after `const stopChecks = …`:

```ts
  const stopRecurring = startRecurringRuns({ enabled: config.recurringRuns });
```

append `; recurring runs ${config.recurringRuns ? 'on (every minute)' : 'off'}` to the start-up log line, and in `stop()` call `stopRecurring();` next to `stopChecks();`. Update the file's header comment: "…; unless RECURRING_RUNS=off, the minute sweep starts each website's scheduled run."

Every worker this repo starts on a database it shares with Marko must not sweep his schedules:
- `packages/worker/src/live-check.ts` line 25: `startWorker({ ...readWorkerConfig(process.env), websiteChecks: false, recurringRuns: false })`;
- `packages/worker/src/capture-e2e.test.ts` line 29: add `recurringRuns: false` to the `startWorker({…})` object;
- `packages/worker/src/crash-recovery.test.ts` line 25: add `RECURRING_RUNS: 'off'` to the spawn `env` (beside `WEBSITE_CHECKS: 'off'`);
- `packages/worker/src/bench/run-speed.ts` line 56: add `recurringRuns: false` (its own database, but a benchmark measures runs, not schedules).

- [ ] **Step 8: Run the tests**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-recurring/packages/api && npx vitest run src/recurring/ src/jobs/ src/verify/website-checks.test.ts && npx tsc --noEmit`
Run: `cd /c/Users/Marko/Documents/projects/robot-platform-recurring/packages/worker && npx vitest run src/config.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 9: Commit**

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-recurring
git add packages/api/src/recurring/sweep.ts packages/api/src/recurring/sweep.test.ts packages/api/src/recurring/start-recurring.test.ts packages/api/src/recurring/scheduled-run.ts packages/api/src/recurring/scheduled-run.test.ts packages/api/src/jobs/types.ts packages/api/src/jobs/handlers.ts packages/api/src/jobs/index.ts packages/worker/src/config.ts packages/worker/src/config.test.ts packages/worker/src/worker.ts packages/worker/src/live-check.ts packages/worker/src/capture-e2e.test.ts packages/worker/src/crash-recovery.test.ts packages/worker/src/bench/run-speed.ts
git commit -m "feat: the worker starts a website's scheduled run — claim-and-advance sweep, scheduled-run job

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The run's file and its webhook — the `run-delivery` job (`@robot/api`) — spec §3.3–§3.4

**Files:**
- Create: `packages/api/src/export/render-run-export.ts`, `packages/api/src/delivery/run-files.ts`, `packages/api/src/delivery/run-delivery.ts`
- Modify: `packages/api/src/export/index.ts`, `packages/api/src/crawl/start-execution.ts` (`buildFinalise` ~line 98), `packages/api/src/jobs/types.ts`, `packages/api/src/jobs/handlers.ts`
- Test: `packages/api/src/export/render-run-export.test.ts`, `packages/api/src/delivery/run-delivery.test.ts`, `packages/api/src/crawl/start-execution.test.ts` (the `buildFinalise` describe)

**Interfaces:**
- Consumes: Task 1 `runFiles`, `webhookDeliveries`; Task 2 `SCHEDULED_LABEL`; Task 3 `bodySignature`, `signedFileUrl`, `LINK_TTL_S`, `publicApiUrl`, `postWebhook`, `PostResult`, `webhookPrivateAllowed`; Task 4 `RUN_DELIVERY_ATTEMPTS`, `loadRunDelivery`; `loadRunExport(db, runId)`, `toCsv`, `toJson`, `toXlsx`, `exportFilename`, `RunExport` (`export/`); `enqueue`; `seedUnshownRun(sourceId, { items })` (test helper).
- Produces:
  - `render-run-export.ts`: `type ExportFormat = 'csv' | 'json' | 'xlsx'`; `EXPORT_FORMATS: readonly ExportFormat[]`; `exportContentType(format: ExportFormat): string`; `runJsonEnvelope(x: RunExport): string`; `renderRunExport(x: RunExport, format: ExportFormat): Promise<{ bytes: Buffer; contentType: string; filename: string }>` — re-exported from `@robot/api/export`.
  - `run-files.ts`: `writeRunFiles(dbh: Database, runId: string): Promise<{ rows: number } | null>`; `loadRunFile(dbh: Database, runId: string, format: ExportFormat): Promise<{ bytes: Buffer; filename: string; rows: number } | null>`.
  - `run-delivery.ts`: `class WebhookNotDelivered extends Error`; `deliverable(status: string, rows: number | null): boolean`; `enqueueRunDelivery(dbh: Database, runId: string): Promise<string | null>`; `type WebhookBody`; `webhookBody(a): WebhookBody`; `webhookHeaders(secret: string, body: string, deliveryId: string): Record<string, string>`; `deliverRun(p: JobPayloads['run-delivery'], ctx: Pick<JobContext, 'attempt'>, deps?: { post?: typeof postWebhook; env?: Record<string, string | undefined>; now?: () => number }): Promise<{ files: boolean; delivered: boolean | null }>`.
  - `JOB_POLICIES['run-delivery'] = { lane: 'background', priority: 15, maxAttempts: 5, stuckMs: 5 * MIN, startWithinMs: null }`; `JobPayloads['run-delivery'] = { runId: string; deliveryId: string }`.
  - `buildFinalise(…, deps.enqueueDelivery?: (db, runId) => Promise<unknown>)`.

- [ ] **Step 1: Write the failing tests**

`packages/api/src/export/render-run-export.test.ts`:

```ts
// The bytes of a run's file in each format — the live export (api-server) and the snapshot (run_files) share them.
import { describe, it, expect } from 'vitest';
import { renderRunExport, runJsonEnvelope, exportContentType, EXPORT_FORMATS } from './render-run-export.js';
import { toCsv, toJson } from './serialize.js';
import { exportFilename, type RunExport } from './build-run-export.js';

const FLAT: RunExport = {
  run: { id: '3f1c2b4a-1111-4111-8111-111111111111', status: 'completed', startedAt: '2026-10-24T06:00:00.000Z', completedAt: '2026-10-24T06:02:00.000Z', createdAt: '2026-10-24T05:59:00.000Z', rowCount: 1 },
  source: { slug: 'shop', name: 'Shop', url: 'https://shop.example.com/p/1' },
  fields: ['Title', 'Price'],
  rows: [{ Title: 'Lamp, white', Price: 9.99 }],
};

describe('renderRunExport', () => {
  it('CSV: the UTF-8 bytes of toCsv, BOM first', async () => {
    const r = await renderRunExport(FLAT, 'csv');
    expect(r.bytes.equals(Buffer.from(toCsv(FLAT.fields, FLAT.rows), 'utf8'))).toBe(true);
    expect([...r.bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(r).toMatchObject({ contentType: 'text/csv; charset=utf-8', filename: exportFilename(FLAT, 'csv') });
  });
  it('JSON: the four-key envelope for a flat run', async () => {
    const r = await renderRunExport(FLAT, 'json');
    expect(r.bytes.toString('utf8')).toBe(toJson({ run: FLAT.run, source: FLAT.source, fields: FLAT.fields, rows: FLAT.rows }));
    expect(r.contentType).toBe('application/json; charset=utf-8');
  });
  it('JSON: the nested shape swaps in its products and their own field lists', () => {
    const nested = { ...FLAT, json: [{ Title: 'Lamp', variants: [] }], jsonFields: ['Title', 'variants'], variantFields: ['variant_key'] } as RunExport;
    expect(JSON.parse(runJsonEnvelope(nested))).toEqual({ run: FLAT.run, source: FLAT.source, fields: ['Title', 'variants'], variantFields: ['variant_key'], rows: nested.json });
  });
  it('XLSX: a workbook (a zip)', async () => {
    const r = await renderRunExport(FLAT, 'xlsx');
    expect(r.bytes.subarray(0, 2).toString('latin1')).toBe('PK');
    expect(r.contentType).toBe(exportContentType('xlsx'));
    expect(EXPORT_FORMATS).toEqual(['csv', 'json', 'xlsx']);
  });
});
```

`packages/api/src/delivery/run-delivery.test.ts`:

```ts
// Spec 2026-10-24 §3.3–§3.4, §4.5: which settled runs deliver; the job writes three files and posts one signed body
// to a local receiver; failed attempts are recorded and retried with one delivery id; nothing touches the run.
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import { db, jobs, runs, runFiles, sources, webhookDeliveries } from '@robot/db';
import { signedInCaller } from '../test-helpers/identity.js';
import { createProjectWithSource } from '../test-helpers/customer-source.js';
import { seedUnshownRun } from '../test-helpers/seed-unshown-run.js';
import { jobsOf, runQueuedJobs, JOB_TEST_MS } from '../test-helpers/jobs.js';
import { JOB_POLICIES } from '../jobs/types.js';
import { loadRunExport } from '../export/load-run-export.js';
import { renderRunExport } from '../export/render-run-export.js';
import { bodySignature, checkFileSignature } from './signing.js';
import { loadRunDelivery, RUN_DELIVERY_ATTEMPTS } from './delivery-state.js';
import { deliverable, deliverRun, enqueueRunDelivery, WebhookNotDelivered } from './run-delivery.js';

const me = await signedInCaller('run-delivery');
const receiver = { status: 200, hits: [] as Array<{ headers: IncomingMessage['headers']; body: string }> };
const server = createServer((req, res) => {
  let body = '';
  req.setEncoding('utf8');
  req.on('data', (c: string) => { body += c; });
  req.on('end', () => { receiver.hits.push({ headers: req.headers, body }); res.writeHead(receiver.status).end(); });
});
let hookUrl = '';
beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  hookUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); await me.cleanup(); });
beforeEach(() => { receiver.status = 200; receiver.hits = []; });

const DELIVERY = '7d4f2b1a-3333-4333-8333-333333333333';
const NOW_MS = Date.parse('2026-10-24T10:00:00Z');
const ENV = { WEBHOOK_ALLOW_PRIVATE: 'on', PUBLIC_API_URL: 'http://api.test' };

/** A website (optionally with a webhook to the local receiver, or a schedule) and a completed run of two rows. */
async function websiteWithRun(tag: string, opts: { webhook?: boolean; schedule?: boolean } = {}) {
  const f = await createProjectWithSource(me.caller, { tag: `delivery-${tag}`, fields: [{ name: 'Price', type: 'money' }] });
  if (opts.webhook) {
    vi.stubEnv('WEBHOOK_ALLOW_PRIVATE', 'on');
    try { await me.caller.sources.update({ id: f.sourceId, webhookUrl: hookUrl }); } finally { vi.unstubAllEnvs(); }
  }
  if (opts.schedule) await me.caller.sources.update({ id: f.sourceId, schedule: { days: [1], time: '06:00', timeZone: 'UTC' } });
  const key = f.keys.Price!;
  const runId = await seedUnshownRun(f.sourceId, { items: [
    { url: `https://test-delivery-${tag}.example.com/p/1`, row: { [key]: '9.99' } },
    { url: `https://test-delivery-${tag}.example.com/p/2`, row: { [key]: '19.99' } },
  ] });
  return { ...f, runId };
}
const secretOf = async (sourceId: string) => (await db.query.sources.findFirst({ where: eq(sources.id, sourceId), columns: { webhookSecret: true } }))!.webhookSecret!;

describe('deliverable (§3.3)', () => {
  it.each([
    ['completed', 0, true], ['partial', 3, true], ['failed', 1, true], ['failed', 0, false], ['failed', null, false],
    ['cancelled', 2, true], ['cancelled', 0, false], ['extracting', 5, false], ['planned', 5, false],
  ] as const)('%s with %s rows → %s', (status, rows, want) => expect(deliverable(status, rows)).toBe(want));
});

describe('enqueueRunDelivery', () => {
  it('nothing for a website with neither a schedule nor a webhook', async () => {
    const f = await websiteWithRun('none');
    try { expect(await enqueueRunDelivery(db, f.runId)).toBeNull(); } finally { await f.cleanup(); }
  });
  it('one job per run (key run-delivery:<runId>) for a webhook or a schedule', async () => {
    const hooked = await websiteWithRun('hooked', { webhook: true });
    const timed = await websiteWithRun('timed', { schedule: true });
    try {
      const id = await enqueueRunDelivery(db, hooked.runId);
      expect(await enqueueRunDelivery(db, hooked.runId)).toBe(id);
      const job = (await jobsOf('run-delivery')).find((j) => j.id === id)!;
      expect(job).toMatchObject({ key: `run-delivery:${hooked.runId}`, priority: 15, maxAttempts: RUN_DELIVERY_ATTEMPTS, payload: { runId: hooked.runId, deliveryId: expect.any(String) } });
      expect(await enqueueRunDelivery(db, timed.runId)).not.toBeNull();
      expect(JOB_POLICIES['run-delivery']).toMatchObject({ lane: 'background', priority: 15, maxAttempts: 5, startWithinMs: null });
    } finally { await hooked.cleanup(); await timed.cleanup(); }
  });
  it('RF4: a backfill delivers its parent; a sample and a failed run with no rows deliver nothing', async () => {
    const f = await websiteWithRun('lineage', { webhook: true });
    try {
      const [child] = await db.insert(runs).values({ sourceId: f.sourceId, status: 'completed', inputLabel: 'backfill', parentRunId: f.runId, resultCount: 1 }).returning({ id: runs.id });
      const jobId = await enqueueRunDelivery(db, child!.id);
      expect((await jobsOf('run-delivery')).find((j) => j.id === jobId)!.payload).toMatchObject({ runId: f.runId });
      const [sample] = await db.insert(runs).values({ sourceId: f.sourceId, status: 'partial', inputLabel: 'probe', resultCount: 5 }).returning({ id: runs.id });
      expect(await enqueueRunDelivery(db, sample!.id)).toBeNull();
      const [empty] = await db.insert(runs).values({ sourceId: f.sourceId, status: 'failed', resultCount: 0 }).returning({ id: runs.id });
      expect(await enqueueRunDelivery(db, empty!.id)).toBeNull();
    } finally { await f.cleanup(); }
  });
});

describe('deliverRun', () => {
  it('writes the three files and posts one signed body whose links check back', async () => {
    const f = await websiteWithRun('post', { webhook: true });
    try {
      expect(await deliverRun({ runId: f.runId, deliveryId: DELIVERY }, { attempt: 1 }, { env: ENV, now: () => NOW_MS })).toEqual({ files: true, delivered: true });
      const files = await db.select().from(runFiles).where(eq(runFiles.runId, f.runId));
      expect(files.map((x) => x.format).sort()).toEqual(['csv', 'json', 'xlsx']);
      expect(files.every((x) => x.rows === 2)).toBe(true);
      const live = (await loadRunExport(db, f.runId))!;
      for (const format of ['csv', 'json'] as const) {
        expect(files.find((x) => x.format === format)!.bytes.equals((await renderRunExport(live, format)).bytes)).toBe(true);
      }
      expect(receiver.hits).toHaveLength(1);
      const hit = receiver.hits[0]!;
      const secret = await secretOf(f.sourceId);
      expect(hit.headers['x-robot-signature']).toBe(bodySignature(secret, hit.body));
      expect(hit.headers).toMatchObject({ 'content-type': 'application/json', 'user-agent': 'robot-platform-webhook/1', 'x-robot-event': 'run.finished', 'x-robot-delivery': DELIVERY });
      const body = JSON.parse(hit.body);
      expect(Object.keys(body).sort()).toEqual(['completedAt', 'deliveryId', 'event', 'failedItems', 'files', 'filesExpireAt', 'project', 'rows', 'runId', 'scheduled', 'startedAt', 'status', 'website'].sort());
      expect(body).toMatchObject({ event: 'run.finished', deliveryId: DELIVERY, runId: f.runId, status: 'completed', scheduled: false, website: { id: f.sourceId }, project: { id: f.projectId }, rows: 2, failedItems: 0 });
      const expires = Math.floor(NOW_MS / 1000) + 7 * 86_400;
      expect(body.filesExpireAt).toBe(new Date(expires * 1000).toISOString());
      for (const format of ['csv', 'json', 'xlsx'] as const) {
        const link = new URL(body.files[format]);
        expect(`${link.origin}${link.pathname}`).toBe(`http://api.test/export/runs/${f.runId}.${format}`);
        expect(link.searchParams.get('expires')).toBe(String(expires));
        expect(checkFileSignature({ secret, runId: f.runId, format, expires: link.searchParams.get('expires')!, sig: link.searchParams.get('sig')!, nowS: Math.floor(NOW_MS / 1000) })).toBe(true);
      }
      expect(await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.runId, f.runId)))
        .toMatchObject([{ deliveryId: DELIVERY, attempt: 1, ok: true, statusCode: 200, error: null }]);
    } finally { await f.cleanup(); }
  });

  it('says scheduled for a run the schedule started', async () => {
    const f = await websiteWithRun('scheduled', { webhook: true });
    try {
      await db.update(runs).set({ inputLabel: 'scheduled' }).where(eq(runs.id, f.runId));
      await deliverRun({ runId: f.runId, deliveryId: DELIVERY }, { attempt: 1 }, { env: ENV });
      expect(JSON.parse(receiver.hits[0]!.body).scheduled).toBe(true);
    } finally { await f.cleanup(); }
  });

  it('a schedule without a webhook writes the files and posts nothing; writing again replaces them', async () => {
    const f = await websiteWithRun('files-only', { schedule: true });
    try {
      expect(await deliverRun({ runId: f.runId, deliveryId: DELIVERY }, { attempt: 1 }, { env: ENV })).toEqual({ files: true, delivered: null });
      await deliverRun({ runId: f.runId, deliveryId: DELIVERY }, { attempt: 1 }, { env: ENV });
      expect(await db.select().from(runFiles).where(eq(runFiles.runId, f.runId))).toHaveLength(3);
      expect(receiver.hits).toHaveLength(0);
      expect(await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.runId, f.runId))).toEqual([]);
    } finally { await f.cleanup(); }
  });

  it('refuses a private address without the flag: a failed attempt, the receiver never reached', async () => {
    const f = await websiteWithRun('private', { webhook: true });
    try {
      await expect(deliverRun({ runId: f.runId, deliveryId: DELIVERY }, { attempt: 1 }, { env: {} })).rejects.toBeInstanceOf(WebhookNotDelivered);
      expect(receiver.hits).toHaveLength(0);
      const [attempt] = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.runId, f.runId));
      expect(attempt).toMatchObject({ attempt: 1, ok: false, statusCode: null });
      expect(attempt!.error).toMatch(/private/);
    } finally { await f.cleanup(); }
  });

  it('a run that is gone ends quietly', async () => {
    expect(await deliverRun({ runId: randomUUID(), deliveryId: DELIVERY }, { attempt: 1 }, { env: ENV })).toEqual({ files: false, delivered: null });
  });

  it('retries on a 500 with one delivery id, five attempts, then gives up — the run untouched (§4.5)', async () => {
    receiver.status = 500;
    const f = await websiteWithRun('retry', { webhook: true });
    vi.stubEnv('WEBHOOK_ALLOW_PRIVATE', 'on');
    try {
      const jobId = (await enqueueRunDelivery(db, f.runId))!;
      await runQueuedJobs({ registry: { 'run-delivery': { policy: JOB_POLICIES['run-delivery'], run: (p, ctx) => deliverRun(p, ctx) } } });
      expect(receiver.hits).toHaveLength(5);
      expect(new Set(receiver.hits.map((h) => h.headers['x-robot-delivery'])).size).toBe(1);
      const attempts = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.runId, f.runId)).orderBy(asc(webhookDeliveries.attempt));
      expect(attempts.map((a) => [a.attempt, a.ok, a.statusCode])).toEqual([1, 2, 3, 4, 5].map((n) => [n, false, 500]));
      expect((await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) }))!.status).toBe('failed');
      expect(await db.query.runs.findFirst({ where: eq(runs.id, f.runId), columns: { status: true, resultCount: true } })).toEqual({ status: 'completed', resultCount: 2 });
      expect(await loadRunDelivery(db, f.runId, false)).toMatchObject({ state: 'failed' });
    } finally { vi.unstubAllEnvs(); await f.cleanup(); }
  }, JOB_TEST_MS);
});
```

In `packages/api/src/crawl/start-execution.test.ts`, inside `describe('buildFinalise', …)`, add:

```ts
  it('queues the run delivery once the run settles (spec 2026-10-24 §3.3), never while extracting', async () => {
    const enqueueDelivery = vi.fn(async () => 'job-1');
    const settled = buildFinalise({} as never, 'run-1', 'source-1', null, { finaliseRun: vi.fn(async () => 'partial' as const), enqueueDelivery });
    expect(await settled(3, false, true)).toBe('partial');
    expect(enqueueDelivery).toHaveBeenCalledWith({}, 'run-1');
    const going = buildFinalise({} as never, 'run-2', 'source-1', null, { finaliseRun: vi.fn(async () => 'extracting' as const), enqueueDelivery });
    await going(3, false, false);
    expect(enqueueDelivery).toHaveBeenCalledTimes(1);
  });

  it('a delivery that cannot be queued never changes the run’s status', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const finalise = buildFinalise({} as never, 'run-1', 'source-1', null, {
      finaliseRun: vi.fn(async () => 'completed' as const),
      enqueueDelivery: vi.fn(async () => { throw new Error('db down'); }),
    });
    expect(await finalise(3, false, false)).toBe('completed');
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-recurring/packages/api && npx vitest run src/export/render-run-export.test.ts src/delivery/run-delivery.test.ts src/crawl/start-execution.test.ts`
Expected: FAIL — the modules do not exist; `buildFinalise` ignores `enqueueDelivery`.

- [ ] **Step 3: `render-run-export.ts`** — the body building moves here from `packages/api-server/src/routes/export.ts` (Task 7 deletes it there):

```ts
// packages/api/src/export/render-run-export.ts
// A run's file, as bytes, in each format: the api-server's live download and the run-delivery snapshot
// (spec 2026-10-24 §3.3) are the same bytes for the same rows.
import { toCsv, toJson } from './serialize.js';
import { toXlsx } from './xlsx.js';
import { exportFilename, type RunExport } from './build-run-export.js';

export type ExportFormat = 'csv' | 'json' | 'xlsx';
export const EXPORT_FORMATS: readonly ExportFormat[] = ['csv', 'json', 'xlsx'];
const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** CSV and JSON declare UTF-8; XLSX is a fixed binary media type with no charset parameter. */
export function exportContentType(format: ExportFormat): string {
  if (format === 'csv') return 'text/csv; charset=utf-8';
  if (format === 'json') return 'application/json; charset=utf-8';
  return XLSX_CONTENT_TYPE;
}

/**
 * `rows`/`fields` always carry the CSV/XLSX shape, which for the `nested` variant shape is the "; "-joined,
 * one-row-per-product view — lossy by design. `json` carries the per-product `variants` structure for that shape
 * and is swapped in, in place of `rows`, for the JSON file only; a flat run's JSON stays the four keys it always
 * was. D3: `fields` describes `rows`, so for a nested envelope it is swapped for `jsonFields`, and `variantFields`
 * is added.
 */
export function runJsonEnvelope(x: RunExport): string {
  if (x.json !== undefined) {
    return toJson({ run: x.run, source: x.source, fields: x.jsonFields, variantFields: x.variantFields, rows: x.json });
  }
  return toJson({ run: x.run, source: x.source, fields: x.fields, rows: x.rows });
}

export async function renderRunExport(x: RunExport, format: ExportFormat): Promise<{ bytes: Buffer; contentType: string; filename: string }> {
  const bytes =
    format === 'csv' ? Buffer.from(toCsv(x.fields, x.rows), 'utf8')
    : format === 'json' ? Buffer.from(runJsonEnvelope(x), 'utf8')
    : Buffer.from(await toXlsx(x.fields, x.rows, x.types));
  return { bytes, contentType: exportContentType(format), filename: exportFilename(x, format) };
}
```

In `packages/api/src/export/index.ts` add: `export { renderRunExport, runJsonEnvelope, exportContentType, EXPORT_FORMATS, type ExportFormat } from './render-run-export.js';`

(If `RunExport` has no `types` key, read `build-run-export.ts`'s type around line 78 — it is the "Column name → field type" map — and use its real name.)

- [ ] **Step 4: `run-files.ts`**

```ts
// packages/api/src/delivery/run-files.ts
// A settled run's file, written once per format by its run-delivery job (spec 2026-10-24 §3.3): the snapshot of
// that moment. A later backfill's own delivery rewrites it; the run page's buttons keep serving the live rows.
import { and, eq } from 'drizzle-orm';
import { runFiles, type Database } from '@robot/db';
import { loadRunExport } from '../export/load-run-export.js';
import { EXPORT_FORMATS, renderRunExport, type ExportFormat } from '../export/render-run-export.js';

/** Null when the run is gone. */
export async function writeRunFiles(dbh: Database, runId: string): Promise<{ rows: number } | null> {
  const x = await loadRunExport(dbh, runId);
  if (!x) return null;
  const rendered = await Promise.all(EXPORT_FORMATS.map(async (format) => ({ format, ...(await renderRunExport(x, format)) })));
  const rows = x.rows.length;
  await dbh.transaction(async (tx) => {
    for (const r of rendered) {
      const createdAt = new Date();
      await tx.insert(runFiles).values({ runId, format: r.format, filename: r.filename, bytes: r.bytes, rows, createdAt })
        .onConflictDoUpdate({ target: [runFiles.runId, runFiles.format], set: { filename: r.filename, bytes: r.bytes, rows, createdAt } });
    }
  });
  return { rows };
}

export async function loadRunFile(dbh: Database, runId: string, format: ExportFormat): Promise<{ bytes: Buffer; filename: string; rows: number } | null> {
  const row = await dbh.query.runFiles.findFirst({
    where: and(eq(runFiles.runId, runId), eq(runFiles.format, format)),
    columns: { bytes: true, filename: true, rows: true },
  });
  return row ?? null;
}
```

- [ ] **Step 5: `run-delivery.ts`**

```ts
// packages/api/src/delivery/run-delivery.ts
// The run-delivery job (spec 2026-10-24 §3.3–§3.4): when a run of a website with a schedule or a webhook settles,
// its file is written (three formats, run_files) and, with a webhook, one signed `run.finished` POST carries
// signed links to it. A failed attempt is recorded and thrown, so the job retries it (30 s, doubling; five
// attempts) with the same delivery id. Nothing here ever changes a run's status or rows (§4.5).
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db, datasets, projects, runItems, runs, sources, webhookDeliveries, type Database } from '@robot/db';
import { enqueue } from '../jobs/enqueue.js';
import type { JobContext } from '../jobs/context.js';
import type { JobPayloads } from '../jobs/types.js';
import { EXPORT_FORMATS, type ExportFormat } from '../export/render-run-export.js';
import { SCHEDULED_LABEL } from '../recurring/schedule.js';
import { writeRunFiles } from './run-files.js';
import { bodySignature, LINK_TTL_S, publicApiUrl, signedFileUrl } from './signing.js';
import { postWebhook } from './webhook-post.js';
import { webhookPrivateAllowed } from './webhook-url.js';

export class WebhookNotDelivered extends Error {}

/** Spec §3.3: completed and partial always; failed and cancelled only with at least one row. */
export function deliverable(status: string, rows: number | null): boolean {
  if (status === 'completed' || status === 'partial') return true;
  if (status === 'failed' || status === 'cancelled') return (rows ?? 0) > 0;
  return false;
}

/**
 * Called by `buildFinalise` once a run settled. A sample never delivers (its rows are a preview); a backfill merges
 * into its parent, so the parent's file is written again and posted again — the job is the parent's. One job per
 * run while one is queued or running (key `run-delivery:<runId>`). Null when nothing is delivered.
 */
export async function enqueueRunDelivery(dbh: Database, runId: string): Promise<string | null> {
  const run = await dbh.query.runs.findFirst({ where: eq(runs.id, runId), columns: { id: true, parentRunId: true, inputLabel: true } });
  if (!run || run.inputLabel === 'probe') return null;
  const target = await dbh.query.runs.findFirst({
    where: eq(runs.id, run.parentRunId ?? run.id),
    columns: { id: true, status: true, resultCount: true, inputLabel: true, sourceId: true },
  });
  if (!target?.sourceId || target.inputLabel === 'probe' || !deliverable(target.status, target.resultCount)) return null;
  const source = await dbh.query.sources.findFirst({ where: eq(sources.id, target.sourceId), columns: { schedule: true, webhookUrl: true } });
  if (!source || (source.schedule == null && !source.webhookUrl)) return null;
  return enqueue(dbh, 'run-delivery', { runId: target.id, deliveryId: randomUUID() }, { key: `run-delivery:${target.id}` });
}

export type WebhookBody = {
  event: 'run.finished';
  deliveryId: string;
  runId: string;
  status: string;
  scheduled: boolean;
  website: { id: string; name: string };
  project: { id: string; name: string };
  startedAt: string | null;
  completedAt: string | null;
  rows: number;
  failedItems: number;
  files: Record<ExportFormat, string>;
  filesExpireAt: string;
};

/** Spec §3.4's body, its links signed to expire `LINK_TTL_S` after `nowMs`. */
export function webhookBody(a: {
  deliveryId: string;
  run: { id: string; status: string; inputLabel: string | null; startedAt: Date | null; completedAt: Date | null };
  website: { id: string; name: string };
  project: { id: string; name: string };
  rows: number;
  failedItems: number;
  base: string;
  secret: string;
  nowMs: number;
}): WebhookBody {
  const expires = Math.floor(a.nowMs / 1000) + LINK_TTL_S;
  return {
    event: 'run.finished',
    deliveryId: a.deliveryId,
    runId: a.run.id,
    status: a.run.status,
    scheduled: a.run.inputLabel === SCHEDULED_LABEL,
    website: a.website,
    project: a.project,
    startedAt: a.run.startedAt?.toISOString() ?? null,
    completedAt: a.run.completedAt?.toISOString() ?? null,
    rows: a.rows,
    failedItems: a.failedItems,
    files: Object.fromEntries(EXPORT_FORMATS.map((f) => [f, signedFileUrl(a.base, a.secret, a.run.id, f, expires)])) as Record<ExportFormat, string>,
    filesExpireAt: new Date(expires * 1000).toISOString(),
  };
}

export function webhookHeaders(secret: string, body: string, deliveryId: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'User-Agent': 'robot-platform-webhook/1',
    'X-Robot-Event': 'run.finished',
    'X-Robot-Delivery': deliveryId,
    'X-Robot-Signature': bodySignature(secret, body),
  };
}

export async function deliverRun(
  p: JobPayloads['run-delivery'],
  ctx: Pick<JobContext, 'attempt'>,
  deps: { post?: typeof postWebhook; env?: Record<string, string | undefined>; now?: () => number } = {},
): Promise<{ files: boolean; delivered: boolean | null }> {
  const written = await writeRunFiles(db, p.runId);
  if (!written) return { files: false, delivered: null };
  const [hit] = await db
    .select({
      run: { id: runs.id, status: runs.status, inputLabel: runs.inputLabel, startedAt: runs.startedAt, completedAt: runs.completedAt },
      website: { id: sources.id, name: sources.name, webhookUrl: sources.webhookUrl, webhookSecret: sources.webhookSecret },
      project: { id: projects.id, name: projects.name },
    })
    .from(runs)
    .innerJoin(sources, eq(runs.sourceId, sources.id))
    .innerJoin(datasets, eq(sources.datasetId, datasets.id))
    .innerJoin(projects, eq(datasets.projectId, projects.id))
    .where(eq(runs.id, p.runId))
    .limit(1);
  if (!hit?.website.webhookUrl || !hit.website.webhookSecret) return { files: true, delivered: null };
  const [failed] = await db.select({ n: sql<number>`count(*)::int` }).from(runItems)
    .where(and(eq(runItems.runId, p.runId), eq(runItems.kind, 'detail'), eq(runItems.status, 'failed')));
  const env = deps.env ?? process.env;
  const secret = hit.website.webhookSecret;
  const body = JSON.stringify(webhookBody({
    deliveryId: p.deliveryId, run: hit.run, website: { id: hit.website.id, name: hit.website.name }, project: hit.project,
    rows: written.rows, failedItems: Number(failed?.n ?? 0), base: publicApiUrl(env), secret, nowMs: (deps.now ?? Date.now)(),
  }));
  const result = await (deps.post ?? postWebhook)(hit.website.webhookUrl, body, webhookHeaders(secret, body, p.deliveryId), { allowPrivate: webhookPrivateAllowed(env) });
  await db.insert(webhookDeliveries).values({ runId: p.runId, deliveryId: p.deliveryId, attempt: ctx.attempt, ok: result.ok, statusCode: result.statusCode, error: result.error });
  if (!result.ok) throw new WebhookNotDelivered(`webhook not delivered: ${result.error ?? `answered ${result.statusCode}`}`);
  return { files: true, delivered: true };
}
```

- [ ] **Step 6: The job type, the registry, `buildFinalise`**

`packages/api/src/jobs/types.ts`, in `JOB_POLICIES` after `'scheduled-run'`:

```ts
  // Spec 2026-10-24 §3.3: writes a settled run's file and posts its webhook; a failed post is retried (30 s, doubling).
  // Five attempts — delivery/delivery-state.ts's RUN_DELIVERY_ATTEMPTS, pinned by run-delivery.test.ts.
  'run-delivery': { lane: 'background', priority: 15, maxAttempts: 5, stuckMs: 5 * MIN, startWithinMs: null },
```

and in `JobPayloads`: `'run-delivery': { runId: string; deliveryId: string };`

`packages/api/src/jobs/handlers.ts`: `import { deliverRun } from '../delivery/run-delivery.js';` and in the registry:

```ts
    // No status row of its own: a failed delivery never closes or changes its run (spec 2026-10-24 §4.5).
    'run-delivery': {
      policy: JOB_POLICIES['run-delivery'],
      subject: () => null,
      run: (p: JobPayloads['run-delivery'], ctx) => deliverRun(p, ctx),
    },
```

`packages/api/src/crawl/start-execution.ts`: `import { enqueueRunDelivery } from '../delivery/run-delivery.js';`; add `enqueueDelivery?: (db: typeof Database, runId: string) => Promise<unknown>;` to `buildFinalise`'s `deps` type; `const doEnqueueDelivery = deps.enqueueDelivery ?? enqueueRunDelivery;` beside the other `do…` constants; and just before `return status;` in the returned function:

```ts
    // Spec 2026-10-24 §3.3: a settled run of a website with a schedule or a webhook gets its file and its post.
    // In its own try, like drift: a delivery that cannot be queued never changes the run's status.
    if (status !== 'extracting') {
      try {
        await doEnqueueDelivery(db, runId);
      } catch (err) {
        console.error(`[crawl] run delivery could not be queued for run ${runId}:`, err);
      }
    }
```

Add one sentence to `buildFinalise`'s doc comment: "After drift, a settled run's delivery (its file and webhook, spec 2026-10-24) is queued the same way — logged and swallowed if it fails."

- [ ] **Step 7: Run the tests**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-recurring/packages/api && npx vitest run src/export/ src/delivery/ src/crawl/start-execution.test.ts src/crawl/execute-run.test.ts src/jobs/ && npx tsc --noEmit`
Expected: PASS, no type errors. (The older `buildFinalise` tests pass `{}` as the database: their default `enqueueRunDelivery` throws inside the try and logs — expected noise, their statuses unchanged.)

- [ ] **Step 8: Commit**

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-recurring
git add packages/api/src/export/render-run-export.ts packages/api/src/export/render-run-export.test.ts packages/api/src/export/index.ts packages/api/src/delivery/run-files.ts packages/api/src/delivery/run-delivery.ts packages/api/src/delivery/run-delivery.test.ts packages/api/src/crawl/start-execution.ts packages/api/src/crawl/start-execution.test.ts packages/api/src/jobs/types.ts packages/api/src/jobs/handlers.ts
git commit -m "feat(api): a settled run writes its file and posts a signed webhook (run-delivery job)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Snapshot downloads — `?snapshot=1` and signed links (`@robot/api-server` export route) — spec §3.3

**Files:**
- Create: `packages/api/src/delivery/index.ts`, `packages/api-server/src/export-snapshot.test.ts`
- Modify: `packages/api/src/delivery/run-files.ts` (add `webhookSecretForRun`), `packages/api/package.json` (`exports`), `packages/api-server/src/routes/export.ts`, `packages/api-server/src/app.ts`
- Test: `packages/api/src/delivery/run-files.test.ts` (new), `packages/api-server/src/export-snapshot.test.ts`, `packages/api-server/src/export-route.test.ts` (unchanged; must still pass)

**Interfaces:**
- Consumes: Task 3 `checkFileSignature`; Task 6 `loadRunFile`, `renderRunExport`, `exportContentType`, `ExportFormat`.
- Produces: `webhookSecretForRun(dbh: Database, runId: string): Promise<string | null>`; package export `@robot/api/delivery` → `loadRunFile`, `webhookSecretForRun`, `checkFileSignature`; `ExportDeps`/`AppDeps` gain `loadRunFile(runId, format)` and `webhookSecretForRun(runId)`; routes `GET /export/runs/<id>.<fmt>?snapshot=1` (session) and `?expires=&sig=` (no session).

- [ ] **Step 1: Write the failing tests**

`packages/api/src/delivery/run-files.test.ts`:

```ts
// The two reads the api-server's snapshot route needs (spec 2026-10-24 §3.3).
import { randomUUID } from 'node:crypto';
import { describe, it, expect, afterAll, vi } from 'vitest';
import { db, runs } from '@robot/db';
import { signedInCaller } from '../test-helpers/identity.js';
import { createProjectWithSource } from '../test-helpers/customer-source.js';
import { loadRunFile, webhookSecretForRun, writeRunFiles } from './run-files.js';

const me = await signedInCaller('run-files');
afterAll(async () => { await me.cleanup(); });

describe('run files', () => {
  it('webhookSecretForRun: the run’s website’s secret; null without one or without a run', async () => {
    const f = await createProjectWithSource(me.caller, { tag: 'run-files', fields: [{ name: 'Price', type: 'money' }] });
    try {
      const [run] = await db.insert(runs).values({ sourceId: f.sourceId, status: 'completed' }).returning({ id: runs.id });
      expect(await webhookSecretForRun(db, run!.id)).toBeNull();
      vi.stubEnv('WEBHOOK_ALLOW_PRIVATE', 'on');
      try { await me.caller.sources.update({ id: f.sourceId, webhookUrl: 'http://127.0.0.1:9/hook' }); } finally { vi.unstubAllEnvs(); }
      expect(await webhookSecretForRun(db, run!.id)).toMatch(/^[0-9a-f]{64}$/);
      expect(await webhookSecretForRun(db, randomUUID())).toBeNull();
    } finally { await f.cleanup(); }
  });
  it('loadRunFile: null before the files are written, the bytes after', async () => {
    const f = await createProjectWithSource(me.caller, { tag: 'run-files-load', fields: [{ name: 'Price', type: 'money' }] });
    try {
      const [run] = await db.insert(runs).values({ sourceId: f.sourceId, status: 'completed' }).returning({ id: runs.id });
      expect(await loadRunFile(db, run!.id, 'csv')).toBeNull();
      await writeRunFiles(db, run!.id);
      const csv = await loadRunFile(db, run!.id, 'csv');
      expect(csv!.bytes.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
      expect(csv!.filename).toMatch(/\.csv$/);
    } finally { await f.cleanup(); }
  });
});
```

`packages/api-server/src/export-snapshot.test.ts`:

```ts
// Spec 2026-10-24 §3.3: a run's snapshot by session (?snapshot=1) or by signed link (no session). Offline: every
// collaborator is injected; the live export must never be built for a snapshot.
import { createHmac } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import type { SessionInfo } from '@robot/api/auth';
import { createApp } from './app.js';

const RUN = '3f1c2b4a-1111-4111-8111-111111111111';
const OTHER = '9a8b7c6d-2222-4222-8222-222222222222';
const SECRET = 'ab'.repeat(32);
const NOW_S = Math.floor(Date.now() / 1000);
const SESSION: SessionInfo = {
  token: 't',
  user: { id: 'u1', email: 'owner@example.com', name: 'Owner', avatarColour: '#000', theme: 'light' },
  org: { id: 'org-1', slug: 'owner-org', name: 'Owner Org', personal: true },
  role: 'owner',
};
const SNAP: Record<string, Buffer> = {
  [`${RUN}.csv`]: Buffer.from('\uFEFFPrice\r\n9.99\r\n', 'utf8'),
  [`${RUN}.json`]: Buffer.from('{"rows":[{"Price":9.99}]}', 'utf8'),
  [`${RUN}.xlsx`]: Buffer.from('PK\u0003\u0004snapshot', 'latin1'),
};
const sign = (secret: string, runId: string, format: string, expires: number) => createHmac('sha256', secret).update(`${runId}.${format}.${expires}`).digest('hex');
const link = (format: string, o: { runId?: string; secret?: string; expires?: number; signedFormat?: string } = {}) => {
  const expires = o.expires ?? NOW_S + 3600;
  return `/export/runs/${RUN}.${format}?expires=${expires}&sig=${sign(o.secret ?? SECRET, o.runId ?? RUN, o.signedFormat ?? format, expires)}`;
};

function app(o: { secret?: string | null; session?: SessionInfo | null; orgId?: string | null; files?: Record<string, Buffer> } = {}) {
  const files = o.files ?? SNAP;
  return createApp({
    loadSession: async () => (o.session === undefined ? SESSION : o.session),
    orgIdForRun: async () => (o.orgId === undefined ? SESSION.org.id : o.orgId),
    loadRunExport: async () => { throw new Error('the live export must not be built for a snapshot'); },
    loadRunFile: async (runId, format) => {
      const bytes = files[`${runId}.${format}`];
      return bytes ? { bytes, filename: `shop-${runId.slice(0, 8)}-2026-10-24.${format}` } : null;
    },
    webhookSecretForRun: async () => (o.secret === undefined ? SECRET : o.secret),
  });
}
const get = (a: ReturnType<typeof createApp>, path: string, headers: Record<string, string> = {}) => a.fetch(new Request(`http://localhost${path}`, { headers }));
const bytesOf = async (res: Response) => Buffer.from(await res.arrayBuffer());

describe('GET /export/runs/:file — signed links', () => {
  it.each(['csv', 'json', 'xlsx'])('a valid link opens the %s snapshot with no session', async (format) => {
    const res = await get(app({ session: null }), link(format));
    expect(res.status).toBe(200);
    expect((await bytesOf(res)).equals(SNAP[`${RUN}.${format}`]!)).toBe(true);
    expect(res.headers.get('content-disposition')).toBe(`attachment; filename="shop-3f1c2b4a-2026-10-24.${format}"`);
  });
  it.each([
    ['a wrong signature', `/export/runs/${RUN}.csv?expires=${NOW_S + 3600}&sig=${'0'.repeat(64)}`],
    ['an expired link', link('csv', { expires: NOW_S - 1 })],
    ['a link for another run', link('csv', { runId: OTHER })],
    ['a replaced secret', link('csv', { secret: 'cd'.repeat(32) })],
    ['RF5: a link signed for the CSV does not open the JSON', link('json', { signedFormat: 'csv' })],
    ['a signature with no expiry', `/export/runs/${RUN}.csv?sig=${sign(SECRET, RUN, 'csv', NOW_S + 3600)}`],
    ['an expiry with no signature', `/export/runs/${RUN}.csv?expires=${NOW_S + 3600}`],
  ])('404 for %s', async (_why, path) => {
    expect((await get(app({ session: null }), path)).status).toBe(404);
  });
  it('a website with no secret has no signed links', async () => {
    expect((await get(app({ session: null, secret: null }), link('csv'))).status).toBe(404);
  });
  it('a signed link never falls back to the session or the live file', async () => {
    const res = await get(app({ files: {} }), link('csv'), { cookie: 'robot_session=valid-token' });
    expect(res.status).toBe(404);
  });
});

describe('GET /export/runs/:file?snapshot=1 — with the session', () => {
  it('serves the snapshot, not the live rows', async () => {
    const res = await get(app(), `/export/runs/${RUN}.csv?snapshot=1`, { cookie: 'robot_session=valid-token' });
    expect(res.status).toBe(200);
    expect((await bytesOf(res)).equals(SNAP[`${RUN}.csv`]!)).toBe(true);
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
  });
  it('401 without a session, 404 for another organisation', async () => {
    expect((await get(app({ session: null }), `/export/runs/${RUN}.csv?snapshot=1`)).status).toBe(401);
    expect((await get(app({ orgId: 'org-2' }), `/export/runs/${RUN}.csv?snapshot=1`, { cookie: 'robot_session=valid-token' })).status).toBe(404);
  });
  it('RF5: ?snapshot=1 before the file is written is 404, never the live file', async () => {
    expect((await get(app({ files: {} }), `/export/runs/${RUN}.csv?snapshot=1`, { cookie: 'robot_session=valid-token' })).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-recurring/packages/api && npx vitest run src/delivery/run-files.test.ts` and `cd ../api-server && npx vitest run src/export-snapshot.test.ts`
Expected: FAIL — `webhookSecretForRun` does not exist; signed and `?snapshot=1` requests get the live route (401 without a session, or the thrown live export).

- [ ] **Step 3: The reads and the package export**

Append to `packages/api/src/delivery/run-files.ts` (add `runs, sources` to its `@robot/db` import):

```ts
/** The signing secret of the run's website, or null (no run, no website, no secret yet). */
export async function webhookSecretForRun(dbh: Database, runId: string): Promise<string | null> {
  const [row] = await dbh.select({ secret: sources.webhookSecret }).from(runs)
    .innerJoin(sources, eq(runs.sourceId, sources.id))
    .where(eq(runs.id, runId))
    .limit(1);
  return row?.secret ?? null;
}
```

`packages/api/src/delivery/index.ts`:

```ts
// What the api-server needs from recurring delivery (spec 2026-10-24 §3.3): the snapshot and the signed-link check.
export { loadRunFile, webhookSecretForRun } from './run-files.js';
export { checkFileSignature } from './signing.js';
```

`packages/api/package.json` `"exports"`: after `"./export": "./src/export/index.ts",` add `"./delivery": "./src/delivery/index.ts",`.

- [ ] **Step 4: The route** — in `packages/api-server/src/routes/export.ts`:

1. Imports: `import { Hono, type Context } from 'hono';`; replace the `@robot/api/export` import with `import { toCsv, toJson, toXlsx, projectExportFilename, renderRunExport, exportContentType, type RunExport, type ProjectExport, type ExportFormat } from '@robot/api/export';`; add `import { checkFileSignature } from '@robot/api/delivery';`.
2. Delete `XLSX_CONTENT_TYPE`, `contentTypeFor` and `toJsonEnvelope` (they moved to `@robot/api`'s `render-run-export.ts`, comments and all); replace `type Format = 'csv' | 'json' | 'xlsx';` with `type Format = ExportFormat;`; the project route's `contentTypeFor(parsed.format)` becomes `exportContentType(parsed.format)`.
3. `ExportDeps` gains:

```ts
  /** The run's snapshot (spec 2026-10-24 §3.3), as its run-delivery job wrote it; null before. */
  loadRunFile: (runId: string, format: ExportFormat) => Promise<{ bytes: Uint8Array; filename: string } | null>;
  /** The signing secret of the run's website; null without one. */
  webhookSecretForRun: (runId: string) => Promise<string | null>;
```

4. Inside `createExportRoutes`, before `app.get('/runs/:file', …)`:

```ts
  const snapshot = async (c: Context, parsed: { id: string; format: Format }) => {
    const file = await deps.loadRunFile(parsed.id, parsed.format);
    if (!file) return c.json({ error: 'Run not found' }, 404);
    return c.body(new Uint8Array(file.bytes), 200, {
      'content-type': exportContentType(parsed.format),
      'content-disposition': `attachment; filename="${file.filename}"`,
    });
  };
```

5. The run route becomes:

```ts
  app.get('/runs/:file', async (c) => {
    const parsed = parseFile(c.req.param('file'));
    if (!parsed) return c.notFound();

    // A signed link (spec 2026-10-24 §3.3): no session; the website's current webhook secret, this run, this format,
    // not expired. Anything wrong is the same 404 as a run that does not exist, and it only ever opens the snapshot.
    const sig = c.req.query('sig');
    const expires = c.req.query('expires');
    if (sig !== undefined || expires !== undefined) {
      const secret = await deps.webhookSecretForRun(parsed.id);
      if (!checkFileSignature({ secret, runId: parsed.id, format: parsed.format, expires, sig })) return c.json({ error: 'Run not found' }, 404);
      return snapshot(c, parsed);
    }

    const session = await deps.loadSession(sessionTokenFrom(c.req.header('cookie')));
    if (!session) return c.json({ error: 'Sign in first' }, 401);

    const orgId = await deps.orgIdForRun(parsed.id);
    if (orgId !== session.org.id) return c.json({ error: 'Run not found' }, 404);

    // The file the run's delivery wrote. The run page's buttons carry no `snapshot` and stay live.
    if (c.req.query('snapshot') === '1') return snapshot(c, parsed);

    const runExport = await deps.loadRunExport(parsed.id);
    if (!runExport) return c.json({ error: 'Run not found' }, 404);
    const file = await renderRunExport(runExport, parsed.format);
    return c.body(new Uint8Array(file.bytes), 200, {
      'content-type': file.contentType,
      'content-disposition': `attachment; filename="${file.filename}"`,
    });
  });
```

Update the file's header comment: one paragraph saying a run's file is also served as its snapshot, with the session (`?snapshot=1`) or a signed link from a webhook (no session; 404 when the signature is wrong, expired, for another run or format, or the secret was replaced).

- [ ] **Step 5: The app's defaults** — `packages/api-server/src/app.ts`: `import { loadRunFile, webhookSecretForRun } from '@robot/api/delivery';`; `AppDeps` gains `loadRunFile: (runId: string, format: 'csv' | 'json' | 'xlsx') => Promise<{ bytes: Uint8Array; filename: string } | null>;` (the route's own shape, so a test stub needs no `rows`) and `webhookSecretForRun: (runId: string) => Promise<string | null>;`; in `createApp`:

```ts
  const loadSnapshot = deps.loadRunFile ?? ((runId: string, format: 'csv' | 'json' | 'xlsx') => loadRunFile(db, runId, format));
  const loadWebhookSecret = deps.webhookSecretForRun ?? ((runId: string) => webhookSecretForRun(db, runId));
```

and pass `loadRunFile: loadSnapshot, webhookSecretForRun: loadWebhookSecret` into `createExportRoutes({…})`. Extend its comment: "…and a run's snapshot, by session (`?snapshot=1`) or by a webhook's signed link (no session)."

- [ ] **Step 6: Run the tests**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-recurring/packages/api && npx vitest run src/delivery/run-files.test.ts && npx tsc --noEmit`
Run: `cd /c/Users/Marko/Documents/projects/robot-platform-recurring/packages/api-server && npx vitest run --no-file-parallelism && npx tsc --noEmit`
Expected: PASS — `export-route.test.ts` and `export-project.test.ts` unchanged and green (the live CSV/JSON/XLSX bytes, BOM and headers are what they were), no type errors.

- [ ] **Step 7: Commit**

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-recurring
git add packages/api/src/delivery/run-files.ts packages/api/src/delivery/run-files.test.ts packages/api/src/delivery/index.ts packages/api/package.json packages/api-server/src/routes/export.ts packages/api-server/src/app.ts packages/api-server/src/export-snapshot.test.ts
git commit -m "feat(api-server): a run's snapshot by session or by a webhook's signed link

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: What a customer sees — Settings rows, "scheduled", the webhook line (`@robot/app`) — spec §3.6

**Files:**
- Create: `packages/app/src/lib/site/recurring-view.ts`, `packages/app/src/components/settings/settings-row.tsx`, `packages/app/src/components/settings/schedule-row.tsx`, `packages/app/src/components/settings/webhook-row.tsx`
- Modify: `packages/app/src/components/settings/settings-rows.tsx`, `packages/app/src/routes/_app/projects/$project/sites/$site/settings.tsx`, `packages/app/src/lib/runs-view.ts`, `packages/app/src/lib/site/run-screen-view.ts`, `packages/app/src/components/runs/run-header.tsx`, `packages/app/src/routes/_app/projects/$project/sites/$site/runs/$run.tsx`, `packages/app/src/routes-smoke.test.ts` (`SITE_SCREENS` `settings` entry ~line 405)
- Test: `packages/app/src/lib/site/recurring-view.test.ts`, `packages/app/src/lib/runs-view.test.ts`, `packages/app/src/lib/site/run-screen-view.test.ts`, `packages/app/src/customer-copy-sweep.test.ts` (unchanged; must pass)

**Interfaces:**
- Consumes: Task 4's `sources.get` fields (`schedule`, `nextRunAt`, `scheduleLast`, `webhookUrl`, `webhookSecret`), `sources.update({ id, schedule | webhookUrl })`, `sources.rotateWebhookSecret({ id })`, `runs.getWithDetails().delivery`.
- Produces (`recurring-view.ts`, pure): `type Schedule`, `type ScheduleLast`, `type ScheduleChoice = 'off' | 'daily' | 'weekdays' | 'custom'`, `type Delivery`; `CHOICE_LABELS: Record<ScheduleChoice, string>`; `DAY_NAMES` (`Mon`…`Sun`, index = ISO day − 1); `SKIP_SENTENCES`; `WEBHOOK_HELP`; `choiceOf(s: Schedule | null): ScheduleChoice`; `scheduleFromForm(choice, days, time, timeZone): Schedule | null`; `scheduleFormProblem(choice, days, time): string | null`; `whenLabel(at: Date, timeZone: string): string`; `nextRunLine(nextRunAt: Date | null, timeZone: string | null): string | null`; `lastOutcomeLine(last: ScheduleLast | null, timeZone: string): { text: string; runId: string | null } | null`; `browserTimeZone(): string`; `timeZoneOptions(current: string): string[]`; `maskSecret(secret: string): string`; `webhookLine(d: Delivery, staff: boolean, timeZone: string): string | null`. `SettingsRow({ label, children })`.

- [ ] **Step 1: Write the failing tests**

`packages/app/src/lib/site/recurring-view.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  choiceOf, scheduleFromForm, scheduleFormProblem, whenLabel, nextRunLine, lastOutcomeLine, timeZoneOptions,
  maskSecret, webhookLine, CHOICE_LABELS, WEBHOOK_HELP,
} from './recurring-view';

const MON_6 = { days: [1], time: '06:00', timeZone: 'Europe/Berlin' };

describe('the Schedule row', () => {
  it('reads a stored schedule back as its choice', () => {
    expect(choiceOf(null)).toBe('off');
    expect(choiceOf({ ...MON_6, days: [1, 2, 3, 4, 5, 6, 7] })).toBe('daily');
    expect(choiceOf({ ...MON_6, days: [1, 2, 3, 4, 5] })).toBe('weekdays');
    expect(choiceOf({ ...MON_6, days: [1, 3] })).toBe('custom');
    expect(CHOICE_LABELS).toEqual({ off: 'Off', daily: 'Every day', weekdays: 'Weekdays', custom: 'Choose days' });
  });
  it('builds what Save sends', () => {
    expect(scheduleFromForm('off', [1], '06:00', 'UTC')).toBeNull();
    expect(scheduleFromForm('daily', [3], '06:00', 'UTC')).toEqual({ days: [1, 2, 3, 4, 5, 6, 7], time: '06:00', timeZone: 'UTC' });
    expect(scheduleFromForm('weekdays', [], '07:30', 'Asia/Kolkata')).toEqual({ days: [1, 2, 3, 4, 5], time: '07:30', timeZone: 'Asia/Kolkata' });
    expect(scheduleFromForm('custom', [5, 1, 5], '06:00', 'UTC')).toEqual({ days: [1, 5], time: '06:00', timeZone: 'UTC' });
  });
  it('says what keeps Save disabled', () => {
    expect(scheduleFormProblem('custom', [], '06:00')).toBe('Choose at least one day.');
    expect(scheduleFormProblem('daily', [], '')).toBe('Use a time like 06:00.');
    expect(scheduleFormProblem('off', [], '')).toBeNull();
    expect(scheduleFormProblem('custom', [2], '23:59')).toBeNull();
  });
  it('the next run, in the schedule’s own zone', () => {
    expect(whenLabel(new Date('2026-10-26T05:00:00Z'), 'Europe/Berlin')).toBe('Monday 26 October, 06:00');
    expect(nextRunLine(new Date('2026-10-26T05:00:00Z'), 'Europe/Berlin')).toBe('Next run: Monday 26 October, 06:00 (Europe/Berlin)');
    expect(nextRunLine(new Date('2026-10-26T00:30:00Z'), 'Asia/Kolkata')).toBe('Next run: Monday 26 October, 06:00 (Asia/Kolkata)');
    expect(nextRunLine(null, 'Europe/Berlin')).toBeNull();
    expect(nextRunLine(new Date(), null)).toBeNull();
  });
  it('the last outcome, in the spec’s sentences', () => {
    expect(lastOutcomeLine({ at: '2026-10-26T05:00:00.000Z', outcome: 'started', runId: 'r1' }, 'Europe/Berlin'))
      .toEqual({ text: 'Started Monday 26 October, 06:00.', runId: 'r1' });
    expect(lastOutcomeLine({ at: '2026-10-26T05:00:00.000Z', outcome: 'skipped', reason: 'paused' }, 'UTC')).toEqual({ text: 'Skipped: the website is paused.', runId: null });
    expect(lastOutcomeLine({ at: 'x', outcome: 'skipped', reason: 'not_certified' }, 'UTC')!.text).toBe('Skipped: the website needs verifying first.');
    expect(lastOutcomeLine({ at: 'x', outcome: 'skipped', reason: 'not_confirmed' }, 'UTC')!.text).toBe('Skipped: run Extract once by hand first.');
    expect(lastOutcomeLine({ at: 'x', outcome: 'skipped', reason: 'busy' }, 'UTC')!.text).toBe('Skipped: the last run was still going.');
    expect(lastOutcomeLine(null, 'UTC')).toBeNull();
  });
  it('offers every zone Intl knows, the current one included', () => {
    const zones = timeZoneOptions('Europe/Berlin');
    expect(zones).toContain('Europe/Berlin');
    expect(zones).toContain('Australia/Lord_Howe');
    expect(timeZoneOptions('Etc/Unknown-But-Stored')).toContain('Etc/Unknown-But-Stored');
  });
});

describe('the Webhook row and the run page line', () => {
  it('masks the secret but its last four', () => {
    expect(maskSecret('ab'.repeat(30) + '1234')).toBe('••••••••••••1234');
  });
  it('the help line', () => {
    expect(WEBHOOK_HELP).toBe("We send a POST with the run's results and download links when a run finishes.");
  });
  it('one customer line per state, no code, no host, no error', () => {
    const at = new Date('2026-10-26T05:03:00Z');
    expect(webhookLine({ state: 'delivered', at }, false, 'Europe/Berlin')).toBe('Webhook delivered Monday 26 October, 06:03.');
    expect(webhookLine({ state: 'retrying', at, statusCode: 500, error: 'answered 500' }, false, 'UTC')).toBe('Webhook not delivered yet — trying again.');
    expect(webhookLine({ state: 'failed', at, statusCode: null, error: 'no answer within 10 s' }, false, 'UTC')).toBe('Webhook could not be delivered.');
    expect(webhookLine(null, false, 'UTC')).toBeNull();
  });
  it('staff also read the stored code and error', () => {
    const at = new Date('2026-10-26T05:03:00Z');
    expect(webhookLine({ state: 'retrying', at, statusCode: 503, error: 'answered 503' }, true, 'UTC')).toBe('Webhook not delivered yet — trying again. (503: answered 503)');
    expect(webhookLine({ state: 'failed', at, statusCode: null, error: 'no answer within 10 s' }, true, 'UTC')).toBe('Webhook could not be delivered. (no answer: no answer within 10 s)');
  });
});
```

`packages/app/src/lib/runs-view.test.ts`, inside `describe('runsView', …)`:

```ts
  it('a scheduled run says so (spec 2026-10-24 §3.6); a manual run says nothing extra', () => {
    const [scheduled, manual] = runsView([
      row({ id: 's', inputLabel: 'scheduled', createdAt: new Date('2026-09-22T10:00:00Z') }),
      row({ id: 'm', inputLabel: 'https://shop.example.com/c', createdAt: new Date('2026-09-22T09:00:00Z') }),
    ], NOW);
    expect(scheduled!.statusLabel).toMatch(/ · scheduled$/);
    expect(manual!.statusLabel).not.toMatch(/·/);
  });
```

`packages/app/src/lib/site/run-screen-view.test.ts`, beside the existing `runStatusLine` cases:

```ts
  it('a scheduled run reads scheduled beside its state (spec 2026-10-24 §3.6)', () => {
    expect(runStatusLine({ status: 'completed', completedAt: new Date(), inputLabel: 'scheduled' }).label).toMatch(/ · scheduled$/);
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-recurring/packages/app && npx vitest run src/lib/site/recurring-view.test.ts src/lib/runs-view.test.ts src/lib/site/run-screen-view.test.ts`
Expected: FAIL — `recurring-view` does not exist; no "scheduled" suffix.

- [ ] **Step 3: `recurring-view.ts`**

```ts
// The Settings tab's Schedule and Webhook rows, and the run page's webhook line (spec 2026-10-24 §3.6). Pure.
// A customer reads no status code, host or error text; staff (`showsMoney`) also read the stored code and error.

export type Schedule = { days: number[]; time: string; timeZone: string };
export type SkipReason = 'paused' | 'not_certified' | 'not_confirmed' | 'busy';
export type ScheduleLast = { at: string; outcome: 'started' | 'skipped'; reason?: SkipReason; runId?: string };
export type ScheduleChoice = 'off' | 'daily' | 'weekdays' | 'custom';
export type Delivery = { state: 'delivered' | 'retrying' | 'failed'; at: Date; statusCode?: number | null; error?: string | null } | null;

export const CHOICE_LABELS: Record<ScheduleChoice, string> = { off: 'Off', daily: 'Every day', weekdays: 'Weekdays', custom: 'Choose days' };
/** Index = ISO weekday − 1. */
export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
export const SKIP_SENTENCES: Record<SkipReason, string> = {
  paused: 'Skipped: the website is paused.',
  not_certified: 'Skipped: the website needs verifying first.',
  not_confirmed: 'Skipped: run Extract once by hand first.',
  busy: 'Skipped: the last run was still going.',
};
export const WEBHOOK_HELP = "We send a POST with the run's results and download links when a run finishes.";

const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7];
const WEEKDAYS = [1, 2, 3, 4, 5];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const same = (a: number[], b: number[]) => a.length === b.length && a.every((d, i) => d === b[i]);

export function choiceOf(s: Schedule | null): ScheduleChoice {
  if (!s) return 'off';
  const days = [...s.days].sort((a, b) => a - b);
  if (same(days, EVERY_DAY)) return 'daily';
  if (same(days, WEEKDAYS)) return 'weekdays';
  return 'custom';
}

export function scheduleFromForm(choice: ScheduleChoice, days: number[], time: string, timeZone: string): Schedule | null {
  if (choice === 'off') return null;
  const picked = choice === 'daily' ? EVERY_DAY : choice === 'weekdays' ? WEEKDAYS : [...new Set(days)].sort((a, b) => a - b);
  return { days: picked, time, timeZone };
}

/** Why Save is disabled (said beside it), or null. The server's own sentences say the same. */
export function scheduleFormProblem(choice: ScheduleChoice, days: number[], time: string): string | null {
  if (choice === 'off') return null;
  if (choice === 'custom' && days.length === 0) return 'Choose at least one day.';
  if (!TIME.test(time)) return 'Use a time like 06:00.';
  return null;
}

/** "Monday 26 October, 06:00" in `timeZone`. */
export function whenLabel(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('weekday')} ${get('day')} ${get('month')}, ${get('hour')}:${get('minute')}`;
}

export function nextRunLine(nextRunAt: Date | null, timeZone: string | null): string | null {
  if (!nextRunAt || !timeZone) return null;
  return `Next run: ${whenLabel(nextRunAt, timeZone)} (${timeZone})`;
}

export function lastOutcomeLine(last: ScheduleLast | null, timeZone: string): { text: string; runId: string | null } | null {
  if (!last) return null;
  if (last.outcome === 'started') return { text: `Started ${whenLabel(new Date(last.at), timeZone)}.`, runId: last.runId ?? null };
  return last.reason ? { text: SKIP_SENTENCES[last.reason], runId: null } : null;
}

export function browserTimeZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

/** Every zone Intl knows, sorted, with `current` kept even if this browser does not list it. */
export function timeZoneOptions(current: string): string[] {
  let zones: string[] = [];
  try { zones = Intl.supportedValuesOf('timeZone'); } catch { zones = []; }
  const all = new Set([...zones, 'UTC', current]);
  return [...all].sort((a, b) => a.localeCompare(b));
}

export function maskSecret(secret: string): string {
  return `${'•'.repeat(12)}${secret.slice(-4)}`;
}

/** The run page's line under the downloads, in the viewer's own time zone; null when no attempt was made. */
export function webhookLine(d: Delivery, staff: boolean, timeZone: string): string | null {
  if (!d) return null;
  const text = d.state === 'delivered' ? `Webhook delivered ${whenLabel(d.at, timeZone)}.`
    : d.state === 'retrying' ? 'Webhook not delivered yet — trying again.'
    : 'Webhook could not be delivered.';
  if (!staff || d.state === 'delivered') return text;
  return `${text} (${d.statusCode ?? 'no answer'}${d.error ? `: ${d.error}` : ''})`;
}
```

- [ ] **Step 4: The "scheduled" suffix** — `packages/app/src/lib/runs-view.ts` `statusLabel`: after the `'backfill'` line add `if (inputLabel === 'scheduled') return \`${label} · scheduled\`;` and extend the `RunView.statusLabel` doc comment ("… or ' · scheduled' (a run its schedule started)"). `packages/app/src/lib/site/run-screen-view.ts` `runStatusLine`: after the `'backfill'` line add `if (run.inputLabel === 'scheduled') return { state, label: \`${label} · scheduled\` };`.

- [ ] **Step 5: The Settings rows**

`packages/app/src/components/settings/settings-row.tsx` (moved out of `settings-rows.tsx`, so the new rows can use it without an import cycle):

```tsx
import type { ReactNode } from 'react';

/** One row of the Settings definition list: a quiet label on the left, the control on the right. */
export function SettingsRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] items-start gap-x-4 gap-y-1 border-b border-line px-4 py-3 last:border-0 sm:items-center">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}
```

`packages/app/src/components/settings/schedule-row.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { trpc } from '../../lib/trpc';
import { mutationErrorText, type MutationErrorLike } from '../../lib/mutation-error';
import { useStaffDetail } from '../../lib/use-staff-detail';
import {
  CHOICE_LABELS, DAY_NAMES, browserTimeZone, choiceOf, lastOutcomeLine, nextRunLine, scheduleFormProblem, scheduleFromForm, timeZoneOptions,
  type Schedule, type ScheduleChoice, type ScheduleLast,
} from '../../lib/site/recurring-view';
import { SettingsRow } from './settings-row';

/** Spec 2026-10-24 §3.6: how often the website runs on its own, when it next does, and what the last time did. */
export function ScheduleRow(props: {
  siteId: string; project: string; site: string;
  schedule: Schedule | null; nextRunAt: Date | null; scheduleLast: ScheduleLast | null;
}) {
  const utils = trpc.useUtils();
  const staff = useStaffDetail();
  const save = trpc.sources.update.useMutation();
  const fallbackZone = useMemo(() => browserTimeZone(), []);
  const [choice, setChoice] = useState<ScheduleChoice>(choiceOf(props.schedule));
  const [days, setDays] = useState<number[]>(props.schedule?.days ?? [1]);
  const [time, setTime] = useState(props.schedule?.time ?? '06:00');
  const [zone, setZone] = useState(props.schedule?.timeZone ?? fallbackZone);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const zones = useMemo(() => timeZoneOptions(zone), [zone]);

  // The server is the authority: the row follows a fresh `sources.get` unless the customer is mid-edit.
  useEffect(() => {
    if (dirty) return;
    setChoice(choiceOf(props.schedule));
    setDays(props.schedule?.days ?? [1]);
    setTime(props.schedule?.time ?? '06:00');
    setZone(props.schedule?.timeZone ?? fallbackZone);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.schedule, dirty]);

  const edit = (f: () => void) => { setDirty(true); f(); };
  const problem = scheduleFormProblem(choice, days, time);
  async function onSave() {
    setError(null);
    try {
      await save.mutateAsync({ id: props.siteId, schedule: scheduleFromForm(choice, days, time, zone) });
      setDirty(false);
      await utils.sources.get.invalidate();
    } catch (e) {
      setError(mutationErrorText(e as MutationErrorLike, staff));
    }
  }
  const next = nextRunLine(props.nextRunAt, props.schedule?.timeZone ?? null);
  const last = lastOutcomeLine(props.scheduleLast, props.schedule?.timeZone ?? zone);

  return (
    <SettingsRow label="Schedule">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-base">
          <Select value={choice} onValueChange={(v) => edit(() => setChoice(v as ScheduleChoice))}>
            <SelectTrigger size="sm" aria-label="How often" className="w-[148px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(CHOICE_LABELS) as ScheduleChoice[]).map((c) => (
                <SelectItem key={c} value={c}>{CHOICE_LABELS[c]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {choice !== 'off' ? (
            <>
              <Input type="time" step={60} aria-label="Time" value={time} onChange={(e) => edit(() => setTime(e.target.value))} className="h-8 w-[112px]" />
              <Select value={zone} onValueChange={(v) => edit(() => setZone(v as string))}>
                <SelectTrigger size="sm" aria-label="Time zone" className="w-[220px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {zones.map((z) => <SelectItem key={z} value={z}>{z}</SelectItem>)}
                </SelectContent>
              </Select>
            </>
          ) : null}
        </div>

        {choice === 'custom' ? (
          <div role="group" aria-label="Days" className="flex flex-wrap gap-1.5">
            {DAY_NAMES.map((name, i) => {
              const iso = i + 1;
              const on = days.includes(iso);
              return (
                <Button key={name} type="button" size="sm" variant="outline" aria-pressed={on}
                  className={on ? 'border-text' : 'text-muted-foreground'}
                  onClick={() => edit(() => setDays(on ? days.filter((d) => d !== iso) : [...days, iso]))}>
                  {name}
                </Button>
              );
            })}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" variant="outline" onClick={() => void onSave()} disabled={!dirty || !!problem || save.isPending}>
            Save schedule
          </Button>
          {/* Every disabled control says why, within a line of it. */}
          {!dirty ? <span className="text-sm text-muted-foreground">No changes to save</span>
            : problem ? <span className="text-sm text-muted-foreground">{problem}</span> : null}
          {error ? <span role="alert" className="text-sm text-fail">{error}</span> : null}
        </div>

        {next ? <p className="text-sm text-muted-foreground">{next}</p> : null}
        {last ? (
          <p className="text-sm text-muted-foreground">
            {last.text}
            {last.runId ? (
              <>
                {' '}
                <Link to="/projects/$project/sites/$site/runs/$run" params={{ project: props.project, site: props.site, run: last.runId }}
                  className="text-link underline-offset-4 hover:underline">
                  Open the run
                </Link>
              </>
            ) : null}
          </p>
        ) : null}
      </div>
    </SettingsRow>
  );
}
```

`packages/app/src/components/settings/webhook-row.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { trpc } from '../../lib/trpc';
import { mutationErrorText, type MutationErrorLike } from '../../lib/mutation-error';
import { useStaffDetail } from '../../lib/use-staff-detail';
import { WEBHOOK_HELP, maskSecret } from '../../lib/site/recurring-view';
import { SettingsRow } from './settings-row';

/** Spec 2026-10-24 §3.6: where a finished run is posted, and the secret that signs it. */
export function WebhookRow({ siteId, webhookUrl, webhookSecret }: { siteId: string; webhookUrl: string | null; webhookSecret: string | null }) {
  const utils = trpc.useUtils();
  const staff = useStaffDetail();
  const save = trpc.sources.update.useMutation();
  const remove = trpc.sources.update.useMutation();
  const rotate = trpc.sources.rotateWebhookSecret.useMutation();
  const [url, setUrl] = useState(webhookUrl ?? '');
  const [dirty, setDirty] = useState(false);
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (!dirty) setUrl(webhookUrl ?? ''); }, [webhookUrl, dirty]);

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await utils.sources.get.invalidate();
    } catch (e) {
      setError(mutationErrorText(e as MutationErrorLike, staff));
    }
  }

  return (
    <SettingsRow label="Webhook">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Input aria-label="Webhook address" inputMode="url" placeholder="Your endpoint’s web address" value={url}
            onChange={(e) => { setDirty(true); setUrl(e.target.value); }} className="h-8 max-w-[420px]" />
          <Button size="sm" variant="outline" disabled={!dirty || url.trim() === '' || save.isPending}
            onClick={() => void act(async () => { await save.mutateAsync({ id: siteId, webhookUrl: url.trim() }); setDirty(false); })}>
            Save webhook
          </Button>
          {webhookUrl ? (
            <Button size="sm" variant="ghost" disabled={remove.isPending}
              onClick={() => void act(async () => { await remove.mutateAsync({ id: siteId, webhookUrl: null }); setDirty(false); })}>
              Remove
            </Button>
          ) : null}
        </div>

        {webhookUrl && webhookSecret ? (
          <div className="flex flex-wrap items-center gap-2 text-base">
            <span className="text-muted-foreground">Signing secret</span>
            <code className="font-mono text-sm break-all">{shown ? webhookSecret : maskSecret(webhookSecret)}</code>
            <Button size="sm" variant="ghost" onClick={() => setShown(!shown)}>{shown ? 'Hide' : 'Show'}</Button>
            <Button size="sm" variant="ghost"
              onClick={() => void navigator.clipboard.writeText(webhookSecret).then(() => setCopied(true), () => setError('That could not be copied. Show the secret and copy it by hand.'))}>
              {copied ? 'Copied' : 'Copy'}
            </Button>
            <Button size="sm" variant="outline" disabled={rotate.isPending}
              onClick={() => void act(async () => { await rotate.mutateAsync({ id: siteId }); setCopied(false); })}>
              Replace secret
            </Button>
          </div>
        ) : null}

        <p className="text-sm text-muted-foreground">{WEBHOOK_HELP}</p>
        {error ? <p role="alert" className="text-sm text-fail">{error}</p> : null}
      </div>
    </SettingsRow>
  );
}
```

`packages/app/src/components/settings/settings-rows.tsx`:
1. Delete the local `Row` function at the bottom and `type ReactNode` from the `react` import; `import { SettingsRow } from './settings-row';`, `import { ScheduleRow } from './schedule-row';`, `import { WebhookRow } from './webhook-row';`, `import type { Schedule, ScheduleLast } from '../../lib/site/recurring-view';`; every `<Row label=…>` / `</Row>` becomes `<SettingsRow …>` / `</SettingsRow>`.
2. `SettingsSite` gains `project: string; siteSlug: string; schedule: Schedule | null; nextRunAt: Date | null; scheduleLast: ScheduleLast | null; webhookUrl: string | null; webhookSecret: string | null;`.
3. Between the `Run limits` row's closing `</SettingsRow>` and `<SettingsRow label="Active">`:

```tsx
      {/* Recurring extraction (spec 2026-10-24 §3.6): after Run limits. */}
      <ScheduleRow siteId={site.id} project={site.project} site={site.siteSlug} schedule={site.schedule} nextRunAt={site.nextRunAt} scheduleLast={site.scheduleLast} />
      <WebhookRow siteId={site.id} webhookUrl={site.webhookUrl} webhookSecret={site.webhookSecret} />
```

4. The doc comment's row list: "Name, Address, Listing mode, Run limits, Schedule, Webhook, Active".

`packages/app/src/routes/_app/projects/$project/sites/$site/settings.tsx`: in `site={{ … }}` add

```tsx
          project: projectSlug,
          siteSlug,
          schedule: source.schedule,
          nextRunAt: source.nextRunAt,
          scheduleLast: source.scheduleLast,
          webhookUrl: source.webhookUrl,
          webhookSecret: source.webhookSecret,
```

and the header comment: "(task 9 — rename, listing mode, run limits, schedule, webhook, active, delete)".

- [ ] **Step 6: The run page line**

`packages/app/src/components/runs/run-header.tsx`: `import { browserTimeZone, webhookLine, type Delivery } from '../../lib/site/recurring-view';`; props gain `delivery: Delivery; staff: boolean;`; wrap the downloads `div` in a column and put the line under it:

```tsx
      <div className="flex flex-col items-end gap-1">
        <div className="flex items-center gap-2">
          {/* … the three download controls, unchanged … */}
        </div>
        {/* Spec 2026-10-24 §3.4: from the latest webhook attempt; a customer reads no code, host or error. */}
        {line ? <p className="text-sm text-muted-foreground">{line}</p> : null}
      </div>
```

with `const line = webhookLine(delivery, staff, browserTimeZone());` beside `const repairing = …`.

`packages/app/src/routes/_app/projects/$project/sites/$site/runs/$run.tsx`: the query becomes

```tsx
  // Spec 2026-10-24: while its webhook is being retried, the page looks again every 15 s (the only poll here
  // besides ExecuteControls'), so "trying again" turns into delivered or not without a reload.
  const detail = trpc.runs.getWithDetails.useQuery({ id: runId }, {
    enabled: valid,
    refetchInterval: (q) => (q.state.data?.delivery?.state === 'retrying' ? 15_000 : false),
  });
```

(and the "Nothing here polls on its own" paragraph of the screen's doc comment gains: "— except the webhook line, refetched every 15 s while it reads 'trying again'."); destructure `delivery` beside `backfillRuns` (`const { run, source, capture, extraction, backfillRuns, delivery } = detail.data;`), and pass `delivery={delivery ?? null}` and `staff={staff}` to `<RunHeader …/>`.

- [ ] **Step 7: The route smoke** — `packages/app/src/routes-smoke.test.ts`, the `settings` entry of `SITE_SCREENS`, after the Delete assertion:

```ts
      // Spec 2026-10-24 §3.6: both rows are on the tab. The smoke never saves a schedule or a webhook.
      expect(await page.locator('dt').filter({ hasText: /^Schedule$/ }).count(), 'the Settings tab has no Schedule row').toBe(1);
      expect(await page.locator('dt').filter({ hasText: /^Webhook$/ }).count(), 'the Settings tab has no Webhook row').toBe(1);
      expect(await page.getByRole('combobox', { name: 'How often' }).count(), 'the Schedule row has no Off / Every day choice').toBe(1);
      expect(await page.getByRole('textbox', { name: 'Webhook address' }).count(), 'the Webhook row has no address field').toBe(1);
      expect(await page.locator('main').innerText(), 'the Webhook row lost its help line').toContain('We send a POST with the run');
      await expectNoMoney(page);
```

(If Base UI's `SelectTrigger` is not a `combobox` here, use the role the existing "Listing mode" trigger has — check it with `page.getByLabel('How often')` — and keep the assertion.)

- [ ] **Step 8: Run the tests and the type-check**

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-recurring/packages/app && npx vitest run src/lib/site/recurring-view.test.ts src/lib/runs-view.test.ts src/lib/site/run-screen-view.test.ts src/lib/org-runs-view.test.ts src/customer-copy-sweep.test.ts && npx tsc --noEmit`
Expected: PASS (the sweep finds no "budget", "HTTP <n>" or host in the new strings), no type errors. Then `git status --short`: restore `packages/app/src/routeTree.gen.ts` if the type-check touched it (`git checkout -- packages/app/src/routeTree.gen.ts`).

- [ ] **Step 9: Commit**

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-recurring
git add packages/app/src/lib/site/recurring-view.ts packages/app/src/lib/site/recurring-view.test.ts packages/app/src/components/settings/settings-row.tsx packages/app/src/components/settings/schedule-row.tsx packages/app/src/components/settings/webhook-row.tsx packages/app/src/components/settings/settings-rows.tsx "packages/app/src/routes/_app/projects/\$project/sites/\$site/settings.tsx" packages/app/src/lib/runs-view.ts packages/app/src/lib/runs-view.test.ts packages/app/src/lib/site/run-screen-view.ts packages/app/src/lib/site/run-screen-view.test.ts packages/app/src/components/runs/run-header.tsx "packages/app/src/routes/_app/projects/\$project/sites/\$site/runs/\$run.tsx" packages/app/src/routes-smoke.test.ts
git commit -m "feat(app): Schedule and Webhook rows in Settings; scheduled runs and the webhook line on the run page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The live check, docs, the merge gate, the merge (`CLAUDE.md` "Autonomous runs") — spec §5

**Files:**
- Create: `packages/worker/src/live-recurring.ts`; results `docs/testing/results/2026-10-24-recurring/live-recurring.json`
- Modify: `packages/worker/src/bench/seed.ts` (export `benchCaller`, add `seedCertifiedWebsite`); `CLAUDE.md`; `.env.example`; `docker-compose.yml` (worker `environment`); `docs/superpowers/specs/2026-10-24-recurring-extraction-design.md` (Status); `docs/handoff.md`; `docs/queue.md`

**Interfaces:**
- Consumes: every earlier task; `createBenchDatabase(base)` (`bench/bench-db.ts`), `startFixtureShop({ sites, latency })`, `INSTANT`, `FIXTURE_FIELDS`, `product` (`bench/fixture-shop.ts`); `seedPassingVerification` (`@robot/api/test-helpers/seed-coverage-check`); `loadRunExport`, `renderRunExport` (`@robot/api/export`); `startWorker`, `readWorkerConfig`.
- Produces: `seedCertifiedWebsite(caller: AppCaller, site: FixtureSite): Promise<{ sourceId: string; keys: Record<string, string> }>`; `benchCaller(): Promise<AppCaller>`; CLI `cd packages/worker && npx tsx src/live-recurring.ts` → exit 0 and `docs/testing/results/2026-10-24-recurring/live-recurring.json`; a branch that passes the gate; `main` fast-forwarded and pushed.

- [ ] **Step 1: The seed** — `packages/worker/src/bench/seed.ts`: add `import type { AppCaller } from '@robot/api/test-helpers/identity';` (type-only: identity.ts imports vitest at runtime, so never a value import) and `import type { FixtureSite } from './fixture-shop.js';`; make `benchCaller` exported with return type `Promise<AppCaller>`; move the per-site body into:

```ts
/** One fixture website: a project and website with its proof pages and expected values, and a passing Verify on the fixture's certified paths. */
export async function seedCertifiedWebsite(caller: AppCaller, site: FixtureSite): Promise<{ sourceId: string; keys: Record<string, string> }> {
  const urls = [1, 2, 3].map((id) => site.productUrl(id));
  const expected = Object.fromEntries(FIXTURE_FIELDS.map((f) => [f.name, Object.fromEntries(urls.map((u, i) => [u, String(product(site.index, i + 1)[f.truth] ?? '')]))]));
  const made = await createProjectWithSource(caller, { tag: `bench-${site.index}`, fields: FIXTURE_FIELDS.map(({ name, type }) => ({ name, type })), urls, expected });
  await seedPassingVerification(made.sourceId, Object.fromEntries(FIXTURE_FIELDS.map((f) => [made.keys[f.name]!, f.paths])));
  return { sourceId: made.sourceId, keys: made.keys };
}
```

and `seedBenchRuns` calls it (`const { sourceId, keys } = await seedCertifiedWebsite(caller, site);`), its run and items unchanged. Check: `cd packages/worker && npx tsc --noEmit && npx vitest run src/bench/` → PASS.

- [ ] **Step 2: The live check** — `packages/worker/src/live-recurring.ts`:

```ts
// The recurring-extraction live check (spec 2026-10-24 §5, the queue item's "done when"). Free, local, keyless: a
// throwaway database, the run-speed fixture shop, a local webhook receiver, the api-server on its own port (it
// serves the signed links; it never starts a browser) and an in-process worker. One certified fixture website gets
// a schedule due within two minutes and a webhook to the receiver; the check waits for the run to start by itself,
// finish, write its three files and post once, then downloads the three links and compares them with the run.
//   cd packages/worker && npx tsx src/live-recurring.ts
import { createHmac, randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = join(here, '..', '..', '..');
const API_PORT = 4310;
const OUT = join(repo, 'docs', 'testing', 'results', '2026-10-24-recurring');
try { loadEnvFile(join(repo, '.env')); } catch { /* no .env: the default URL below */ }
const { createBenchDatabase } = await import('./bench/bench-db.js');
process.env.JOB_QUEUE = `live-recurring-${randomUUID()}`.slice(0, 64);
Object.assign(process.env, {
  ANTHROPIC_API_KEY: '', JEV_SHADOW: '', TYPESAFE_API_KEY: '', WEBSITE_CHECKS: 'off',
  WEBHOOK_ALLOW_PRIVATE: 'on', PUBLIC_API_URL: `http://127.0.0.1:${API_PORT}`,
});
const capturesDir = mkdtempSync(join(tmpdir(), 'live-recurring-captures-'));
process.env.CAPTURES_DIR = capturesDir;

const hits: Array<{ headers: IncomingHttpHeaders; body: string }> = [];
const receiver = createServer((req, res) => {
  let body = '';
  req.setEncoding('utf8');
  req.on('data', (c: string) => { body += c; });
  req.on('end', () => { hits.push({ headers: req.headers, body }); res.writeHead(200).end('ok'); });
});
await new Promise<void>((r) => receiver.listen(0, '127.0.0.1', r));
const hookUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/hook`;

async function until<T>(what: string, ms: number, probe: () => Promise<T | null | undefined | false>): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await probe();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

let exitCode = 0;
const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];
const check = (name: string, ok: boolean, detail?: string) => {
  checks.push({ name, ok, ...(detail ? { detail } : {}) });
  console.log(`[live-recurring] ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) exitCode = 1;
};

let bench: Awaited<ReturnType<typeof createBenchDatabase>> | null = null;
let api: ChildProcess | null = null;
let closeShop: (() => Promise<void>) | null = null;
let stopWorker: (() => Promise<void>) | null = null;
try {
  bench = await createBenchDatabase(process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/robot_platform');
  // Before anything imports @robot/db: every row of this check goes to the throwaway database.
  process.env.DATABASE_URL = bench.url;
  api = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: join(repo, 'packages', 'api-server'), env: { ...process.env, PORT: String(API_PORT) }, stdio: ['ignore', 'inherit', 'inherit'],
  });
  await until('the api-server', 60_000, () => fetch(`http://127.0.0.1:${API_PORT}/healthz`).then((r) => r.ok).catch(() => false));

  const { startFixtureShop, INSTANT } = await import('./bench/fixture-shop.js');
  const shop = await startFixtureShop({ sites: 1, latency: INSTANT });
  closeShop = shop.close;
  const { setBrowserOwner } = await import('@robot/browser');
  setBrowserOwner(String(process.pid));
  const { benchCaller, seedCertifiedWebsite } = await import('./bench/seed.js');
  const caller = await benchCaller();
  const { sourceId } = await seedCertifiedWebsite(caller, shop.sites[0]!);
  const due = new Date(Date.now() + 60_000);
  const time = `${String(due.getUTCHours()).padStart(2, '0')}:${String(due.getUTCMinutes()).padStart(2, '0')}`;
  await caller.sources.update({ id: sourceId, schedule: { days: [1, 2, 3, 4, 5, 6, 7], time, timeZone: 'UTC' }, webhookUrl: hookUrl });

  const { db, runs, runFiles, sources, webhookDeliveries } = await import('@robot/db');
  const { and, eq } = await import('drizzle-orm');
  const src = (await db.query.sources.findFirst({ where: eq(sources.id, sourceId), columns: { nextRunAt: true, webhookSecret: true } }))!;
  check('the schedule is due within two minutes', !!src.nextRunAt && src.nextRunAt.getTime() - Date.now() <= 125_000, src.nextRunAt?.toISOString());

  const { readWorkerConfig } = await import('./config.js');
  const { startWorker } = await import('./worker.js');
  const worker = await startWorker({ ...readWorkerConfig({ JOB_QUEUE: process.env.JOB_QUEUE }), websiteChecks: false, recurringRuns: true });
  stopWorker = () => worker.stop();

  const run = await until('the scheduled run to start', 4 * 60_000, () => db.query.runs.findFirst({ where: and(eq(runs.sourceId, sourceId), eq(runs.inputLabel, 'scheduled')) }));
  check('a run started by itself, labelled scheduled', true, run.id);
  const done = await until('the run to finish', 5 * 60_000, async () => {
    const r = await db.query.runs.findFirst({ where: eq(runs.id, run.id) });
    return r && ['completed', 'partial', 'failed', 'cancelled'].includes(r.status) ? r : null;
  });
  check('the run completed', done.status === 'completed', `${done.status}, ${done.resultCount} rows`);
  const files = await until('three files', 2 * 60_000, async () => {
    const f = await db.select().from(runFiles).where(eq(runFiles.runId, run.id));
    return f.length === 3 ? f : null;
  });
  check('three files were written', files.length === 3, files.map((f) => `${f.format} ${f.bytes.length} B`).join(', '));
  const hit = await until('the webhook', 2 * 60_000, async () => hits[0] ?? null);
  await new Promise((r) => setTimeout(r, 3000));
  check('one POST reached the receiver', hits.length === 1, String(hits.length));
  const secret = src.webhookSecret!;
  check('the POST is signed', hit.headers['x-robot-signature'] === `sha256=${createHmac('sha256', secret).update(hit.body).digest('hex')}`);
  check('the headers', hit.headers['x-robot-event'] === 'run.finished' && hit.headers['user-agent'] === 'robot-platform-webhook/1'
    && hit.headers['content-type'] === 'application/json' && typeof hit.headers['x-robot-delivery'] === 'string');
  const body = JSON.parse(hit.body) as { event: string; runId: string; status: string; scheduled: boolean; rows: number; website: { id: string }; files: Record<'csv' | 'json' | 'xlsx', string> };
  check('the body names the run', body.event === 'run.finished' && body.runId === run.id && body.status === done.status && body.scheduled === true && body.website.id === sourceId);

  const { loadRunExport, renderRunExport } = await import('@robot/api/export');
  const live = (await loadRunExport(db, run.id))!;
  for (const format of ['csv', 'json', 'xlsx'] as const) {
    const res = await fetch(body.files[format]);
    const got = Buffer.from(await res.arrayBuffer());
    const stored = files.find((f) => f.format === format)!.bytes;
    check(`the ${format} link downloads the run's file`, res.status === 200 && got.equals(stored), `${res.status}, ${got.length} B`);
    // CSV and JSON are byte-for-byte the live export of the same rows; an XLSX carries its own timestamps.
    if (format !== 'xlsx') check(`the ${format} file holds the run's rows`, got.equals((await renderRunExport(live, format)).bytes));
  }
  check('the row count matches the run', body.rows === live.rows.length && live.rows.length === done.resultCount, `${body.rows} / ${live.rows.length} / ${done.resultCount}`);
  const tampered = body.files.csv.replace(/sig=([0-9a-f])/, (_m, c: string) => `sig=${c === '0' ? '1' : '0'}`);
  check('a tampered link is refused', (await fetch(tampered)).status === 404);
  const attempts = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.runId, run.id));
  check('one delivery attempt, delivered', attempts.length === 1 && attempts[0]!.ok === true, `${attempts.length} attempt(s)`);

  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'live-recurring.json'), JSON.stringify({
    at: new Date().toISOString(), runId: run.id, status: done.status, rows: done.resultCount,
    scheduledFor: src.nextRunAt?.toISOString(), startedAt: run.startedAt, completedAt: done.completedAt, checks,
  }, null, 1));
} catch (err) {
  console.error('[live-recurring] failed:', err);
  exitCode = 1;
} finally {
  await stopWorker?.().catch(() => {});
  api?.kill();
  await closeShop?.().catch(() => {});
  receiver.close();
  rmSync(capturesDir, { recursive: true, force: true });
  const made = bench;
  if (made) await made.drop().catch((err) => { console.error(`[live-recurring] could not drop ${made.name}:`, err); exitCode = 1; });
}
process.exit(exitCode);
```

Run it in the background (Bash `run_in_background`; nothing else Chromium-heavy at the same time):

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-recurring/packages/worker && npx tsx src/live-recurring.ts
```

Expected: every line `ok`, exit 0, within ~5 minutes; `docs/testing/results/2026-10-24-recurring/live-recurring.json` written. **Done when** (queue item): a scheduled run fired, wrote its file and posted its webhook. A `FAIL` blocks the item: find the cause (with a test in the owning task's file), fix on the branch, run again. Afterwards: no `robot_bench_*` database left (`SELECT datname FROM pg_database WHERE datname LIKE 'robot_bench_%'`), nothing listening on :4310.

- [ ] **Step 3: Reviews are clean; trailers are right**

Confirm each task's review (and fix rounds) ended clean. Then:

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-recurring && git log main..HEAD --format=%B | grep Co-Authored-By | sort | uniq -c
```

Expected: only `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Rewrite strays with `git rebase main --exec "bash <script>"` (memory `subagent-commit-trailers`).

- [ ] **Step 4: Full test run and type-check of every touched package**

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-recurring/packages/db && npx vitest run --no-file-parallelism && npx tsc --noEmit
cd /c/Users/Marko/Documents/projects/robot-platform-recurring/packages/api && npx vitest run --no-file-parallelism && npx tsc --noEmit
cd /c/Users/Marko/Documents/projects/robot-platform-recurring/packages/api-server && npx vitest run --no-file-parallelism && npx tsc --noEmit
cd /c/Users/Marko/Documents/projects/robot-platform-recurring/packages/worker && npx vitest run --no-file-parallelism && npx tsc --noEmit
cd /c/Users/Marko/Documents/projects/robot-platform-recurring/packages/app && npx vitest run --no-file-parallelism && npx tsc --noEmit
```

Expected: all PASS, no type errors (Postgres up; the app's route smoke skips without `RUN_UI_SMOKE`). A Chromium file that times out only in the full run: re-run it alone. A real failure blocks the merge: fix it on the branch with a test. Then `git status --short`: restore `packages/app/src/routeTree.gen.ts` if it changed; no test left a `jobs` row (`SELECT queue, count(*) FROM jobs WHERE queue LIKE 'test-%' OR queue LIKE 'live-recurring-%' GROUP BY queue` → none); no test website left with a schedule (`SELECT count(*) FROM sources WHERE schedule IS NOT NULL AND slug LIKE 'site-%'` → 0 — test websites are named `Site <tag>`).

- [ ] **Step 5: Whole-branch review**

The controller dispatches one reviewer on the most capable model over `git diff main...HEAD`, with the spec and this plan. Points to press: §3.2's eligibility table row by row against `skipReason` (order, reasons, sentences) and that a refusal still moves `next_run_at` on; the claim — lock, advance, outcome, run row and job in one transaction — and that every test sweep passes `only`; `nextRunAt`'s gap and overlap rules (the binary search's invariant; a loop that can never find a day); `run-delivery`'s conditions (§3.3: settled statuses, rows, probe, backfill → parent), its key, and that nothing in it can change a run (`subject: () => null`, no `runSentence`); the webhook body's keys and headers against §3.4 verbatim; `postWebhook` — no redirect followed, the literal check before `lookup`, every address checked, one timer for the whole request, the read cap, never a rejection; the signed-link check — constant-time compare, format and run in the signed string, expiry, no fallback to the session; the export route's live download bytes unchanged; customer copy — the new strings carry no money, code, host or "budget", and every refusal reaches the app as `BAD_REQUEST` with a sentence; every worker on a shared database runs with recurring runs off; no AI call anywhere. No open Critical or Important finding may remain; fix on the branch and re-run Step 4 for the touched packages.

- [ ] **Step 6: The route smoke, from the branch, on an isolated pair with its worker (gate 4: `@robot/app` and `@robot/api` changed)**

A stop file for the worker: `/c/Users/Marko/AppData/Local/Temp/claude/worker-4100.stop`. In the background, three processes:

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-recurring/packages/api-server && ANTHROPIC_API_KEY= JEV_SHADOW= TYPESAFE_API_KEY= WEBSITE_CHECKS=off JOB_QUEUE=isolated-4100 PORT=4100 APP_ORIGINS=http://localhost:3100 npx tsx src/index.ts
```

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-recurring/packages/worker && ANTHROPIC_API_KEY= JEV_SHADOW= TYPESAFE_API_KEY= WEBSITE_CHECKS=off RECURRING_RUNS=off JOB_QUEUE=isolated-4100 WORKER_STOP_FILE=/c/Users/Marko/AppData/Local/Temp/claude/worker-4100.stop npx tsx src/index.ts
```

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-recurring/packages/app && VITE_API_URL=http://localhost:4100 npx vite dev --port 3100
```

Wait until `curl -s http://localhost:4100/healthz` answers `{"status":"ok"}`, the worker's log says `on queue "isolated-4100"` with `website checks off` and `recurring runs off`, and `curl -s -o /dev/null -w "%{http_code}" http://localhost:3100/login` answers 200. Then:

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-recurring/packages/app && RUN_UI_SMOKE=1 APP_URL=http://localhost:3100 API_URL=http://localhost:4100 npx vitest run src/routes-smoke.test.ts
```

Expected: PASS, every test. Look at `docs/testing/screens/app-site-settings-dark.png` and `-light.png`: the Schedule row (Off, its Save disabled with "No changes to save") and the Webhook row (address field, help line) sit between Run limits and Active, in both themes, nothing overflowing. Stop the worker with `touch /c/Users/Marko/AppData/Local/Temp/claude/worker-4100.stop` and wait for it to exit (`stopping (stop file)`), then the two servers by port, never :3000/:4000:

```powershell
Get-NetTCPConnection -LocalPort 4100,3100 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -Confirm:$false }
```

If the worker has not exited 60 s after the stop file: `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*robot-platform-recurring*packages*worker*src*index.ts*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -Confirm:$false }`. Then `DELETE FROM jobs WHERE queue = 'isolated-4100'` (via `npx tsx -e` with `@robot/db`, from `packages/worker`). Restore: `git checkout -- packages/app/src/routeTree.gen.ts docs/testing/screens`.

- [ ] **Step 7: The live check on the final head (gate 5)**

If any code changed after Step 2 (`git log <step-2 commit>..HEAD -- packages`), run Step 2's command again; it must pass again. Capture and extraction code is untouched by this item (`git diff main...HEAD --stat -- packages/browser packages/scraper` → nothing); say so in the digest.

- [ ] **Step 8: Docs**

Note the last code commit: `git log -1 --format=%h -- packages` → `<sha>`.

1. Spec — the Status paragraph's first sentence becomes ``**Status:** implemented on `feat/recurring-extraction` and merged to `main` on <date> (`<sha>`); written 2026-10-24 under the standing approval …`` (keep the rest); add a **Proven:** sentence (the live check's run, its three files and its one signed POST; test counts from Step 4; the smoke) and any **Deviations:** the reviews forced, plus "Settled here" below.
2. `CLAUDE.md`:
   - Environment, after `WEBSITE_CHECK_DAYS`:
     - `` - `RECURRING_RUNS` — the worker's schedule sweep (every minute; starts each website's scheduled run, spec 2026-10-24); on unless set to `off`. The isolated smoke pair's worker, and any worker on a database it shares, sets `off` ``
     - `` - `WEBHOOK_ALLOW_PRIVATE` — set to `on` to let webhooks reach loopback and private addresses (tests, the local live check, Docker); off by default. Read by the api-server (saving) and the worker (sending) ``
     - `` - `PUBLIC_API_URL` — the api-server as a webhook receiver reaches it; the signed file links in a webhook are built on it; default `http://localhost:4000`. Read by the worker ``
   - Commands: `` - `cd packages/worker && npx tsx src/live-recurring.ts` — the recurring-extraction live check: a throwaway database, the fixture shop, a local webhook receiver, an api-server on :4310 and an in-process worker; a scheduled run fires, writes its three files and posts one signed webhook; writes `docs/testing/results/2026-10-24-recurring/live-recurring.json` (live, free) ``
   - The `pnpm test:ui:staff` line: "`JOB_QUEUE=isolated-4100 WEBSITE_CHECKS=off` on both the api-server and the worker, and `RECURRING_RUNS=off` on the worker"; the isolated pair's worker command gains `RECURRING_RUNS=off`.
   - Key Technical Decisions, after the "Capture worker" bullet:

```markdown
- Recurring extraction (2026-10-24): a website may carry a weekly schedule (ISO days, a wall time, an IANA time zone; DST gaps run at the end of the gap, overlaps once) and a webhook. The worker's minute sweep claims due websites (`FOR UPDATE SKIP LOCKED`, `next_run_at` moved on from now, so a worker that was down fires once) and starts a `scheduled-run` (plan at the run limits, then the run) unless the website is paused, uncertified, an unconfirmed listing, or still running — the reason is shown in Settings. A settled run of such a website gets a `run-delivery` job: CSV/JSON/XLSX snapshots in `run_files`, then one signed `run.finished` POST with signed links (7 days) that open the snapshot without a session. Webhooks never reach private or loopback addresses (checked at save and on every resolved address at send; no redirects; 10 s; 64 KB) unless `WEBHOOK_ALLOW_PRIVATE=on`; five attempts, never touching the run. `RECURRING_RUNS=off` stops the sweep.
```

3. `.env.example`, after the `WEBSITE_CHECK_DAYS` block:

```
# Recurring extraction (spec 2026-10-24): the worker's minute sweep starts each website's scheduled run. On unless off;
# an isolated smoke pair's worker sets off.
# RECURRING_RUNS=
# Let webhooks reach loopback/private addresses (tests, the local live check, Docker). Off by default.
# WEBHOOK_ALLOW_PRIVATE=
# The api-server as a webhook receiver reaches it; the signed file links in a webhook are built on it.
# PUBLIC_API_URL=http://localhost:4000
```

4. `docker-compose.yml`, the `worker` service's `environment`: add `PUBLIC_API_URL: http://127.0.0.1:${STACK_API_PORT:-4200}` (its links must name the stack's published api port, not :4000).
5. `docs/handoff.md` — the "Newest" line becomes `**Newest: [Recurring extraction (2026-10-24)](#recurring-extraction-2026-10-24).** A website can run on a weekly schedule and post a signed webhook with download links when a run finishes. Merged <date>.` followed by `**Before it: …**` and the rest of the old line. Insert before the previous newest section a section `## Recurring extraction (2026-10-24)` with: spec/plan paths; **What changed** (the schedule and its sweep; the scheduled-run job; the run file and signed links; the webhook and its safety; what a customer sees — one paragraph each, from the spec); **How it was proven** (the live check's lines and JSON, test counts from Step 4, the smoke and its Settings screenshots); **After pulling** (`pnpm db:migrate` — migration 0021; restart `pnpm dev:all` so the worker starts the sweep; nothing runs until a customer saves a schedule); **What NOT to redo** (never follow a webhook redirect; check every resolved address, not just the first; keep the snapshot separate from the live download; a backfill re-delivers its parent; a sample never delivers; tests always sweep with `only`); **Open** (spec §6; `projects.default_schedule` / `output_destination` / `notification_channel` still unused; the secret is stored in plain text; links name `PUBLIC_API_URL`, which must be reachable from the customer's endpoint).
6. `docs/queue.md` — move item 1 from **Next** to **Done** as `- <date> — Recurring extraction (\`<sha>\`): a weekly schedule per website, a CSV/JSON/XLSX snapshot per run, a signed webhook with signed links on completion; live check docs/testing/results/2026-10-24-recurring/live-recurring.json. After merge: pnpm db:migrate, restart dev:all.`; renumber **Next**; add under **Needs Marko**: `- **Recurring runs are on by default** (RECURRING_RUNS): nothing runs until a customer saves a schedule. Keep on?` and `- **Webhook links point at PUBLIC_API_URL** (default http://localhost:4000): a customer's endpoint outside this machine cannot open them until the api-server has a public address. Which address?`

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-recurring
git add packages/worker/src/live-recurring.ts packages/worker/src/bench/seed.ts docs/testing/results/2026-10-24-recurring/live-recurring.json docs/superpowers/specs/2026-10-24-recurring-extraction-design.md CLAUDE.md .env.example docker-compose.yml docs/handoff.md docs/queue.md
git commit -m "docs: recurring extraction — live check, shipped; handoff, decisions, commands, queue

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(The live check and the seed may also be committed on their own right after Step 2; if so, drop them from this `git add`.)

- [ ] **Step 9: Rebase on `main`, fast-forward `main`, push**

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-recurring
git checkout -- packages/app/src/routeTree.gen.ts
git status --short
git fetch origin
git rebase main
```

If `main` moved, re-run Step 4 for the touched packages (and Step 6 if an app/api file on `main` changed; regenerate the migration if `main` gained a `0021` — renumber ours to the next free index with `drizzle-kit generate` after rebasing the schema, never by hand-editing the journal). The main checkout must be clean and on `main`:

```bash
git -C /c/Users/Marko/Documents/projects/robot-platform status --short
git -C /c/Users/Marko/Documents/projects/robot-platform rev-parse --abbrev-ref HEAD
```

If it is not clean, or not on `main`, stop: write the item under **Needs Marko** in `docs/queue.md` ("branch ready, main checkout not clean") and do not merge. Otherwise:

```bash
git -C /c/Users/Marko/Documents/projects/robot-platform merge --ff-only feat/recurring-extraction
git -C /c/Users/Marko/Documents/projects/robot-platform push origin main
```

Expected: a fast-forward and a push. Marko's dev servers are not restarted: his worker keeps the old code (no sweep) until he runs `pnpm db:migrate` and restarts `pnpm dev:all` — say so in the run's digest. Do not run `pnpm install` or migrations in the main checkout. Finally: no `robot_bench_*` database, no `isolated-4100`/`live-recurring-%`/`test-%` jobs, nothing listening on :4100, :3100 or :4310.

---

## Settled here (spec ambiguities, decided for this plan)

1. **`run_files.filename`** — the spec lists `run_id, format, bytes, rows, created_at`; a `filename` column is added so a snapshot downloads under the live export's name without rebuilding the export.
2. **Samples and backfills** — a sample (`input_label = 'probe'`) never delivers (its rows are a preview, and probes are frequent); a backfill delivers its **parent** (spec: "the backfill's own finalise delivers again for the parent, replacing it") with the parent's id and files.
3. **An empty scheduled plan** — today a plan with 0 items and no failed input reads `planned`; for a scheduled run that is closed `failed` with "This run found no products to extract." (spec: "stays a failed plan run, with its own reason"). A plan that already failed keeps its own reason.
4. **The claim** — `SELECT … FOR UPDATE SKIP LOCKED` then `UPDATE` in one transaction (the next time needs the row's schedule, computed in JS by `nextRunAt`), with eligibility, the run row and the job in the same transaction — the same guarantee as the spec's single `UPDATE … WHERE id = (SELECT … SKIP LOCKED)`. An unreadable stored schedule gets `next_run_at = null` (never fires) instead of being retried every minute.
5. **Sweep timing** — the first sweep 10 s after the worker starts, then every 60 s.
6. **"Scheduled"** — shown as the existing suffix grammar, `· scheduled` (beside `· sample`, `· backfill`/`· repair`), in the website's and the organisation's Runs tables and on the run page.
7. **Refusal sentences the spec did not word** — "Choose at least one day.", "Choose each day once.", "Choose days from Monday to Sunday.", "Use a time like 06:00.", "That schedule could not be saved.", "Enter a web address.", "Enter the full web address, starting with http or https.", "Use a web address of at most 2,000 characters.", "Leave the user name and password out of the address." — all `BAD_REQUEST` with the sentence (zod checks the shape only; its JSON message would reach the app as "Something went wrong"). None contains `https://`, a host or an IP (the app's `captureWords` would swallow it).
8. **`WEBHOOK_ALLOW_PRIVATE`** applies at save (api-server) and at send (worker).
9. **The delivery state** — `null` until a first attempt; `retrying` = the latest attempt failed with attempt < 5; `failed` = attempt 5 failed. The run page line uses the viewer's browser time zone; staff see `(<code or "no answer">: <error>)` after it; the run page refetches every 15 s while it reads "trying again".
10. **The body's `rows`** is the rows in the files (the export's rows, one per product for a nested-variants project); `failedItems` counts failed product pages.
11. **A schedule without a webhook** still writes the three files (downloadable with `?snapshot=1`); it has no secret, so no signed links, until a webhook is saved.
12. **Staff log sentences** — "Set the schedule of X", "Turned off the schedule of X", "Set the webhook of X", "Removed the webhook of X", "Replaced the webhook signing secret of X".
13. **Docker** — the worker's `PUBLIC_API_URL` is set to the stack's published api port (`http://127.0.0.1:${STACK_API_PORT:-4200}`), otherwise its links would name :4000.
14. **Time-zone list** — `Intl.supportedValuesOf('timeZone')` plus `UTC` and the stored zone; the spec's example date "Monday 27 October" is a format example (in 2026 that Monday is the 26th).
