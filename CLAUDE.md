# Robot Platform — AI-Native Web Scraper

## Start here

**[docs/handoff.md](docs/handoff.md)** — current state, what not to redo, open decisions, and the next work. Read it before starting.

## Project Overview

AI-powered web scraping platform for in-house use. Customers request data from websites — we configure extractors with minimal manual effort. AI agents handle schema discovery, selector generation, and extraction. Humans review and refine.

- **Monorepo**: pnpm workspaces + Turborepo
- **Architecture docs**: [docs/extraction-architecture.md](docs/extraction-architecture.md), [docs/project-overview.md](docs/project-overview.md)

## Package Map

| Package | Purpose | Key Tech |
|---------|---------|----------|
| `@robot/browser` | Page capture, popup dismissal, network interception | Playwright |
| `@robot/agent` | LLM orchestration — schema discovery, selectors, validation | Anthropic Claude, Ollama |
| `@robot/scraper` | Pipeline, XPath executor, structured data extraction | Multi-source extraction chain |
| `@robot/app` | The customer app — login, org switcher, projects, and a project's websites, Fields and Output, a website's Verification / Extract / Runs / Settings, and the organisation's Runs, Usage, Settings and Account; plus a read-only ops mode for staff at `/ops`, from which staff can also work inside a customer's org; :3000 | TanStack Start + Router/Query (SSR), Tailwind v4, shadcn/ui + Base UI |
| `@robot/db` | Database schema + migrations | Drizzle ORM, PostgreSQL |
| `@robot/api` | Type-safe API | tRPC v11, Zod, superjson |
| `@robot/api-server` | HTTP host — mounts the tRPC routers over HTTP, serves captures; never starts a browser | Hono |
| `@robot/worker` | The capture worker — claims jobs from the Postgres `jobs` queue and owns every browser (Verify, proof-page captures, checks, runs, planning, request-time page reads) | Playwright via `@robot/api` jobs |

## Extraction Chain (priority order)

0. **Customer-verified paths** — a Source with a verified schema (the Verification tab of a website inside a project) runs its certified paths only; nothing below applies to it. A miss leaves the cell empty and is counted.
1. **Mechanical** — flatten intercepted APIs + JSON-LD + meta tags (free, instant)
2. **Cached API paths** — replay stored dot-notation paths against fresh API JSON (free)
3. **Cached XPaths** — execute stored XPath selectors on live page (free)
4. **Cross-validation** — agreement among a field's stored paths sets confidence; every value must corroborate against the rendered page (free)
5. **AI API analysis** — Claude reads raw API JSON, finds field values + paths (~$0.03)
6. **AI XPath generation** — Claude generates XPath selectors for DOM extraction (~$0.05)
7. **Save to cache** — store all paths with hit/miss stats for future runs

## Commands

- `pnpm dev:all` — start the api-server (:4000), the app (:3000) and the worker (`@robot/worker`); the app is no use without the api-server, and nothing loads a page without the worker (the api-server never starts a browser)
- `pnpm dev:all:noai` — same as `dev:all`, but forces `ANTHROPIC_API_KEY` unset in the api-server process (`--env-mode=loose`, since turbo's default strict env mode otherwise swallows an ad-hoc `ANTHROPIC_API_KEY=` shell override). Use this to test the mechanical-only / AI-unavailable path
- `pnpm db:adopt-default -- --email <email>` — make that user the owner of the seeded `default` org, so an existing checkout's projects are visible after a first sign-in (sign-in never adopts anything itself)
- `pnpm -r test` — the green gate (Tier 1 fixture replay + unit tests). Needs Postgres running
- `pnpm test:judge` — calibrate the Tier 2 judge against known answers (live, paid)
- `pnpm test:liveness` — do the corpus fixtures still match the pages their URLs serve? (live, free)
- `pnpm test:ui:app` — `@robot/app` route smoke: signs in through `/login` as a throwaway address, walks every screen in both themes, screenshots into `docs/testing/screens/app-*.png`; needs `pnpm dev:all` running — the api-server, the app and the worker, which takes the smoke's captures (live, free)
- `pnpm test:ui:staff` — staff-access smoke: a throwaway operator works on a throwaway customer's website as staff, and the customer reads the log; screenshots into `docs/testing/screens/staff-*.png`. Runs only against an isolated pair (keyless api-server on :4100 with `OPS_EMAILS=staff-smoke-op@example.com APP_ORIGINS=http://localhost:3100`, the app on :3100 with `VITE_API_URL=http://localhost:4100`, and its worker — `JOB_QUEUE=isolated-4100 WEBSITE_CHECKS=off` on both the api-server and the worker, and `RECURRING_RUNS=off` on the worker; see the top of `packages/app/src/staff-smoke.test.ts`), never `pnpm dev:all` (live, free)
- The isolated pair's worker: `cd packages/worker && ANTHROPIC_API_KEY= JEV_SHADOW= TYPESAFE_API_KEY= WEBSITE_CHECKS=off RECURRING_RUNS=off JOB_QUEUE=isolated-4100 WORKER_STOP_FILE=<scratch>/worker.stop npx tsx src/index.ts`; stop it by creating the stop file (e.g. `touch <scratch>/worker.stop`) — it gives running jobs back, closes its browsers and exits 0 (on Windows a kill would leave its Chromium running)
- `cd packages/worker && npx tsx src/bench/run-speed.ts --label <l> --sites <n> --pages <n> --runs <n> --browsers <n>` — the run-speed benchmark: a local fixture shop, a throwaway database (created and dropped), its own queue; writes `docs/testing/results/2026-10-23-run-speed/<l>.json` (live, free; one Chromium-heavy job at a time)
- `cd packages/worker && npx tsx src/bench/real-sites.ts [sourceId …]` — today's capture vs lean on certified websites' latest product pages, read only (a read-only database session; live, free)
- `cd packages/worker && npx tsx src/live-recurring.ts` — the recurring-extraction live check: a throwaway database, the fixture shop, a local webhook receiver, an api-server on :4310 and an in-process worker; a scheduled run fires, writes its three files and posts one signed webhook; writes `docs/testing/results/2026-10-24-recurring/live-recurring.json` (live, free)
- `pnpm --filter @robot/worker exec tsx src/live-check.ts [url …]` — free live check of reachability and the listing check through an in-process worker on its own queue (keyless; no Jev)
- Keep `JEV_SHADOW` unset in the worker (and the api-server) a `pnpm test:ui:app` or `pnpm test:ui:staff` run talks to: the worker takes the captures the smokes trigger, and with it set sends real, paid Jev readings for them
- `pnpm --filter @robot/api dogfood` — Tier 2 live dogfood + LLM judge; writes `docs/testing/results/`. Needs `ANTHROPIC_API_KEY`
- `pnpm --filter @robot/scraper exec tsx src/test-run.ts "URL"` — CLI test run
- `HEADFUL=1 pnpm --filter @robot/scraper exec tsx src/test-run.ts "URL"` — with visible browser
- `pnpm --filter @robot/api exec tsx src/judge-run.ts <runId> [--max-items N] [--max-usd X] [--fields a,b] [--tiles N] [--dry-run]` — judge a completed run's stored values against freshly captured pages; writes `docs/testing/results/`, no DB writes. Needs `ANTHROPIC_API_KEY` (paid, ~$0.0086 per judge call, default cap $5) unless `--dry-run`
- `docker compose up -d --build` — the whole stack in Docker (spec 2026-10-23 docker-compose), compose project `robot-stack`: Postgres, a one-shot migrate, api-server, worker (Playwright Chromium), app and a nightly backup. App http://127.0.0.1:3200, api http://127.0.0.1:4200, Postgres 127.0.0.1:5442, published on 127.0.0.1 only (`STACK_APP_PORT`, `STACK_API_PORT`, `STACK_DB_PORT`; changing `STACK_API_PORT` needs `--build`, the app bakes it in). Open it as 127.0.0.1, not localhost: the session cookie is per host, so localhost would collide with `pnpm dev:all`; its own volumes; never touches `robot-platform-db` or `pnpm dev:all`. Keyless: no service receives `.env` (compose reads it only for `STACK_*` values); keys and switches (`ANTHROPIC_API_KEY`, `TYPESAFE_API_KEY`, `JEV_SHADOW`, `WEBSITE_CHECKS`, `OPS_EMAILS`) only from an optional, gitignored `./stack.env`. `docker compose down` stops it (`-v` also drops its database and captures). Smoke: `docker compose --profile test up -d` (adds a static fixture page), then `node docker/smoke/e2e.mjs` and `node docker/smoke/ui.mjs <screenshot dir>`
- Stack backups — the `backup` service `pg_dump`s nightly at `STACK_BACKUP_AT` (UTC, default 03:00) into `./backups` (gitignored), keeping `STACK_BACKUP_KEEP` (14). On demand: `docker compose exec backup sh /scripts/backup.sh`; restore into a new database: `… sh /scripts/restore.sh /backups/<file>.dump <new-db>`; replace the live one (stop `api` and `worker` first; the old one is kept as `robot_platform_before_<stamp>`): `… sh /scripts/restore.sh --replace /backups/<file>.dump`; restore test (fresh dump → fresh database → every table's row count and content hash compared): `… sh /scripts/restore-test.sh` (with a dump argument it checks that dump against the current database instead). In Git Bash prefix with `MSYS_NO_PATHCONV=1`

## First-time setup

1. `pnpm install`
2. `pnpm --filter @robot/browser exec playwright install chromium`
3. Start Postgres 16 (see `.env.example` for the Docker one-liner)
4. `cp .env.example .env` and fill in `ANTHROPIC_API_KEY`
5. `pnpm db:migrate && pnpm db:seed`

Node ≥20.12 is required (`process.loadEnvFile`). pnpm version is pinned via `packageManager`.

## Environment

Config lives in a repo-root `.env` (gitignored; template in `.env.example`). `@robot/db` loads it on
import, so tests, CLIs and the api-server all pick it up without exporting anything in the shell.
Variables already set in the shell take precedence over `.env`.

- `ANTHROPIC_API_KEY` — Claude API key (falls back to Ollama if not set)
- `DATABASE_URL` — PostgreSQL connection string
- `OPS_EMAILS` — comma-separated emails that land in ops mode (staff), matched case-insensitively and trimmed; empty or unset means nobody is an operator
- `APP_ORIGINS` — comma-separated origins the api-server accepts (CORS); default `http://localhost:3000`. An isolated pair (app :3100 → api :4100) sets its own
- `TYPESAFE_API_KEY` — TypeSafe (Jev) API key; with `JEV_SHADOW=1` set too, enables a Jev reading after each proof-page capture (spec 2026-10-16). Either missing, no reading runs
- `JEV_SHADOW` — set to `1` to turn on Jev at Verify, in shadow; needs `TYPESAFE_API_KEY` too
- `JEV_DAILY_READINGS` — readings per UTC day across the worker, which takes every proof-page capture (one reading per capture); default 2000
- `WEBSITE_CHECKS` — set to `on` to run the free scheduled website checks every hour (proof pages + listing sample, no AI); off by default; read by the worker (it owns the schedule)
- `JOB_QUEUE` — the queue the api-server enqueues to and the worker claims from; default `default`. Tests use their own per file; the isolated smoke pair uses `isolated-4100`
- `WORKER_BROWSERS` — at most this many Chromium processes in the worker at once; default 3 (at least 1); one is kept for interactive work and, with 3 or more, one for background work. Raising it (with `WORKER_RUNS`, e.g. 6 / 4) runs more websites at once
- `WORKER_INTERACTIVE` — interactive-lane slots (proof-page captures, reachability, listing check, planning…); default 3
- `WORKER_CONCURRENCY` — background-lane slots (Verify, drift, coverage, website checks); default 2
- `WORKER_RUNS` — runs extracted at once, each a website, each one page at a time; default 1 (the gate lets runs hold at most `WORKER_BROWSERS − 2` when `WORKER_BROWSERS ≥ 3`, else today's `WORKER_BROWSERS − 1` rule, so a browser always stays free for a customer's Verify)
- `RUN_CAPTURE` — `full` makes certified runs take today's full capture (no lean captures; pictures still off); unset: lean (spec 2026-10-23 run speed)
- `WORKER_MIN_FREE_MB` — no job claimed and no browser started while free memory is under this; default 1024
- `WORKER_LEASE_MS` — a claimed job's lease, renewed every quarter lease; a crashed worker's job is reaped once it lapses; default 60000
- `WORKER_SHUTDOWN_MS` — how long a stopping worker waits for running jobs before it gives them back; default 25000
- `WORKER_RETRY_MS` — the first retry's delay, doubled per attempt; default 30000
- `WORKER_NAME` — the worker id's prefix (default the hostname)
- `WORKER_STOP_FILE` — a path; when that file appears the worker stops cleanly (the Windows smokes' way to stop it)
- `WEBSITE_CHECK_DAYS` — days between a website's scheduled checks (a Verify or a check that reads its pages moves the next one on); default 3
- `RECURRING_RUNS` — the worker's schedule sweep (every minute; starts each website's scheduled run, spec 2026-10-24); on unless set to `off`. The isolated smoke pair's worker, and any worker on a database it shares, sets `off` (the sweep is not tied to a queue)
- `WEBHOOK_ALLOW_PRIVATE` — set to `on` to let webhooks reach loopback and private addresses (tests, the local live check, Docker); off by default. Read by the api-server (saving) and the worker (sending)
- `PUBLIC_API_URL` — the api-server as a webhook receiver reaches it; the signed file links in a webhook are built on it; default `http://localhost:4000`. Read by the worker. Webhooks go out directly: never set `NODE_USE_ENV_PROXY` on the worker (the address check would apply to the proxy)

## Key Technical Decisions

- XPath over CSS selectors — supports sibling traversal, ancestor access, text matching
- Multi-path extraction — each field has multiple ranked extraction paths, cross-validated
- Domain intelligence cache — enriched over time, never overwritten. Always consulted (no consecutive-failures reset gate; removed in v1.1b). Conservative per-path prune only (≥5 uses & ≤10% hit rate; max 5 paths/field); degradation is flagged for human review, never auto-reset.
- Verification-first sources (2026-09): the customer defines fields + expected values on three URLs; paths certify when, together, they cover every proof page a field is checked on and none is wrong on any (three to six pages; 2026-09-17); extraction at scale runs certified paths only.
- Proof-page coverage (2026-10-10): after a passing Verify a free background check samples twenty listing products with the certified paths and the Verification tab says per field where they came back empty, with "Use as proof page"; a cell marked "Not on this product" is a checked page whose answer is nothing, so a path that invents a value there never certifies.
- Shown on the page (2026-10-12): a run flags every certified value the product's page does not show (free, at extraction time); the run page counts and names them; at Verify a Title that is not the page's heading never reads agreed and a typed value the page does not show warns; the judge report measures the flag against its verdicts.
- A website's default values (2026-10-13): a binding carries a default per field; a run writes the certified path's value where one reads and the default where every path misses; Verify treats a blank cell on such a field as a default cell and certifies by default only, free, when nothing reads the field; defaulted values are counted on the run page, read as empty by drift and the coverage check, shown in ops and judged like any value.
- The variant the address names (2026-10-14): every capture knows its page variant; a certified path reads an array by it with `[page]` (the one matching entry or nothing, never entry 0); Verify proposes and prefers that form; a page that does not show the variant its address names fails its capture with one sentence.
- Jev at Verify, in shadow (2026-10-16): with JEV_SHADOW=1 and a TypeSafe key, each proof-page capture gets one Jev reading (screenshot once in state): which candidate each ambiguous text/money/number field is, which variant the page shows. Shown where Jev differs ("Jev reads …"), recorded against what the customer verifies, never applied. Staff-only: a customer never receives or sees a reading.
- Captures without overlays (2026-10-19): a capture closes what the page put over the product and never opens anything over it itself. One overlay definition (`packages/browser/src/overlays.ts`); the expand pass skips layer triggers, clicks each control once and closes any overlay it opened; dismissal never clicks a variant, settings or navigating control, closes the topmost layer by its close word and hides overlays every round; after a final pass the page scrolls to the top, and an overlay still at the centre is one warning line, never a field on the result. Page code goes through `pageScript()` (esbuild `__name` shim). The tabs step stays OFF by default (`CaptureOptions.expandTabs`, default false) until a free replay of certified sources shows no drift.
- Verify dead ends (2026-10-17): a field marked "not on this product" on every proof page passes as not on this website (no path, left empty); the shop's name (og:site_name, the offer seller) can be a brand; a page where the value was found reads green even while another page fails, but a page covered only by a path that reads just that one page reads ambiguous instead; a marked sku/brand/rating line stores its value without "Label:", and a mark reads an image's src; a number shown with decimals matches more precise page data; the address warning's re-verify is free, with no AI call; Verify's cost label is $0.06 per AI-reachable field per proof page, staff only; a customer sees no money anywhere in the app (`showsMoney`, Marko 2026-10-17).
- Verify never fails silently (2026-10-20): every refused, failed or stalled Verify and every failed proof-page screenshot ends with one customer sentence in the Verify bar or on the card/cell it concerns; a server refusal names the field and the product number (`error.data.verifyProblems`), never an address; one field's AI failure fails that field only (`ai_unavailable`); a failed run never replaces the last completed results on screen (`verificationStatus.failedRun`); a value found in another place on a product reads `elsewhere`, not "not found".
- The finder reads product links (2026-10-20): "Find products", the coverage check and the walk's cross-check share one rule (`findProductGroup`, `readListingPage` in `@robot/scraper`): a product link sits on a card with an image and a price (or, with no priced cards, on one of six or more image cards), one product is one path (query dropped, except id-like parameters on literal or script paths), shapes are per path segment, a JSON-LD ItemList counts, and a page with none says "No products found on this page."; the finder loads more of a listing, bounded (three rounds, ~10 s).
- Backups from more than one source (2026-10-20): Verify keeps at most two certified paths per source (one API response, the page's JSON-LD, its meta tags) and fills the rest from other sources; the page's HTML (XPath) counts as one source too (2026-10-21); a multi-layout cover is never capped or warned on; certified API paths carry an optional `container` (the response they read), shown in ops; ops warns only when every path still reads one source; a Verify's certified paths always stay in the domain store.
- Customer copy (2026-10-21): stored capture sentences stay as they are (drift and diagnosis read them); the app rewords them at display time with `captureWords(text, staff)` so a customer never reads a host, an address, an HTTP code, "CAPTCHA" or a library error, while staff (`showsMoney`) see the stored text; failed buttons show `mutationErrorText`; "budget" is "Run limits" / "page limit"; a sweep test fails on those words in shipped customer copy.
- Websites change (2026-10-21): a failed re-verify never stops a website whose last good paths still read its proof pages — the field is held (`field_holds`) until the customer edits it or a Verify passes; price, rating, review count and stock refresh their expected values automatically when the same certified path reads a valid, shown, in-range value on two or more pages (`value_refreshes`, then a free re-verify; never AI; never title/brand/SKU/description); a free check runs after a failed Verify and, with `WEBSITE_CHECKS=on`, every few days; the customer sees "Needs attention" and one sentence naming what needs them; staff see holds and automatic updates in ops.
- Capture worker (2026-10-23): all browser work runs as jobs in the `jobs` table (`@robot/api` `src/jobs`), claimed by `@robot/worker` with leases, retries and lanes (interactive / background / runs; one browser always kept for interactive work); the api-server cannot launch a browser; status rows carry `job_id` and stall rules ask the job; tests use a per-file `JOB_QUEUE`.
- Run speed (2026-10-23): a certified run captures each product lean — no popup rounds, no pictures, the certified XPaths read in the live tab after the expand pass — and takes today's full capture of the same page only on a missing field, a value not shown, a non-wall verdict, or its first two (check) items; any disagreement, or three rescues in a row, switch that run to full; a field whose misses (or, separately, whose not-shown values) the full capture confirmed three times is trusted for that reason only. Everything written on a fallback comes from the full capture. A website with a variant plan always takes the full capture. Politeness spaces page starts 2 s apart per host (one page at a time); several websites run at once (`WORKER_RUNS`, default 1 — raising it is Marko's call, about 1 GB free memory per run), and runs leave one browser for interactive work and one for Verify. `RUN_CAPTURE=full` turns lean off.
- Recurring extraction (2026-10-24): a website may carry a weekly schedule (ISO days, a wall time, an IANA time zone; DST gaps run at the end of the gap, overlaps once) and a webhook. The worker's minute sweep claims due websites (`FOR UPDATE SKIP LOCKED`, `next_run_at` moved on from now, so a worker that was down fires once) and starts a `scheduled-run` (plan at the run limits, then the run) unless the website is paused, uncertified, an unconfirmed listing, or still running — the reason is shown in Settings. A settled run of such a website (finalised, or closed by the job layer with rows) gets a `run-delivery` job: CSV/JSON/XLSX snapshots in `run_files`, then one signed `run.finished` POST (`X-Robot-Signature`, the same `X-Robot-Delivery` id on every retry — receivers dedupe on it) with signed links (7 days) that open the snapshot without a session. Webhooks never reach private or loopback addresses (checked at save and on every resolved address at send; no redirects; 10 s; 64 KB) unless `WEBHOOK_ALLOW_PRIVATE=on`; five attempts, never touching the run. A sample never delivers; a backfill re-delivers its parent. `RECURRING_RUNS=off` stops the sweep.
- Popup auto-dismissal — up to 4 rounds of whole-name and close-word clicks (each counts only if it worked) and a removal pass every round, then one more pass just before the screenshot (2026-10-19)
- Provider abstraction — Anthropic and Ollama supported, auto-detected from env
- `"type": "module"` in all packages
- History: the old `@robot/dashboard` (a Vite + TanStack Router/Query SPA) was deleted 2026-10-07, cut-over plan 6 — `@robot/app` had reached parity with it. Before that it replaced the original Next.js dashboard in v1.5 (commit 0937bad, 2026-05-15) — older docs/commits that say "Next.js 15 / Server Components / App Router" are stale.
- Customer routes live under `/projects/…` in `@robot/app` — a project's websites, Fields and Output, and a website's Verification / Extract / Runs / Settings. `/p/…` and `/domains/…` were the old dashboard's routes and have no equivalent in `@robot/app` (the dashboard was deleted at cut-over, plan 6). Operator views are under `/ops/…` — a read-only ops mode for staff (`OPS_EMAILS`), rebuilt in `@robot/app` at cut-over: one row per customer website across every org, and a website's certified paths in customer words with real run hit rates. Ops itself stays read-only; staff change a customer's data only by entering their org (next line).
- Staff access (2026-10-07): an operator's session can enter a customer org from ops (`ops.enterOrg`), 8 hours max; deny-list in `packages/api/src/auth/staff-guard.ts`; every staff-mode mutation is logged in `staff_actions` and shown in ops and the customer's Settings.
- Field name and type live on the project's dataset (the contract); a website owns only its location hints, proof pages, expected values and certification, which is current per field (2026-09-09, spec section 4).
- `@robot/app`'s actual stack: shadcn/ui + Base UI on Tailwind v4, Geist/Geist Mono, dark and light themes (dark default)

## Autonomous runs

Standing approval (Marko, 2026-10-20). Claude works `docs/queue.md` from the top: for each item it
writes the spec and plan, executes them (subagent-driven, reviewed per task), and merges to `main`
and pushes — no approval needed between items.

Nothing merges until, on the branch:
1. every task's tests passed and its review (and fix rounds) are clean;
2. the full test run and type-check of every touched package pass;
3. a whole-branch review on the most capable model has no open Critical or Important finding;
4. if `@robot/app` or `@robot/api` changed: the route smoke passes against an isolated pair (keyless
   api-server on :4100 with `JEV_SHADOW` empty, the app on :3100), run from the branch;
5. if capture or extraction changed: a free live check, and Claude has looked at the screenshots.
Then fast-forward `main` and push.

Hard stops — write the item under "Needs Marko" in `docs/queue.md` with the reason and move on:
- paid AI spend over $2 for one feature (estimate before; free checks are fine);
- changing or deleting Marko's projects or any customer data; creating users or organisations;
- starting, stopping or restarting Marko's dev servers;
- a product decision the spec cannot settle (wording, pricing, what a customer sees);
- a gate above that fails and cannot be fixed.

At the end of a run, a short digest (Claude Docs page): what shipped, what failed, what needs Marko.

## Conventions

- Commits are fine when the work is done — use focused, single-purpose commits
- Prefer proper fixes over workarounds
- All new packages use ESM (`"type": "module"`)
- Legacy code preserved in `/Users/marko/Documents/robot-platform-legacy/`
