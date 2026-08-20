---
name: Session handoff — state, decisions, and what to do next
description: Where the project stands as of 2026-08-20 and how to pick it up. Read this before starting.
type: project
---

# Handoff — 2026-08-20

## Read this first

The v2 crawler (listing → detail, two phases) is built, merged into `feat/v2-crawler-phase2`, and has now been run against a live site end to end **twice**: once that exposed a real shared-browser lifecycle bug in `runExtraction` (7/8 items failed), and once after the fix that ran clean (8/8 items done, CSV export shows all 8 rows). The bug is fixed (`376b7ac`), TDD'd, and gated — see below for both runs' numbers.

## What phase 1 and phase 2 actually do

- **Phase 1 — `crawl.plan`** (`packages/scraper/src/crawl/plan-run.ts`, `packages/api/src/routers/crawl.ts`'s `plan` procedure). Walks a Source's listing page(s) via the existing extraction chain (mechanical → cache → AI), detects pagination (`url-pattern` / `next-button` / `page-numbers`, heuristic first, AI fallback), and enumerates detail URLs into `run_items` — `kind: 'listing'` rows for pages walked (already `done`, they cost nothing further), `kind: 'detail'` rows `pending` and waiting for phase 2. It fetches nothing on the detail pages themselves and spends nothing per item. Budget (`max_pages` / `max_items` / `mode`) is enforced here, so a run never plans more than the Source allows.
- **Phase 2 — `crawl.execute`** (`packages/api/src/crawl/execute-run.ts`, `extract-item.ts`, `claim-item.ts`, `record-outcome.ts`, `roll-up-run.ts`; `crawl.execute`/`crawl.status`/`crawl.cancel` procedures). Claims one pending detail item at a time (`SKIP LOCKED`, so it's safe to call again after a crash — nothing double-claims), runs it through the same extraction chain the rest of the pipeline uses, merges input + listing + detail values into one row (`mergeRow`), and records the outcome per item: `done` with an extraction id, or `failed` with a reason. One blocked or erroring page is isolated — the loop keeps going and the run still reaches a terminal status (`completed` or `partial`, derived from the DB, not a local counter). `crawl.cancel` flips the run to `cancelling`; the loop checks between items (never mid-item) and stops cleanly, leaving the rest `pending` — calling `execute` again resumes it. Runs it outside the HTTP request (deliberately not awaited, guarded so a failure can never take the api-server process down); state lives entirely in `run_items`, so an api-server restart pauses a run rather than losing it.

## How to drive them

- CLI, phase 1: `pnpm --filter @robot/api exec tsx src/crawl-plan.ts <sourceId|sourceSlug>` — prints the work list it produced and the run id.
- CLI, phase 2: `pnpm --filter @robot/api exec tsx src/crawl-execute.ts <runId>` — starts execution and polls `crawl.status` every 5s until the run leaves `extracting`/`cancelling`, then prints per-item final status.
- Dashboard: the Source Runs page (`packages/dashboard/src/routes/source-runs.tsx`) has the button that calls `crawl.plan`. The Run detail page (`source-run-detail.tsx`) has Run/Cancel buttons wired to `crawl.execute`/`crawl.cancel`, with polling-based progress (`run-progress.ts`) — no live push yet, SSE/WebSocket is still future work.

## The first live run — the bug (2026-08-20, run `2f1b29b9-...`)

Ran against `abebooks-pagination` (seeded Source, budget `{mode: "first_n", max_items: 8, max_pages: 2}`), not `newegg-gpus-live` — an earlier live check had already shown the export mechanism works for one row, so this run's point was to prove multiple rows, which needed a source with a bigger budget.

**Phase 1** (`crawl.plan abebooks-pagination`) produced run `2f1b29b9-574e-4bff-9bd4-1343f6f2f56d`: 1 listing page walked, 8 detail items enumerated (deduped, budget-capped — the log shows `budget reached: 8 items`, and page 2 was never fetched because page 1 alone filled the 8-item cap). Domain cache was warm from a prior run. This part worked exactly as designed.

**Phase 2** (`crawl-execute.ts 2f1b29b9-...`) did not. Item 1 extracted cleanly (`product_name` from the API, `price` from XPath, 2/2 fields, confidence 100%). Every one of the remaining 7 items then failed immediately with the same error: `Browser not launched. Call launch() first.` The run still reached a terminal state correctly — `partial`, not stuck — because the failure-isolation and roll-up logic worked exactly as designed even though the underlying extraction did not.

**Root cause, found by reading the code rather than guessing:** `runExtraction` (`packages/scraper/src/extraction-orchestrator.ts`, was line ~485) ended with `if (!deps.capture) await browser.close();` — a leftover from its original single-shot call site (`extractRouter.extract`, one request = one browser). `startExecution` in `packages/api/src/routers/crawl.ts` launches **one** `PlaywrightBrowser` and passes it into `extractItem` for the whole run's item loop, expecting it to persist across items. It doesn't: `PlaywrightBrowser.close()` nulls `this.context`/`this.browser`, so the very next `browser.capture()` call throws "Browser not launched." This was **not** an AbeBooks block — no interstitial, no empty HTML, no site-side signal — it was our own browser-lifecycle bug, newly exposed because phase 2 was the first caller that reuses a browser across more than one `runExtraction` call.

**Verification queries, live run `2f1b29b9-574e-4bff-9bd4-1343f6f2f56d`:**

```
run_items: done=2 (1 listing + 1 detail), failed=7 (all detail)
runs:      status=partial, result_count=1
```

**CSV export** (`GET /export/runs/2f1b29b9-574e-4bff-9bd4-1343f6f2f56d.csv`): header row `_url,price,_page_number,product_name,category_name` plus exactly 1 data row — matching `result_count=1`, not the 8 planned. This run's row is left in the DB as the record; it was not deleted or re-run.

## The fix (2026-08-20, `376b7ac`)

**Ruling: whoever launches the browser closes it.** `runExtraction` never launches a browser and, after the fix, never closes one either — on any path, including the capture-error path (which still rethrows). The guard that conflated "I captured this page myself" with "I own this browser" is gone; the invariant is now documented directly on `ExtractionDeps.browser`.

- `packages/scraper/src/extraction-orchestrator.ts` — both `browser.close()` calls removed (the capture-error path and the end-of-chain path).
- `packages/api/src/routers/scraper.ts`'s `extract` procedure launches its own single-use browser and was relying on `runExtraction` to close it; it now closes it itself in a `finally`. Its sibling `analyze` procedure was already correct (`analysis-orchestrator.ts` closes its own browser) and needed no change.
- Audited every other production caller: `extract-item.ts` (browser owned by `startExecution`, already closes in a `finally`) and `plan-run.ts` (browser owned by the `crawl.plan` procedure, already closes in a `finally`, and always injects `capture` so the old guard was never true there — phase 1 was correctly unaffected by the original bug).
- TDD: `packages/scraper/src/extraction-orchestrator-browser-lifecycle.test.ts` — three tests on the no-injected-capture path (the one the old guard broke), including the actual regression (two sequential `runExtraction` calls on one browser, both must succeed). All three failed against the pre-fix code for the right reason; a teeth check (re-adding the close, watching the regression test fail, then reverting) confirmed the test actually exercises the bug.

## The second live run — reproof (2026-08-20, run `bd44fa22-...`)

Same Source, same unchanged budget (`{max_items: 8, max_pages: 2}`), fresh plan (not a re-run of the failed one — that record stays in the DB untouched).

**Phase 1** (`crawl.plan abebooks-pagination`) produced run `bd44fa22-c667-4538-9a48-0e8066c8f444`: 1 listing page walked, 8 detail items enumerated, budget reached at 8 items exactly as before.

**Phase 2** (`crawl-execute.ts bd44fa22-...`) completed all 8 items — `done 8/8 · failed 0` — with the browser launched once and reused across the whole loop, which is exactly the path the bug used to break.

**Verification queries, live run `bd44fa22-c667-4538-9a48-0e8066c8f444`:**

```
run_items: done=9 (1 listing + 8 detail)
runs:      status=completed, result_count=8
```

**CSV export** (`GET /export/runs/bd44fa22-c667-4538-9a48-0e8066c8f444.csv`): header row `_url,price,_page_number,product_name,category_name` plus **8 data rows across 8 distinct `_url`s** — matching `result_count=8` and the full planned item count. The v2 spec's "one row per URL" claim is now demonstrated in volume, not just in mechanism.

## What NOT to redo

- **The API-side entity filter.** Tried and reverted (`c606a54`). Documented on `filterRequestsForPage` in `entity-match.ts`, captured as a test.
- **Don't re-run the AbeBooks or Newegg live crawls to get a better-looking result.** The two runs above (one broken, one fixed) are what happened; this task was authorised for exactly one planning + one execution run after the fix, and that budget is spent. Both runs stay in the DB as the record.
- **The shared-browser-close bug is fixed** (`376b7ac`) — don't reopen it or re-derive the root cause; read the "The fix" section above instead.

## Open decisions (need Marko, not code)

1. **Candidate labelling** (`docs/ideas.md` → "Label every candidate instead of picking one"). Still open, unchanged from prior handoffs.
2. **Proxy budget.** Anti-bot remains the dominant schedule risk for the pipeline generally; unrelated to the v2 crawler bug above.

## Suggested next work

1. From `docs/roadmap.md`'s v2 section: `api-param` pagination detection and replay; caching the winning pagination config to `domain_intelligence` (the column exists, lookup reads it, nothing writes it yet); infinite scroll and load-more pagination strategies; the progressive-confidence ladder (1 → 5 → 20 → 1000 URLs); a real job queue (an api-server restart still pauses a run — `run_items` survives so `execute` resumes it, but nothing resumes it automatically).

## Cheap things worth doing whenever convenient

- Measure the five unmeasured extraction-quality domains once (~$4) — unchanged from prior handoffs, unrelated to v2.
- `star_distribution` arrives as an object and is rejected as "not array".
- Target's `availability` returns a delivery date from a poisoned cached XPath; the pin machinery to fix it already exists.

## Commands worth knowing

| Command | What it does |
|---|---|
| `pnpm -r test` | Free green gate. Needs Postgres. |
| `pnpm typecheck` | All packages, including the two that have no build step. |
| `pnpm --filter @robot/dashboard exec tsc --noEmit` | Dashboard type check (not wired into `pnpm typecheck`). |
| `pnpm --filter @robot/api exec tsx src/crawl-plan.ts <sourceId\|slug>` | Phase 1 CLI — plan a crawl. |
| `pnpm --filter @robot/api exec tsx src/crawl-execute.ts <runId>` | Phase 2 CLI — execute a planned run, spends money. |
| `pnpm test:judge` | Calibrates both judges against known answers (live, paid). |
| `pnpm test:liveness` | Do the fixtures still match the pages they claim? (live, free) |
| `pnpm test:ui` | Dashboard route smoke tests; needs `pnpm dev:all`. |
