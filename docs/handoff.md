---
name: Session handoff — state, decisions, and what to do next
description: Where the project stands as of 2026-08-21 and how to pick it up. Read this before starting.
type: project
---

# Handoff — 2026-08-21

## Read this first

**Do not start another fix-and-dogfood cycle.** The last correctness push converged on the corpus rather than on reality, each round cost real money, and half the remaining defects are design decisions rather than bugs (see *What NOT to redo* below). If you're tempted to chase extraction-quality numbers, don't — the next work is feature implementation against the roadmap.

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

**The consequence: `gained > 0` is too weak a bar for "this config works."** `plan-run.ts` writes `pagination_config` whenever a walk yields at least one new item. 2 + 1 = 3 stray items were enough to pass that bar, so the broken `ds`-based template was certified and cached — a pre-existing gap in the Task 3/4 verification logic that this live run is what exposed it. It was purged by hand (`delete from domain_intelligence where domain='www.abebooks.com' and page_type='listing'`) rather than shipped; the row's exact contents before deletion are recorded in `task-6-report.md`. **Do not re-cache it** without first fixing `deriveTemplate` (in `@robot/browser`) or tightening the verification gate — ideally both. A candidate fix for the gate: treat a page yielding only a small fraction of page 1's item count as evidence of a broken pager, not a thin real page, rather than trusting `gained > 0` alone.

**What this run does NOT prove.** Per-item detail extraction is not re-proven here — that is the earlier v2-crawler run (`bd44fa22-c667-4538-9a48-0e8066c8f444`, 8/8 AbeBooks detail items, described above). This run is plan-only for pages 1-3 (Steps 1-5) plus a bounded execute for the cancel/resume proof (Step 6, 8/33 items extracted, 25 left `pending` on purpose). Infinite scroll and load-more are unrelated to this bug and remain wholly unbuilt (see roadmap).

**Budget note:** `abebooks-pagination`'s budget was raised to `{max_items: 60, max_pages: 3}` for this proof and restored to its original `{max_items: 8, max_pages: 2}` afterward — confirmed by SQL in `task-6-report.md`.

## What NOT to redo

- **The API-side entity filter.** Tried and reverted (`c606a54`). Documented on `filterRequestsForPage` in `entity-match.ts`, captured as a test.
- **Don't chase the price/rating "wrong" verdicts as bugs.** Four of the eight remaining wrong verdicts are cases where the extractor returned a real value and nothing said which of several valid values was wanted. They need the labelling design (Open decision 1 below), not a fix.
- **Don't re-run the AbeBooks or Newegg live crawls to get a better-looking result.** The two v2 runs above (one broken, one fixed) are what happened; that task was authorised for exactly one planning + one execution run after the fix, and that budget is spent. Both runs stay in the DB as the record.
- **The shared-browser-close bug is fixed** (`376b7ac`, plus the `analysis-orchestrator.ts` half and the structural `withBrowserSession` fix from the review round) — don't reopen it or re-derive the root cause; read "The fix, and its follow-up" above instead.
- **Don't re-run the pagination-walk or cancel/resume proofs to get a better-looking result.** Runs `4bf71da9…`, `aeaab1db…` and the two cancel/resume cycles are the record; that budget is spent and restored. If `deriveTemplate`'s AbeBooks bug gets fixed, a fresh live run to reprove it is legitimate new work, not a re-run of this one.
- **The `deriveTemplate` wrong-page-parameter bug is a known, recorded finding — don't re-derive it, and don't patch it as a drive-by.** See "Pagination walk + caching — live proof" above and `task-6-report.md` for the evidence. It needs its own cycle (design problem: choosing the right pager parameter when several query params look plausible), not a quick fix bolted onto whatever else is in flight.

## Open decisions (need Marko, not code)

1. **Candidate labelling** (`docs/ideas.md` → "Label every candidate instead of picking one"). Premise confirmed: one Newegg page carries four simultaneously valid prices and the *displayed* price matches none of the API fields. Marko's direction — label all candidates, let the customer choose, per-domain catalogue and per-dataset selection — is recorded and deserves its own spec. Still open.
2. **Proxy budget.** Anti-bot remains the dominant schedule risk for the pipeline generally; unrelated to the v2 crawler work above.

## Suggested next work

1. **Fix `deriveTemplate`'s page-parameter choice** (in `@robot/browser`), or tighten the `gained > 0` verification gate in `plan-run.ts` (or both) — the AbeBooks bug above. This is the most concrete, evidence-backed item on this list.
2. From `docs/roadmap.md`'s v2 section: `api-param` pagination detection and replay (still unbuilt); infinite scroll and load-more pagination strategies (still unbuilt — no listing that loads by scroll can be paged today); the progressive-confidence ladder (1 → 5 → 20 → 1000 URLs); a real job queue (an api-server restart still pauses a run — `run_items` survives so `execute` resumes it, but nothing resumes it automatically).

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
| `pnpm typecheck` | **Not all packages.** Five turbo tasks: `tsc --noEmit` in `@robot/db` and `@robot/api`, plus the `build` (`tsc`) of `@robot/browser`, `@robot/agent` and `@robot/scraper`, which typecheck as a side effect of emitting. `@robot/api-server` and `@robot/dashboard` have no `typecheck` script at all and are **not** covered. |
| `pnpm --filter @robot/dashboard exec tsc --noEmit` | The dashboard type check, which `pnpm typecheck` does not run. Nothing equivalent exists for `@robot/api-server` — it is unchecked until someone adds the script. |
| `pnpm --filter @robot/api exec tsx src/crawl-plan.ts <sourceId\|slug>` | Phase 1 CLI — plan a crawl. |
| `pnpm --filter @robot/api exec tsx src/crawl-execute.ts <runId>` | Phase 2 CLI — execute a planned run, spends money. |
| `pnpm test:judge` | Calibrates both judges against known answers (live, paid). |
| `pnpm test:liveness` | Do the fixtures still match the pages they claim? (live, free) |
| `pnpm test:ui` | Dashboard route smoke tests; needs `pnpm dev:all`. |
