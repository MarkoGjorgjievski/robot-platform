---
name: Session handoff — state, decisions, and what to do next
description: Where the project stands as of 2026-08-20 and how to pick it up. Read this before starting.
type: project
---

# Handoff — 2026-08-20

## Read this first

**Do not start another fix-and-dogfood cycle.** The last correctness push converged on the corpus rather than on reality, each round cost real money, and half the remaining defects are design decisions rather than bugs (see *What NOT to redo* below). If you're tempted to chase extraction-quality numbers, don't — the next work is feature implementation against the roadmap.

The v2 crawler (listing → detail, two phases) is built and **committed on `feat/v2-crawler-phase2`** — not merged, and not in `main`. It has been run against a live site end to end twice: once exposed a real shared-browser lifecycle bug in `runExtraction` (7/8 items failed), once after the fix ran clean (8/8 items done, CSV export shows all 8 rows). A follow-up review round found and fixed the identical bug pattern one file over (`runAnalysis` in `analysis-orchestrator.ts`) and made the "whoever launches the browser closes it" rule structural instead of a convention — see `task-9-fix2-report.md`. The full narrative — both live runs' logs, verification queries, and the root-cause walkthrough — lives in `.superpowers/sdd/2026-08-20-v2-crawler-phase2/task-9-report.md` and `task-9-fix-report.md`; this file keeps only what's still true and useful to a fresh session.

## Quality/cost baseline

Unrelated to the v2 crawler, but it's the number that justifies "don't start another fix-and-dogfood cycle" above: **73% of *verifiable* fields correct across the three measured domains (22 of 30). 44% of all requested fields**, the difference being values a screenshot cannot check. **Cost ~$0.47 per cold URL, ~$0.20 warm**, pipeline only. The Tier 2 judge adds ~$0.14 per URL and is not a product cost.

### Corpus: 8 domains, 3 measured

`newegg`, `target`, `barnesandnoble` are measured (the numbers above). `bhphoto`, `abebooks`, `zalando`, `currys`, `uniqlo` were added 2026-08-19 and have never been run for extraction quality (`abebooks` has since been used live for the v2 crawler above, which is a different kind of run — pagination/plumbing, not a quality measurement). Only `newegg` has a Tier 1 fixture among the measured domains; two other fixtures (`ikea`, `nike`) exist but cover domains that aren't in the live corpus.

## What phase 1 and phase 2 actually do

- **Phase 1 — `crawl.plan`** (`packages/scraper/src/crawl/plan-run.ts`, `packages/api/src/routers/crawl.ts`'s `plan` procedure). Walks a Source's listing page(s) via the existing extraction chain (mechanical → cache → AI), detects pagination (`url-pattern` / `next-button` / `page-numbers`, heuristic first, AI fallback), and enumerates detail URLs into `run_items` — `kind: 'listing'` rows for pages walked (already `done`, they cost nothing further), `kind: 'detail'` rows `pending` and waiting for phase 2. It fetches nothing on the detail pages themselves and spends nothing per item. Budget (`max_pages` / `max_items` / `mode`) is enforced here, so a run never plans more than the Source allows.
- **Phase 2 — `crawl.execute`** (`packages/api/src/crawl/execute-run.ts`, `extract-item.ts`, `claim-item.ts`, `record-outcome.ts`, `roll-up-run.ts`; `crawl.execute`/`crawl.status`/`crawl.cancel` procedures). Claims one pending detail item at a time (`SKIP LOCKED`, so it's safe to call again after a crash — nothing double-claims), runs it through the same extraction chain the rest of the pipeline uses, merges input + listing + detail values into one row (`mergeRow`), and records the outcome per item: `done` with an extraction id, or `failed` with a reason. One blocked or erroring page is isolated — the loop keeps going and the run still reaches a terminal status (`completed` or `partial`, derived from the DB, not a local counter). `crawl.cancel` flips the run to `cancelling`; the loop checks between items (never mid-item) and stops cleanly, leaving the rest `pending` — calling `execute` again resumes it. **This stop-and-resume path is unit-tested but has never been exercised live** — no live crawl has actually been cancelled mid-run. Runs it outside the HTTP request (deliberately not awaited, guarded so a failure can never take the api-server process down); state lives entirely in `run_items`, so an api-server restart pauses a run rather than losing it.

## How to drive them

- CLI, phase 1: `pnpm --filter @robot/api exec tsx src/crawl-plan.ts <sourceId|sourceSlug>` — prints the work list it produced and the run id.
- CLI, phase 2: `pnpm --filter @robot/api exec tsx src/crawl-execute.ts <runId>` — starts execution and polls `crawl.status` every 5s (240 ticks / 20 min cap) until the run leaves `extracting`/`cancelling`, then prints per-item final status. The crawl runs inside this CLI's own process, so hitting the poll cap while the run is still active exits non-zero with an explicit "still in progress" message rather than silently reporting success.
- Dashboard: the Source Runs page (`packages/dashboard/src/routes/source-runs.tsx`) has the button that calls `crawl.plan`. The Run detail page (`source-run-detail.tsx`) has Run/Cancel buttons wired to `crawl.execute`/`crawl.cancel`, with polling-based progress (`run-progress.ts`) — no live push yet, SSE/WebSocket is still future work.

## What the live runs demonstrated

Both runs used the same seeded Source, `abebooks-pagination` (budget `{mode: "first_n", max_items: 8, max_pages: 2}`), so the results are directly comparable:

- **Run 1** (`2f1b29b9-...`, pre-fix): phase 1 correctly enumerated 8 detail items, capped at page 1, never touching page 2. Phase 2 broke — item 1 succeeded, then `runExtraction` closed the shared browser it didn't own, and items 2-8 all failed with "Browser not launched." Run settled to `partial`, `result_count=1`. Left in the DB as the historical record; do not re-run it.
- **Run 2** (`bd44fa22-c667-4538-9a48-0e8066c8f444`, post-fix `376b7ac`): same plan shape, phase 2 completed 8/8 — `run_items` = 1 listing + 8 detail, all `done`; `result_count=8`; CSV export shows 8 data rows across 8 distinct `_url`s.
- Full step-by-step logs, the root-cause walkthrough, and verification queries: `.superpowers/sdd/2026-08-20-v2-crawler-phase2/task-9-report.md` (the bug run) and `task-9-fix-report.md` (the fix + reproof run).

## The fix, and its follow-up

**Ruling: whoever launches the browser closes it.** `runExtraction` (`extraction-orchestrator.ts`) no longer closes a browser it doesn't own, on any path — the invariant is documented directly on `ExtractionDeps.browser`. A review round found the identical pattern one file over: `runAnalysis` (`analysis-orchestrator.ts`) was still closing a browser it never launched, and `scraper.ts`'s `analyse` procedure had no `finally` at all, leaking a browser on its early-throw path. Both are fixed, and the rule is now structural rather than a convention each procedure has to remember: `@robot/api`'s `withBrowserSession` (`packages/api/src/browser-session.ts`) launches a browser, runs the caller's function, and always closes it in a `finally` — `extract` and `analyse` both route through it now. See `task-9-fix2-report.md` for the full fix.

## What NOT to redo

- **The API-side entity filter.** Tried and reverted (`c606a54`). Documented on `filterRequestsForPage` in `entity-match.ts`, captured as a test.
- **Don't chase the price/rating "wrong" verdicts as bugs.** Four of the eight remaining wrong verdicts are cases where the extractor returned a real value and nothing said which of several valid values was wanted. They need the labelling design (Open decision 1 below), not a fix.
- **Don't re-run the AbeBooks or Newegg live crawls to get a better-looking result.** The two v2 runs above (one broken, one fixed) are what happened; that task was authorised for exactly one planning + one execution run after the fix, and that budget is spent. Both runs stay in the DB as the record.
- **The shared-browser-close bug is fixed** (`376b7ac`, plus the `analysis-orchestrator.ts` half and the structural `withBrowserSession` fix from the review round) — don't reopen it or re-derive the root cause; read "The fix, and its follow-up" above instead.

## Open decisions (need Marko, not code)

1. **Candidate labelling** (`docs/ideas.md` → "Label every candidate instead of picking one"). Premise confirmed: one Newegg page carries four simultaneously valid prices and the *displayed* price matches none of the API fields. Marko's direction — label all candidates, let the customer choose, per-domain catalogue and per-dataset selection — is recorded and deserves its own spec. Still open.
2. **Proxy budget.** Anti-bot remains the dominant schedule risk for the pipeline generally; unrelated to the v2 crawler work above.

## Suggested next work

1. From `docs/roadmap.md`'s v2 section: `api-param` pagination detection and replay; caching the winning pagination config to `domain_intelligence` (the column exists, lookup reads it, nothing writes it yet); infinite scroll and load-more pagination strategies; the progressive-confidence ladder (1 → 5 → 20 → 1000 URLs); a real job queue (an api-server restart still pauses a run — `run_items` survives so `execute` resumes it, but nothing resumes it automatically).

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
| `pnpm typecheck` | All packages, including the two that have no build step. |
| `pnpm --filter @robot/dashboard exec tsc --noEmit` | Dashboard type check (not wired into `pnpm typecheck`). |
| `pnpm --filter @robot/api exec tsx src/crawl-plan.ts <sourceId\|slug>` | Phase 1 CLI — plan a crawl. |
| `pnpm --filter @robot/api exec tsx src/crawl-execute.ts <runId>` | Phase 2 CLI — execute a planned run, spends money. |
| `pnpm test:judge` | Calibrates both judges against known answers (live, paid). |
| `pnpm test:liveness` | Do the fixtures still match the pages they claim? (live, free) |
| `pnpm test:ui` | Dashboard route smoke tests; needs `pnpm dev:all`. |
