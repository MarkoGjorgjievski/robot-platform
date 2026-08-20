---
name: Session handoff — state, decisions, and what to do next
description: Where the project stands as of 2026-08-20 and how to pick it up. Read this before starting.
type: project
---

# Handoff — 2026-08-20

## Read this first

The v2 crawler (listing → detail, two phases) is built, merged into `feat/v2-crawler-phase2`, and has now been run once against a live site end to end. **It mostly works, and the live run also found a real bug**: a shared-browser lifecycle bug in `runExtraction` that limits phase 2 to one successful extraction per run before every subsequent item fails. That bug is not fixed yet — fixing it is the next work, and it needs TDD like any other production code change (it lives in `@robot/scraper`, which is under test).

## What phase 1 and phase 2 actually do

- **Phase 1 — `crawl.plan`** (`packages/scraper/src/crawl/plan-run.ts`, `packages/api/src/routers/crawl.ts`'s `plan` procedure). Walks a Source's listing page(s) via the existing extraction chain (mechanical → cache → AI), detects pagination (`url-pattern` / `next-button` / `page-numbers`, heuristic first, AI fallback), and enumerates detail URLs into `run_items` — `kind: 'listing'` rows for pages walked (already `done`, they cost nothing further), `kind: 'detail'` rows `pending` and waiting for phase 2. It fetches nothing on the detail pages themselves and spends nothing per item. Budget (`max_pages` / `max_items` / `mode`) is enforced here, so a run never plans more than the Source allows.
- **Phase 2 — `crawl.execute`** (`packages/api/src/crawl/execute-run.ts`, `extract-item.ts`, `claim-item.ts`, `record-outcome.ts`, `roll-up-run.ts`; `crawl.execute`/`crawl.status`/`crawl.cancel` procedures). Claims one pending detail item at a time (`SKIP LOCKED`, so it's safe to call again after a crash — nothing double-claims), runs it through the same extraction chain the rest of the pipeline uses, merges input + listing + detail values into one row (`mergeRow`), and records the outcome per item: `done` with an extraction id, or `failed` with a reason. One blocked or erroring page is isolated — the loop keeps going and the run still reaches a terminal status (`completed` or `partial`, derived from the DB, not a local counter). `crawl.cancel` flips the run to `cancelling`; the loop checks between items (never mid-item) and stops cleanly, leaving the rest `pending` — calling `execute` again resumes it. Runs it outside the HTTP request (deliberately not awaited, guarded so a failure can never take the api-server process down); state lives entirely in `run_items`, so an api-server restart pauses a run rather than losing it.

## How to drive them

- CLI, phase 1: `pnpm --filter @robot/api exec tsx src/crawl-plan.ts <sourceId|sourceSlug>` — prints the work list it produced and the run id.
- CLI, phase 2: `pnpm --filter @robot/api exec tsx src/crawl-execute.ts <runId>` — starts execution and polls `crawl.status` every 5s until the run leaves `extracting`/`cancelling`, then prints per-item final status.
- Dashboard: the Source Runs page (`packages/dashboard/src/routes/source-runs.tsx`) has the button that calls `crawl.plan`. The Run detail page (`source-run-detail.tsx`) has Run/Cancel buttons wired to `crawl.execute`/`crawl.cancel`, with polling-based progress (`run-progress.ts`) — no live push yet, SSE/WebSocket is still future work.

## The live run — what actually happened (2026-08-20)

Ran against `abebooks-pagination` (seeded Source, budget `{mode: "first_n", max_items: 8, max_pages: 2}`), not `newegg-gpus-live` — an earlier live check had already shown the export mechanism works for one row, so this run's point was to prove multiple rows, which needed a source with a bigger budget.

**Phase 1** (`crawl.plan abebooks-pagination`) produced run `2f1b29b9-574e-4bff-9bd4-1343f6f2f56d`: 1 listing page walked, 8 detail items enumerated (deduped, budget-capped — the log shows `budget reached: 8 items`, and page 2 was never fetched because page 1 alone filled the 8-item cap). Domain cache was warm from a prior run. This part worked exactly as designed.

**Phase 2** (`crawl-execute.ts 2f1b29b9-...`) did not. Item 1 extracted cleanly (`product_name` from the API, `price` from XPath, 2/2 fields, confidence 100%). Every one of the remaining 7 items then failed immediately with the same error: `Browser not launched. Call launch() first.` The run still reached a terminal state correctly — `partial`, not stuck — because the failure-isolation and roll-up logic worked exactly as designed even though the underlying extraction did not.

**Root cause, found by reading the code rather than guessing:** `runExtraction` (`packages/scraper/src/extraction-orchestrator.ts:485`) ends with `if (!deps.capture) await browser.close();` — a leftover from its original single-shot call site (`extractRouter.extract`, one request = one browser). `startExecution` in `packages/api/src/routers/crawl.ts` launches **one** `PlaywrightBrowser` and passes it into `extractItem` for the whole run's item loop, expecting it to persist across items. It doesn't: `PlaywrightBrowser.close()` nulls `this.context`/`this.browser`, so the very next `browser.capture()` call throws "Browser not launched." This is **not** an AbeBooks block — no interstitial, no empty HTML, no site-side signal — it is our own browser-lifecycle bug, newly exposed because phase 2 is the first caller that reuses a browser across more than one `runExtraction` call. **Not fixed in this task** — it's a `@robot/scraper` production-code bug and needs its own TDD cycle, not a docs-task drive-by.

**Verification queries, live run `2f1b29b9-574e-4bff-9bd4-1343f6f2f56d`:**

```
run_items: done=2 (1 listing + 1 detail), failed=7 (all detail)
runs:      status=partial, result_count=1
```

**CSV export** (`GET /export/runs/2f1b29b9-574e-4bff-9bd4-1343f6f2f56d.csv`): header row `_url,price,_page_number,product_name,category_name` plus **exactly 1 data row** — matching `result_count=1`, not the 8 planned. `category_name` (a listing-origin column, carried from the planning pass rather than the detail page) correctly holds its value (`Manuscript / Paper Collectible`) on that row. So: **the export mechanism itself — stable header, listing-origin propagation, one row per successfully extracted URL — is proven correct**, but the live run demonstrates it for 1 distinct `_url`, not 8. The plan-level "one row per URL" headline claim from the v2 spec is proven in mechanism, not in volume, until the browser bug above is fixed and the run repeated.

## What NOT to redo

- **The API-side entity filter.** Tried and reverted (`c606a54`). Documented on `filterRequestsForPage` in `entity-match.ts`, captured as a test.
- **Don't re-run the AbeBooks or Newegg live crawls to get a better-looking result.** The one execution run above is what happened; re-running to paper over the browser bug would hide the exact defect this task exists to surface. Fix the bug first (see below), then re-run.

## Open decisions (need Marko, not code)

1. **Candidate labelling** (`docs/ideas.md` → "Label every candidate instead of picking one"). Still open, unchanged from prior handoffs.
2. **Proxy budget.** Anti-bot remains the dominant schedule risk for the pipeline generally; unrelated to the v2 crawler bug above.

## Suggested next work

1. **Fix the shared-browser-close bug** (`extraction-orchestrator.ts:485`). The fix likely belongs in `extract-item.ts` or `runExtraction`'s contract: either `runExtraction` needs a "don't close, caller owns the browser" mode (similar to how `deps.capture` already skips the close-on-capture-supplied path), or phase 2 needs to relaunch the browser per item. TDD — there's no existing test that runs `runExtraction` twice against one `IBrowser` and asserts the second call still has a browser to use; write that first, watch it fail, then fix.
2. **Re-run the AbeBooks live proof** once the bug is fixed, to actually demonstrate the 8-row CSV export this task set out to prove.
3. From `docs/roadmap.md`'s v2 section: `api-param` pagination detection and replay; caching the winning pagination config to `domain_intelligence` (the column exists, lookup reads it, nothing writes it yet); infinite scroll and load-more pagination strategies; the progressive-confidence ladder (1 → 5 → 20 → 1000 URLs); a real job queue (an api-server restart still pauses a run — `run_items` survives so `execute` resumes it, but nothing resumes it automatically).

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
