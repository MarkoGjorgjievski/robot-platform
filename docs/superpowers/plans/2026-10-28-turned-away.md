# When a website turns us away — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a turned-away proof-page screenshot retries itself along a 4-try ladder (direct, then a fallback proxy when configured), the customer watches it (state, countdown, try N of 4, one bar), and staff see it in ops.

**Architecture:** the `proof-page-capture` job's handler turns a wall into a `waiting` captures row plus a re-enqueued job with `runAfter`; a new `FALLBACK_PROXY_URL` route is tried and kept (`sources.fallback_proxy_at`) when it works; the app renders the new state from the existing polls with a client-side countdown.

**Tech Stack:** TypeScript ESM, Drizzle/Postgres, tRPC v11, Playwright via `@robot/browser`, TanStack Start + React, vitest.

**Spec:** `docs/superpowers/specs/2026-10-28-turned-away-design.md` — the authority. Every task reads its sections named below.

## Global Constraints

- Customer copy never contains "proxy", "IP", a host, an address, an HTTP code, "CAPTCHA" or money; it names the website by `sources.name`. Staff (`showsMoney` / `viewerSeesMoney`) may read stored sentences and "via fallback proxy".
- Four tries in all (`LADDER_TRIES = 4`); direct waits 2 / 4 / 8 min; fallback: try 3 at once, try 4 after 4 min (spec §3.2).
- Only verdict kinds `refused` and `challenge` are walls; every other failure keeps today's behaviour.
- A try answered from the backoff (no browser) never counts as a try.
- `FALLBACK_PROXY_URL` is never a real provider in tests; live checks use `@robot/browser`'s recording proxy fixture.
- Never `pnpm -r test`; run each touched package's vitest (`npx vitest run` in the package) and `npx tsc --noEmit`.
- Never stage `packages/app/src/routeTree.gen.ts` unless a route file was added (none is planned).
- Commit by explicit path; message trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never touch :3000 / :4000, the `robot-platform-db` data outside throwaway databases/test queues, or start dev servers.
- Never grep with unbounded `.{0,N}` regexes over large HTML files.
- Migration number: `0026` (latest on main is `0025`).

## Review Focus

1. Two products of one website walled together: their retries must not fire in the same second and wall each other again (backoff per route + politeness; retryAt never before the route's backoff end).
2. A customer clicks Try again / removes the card / reloads while a row is `waiting`: the old job must not later overwrite or resurrect anything (fenced writes, cancelled job, newest row per URL wins).
3. A worker restart while rows are `waiting`: the queued job still fires at `retryAt` (it is in Postgres), and a `waiting` row whose job vanished is closed `stalled`, never left counting down forever.
4. `DEFAULT_PROXY_URL` or an own `proxy_url` set: no fallback is tried, and an existing website without `fallback_proxy_at` resolves exactly as before (no behaviour change for anyone today).
5. The countdown reaching 0 before the poll sees `capturing`: the card reads "Trying now…", never a negative time.

---

### Task 1: Routes, backoff per route, scheduling primitives (api, scraper, browser, db)

Spec §3.2 (scheduling primitive only), §3.3, §3.4.

**Files:**
- Create: `packages/db/drizzle/0026_*.sql` (+ journal/snapshot via `pnpm --filter @robot/db exec drizzle-kit generate`), modify `packages/db/src/schema.ts` (`sources.fallbackProxyAt: timestamp('fallback_proxy_at', { withTimezone: true })`).
- Modify: `packages/api/src/jobs/enqueue.ts` (opts `runAfter?: Date`), `packages/api/src/jobs/queue.ts` insert (run_after / expires_at from it).
- Modify: `packages/scraper/src/domain-lock.ts` — `reportVerdict`, `backoffAnswer`, `backoffRemainingMs`, `backoffVerdict` accept an optional `route: 'direct' | 'fallback'` (default direct; key `host` / `host via fallback`). Existing callers unchanged.
- Create: `packages/api/src/proxy/fallback.ts` — `fallbackProxyUrl(env)`, `guessCountry(url): string | null` (first path segment `xx` or `xx-yy` whose first part is a COUNTRIES code; else ccTLD incl. `co.uk`→`gb`, `com.au`→`au`; only COUNTRIES codes), `fallbackFor(site: { proxyUrl; country; fallbackProxyAt }, url, env): { available: true; country: string | null } | { available: false; reason: 'none' | 'own' | 'default' | 'already' | 'no-country' | 'unusable' }`, `markFallbackKept(sourceId, country)` (fenced update per spec §3.3).
- Modify: `packages/api/src/proxy/browser-profile.ts` — `Site` gains `fallbackProxyAt`; `buildProfile(site, defaultUrl, fallbackUrl = process.env.FALLBACK_PROXY_URL, opts?: { via?: 'fallback'; country?: string })`: precedence own → default → fallback when `fallbackProxyAt` set or `opts.via==='fallback'` → direct; `networkOf` reports `proxy: 'fallback'` (type widened) with the masked fallback address. `browserProfileForSource(db, id, opts?)` passes through.
- Modify: `packages/api/src/proxy/website-session.ts` — `forWebsite(sourceId, session, opts?: { via?: 'fallback'; country?: string })`.
- Tests: `packages/scraper/src/domain-lock-backoff.test.ts` (route keys independent), `packages/api/src/proxy/fallback.test.ts` (new), `packages/api/src/proxy/browser-profile.test.ts` (precedence; existing cases unchanged), `packages/api/src/jobs/enqueue.test.ts` (runAfter delays the claim; expires window starts at runAfter).

- [ ] Write failing tests for each item above (unit, Postgres where the existing file already uses it).
- [ ] Implement; run `npx vitest run` in `packages/scraper`, `packages/api` (the touched files, then the whole api suite in the background), `packages/db` tsc.
- [ ] `npx tsc --noEmit` in db, scraper, api.
- [ ] Commit.

**Interfaces produced:** `enqueue(tx, type, payload, { key, priority, runAfter })`; `reportVerdict(host, v, nowFn?, route?)` — keep the existing positional `nowFn` and add `route` as an options-last param: `reportVerdict(domain, verdictOrKind, nowFn = now, route: Route = 'direct')`; `backoffAnswer(url, nowFn = now, route = 'direct')`; `type Route = 'direct' | 'fallback'` exported from `@robot/scraper`; `fallbackFor`, `guessCountry`, `markFallbackKept` from `packages/api/src/proxy/fallback.ts`; `forWebsite(id, session?, { via, country })`.

### Task 2: The ladder in the proof-page capture (api)

Spec §3.1, §3.2. Consumes Task 1.

**Files:**
- Modify: `packages/api/src/verify/proof-page-capture.ts` — `ProofPageMeta` `waiting` variant and new optional fields; `LADDER_TRIES = 4`; a pure `nextTry({ attempt, route, fallback: boolean, backoffMs }): { attempt; via; waitMs } | 'give-up'` exported and unit-tested against the spec table; `runProofPageCapture` takes `capturing` or `waiting` rows, writes `capturing` with `attempt`/`firstStartedAt`, opens `forWebsite(..., { via, country })` for a fallback try, and on a wall writes `waiting` + enqueues the next job (`runAfter`, key `capture:<id>:<attempt>`, `captures.job_id` updated) in one transaction, or `failed` + `gaveUp` after try 4; a backoff answer re-schedules at the backoff end without counting; an ok fallback try calls `markFallbackKept`; walls on a fallback try report to the `fallback` route's backoff. `resolveStalledProofPage` handles `waiting` (job not live and `retryAt` + `PROOF_PAGE_STALL_MS` past → `failed`/`stalled`). `latestProofPageCaptures` and `ProofPageCaptureState` carry `waiting` (`retryAt`, `attempt`, `of`, `via`) and failed `gaveUp`/`attempts`/`firstStartedAt`. `startProofPageCapture` cancels the queued job of a `waiting` row for the same source+URL (superseded; use `packages/api/src/jobs/cancel.ts` helpers or a fenced `UPDATE jobs SET status='cancelled'` matching what cancel.ts does).
- Modify: `packages/api/src/routers/sources.ts` `proofPageCapture` output for the new fields (customers get `via`; never an address).
- Modify: the fences elsewhere that read `status === 'capturing'` for proof pages if any close/retry rows (grep `'capturing'` in `packages/api/src`).
- Tests: `packages/api/src/verify/proof-page-capture.test.ts` (ladder with fake session throwing `CaptureProblemError` refused: rows and jobs after each try; fallback path with env + fake session asserting the `via` passed; give-up; backoff answer not counting; stalled waiting; supersede cancels), router shape tests where `proofPageCapture` is already tested (`sources-marks.test.ts` / `site-scope.test.ts`).

- [ ] Failing tests → implement → api suite + tsc → commit.

**Interfaces produced:** `ProofPageCaptureState = { captureId; status: 'capturing'|'captured'|'failed'|'waiting'; error?; verdict?; title?; retryAt?; attempt?; of?; via?; gaveUp?; attempts?; firstStartedAt?; startedAt? }` (add `startedAt` for the capturing timer); the same fields on `sources.proofPageCapture`'s answer.

### Task 3: Staff — undo, Network panel, ops flags (api, app)

Spec §3.3 (Undo), §3.5.

**Files:**
- Modify: `packages/api/src/routers/sources.ts` — `update` input `fallbackProxy?: false` (operators only, like `proxyUrl`), clears `fallback_proxy_at`, logs staff action "Set the website to load directly" through the existing proxy logging path; `get` gives staff `fallbackProxyAt`.
- Modify: `packages/api/src/routers/ops.ts` `websites` — `turnedAway` and `fallbackProxyAt` per row (one query over captures from the last 24 h, newest per source+URL, `metadata->>'status' = 'waiting'` or failed with `gaveUp`); `fallbackConfigured: boolean` once per answer so the app can choose the badge.
- Modify: app Settings → Network (staff) panel (find it: grep "Network (staff)" in `packages/app/src`) — the automatic switch line with **Go direct again**; ops websites list (`packages/app/src/routes/_app/ops/websites/`) — the badges of spec §3.5.
- Tests: the isolation classification (`packages/api/src/isolation/procedure-classes.ts` unchanged unless a procedure is added; run `npx vitest run src/isolation`), `sources.update` operator-only + log test next to the existing proxy ones, `ops.websites` shape test next to existing ones, app view-function tests for the badge text.

- [ ] Failing tests → implement → api + app suites + tsc → commit.

### Task 4: The customer screen (app)

Spec §3.6. Consumes Task 2's state shape.

**Files:**
- Modify: `packages/app/src/lib/site/proof-capture-state.ts` (map the new fields; customer vs staff wording), `packages/app/src/lib/site/use-proof-captures.ts` (poll 5 s while `waiting`, 2 s while `capturing`), `packages/app/src/lib/site/verification-model.ts` `rowStatus` wording (spec §3.6 Rows; update `verification-model.test.ts:549`).
- Create: `packages/app/src/lib/site/turned-away.ts` — pure functions: `cardWords(capture, name, nowMs)` → `{ tone; icon: 'spinner'|'clock'|'alert'; lines: string[]; actions: ('swap'|'retry')[] }`; `barWords(cards, name, nowMs)` → string | null; `mmss(ms)`; `minutesSpent(first, last)`. All copy from spec §3.6 verbatim.
- Create: `packages/app/src/lib/use-now.ts` — one shared 1 s ticker hook (`useNow(active: boolean)`).
- Modify: `packages/app/src/routes/_app/projects/$project/sites/$site/index.tsx` — `ProductView` renders `cardWords` (spinner/clock icons from lucide, already in the app), the sentence unclamped, **Swap product** (removes the card via the existing remove handler and opens Find products with the listing filled when known — find how the listing bar is opened today), and the bar above the table.
- Tests: `packages/app/src/lib/site/turned-away.test.ts` (every state, 1/2/3 products, given up, countdown 0 → "Trying now…", minutes rounding, no "proxy" in any customer string), `proof-capture-state.test.ts`, `verification-model.test.ts`; the customer-copy sweep test still passes.

- [ ] Failing tests → implement → app suite + tsc → commit.

### Task 5: Live check, route smoke, docs

Spec §5 (live check, route smoke). Consumes all.

**Files:**
- Create: `packages/worker/src/live-turned-away.ts` (model it on `packages/worker/src/live-proxy.ts` and `live-monitoring.ts`): throwaway database, fixture shop page that walls direct loads for its first N requests and passes requests arriving through the recording proxy (find how the fixture proxy marks requests, e.g. a header it adds, and key on that), an in-process worker on its own queue, short waits via `ROBOT_BACKOFF_FIRST_MS` plus a ladder-wait env for the check only (e.g. `PROOF_LADDER_WAIT_SCALE` read once, default 1; document it as test-only). Scenarios: (a) fallback configured: walls → waiting rows → fallback try captured → `fallback_proxy_at` set → a second capture goes through the proxy; (b) none configured: four walls → `gaveUp`. Writes `docs/testing/results/2026-10-28-turned-away/live-turned-away.json`.
- Modify: `packages/app/src/routes-smoke.test.ts` wall step to the new card (state + countdown shape), keeping its other assertions.
- Modify: `CLAUDE.md` (env `FALLBACK_PROXY_URL`, the command, a Key Technical Decisions line), `.env.example`, `docker-compose.yml` / stack env passthrough for `FALLBACK_PROXY_URL`, `docs/handoff.md`, `docs/queue.md` (Done entry), the spec's Status/Proven/Deviations.

- [ ] Write and run the live check (free); look at its output.
- [ ] Route smoke on the isolated pair (controller runs it).
- [ ] Docs; commit.
