---
name: Session handoff — state, decisions, and what to do next
description: Where the project stands as of 2026-08-24 and how to pick it up. Read this before starting.
type: project
---

# Handoff — 2026-08-24

## Read this first

**Do not start another fix-and-dogfood cycle.** The last correctness push converged on the corpus rather than on reality, each round cost real money, and half the remaining defects are design decisions rather than bugs (see *What NOT to redo* below). If you're tempted to chase extraction-quality numbers, don't — the next work is feature implementation against the roadmap.

**`api-param` pagination is implemented and gated offline, but NOT live-proven.** The `feat/api-param-pagination` branch built it end to end — proving a paging parameter by experiment (probe a page-1-identified JSON endpoint with candidate query params, reject any candidate whose response overlaps page 1's items too much) before it is ever used or cached — and gated it with unit tests plus a Tier 1 fixture-server test that fails if page 2 re-serves page 1. The one live run authorised to prove it (`newegg-gpus-live`, 2026-08-24, run `c889faea-3417-4d36-97cd-1907e55653af`) **fell through to the existing `mechanical` (`url-pattern`) pagination — `api-param` never got a candidate to try.** Do not read "API pagination delivered" as covering the live case; it covers only the offline-gated path. Full detail: "`api-param` pagination — live proof (2026-08-24)" below.

**The multi-page pagination walk is now live-proven, and it live-proved a real bug on the same run.** `crawl.plan` against `abebooks-pagination` walked listing pages 1, 2 and 3, wrote `domain_intelligence.pagination_config` for the first time in this repo's history, and replayed it from cache on a second plan. But the URLs it walked to on AbeBooks were wrong — `deriveTemplate` chose the `ds` query parameter as the page cursor and pinned `p=1`, when `p` is AbeBooks' actual pager, so pages 2 and 3 re-requested page 1 in substance. The stray items that leaked past dedupe (2 and 1, against page 1's 30) were enough to satisfy the `gained > 0` verification gate, so a broken template got cached and then had to be purged by hand. Full detail, evidence, and the live cancel/resume proof: see "Pagination walk + caching — live proof (2026-08-21)" below.

The v2 crawler (listing → detail, two phases) is built and **merged into `main`** (merge commit `3908780`, 2026-08-21). It has been run against a live site end to end twice: once exposed a real shared-browser lifecycle bug in `runExtraction` (7/8 items failed), once after the fix ran clean (8/8 items done, CSV export shows all 8 rows). A follow-up review round found and fixed the identical bug pattern one file over (`runAnalysis` in `analysis-orchestrator.ts`) and made the "whoever launches the browser closes it" rule structural instead of a convention — see `task-9-fix2-report.md`. The full narrative — both live runs' logs, verification queries, and the root-cause walkthrough — lives in `.superpowers/sdd/2026-08-20-v2-crawler-phase2/task-9-report.md` and `task-9-fix-report.md`; this file keeps only what's still true and useful to a fresh session.

## Quality/cost baseline

Unrelated to the v2 crawler, but it's the number that justifies "don't start another fix-and-dogfood cycle" above: **73% of *verifiable* fields correct across the three measured domains (22 of 30). 44% of all requested fields**, the difference being values a screenshot cannot check. **Cost ~$0.47 per cold URL, ~$0.20 warm**, pipeline only. The Tier 2 judge adds ~$0.14 per URL and is not a product cost.

### Corpus: 8 domains, 3 measured

`newegg`, `target`, `barnesandnoble` are measured (the numbers above). `bhphoto`, `abebooks`, `zalando`, `currys`, `uniqlo` were added 2026-08-19 and have never been run for extraction quality (`abebooks` has since been used live for the v2 crawler above, which is a different kind of run — pagination/plumbing, not a quality measurement). Only `newegg` has a Tier 1 fixture among the measured domains; two other fixtures (`ikea`, `nike`) exist but cover domains that aren't in the live corpus.

## What phase 1 and phase 2 actually do

- **Phase 1 — `crawl.plan`** (`packages/scraper/src/crawl/plan-run.ts`, `packages/api/src/routers/crawl.ts`'s `plan` procedure). Walks a Source's listing page(s) via the existing extraction chain (mechanical → cache → AI), detects pagination (`url-pattern` / `next-button` / `page-numbers`, heuristic first, AI fallback), and enumerates detail URLs into `run_items` — `kind: 'listing'` rows for pages walked (already `done`, they cost nothing further), `kind: 'detail'` rows `pending` and waiting for phase 2. It fetches nothing on the detail pages themselves and spends nothing per item. Budget (`max_pages` / `max_items` / `mode`) is enforced here, so a run never plans more than the Source allows.
- **Phase 2 — `crawl.execute`** (`packages/api/src/crawl/execute-run.ts`, `extract-item.ts`, `claim-item.ts`, `record-outcome.ts`, `roll-up-run.ts`; `crawl.execute`/`crawl.status`/`crawl.cancel` procedures). Claims one pending detail item at a time (`SKIP LOCKED`, so it's safe to call again after a crash — nothing double-claims), runs it through the same extraction chain the rest of the pipeline uses, merges input + listing + detail values into one row (`mergeRow`), and records the outcome per item: `done` with an extraction id, or `failed` with a reason. One blocked or erroring page is isolated — the loop keeps going and the run still reaches a terminal status (`completed` or `partial`, derived from the DB, not a local counter). `crawl.cancel` flips the run to `cancelling`; the loop checks between items (never mid-item) and stops cleanly, leaving the rest `pending` — calling `execute` again resumes it. **This stop-and-resume path is now proven live** (2026-08-21, run `aeaab1db-0f1f-4da5-8230-d59b3ef771af`): cancelled twice mid-run, each time the in-flight item finished, the run settled cleanly to `cancelled` with the rest of the items untouched at `pending`, and re-invoking `crawl-execute.ts` on the same run id resumed from the pending set rather than restarting or refusing. 8 of 33 detail items were extracted across both segments; 25 were deliberately left `pending` to avoid draining the run. See below for the full transcript. Runs it outside the HTTP request (deliberately not awaited, guarded so a failure can never take the api-server process down); state lives entirely in `run_items`, so an api-server restart pauses a run rather than losing it.

## How to drive them

- CLI, phase 1: `pnpm --filter @robot/api exec tsx src/crawl-plan.ts <sourceId|sourceSlug>` — prints the work list it produced and the run id.
- CLI, phase 2: `pnpm --filter @robot/api exec tsx src/crawl-execute.ts <runId>` — starts execution and polls `crawl.status` every 5s (240 ticks / 20 min cap) until the run leaves `extracting`/`cancelling`, then prints per-item final status. The crawl runs inside this CLI's own process, so hitting the poll cap while the run is still active exits non-zero with an explicit "still in progress" message rather than silently reporting success.
- Dashboard: the Source Runs page (`packages/dashboard/src/routes/source-runs.tsx`) has the button that calls `crawl.plan`. The Run detail page (`source-run-detail.tsx`) has **Extract N pending** / **Retry N failed** / **Stop**, wired to `crawl.execute`/`crawl.cancel`, with polling-based progress (`run-progress.ts`) — no live push yet, SSE/WebSocket is still future work. Which buttons appear is decided by `runControls` in `run-progress.ts`: Extract and Retry key off the item counts alone and are deliberately NOT hidden while the run is active, because a run can sit at `extracting` with no loop behind it and must stay recoverable from this page. Extract counts `running` as well as `pending` — an item abandoned mid-extraction is work a re-entered loop reclaims — and reads **Resume N stalled** (`extractButtonLabel`) when stalled items are all that is left.

## What the live runs demonstrated

Both runs used the same seeded Source, `abebooks-pagination` (budget `{mode: "first_n", max_items: 8, max_pages: 2}`), so the results are directly comparable:

- **Run 1** (`2f1b29b9-...`, pre-fix): phase 1 correctly enumerated 8 detail items, capped at page 1, never touching page 2. Phase 2 broke — item 1 succeeded, then `runExtraction` closed the shared browser it didn't own, and items 2-8 all failed with "Browser not launched." Run settled to `partial`, `result_count=1`. Left in the DB as the historical record; do not re-run it.
- **Run 2** (`bd44fa22-c667-4538-9a48-0e8066c8f444`, post-fix `376b7ac`): same plan shape, phase 2 completed 8/8 — `run_items` = 1 listing + 8 detail, all `done`; `result_count=8`; CSV export shows 8 data rows across 8 distinct `_url`s.
- Full step-by-step logs, the root-cause walkthrough, and verification queries: `.superpowers/sdd/2026-08-20-v2-crawler-phase2/task-9-report.md` (the bug run) and `task-9-fix-report.md` (the fix + reproof run).

## The fix, and its follow-up

**Ruling: whoever launches the browser closes it.** `runExtraction` (`extraction-orchestrator.ts`) no longer closes a browser it doesn't own, on any path — the invariant is documented directly on `ExtractionDeps.browser`. A review round found the identical pattern one file over: `runAnalysis` (`analysis-orchestrator.ts`) was still closing a browser it never launched, and `scraper.ts`'s `analyse` procedure had no `finally` at all, leaking a browser on its early-throw path. Both are fixed, and the rule is now structural rather than a convention each procedure has to remember: `@robot/api`'s `withBrowserSession` (`packages/api/src/browser-session.ts`) launches a browser, runs the caller's function, and always closes it in a `finally` — `extract` and `analyse` both route through it now. See `task-9-fix2-report.md` for the full fix.

## Pagination walk + caching — live proof (2026-08-21)

Tasks 1-5 of `.superpowers/sdd/2026-08-21-pagination-proof-and-caching/` built and fixture-gated: `planRun` walking listing pages 2..N, deduping detail URLs across them, writing the winning pagination strategy to `domain_intelligence.pagination_config` only once a walk verifies it produced new items, and re-detecting once (never twice) when a cached config goes stale. Task 6 is the live proof — the part fixtures cannot give. Full raw transcript, SQL, and run ids: `.superpowers/sdd/2026-08-21-pagination-proof-and-caching/task-6-report.md`.

**What worked, end to end.** Against `abebooks-pagination` (budget set to `{max_items: 60, max_pages: 3}` so `max_pages`, not `max_items`, would bind):
- `crawl-plan.ts` walked listing pages 1, 2 and 3 (run `4bf71da9-edf3-4155-8fdb-67b4cc30d7c2`) and enumerated 33 detail URLs spread across `page_number` 1 (30), 2 (2), 3 (1) — `run_items` confirms three `listing` rows and detail rows on all three page numbers.
- `domain_intelligence.pagination_config` was written for `(www.abebooks.com, listing)` — the first time this column has ever held a value in this repo's history.
- A second plan against the same Source (run `aeaab1db-0f1f-4da5-8230-d59b3ef771af`) produced the identical fan-out (30/2/1 across the same three page numbers) **without** re-detecting: the `[cache] pagination for ...` save-line that fires only on a fresh, non-cache detection was absent, which — combined with the identical result — is conclusive that the pagination `source` was `cache` on the replay. (The CLI has no direct `source: cache` print; this is inferred from the code path, precisely, not asserted from a log line saying the word.)
- `crawl.cancel` stop-and-resume, previously unit-tested only, is now live-proven (see above) — cancelled twice, resumed cleanly once, settled to `cancelled` both times, no item lost or double-run.

**What did NOT work: `deriveTemplate` picked the wrong page parameter for AbeBooks.** The three listing URLs actually fetched (identical on both plan runs):

```
page 1: https://www.abebooks.com/servlet/SearchResults?kn=python&sortby=17
page 2: https://www.abebooks.com/servlet/SearchResults?ds=2&dym=on&kn=python&p=1&rollup=on&sortby=17&sp=0&spo=30
page 3: https://www.abebooks.com/servlet/SearchResults?ds=3&dym=on&kn=python&p=1&rollup=on&sortby=17&sp=0&spo=30
```

`p=1` is pinned on every request; the template increments `ds` instead, which is not AbeBooks' page parameter. So pages 2 and 3 substantially re-fetched page 1. The 30/2/1 detail-URL split confirms it — a real second and third page of ~30 results would produce roughly 30 each, not 2 and 1; those are consistent with result-ordering jitter across near-duplicate requests slipping past cross-page dedupe, not with genuine additional inventory.

**The consequence: `gained > 0` is too weak a bar for "this config works."** `plan-run.ts` writes `pagination_config` whenever a walk yields at least one new item. 2 + 1 = 3 stray items were enough to pass that bar, so the broken `ds`-based template was certified and cached — a pre-existing gap in the Task 3/4 verification logic that this live run is what exposed it. It was purged by hand (`delete from domain_intelligence where domain='www.abebooks.com' and page_type='listing'`) rather than shipped; the row's exact contents before deletion are recorded in `task-6-report.md`. **Do not re-cache it** without first fixing `deriveTemplate` (in `@robot/browser`) or tightening the verification gate — ideally both. A candidate fix for the gate: treat a page yielding only a small fraction of page 1's item count as evidence of a broken pager, not a thin real page, rather than trusting `gained > 0` alone. **That ratio must not be implemented naively as a refusal.** `absorb` passes `remaining: cap - detailCount()` into `enumerateDetailUrls`, so a genuinely working pager legitimately gains only 1-2 new items on page 2 once the item budget is nearly full — which is this repo's own default `{max_items: 8, max_pages: 2}` shape. A bare ratio gate would refuse those correct configs, the cache would never warm, and the feature would deliver nothing. So as of 2026-08-21 the ratio ships as a **warning only** (`THIN_WALK_SHARE` in `plan-run.ts`, suppressed whenever the walk was stopped by the item budget rather than by the pager) — it accumulates the evidence a `deriveTemplate` fix will be built from, and refuses nothing. A real refusal needs a budget-aware signal, not the ratio on its own.

**What this run does NOT prove.** Per-item detail extraction is not re-proven here — that is the earlier v2-crawler run (`bd44fa22-c667-4538-9a48-0e8066c8f444`, 8/8 AbeBooks detail items, described above). This run is plan-only for pages 1-3 (Steps 1-5) plus a bounded execute for the cancel/resume proof (Step 6, 8/33 items extracted, 25 left `pending` on purpose). Infinite scroll and load-more are unrelated to this bug and remain wholly unbuilt (see roadmap).

**Budget note:** `abebooks-pagination`'s budget was raised to `{max_items: 60, max_pages: 3}` for this proof and restored to its original `{max_items: 8, max_pages: 2}` afterward — confirmed by SQL in `task-6-report.md`.

## `api-param` pagination — live proof (2026-08-24)

Tasks 1-7 of `.superpowers/sdd/2026-08-22-api-param-pagination/` built and fixture-gated `api-param`: `planRun` finds the intercepted response that carries page 1's own detail URLs (`findListingApi`, requiring both `API_MATCH_MIN_COUNT = 3` matches and `API_MATCH_MIN_SHARE = 0.5` share, so a small widget or a recommendations blob can't qualify), ranks paging-parameter candidates from that endpoint's own URL, probes each one, and accepts a candidate only if its response's items overlap page 1's by at most `REPLAY_MAX_OVERLAP = 0.5` (`overlapShare` in `api-param-candidates.ts`) — a parameter is never used or cached until a probe has shown it returns genuinely different data. Detection is wrapped so it can never throw (`probeApiParam`/`detectApiParam` in `detect-api-param.ts`) and reached the case Task 5's review round added: when an endpoint was found but no candidate verified, `plan-run.ts` emits a warning naming the endpoint and every candidate tried. Task 8 (this entry) is the live proof — the part fixtures cannot give.

**Target and method.** `newegg-gpus-live` — the corpus entry recorded in `docs/roadmap.md` as exercising "JSON-LD + APIs" (P3b, 2026-08-18) — was chosen specifically because it is the only seeded source whose extraction chain touches intercepted APIs at all; AbeBooks was considered and rejected (its search results are server-rendered HTML, proven by the 2026-08-21 walk above, so it almost certainly exposes no JSON endpoint carrying detail URLs — running it would have spent money demonstrating a negative). Budget was raised from `{max_items: 5, max_pages: 1}` to `{max_items: 60, max_pages: 3}` (so `max_pages` would bind) for one plan run, then restored. Full transcript, SQL, and run id: `.superpowers/sdd/2026-08-22-api-param-pagination/task-8-report.md`.

**What happened: no anti-bot interstitial, a clean category-page capture, and `api-param` fell through.** `crawl-plan.ts` against `newegg-gpus-live` (run `c889faea-3417-4d36-97cd-1907e55653af`) planned 60 detail items across all 3 listing pages (12 / 36 / 12 by `page_number`) in 134s. `domain_intelligence.pagination_config` for `(www.newegg.com, listing)` is `{"strategy": "url-pattern", "urlTemplate": "https://www.newegg.com/p/pl?N=100006662&page={N}"}` — the pre-existing mechanical HTML pager, not `api-param`. **No warning was printed at the time of the run** — and that silence was a gap, not a finding. The warning as it then stood only fired when `findListingApi` had found a candidate *endpoint* and no parameter verified against it, so the "no endpoint at all" case said nothing, and the diagnosis below had to be reconstructed by hand from intercepted-request dumps. **That gap is now closed** (`apiParamReason` in `plan-run.ts`): an attempt carries a reason — `no-listing-api`, `no-candidates`, `none-verified` — plus how many GET/JSON/2xx responses were considered, and `planRun` emits one reason-specific warning whenever there was anything to consider at all. A future run in this situation will say so directly. **Re-running this same plan would now produce a warning where the transcript below shows none; the transcript is the record of what the code did on 2026-08-24, not of what it does today.** Here, `findListingApi` returned `null` outright — of the 34 intercepted requests (10 JSON-bearing), none had an array-of-objects overlapping page 1's 12 detail-URL identifiers at ≥3 matches / ≥50% share. The browser's own log line for the largest JSON response, `api/CountryApi` (1144 bytes), confirms it's a locale widget, not a product feed. Field extraction (a separate, independent code path) corroborates the same conclusion from the other direction: `detail_url` for this run was sourced from `json-ld`/`xpath` (`[extract] Sources: {"category_name":"json-ld","detail_url":"xpath"}`), never from an API path, meaning no listing API was visible to the AI-API extraction tier either. **This is the "no candidate endpoint at all" case — distinct from "endpoint found, every candidate rejected."** The `REPLAY_MAX_OVERLAP` overlap check in `api-param-candidates.ts` was never reached; the miss happened one gate earlier, at `findListingApi`'s multiplicity bar in `find-listing-api.ts`.

**What this means for the thresholds.** `API_MATCH_MIN_COUNT = 3`, `API_MATCH_MIN_SHARE = 0.5`, and `REPLAY_MAX_OVERLAP = 0.5` were all picked from reasoning, not traffic, when this feature was designed. This run is the first real data point, and what it shows is negative but specific: on this one real category page, the observed match count/share for every intercepted JSON response against page 1's 12 detail-URL identifiers was low enough that none crossed `API_MATCH_MIN_COUNT`/`API_MATCH_MIN_SHARE` (the exact matched/share numbers per candidate response were not logged — `findListingApi` returns only the best match or `null`, not a ranked list of near-misses — so "how close" is not knowable from this run without adding that instrumentation). No candidate ever reached the `overlapShare`/`REPLAY_MAX_OVERLAP` check, so this run says nothing about whether `0.5` is the right overlap bar — it only exercises the earlier gate. Newegg's category page renders its listing server-side (HTML + JSON-LD); the JSON it does expose over the wire on this page is unrelated widget/telemetry traffic, not the product grid. That is a fact about this one page, not a refutation of the `api-param` design — a listing that genuinely paginates by replaying its own JSON (the case this feature targets) would behave differently, and this corpus does not currently contain one that both (a) is known to load its grid from a same-origin JSON endpoint and (b) is safe to hit live without an anti-bot block.

**What this run does NOT prove.** `api-param`'s detection-and-probe machinery, its overlap guard, and its `planRun` JSON-walk integration remain proven only offline (unit tests + the Tier 1 fixture-server test, which fails if a fixture's page 2 re-serves page 1). No real site has yet been observed picking `source: api-param`. **Cursor-based APIs, POST/GraphQL endpoints, and DOM-driven infinite scroll remain wholly unsupported** — `api-param` only ever considers GET requests carrying a page-number-shaped query parameter (see `rankCandidates` in `api-param-candidates.ts`); none of the corpus's live sources have been shown to need those, and nothing in this task changes that gap. The (still unbuilt) DOM-scroll cycle referenced in the roadmap's v2 section is what would eventually cover infinite scroll and load-more — `api-param` does not and was never meant to.

## `api-param` pre-merge fix wave (2026-08-24)

A whole-branch review of `feat/api-param-pagination` returned DO NOT MERGE. Eight findings plus
minors, all fixed on the branch (`ec1b840`..`1820aaa`); full write-up with every teeth-check in
`.superpowers/sdd/2026-08-22-api-param-pagination/merge-fix-report.md`. The two that matter beyond
this feature:

**The walk fabricated detail URLs, and cached the config that did it** — the 2026-08-21 AbeBooks
failure class with a new trigger. `collectRowUrls` accepted any non-empty string at
`itemsPath[].urlPath`, and the walk resolved it against the API endpoint's own URL rather than the
listing page's. Two demonstrated failures: an API answering in bare slugs produced
`/java-in-depth` where the real URL is `/books/java-in-depth` (detection verifies a slug API
happily — identifiers compare as trailing path segments), and a cross-origin API host
(`api.<site>` fronting `www.<site>`) put every page-2+ URL on the wrong host. In both cases
`gained > 0`, nothing warned, and the config reached the cross-customer domain cache. Now resolved
against the listing page, and each value measured against the shape page 1 itself demonstrated —
same origin, inside the longest directory prefix page 1's own detail URLs agree on. A refusal stops
the walk, keeps page 1, names the value, and caches nothing (`api-row-urls.ts`). Spec §4 required
this and it had never been implemented.

**A credential that persists in the client cannot pin which document issued a request.** The Tier 1
cookie gate's comment claimed that verification succeeding "is itself the proof that the fetch ran
in the page". It was not: the browser's cookie jar outlives one `evaluate`, so the proof only held
because that test ran first in a freshly launched browser. Mutating the walk's navigation target
left all 192 tests green. Both gates now assert the `Referer` a same-origin fetch sets to the full
URL of the issuing document. Worth remembering the next time a fixture is built to prove where a
request came from.

Also corrected, because it is easy to believe otherwise: `fetch(credentials: 'include')` restores
cookies and HTTP Basic/Digest auth, **never** a JS-set `Authorization` or CSRF header. A site whose
listing XHRs carry a JS-set bearer token 401s every probe and correctly falls through — but a 401
there must not be read as "the parameter was wrong". Spec §3 had claimed the opposite.

## What NOT to redo

- **The API-side entity filter.** Tried and reverted (`c606a54`). Documented on `filterRequestsForPage` in `entity-match.ts`, captured as a test.
- **Don't chase the price/rating "wrong" verdicts as bugs.** Four of the eight remaining wrong verdicts are cases where the extractor returned a real value and nothing said which of several valid values was wanted. They need the labelling design (Open decision 1 below), not a fix.
- **Don't re-run the AbeBooks or Newegg live crawls to get a better-looking result.** The two v2 runs above (one broken, one fixed) are what happened; that task was authorised for exactly one planning + one execution run after the fix, and that budget is spent. Both runs stay in the DB as the record.
- **The shared-browser-close bug is fixed** (`376b7ac`, plus the `analysis-orchestrator.ts` half and the structural `withBrowserSession` fix from the review round) — don't reopen it or re-derive the root cause; read "The fix, and its follow-up" above instead.
- **Don't re-run the pagination-walk or cancel/resume proofs to get a better-looking result.** Runs `4bf71da9…`, `aeaab1db…` and the two cancel/resume cycles are the record; that budget is spent and restored. If `deriveTemplate`'s AbeBooks bug gets fixed, a fresh live run to reprove it is legitimate new work, not a re-run of this one.
- **The `deriveTemplate` wrong-page-parameter bug is a known, recorded finding — don't re-derive it, and don't patch it as a drive-by.** See "Pagination walk + caching — live proof" above and `task-6-report.md` for the evidence. It needs its own cycle (design problem: choosing the right pager parameter when several query params look plausible), not a quick fix bolted onto whatever else is in flight.
- **Don't re-run the `api-param` live proof against `newegg-gpus-live` to get a better-looking result.** Run `c889faea-3417-4d36-97cd-1907e55653af` (2026-08-24) is the record; that budget is spent and the source's budget is restored to `{max_items: 5, max_pages: 1}`. It fell through to `mechanical` — see "`api-param` pagination — live proof (2026-08-24)" above. If a corpus site is added that is known to load its listing from a same-origin JSON endpoint, a fresh live run against *that* site is legitimate new work, not a re-run of this one.

## Open decisions (need Marko, not code)

1. **Candidate labelling** (`docs/ideas.md` → "Label every candidate instead of picking one"). Premise confirmed: one Newegg page carries four simultaneously valid prices and the *displayed* price matches none of the API fields. Marko's direction — label all candidates, let the customer choose, per-domain catalogue and per-dataset selection — is recorded and deserves its own spec. Still open.
2. **Proxy budget.** Anti-bot remains the dominant schedule risk for the pipeline generally; unrelated to the v2 crawler work above.

## Suggested next work

1. **Fix `deriveTemplate`'s page-parameter choice** (in `@robot/browser`), or tighten the `gained > 0` verification gate in `plan-run.ts` (or both) — the AbeBooks bug above. This is the most concrete, evidence-backed item on this list.
2. From `docs/roadmap.md`'s v2 section: infinite scroll and load-more pagination strategies (still unbuilt — no listing that loads by scroll can be paged today, and `api-param` does not cover it either); the progressive-confidence ladder (1 → 5 → 20 → 1000 URLs); a real job queue (an api-server restart still pauses a run — `run_items` survives so `execute` resumes it, but nothing resumes it automatically). `api-param` pagination detection and replay is now built and offline-gated (see above) but still wants a live site that actually exercises it — the corpus doesn't currently have a confirmed one.

## Cheap things worth doing whenever convenient

- Measure the five unmeasured extraction-quality domains once (~$4): `bhphoto`, `abebooks`, `zalando`, `currys`, `uniqlo`.
- Capture Tier 1 fixtures for the corpus so the commit-time gate covers more than one eighth of it.
- `star_distribution` arrives as an object and is rejected as "not array".
- Target's `availability` returns a delivery date from a poisoned cached XPath; the pin machinery to fix it already exists.

## Commands worth knowing

| Command | What it does |
|---|---|
| `docker start robot-platform-db` | Start Postgres first — the one non-obvious prerequisite on this machine. Everything below needs it running. |
| `pnpm -r test` | Free green gate. |
| `docker exec -e PGPASSWORD=postgres robot-platform-db psql -U postgres -d robot_platform -c "select domain, page_type from domain_intelligence where domain in ('example.com','listing.example') or domain like 'test-%';"` | Cache-hygiene gate — run it **after** `pnpm -r test`, expect zero rows. The `test-%` prefix alone is not enough: the `planRun` unit fakes plan against `example.com` and `listing.example`, and an unstubbed `savePagination` in those fakes wrote real rows under those names for several commits without the prefix check noticing. Add any new fake hostname to this list. |
| `pnpm typecheck` | **Not all packages.** Five turbo tasks: `tsc --noEmit` in `@robot/db` and `@robot/api`, plus the `build` (`tsc`) of `@robot/browser`, `@robot/agent` and `@robot/scraper`, which typecheck as a side effect of emitting. `@robot/api-server` and `@robot/dashboard` have no `typecheck` script at all and are **not** covered. |
| `pnpm --filter @robot/dashboard exec tsc --noEmit` | The dashboard type check, which `pnpm typecheck` does not run. Nothing equivalent exists for `@robot/api-server` — it is unchecked until someone adds the script. |
| `pnpm --filter @robot/api exec tsx src/crawl-plan.ts <sourceId\|slug>` | Phase 1 CLI — plan a crawl. |
| `pnpm --filter @robot/api exec tsx src/crawl-execute.ts <runId>` | Phase 2 CLI — execute a planned run, spends money. |
| `pnpm test:judge` | Calibrates both judges against known answers (live, paid). |
| `pnpm test:liveness` | Do the fixtures still match the pages they claim? (live, free) |
| `pnpm test:ui` | Dashboard route smoke tests; needs `pnpm dev:all`. |
