# Recurring extraction: a schedule per website, a file per run, a webhook on completion — design

**Status:** implemented on `feat/recurring-extraction` and merged to `main` on 2026-10-24 (`2881058f`); written 2026-10-24 under the standing approval (`CLAUDE.md`, "Autonomous runs"; `docs/queue.md` item 1,
"Recurring extraction"). Plan: `docs/superpowers/plans/2026-10-24-recurring-extraction.md`. Branch
`feat/recurring-extraction` from `main` @ `e950e093`, worktree `C:\Users\Marko\Documents\projects\robot-platform-recurring`.

**Proven:** the live check (`docs/testing/results/2026-10-24-recurring/live-recurring.md`) — a website scheduled one minute ahead started by itself 20 s after its time, completed in 10 s, wrote CSV/JSON/XLSX snapshots, and the local receiver got one signed POST 0.4 s later whose three signed links downloaded the same bytes; a tampered link answered 404. Tests: api 1,599, app 1,092, plus worker, api-server and db suites; the route smoke on the isolated pair.

**Deviations and settled here** (reviews, 2026-10-24): runs closed by the job layer (failed for good, reaped, stalled) with rows deliver too; a scheduled run left `planned` by a dead worker is closed failed; a delivery that fails before any POST records an attempt; a backfill that lands while its parent's delivery is running re-delivers once with a new delivery id; a sample never delivers; the "Scheduled" label reads "· scheduled" after the status, like "· sample"; replacing the secret asks first; the sweep takes a `now` so tests never make a dev website due.

## 1. Why

A customer wants a website's data every Monday morning without opening the app. Today a run starts only from the
Extract tab (`crawl.plan` / `sources.confirm`, then `crawl.execute`), its file is built on demand behind the session
cookie (`api-server/src/routes/export.ts`), and nothing tells anyone outside the app that a run finished.

**Done when** (queue): a scheduled run fires, writes its file and posts its webhook; tests; the route smoke.

## 2. What exists and is reused

- A run = a `planning` run row + a plan (`planSource`, browser, in the worker) + the `run` job (`startRunJob`,
  `jobs/handlers/run.ts`). Planning a certified website at full run limits is free (certified paths only, no AI).
- `requireCertification` refuses a website whose schema lost its certification; `canExecute` refuses an empty plan.
- `finaliseRun` (`crawl/roll-up-run.ts`) is the one place a run becomes terminal; `buildFinalise`
  (`crawl/start-execution.ts`) already hangs a side effect (drift flagging) after it, in its own try/catch.
- The export package (`loadRunExport`, `toCsv`, `toJson`, `toXlsx`) already shapes a run's rows in three formats.
- The website-checks scheduler (`verify/website-checks.ts`): a timer in the worker, a claim-and-advance SQL
  (`FOR UPDATE SKIP LOCKED`), one job per due website.

## 3. The design

### 3.1 The schedule

A website has an optional schedule: `{ days: number[]; time: 'HH:MM'; timeZone: string }`. `days` holds ISO
weekdays (1 = Monday … 7 = Sunday), at least one, no duplicates. `time` is 24-hour. `timeZone` is an IANA name
that `Intl.DateTimeFormat` accepts. No schedule = `null` (the default).

`nextRunAt(schedule, after)` (pure, no library) returns the first instant strictly after `after` whose wall-clock
time in `timeZone` is a listed day at `time`.
- A wall time that does not exist (spring-forward gap) runs at the first instant after the gap.
- A wall time that happens twice (fall-back) runs once, at the first occurrence.

`sources.next_run_at` holds it, recomputed:
- whenever the schedule is saved (from now);
- after each due sweep (from now — a worker that was down for a week runs a website once, not seven times).

### 3.2 Firing

The worker runs a sweep every 60 s, off unless `RECURRING_RUNS` is not `off` (default on; the isolated smoke pair
sets `off`).

**Claim.** It claims due websites one at a time with the website-checks pattern:
- `UPDATE sources SET next_run_at = <next> … WHERE id = (SELECT id … WHERE next_run_at <= now() AND schedule IS NOT
  NULL ORDER BY next_run_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING …`;
- at most 6 per sweep.

**Eligibility, then start.** For each claimed website it records one outcome, as below. A refusal is recorded and
never retried before the next scheduled time.

| Condition (checked in this order) | Outcome | Customer sentence (Settings) |
|---|---|---|
| website not active | skipped | "Skipped: the website is paused." |
| schema not certified (`requireCertification` refuses) | skipped | "Skipped: the website needs verifying first." |
| a listing website that was never confirmed (no first full run) | skipped | "Skipped: run Extract once by hand first." |
| a run of this website is `planning`, `extracting` or `cancelling` | skipped | "Skipped: the last run was still going." |
| otherwise | started | "Started <time>." with a link to the run |

**Starting.** In one transaction it writes:
- a `planning` run row with `input_label = 'scheduled'`;
- a `scheduled-run` job (background lane, priority 20, 1 attempt, no start deadline; key `scheduled-run:<runId>`).

The handler plans like `crawl.plan` (`planSource(db, sourceId, { probe: false, runId })`, the website's run limits).
- A plan with no detail items stays a failed plan run, with its own reason (as today).
- Otherwise the handler calls `startRunJob`. From there the run is an ordinary run.

**Recording.** The outcome is stored on the website as `schedule_last = { at, outcome, reason?, runId? }`, `reason`
one of `paused | not_certified | not_confirmed | busy`. Starting a run by hand does not touch the schedule.

### 3.3 The file

When a run settles terminal (`completed`, `partial`, `failed` with at least one row, `cancelled` with at least one
row), and its website has a schedule or a webhook, `buildFinalise` enqueues one `run-delivery` job:
- lane background, priority 15, at most 5 attempts;
- key `run-delivery:<runId>`, so a resumed or re-finalised run delivers once per job;
- in its own try/catch, like drift flagging.

**Writing.** The handler first writes the run's file: CSV, JSON and XLSX built by the existing export functions, one
row each in a new `run_files` table (`run_id`, `format`, `bytes` bytea, `rows`, `created_at`; unique `(run_id,
format)`; an existing row is replaced). The file is the snapshot of that moment: a later backfill merging into the
run changes the run page's live download, not the snapshot (the backfill's own finalise delivers again for the
parent, replacing it).

**Downloading.** A snapshot is downloadable two ways:
- with the session, `GET /export/runs/<runId>.<fmt>?snapshot=1` (org-gated as today; the run page's download
  buttons are unchanged and stay live);
- with a signed link, `GET /export/runs/<runId>.<fmt>?expires=<unix s>&sig=<hex>`. It needs no session, and
  `sig = HMAC-SHA256(website webhook secret, "<runId>.<fmt>.<expires>")`. A wrong or expired signature answers 404;
  a website with no secret has no signed links.
- Links in a webhook expire after 7 days.

### 3.4 The webhook

A website has an optional webhook URL and a secret:
- The secret is generated on first save: 32 random bytes, hex, plain text in `sources.webhook_secret`, matching how
  the project stores other customer configuration.
- `sources.rotateWebhookSecret` replaces it.
- The customer sees the secret in Settings with a copy button.

**When.** After writing the file, the `run-delivery` handler POSTs, if a URL is set, a JSON body:

```json
{ "event": "run.finished", "deliveryId": "<uuid>", "runId": "…", "status": "completed|partial|failed|cancelled",
  "scheduled": true, "website": { "id": "…", "name": "…" }, "project": { "id": "…", "name": "…" },
  "startedAt": "…", "completedAt": "…", "rows": 123, "failedItems": 0,
  "files": { "csv": "<signed url>", "json": "<signed url>", "xlsx": "<signed url>" }, "filesExpireAt": "…" }
```

**Headers:**
- `Content-Type: application/json`;
- `User-Agent: robot-platform-webhook/1`;
- `X-Robot-Event: run.finished`;
- `X-Robot-Delivery: <deliveryId>` (the same on every retry of one run's delivery);
- `X-Robot-Signature: sha256=<hex HMAC-SHA256(secret, raw body)>`.

Links are absolute, on `PUBLIC_API_URL` (default `http://localhost:4000`).

**Safety** (a server-side request to a customer-typed URL, new in this codebase):
- **When saving:** `http:` or `https:` only, no credentials in the URL, at most 2,000 characters. A literal IP or
  `localhost` that is loopback, private, link-local, CGNAT, multicast or unspecified (IPv4 and IPv6, including
  v4-mapped) is refused with "Use a public web address."
- **When sending:** the request goes out through `node:http(s)` with a `lookup` that resolves the host and refuses
  those same ranges for every address it returns. The checked address is the one connected to, which also closes a
  DNS-rebinding gap.
- **Request limits:** no redirects (a 3xx is a failed delivery); a 10 s timeout for the whole request; the response
  body is read up to 64 KB and discarded.
- `WEBHOOK_ALLOW_PRIVATE=on` lifts the range check, for tests, the local live check and Docker. It is off by
  default.

**Outcome.** A 2xx response is delivered. Anything else is a failed attempt: retried with the job's backoff (30 s,
doubling), 5 attempts, then given up. Each attempt is one `webhook_deliveries` row: `run_id`, `delivery_id`,
`attempt`, `ok`, `status_code` (nullable), `error` (stored text), `at`.

**What is shown:**
- **Customer, on the run page:** one line under the downloads, from the latest attempt: "Webhook delivered <time>."
  / "Webhook not delivered yet — trying again." / "Webhook could not be delivered." No status code, no host, no
  error text.
- **Staff:** the stored `status_code` and `error` (`showsMoney`).

### 3.5 The API

**`sources.update`** accepts:
- `schedule` (the §3.1 shape, or `null`): validated with zod. An unknown time zone answers "Choose a time zone from
  the list." Saving recomputes `next_run_at`.
- `webhookUrl` (string or `null`): validated per §3.4. The first non-null save generates the secret; `null` clears
  the URL and keeps the secret, so links already sent keep working.

**`sources.rotateWebhookSecret({ id })`** returns the new secret.

**`sources.get`** returns `schedule`, `nextRunAt`, `scheduleLast`, `webhookUrl` and `webhookSecret`.

**`runs.get`** (or the run page's query) returns `delivery: { state: 'delivered' | 'retrying' | 'failed' | null; at }`,
plus, for staff, `statusCode` and `error`.

All are org-scoped through the existing `sourceInOrg` / `runInOrg`. Staff mode is logged through `staff_actions` like
any `sources.update`. `rotateWebhookSecret` is not on the staff deny list: rotating is safe, and it is logged.

### 3.6 What a customer sees

**Settings tab, after "Run limits":**
- **"Schedule":**
  - an Off / Every day / Weekdays / Choose days select (days as toggle chips);
  - a time field;
  - a time-zone select, default the browser's (`Intl.DateTimeFormat().resolvedOptions().timeZone`);
  - Save;
  - below it, "Next run: Monday 27 October, 06:00 (Europe/Berlin)" and the last outcome sentence from §3.2.
- **"Webhook":**
  - a URL field with Save and a Remove action;
  - once saved, "Signing secret" with a masked value, Show / Copy, and "Replace secret";
  - one help line: "We send a POST with the run's results and download links when a run finishes."

**Other places:**
- **Runs table and run page:** a scheduled run reads "Scheduled" where a manual run shows nothing.
- **Run page:** the webhook line from §3.4.

The customer-copy sweep stays green: no "budget", no HTTP codes, no hosts.

## 4. Safety properties

1. A schedule never starts a run of an uncertified, paused or unconfirmed website, and never a second run while one
   is going.
2. Two workers never start the same scheduled run (claim-and-advance under `SKIP LOCKED`).
3. A worker that was down fires each website at most once on return.
4. No webhook reaches a private or loopback address unless `WEBHOOK_ALLOW_PRIVATE=on`. This holds for a DNS name that
   resolves there, and for a redirect.
5. A failed delivery never changes the run's status or rows.
6. A signed link never opens another run's file, and a link is useless after it expires or once the secret is
   replaced.
7. Nothing paid: planning and extraction use certified paths; no AI call anywhere in this feature.

## 5. Testing

**Unit (pure):**
- `nextRunAt` across days, time zones, DST gaps and overlaps (Europe/Berlin, America/New_York, Asia/Kolkata,
  Australia/Lord_Howe's 30-minute shift);
- schedule validation;
- URL validation and the IP-range table (v4, v6, v4-mapped);
- signature and signed-link building and checking.

**API (Postgres, per-file queue):**
- the sweep: claims due websites only, advances `next_run_at`, writes each skip reason, and starts a `scheduled-run`
  job with a planning run labelled `scheduled`;
- concurrency: two sweeps at once start one run;
- the `scheduled-run` handler with a stubbed planner: an empty plan stays failed; a plan with items calls
  `startRunJob`;
- `run-delivery`: writes three `run_files` rows, POSTs to a local receiver with a correct signature, records attempts,
  retries on a 500, refuses a private address without the flag;
- the export route serves a snapshot with a valid signature, and answers 404 when the signature is wrong, expired,
  for another run, or the secret was replaced;
- the router: `sources.update` schedule/webhook validation, `rotateWebhookSecret`, org scoping.

**App:**
- the view functions for the Settings rows and the run page line;
- the copy sweep;
- the route smoke's Settings screen shows both rows; the smoke never saves a schedule.

**Live check (free, local, the item's "done when"):** `packages/worker/src/live-recurring.ts`, keyless:
- **Setup:** a throwaway database, the fixture shop from the run-speed bench, and a local webhook receiver.
- **Website:** one certified fixture website (the bench seed) with a schedule due one minute from now and a webhook
  to the receiver (`WEBHOOK_ALLOW_PRIVATE=on`).
- **Run:** an in-process worker.
- **Must see:** the run starts by itself, completes, writes three files, and the receiver gets one signed POST whose
  three links download the same rows as the run.

## 6. Not in this spec

- Email on completion (queue item "Email, with a local catcher").
- Monthly or cron-expression schedules.
- A schedule per project.
- Delivering files to S3, SFTP or Google Drive.
- Webhook events other than `run.finished`.
- Encrypting the webhook secret at rest.
- The unused `projects.default_schedule` / `output_destination` / `notification_channel` columns stay unused.
