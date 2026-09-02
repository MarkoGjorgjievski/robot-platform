---
name: Session handoff — state, decisions, and what to do next
description: Where the project stands as of 2026-09-02 and how to pick it up. Read this before starting.
type: project
---

# Handoff — 2026-09-02

## Read this first

**Do not start another fix-and-dogfood cycle.** The last correctness push converged on the corpus rather than on reality, each round cost real money, and half the remaining defects are design decisions rather than bugs (see *What NOT to redo* below). If you're tempted to chase extraction-quality numbers, don't — the next work is feature implementation against the roadmap.

**DOM-scroll pagination is live-proven and now delivers a complete listing reproducibly.** 2026-08-25, after a root-cause fix (`5473e89`). Five plan runs against `uniqlo-scroll-live`, a page holding 220 product tiles. The first three under-delivered unpredictably — 220, then 144, then 148 — and the 220 was luck, not correctness. Root cause: `scrollPages` opens its **own** page and used to stamp everything already loaded there before the first scroll, on the assumption the caller had it; but page 1's rows come from `capture`, a **different** navigation, and the two views overlap only by coincidence. Everything in the gap was stamped unseen and never yielded. Fixed by yielding the first round and letting `absorb` dedupe — which is what the spec always said. **The last two runs planned 220 of 220 both times, while page 1's own view still swung 144 vs 108 and the walk compensated exactly.** Full narrative, including two wrong diagnoses on the way: "DOM-scroll pagination — live proof (2026-08-25)" below. Merge commit `382eacd`. A listing that reveals products only when scrolled now has a strategy: `IBrowser.scrollPages` grows the DOM and yields what appeared, `planRun` tries it as the last rung when every other strategy came back empty, and a walk that gains items caches `{strategy: 'dom-scroll'}`. It is exercised end to end in **real Chromium** against fixture pages that append on scroll, recycle nodes, pause a round, and never go quiet — so "offline" here means no network and no spend, not a mock. **No live site has run it.** Task 6 of its plan (live proof) is deliberately unstarted and needs Marko's approval plus a `HEADFUL=1` pre-check that scrolling actually adds products on the chosen target. Full detail: "DOM-scroll pagination (2026-08-25)" below.

**`api-param` pagination is implemented and gated offline, but NOT live-proven.** The `feat/api-param-pagination` branch built it end to end — proving a paging parameter by experiment (probe a page-1-identified JSON endpoint with candidate query params, reject any candidate whose response overlaps page 1's items too much) before it is ever used or cached — and gated it with unit tests plus a Tier 1 fixture-server test that fails if page 2 re-serves page 1. The one live run authorised to prove it (`newegg-gpus-live`, 2026-08-24, run `c889faea-3417-4d36-97cd-1907e55653af`) **fell through to the existing `mechanical` (`url-pattern`) pagination — `api-param` never got a candidate to try.** Do not read "API pagination delivered" as covering the live case; it covers only the offline-gated path. Full detail: "`api-param` pagination — live proof (2026-08-24)" below.

**The multi-page pagination walk is now live-proven, and it live-proved a real bug on the same run.** `crawl.plan` against `abebooks-pagination` walked listing pages 1, 2 and 3, wrote `domain_intelligence.pagination_config` for the first time in this repo's history, and replayed it from cache on a second plan. But the URLs it walked to on AbeBooks were wrong — `deriveTemplate` chose the `ds` query parameter as the page cursor and pinned `p=1`, when `p` is AbeBooks' actual pager, so pages 2 and 3 re-requested page 1 in substance. The stray items that leaked past dedupe (2 and 1, against page 1's 30) were enough to satisfy the `gained > 0` verification gate, so a broken template got cached and then had to be purged by hand. Full detail, evidence, and the live cancel/resume proof: see "Pagination walk + caching — live proof (2026-08-21)" below.

The v2 crawler (listing → detail, two phases) is built and **merged into `main`** (merge commit `3908780`, 2026-08-21). It has been run against a live site end to end twice: once exposed a real shared-browser lifecycle bug in `runExtraction` (7/8 items failed), once after the fix ran clean (8/8 items done, CSV export shows all 8 rows). A follow-up review round found and fixed the identical bug pattern one file over (`runAnalysis` in `analysis-orchestrator.ts`) and made the "whoever launches the browser closes it" rule structural instead of a convention — see `task-9-fix2-report.md`. The full narrative — both live runs' logs, verification queries, and the root-cause walkthrough — lives in `.superpowers/sdd/2026-08-20-v2-crawler-phase2/task-9-report.md` and `task-9-fix-report.md`; this file keeps only what's still true and useful to a fresh session.

## Pre-spend cleanup + cache-reputation repair (2026-09-02): three branches stacked on `feat/repair-engine`, all free

While API funding stays pending, three review-driven branches landed everything fixable without spend. Stack and merge order: `main` ← `feat/repair-engine` ← `chore/legacy-purge` ← `fix/cache-reputation` ← `chore/pre-spend-fixes`. All merge after `feat/repair-engine`'s paid proof (Task 12 Step 2). Full suite + `pnpm typecheck` green at every tip; **`pnpm typecheck` now covers all seven packages** (the dashboard had never been type-checked — it was clean on first check).

- **`chore/legacy-purge`** (5 commits, −888 LOC + ~15 MB): deleted the pre-Source "extractor" era — seven zero-caller routers (`orgs`/`extractors`/`inputs`/`credentials`/`overrides`/`captures`/`extractions`, which also closes the unauthenticated `orgs.delete`/`extractors.delete` cascade exposure), five dead `runs` procedures, the schema-drifted `migrate-cache.ts` (ran `DROP TABLE domain_intelligence CASCADE` — it was a loaded gun), the executed sandbox one-shot `backfill-transform.ts`, Next-era `cn()`/`slugify` + `clsx`/`tailwind-merge`, tracked `.next/` traces and 25 orphaned dashboard PNGs. Tables/columns were **NOT** dropped (needs a migration + history decision). The no-op `pnpm lint` was removed — wiring a real linter is an open decision.
- **`fix/cache-reputation`** (2 commits): the domain cache's feedback loop actually works now. Replayed paths finally earn hits (`ResolvedField.path`, `'xpath-cached'` mapped back to stored identity); attempted-but-failed cached paths take misses — **this lands the "record replay misses" half of the AbeBooks poisoned-titles RCA** (the corroboration half already existed), so the unchanged conservative prune can finally retire that poison; miss accounting is per-path, not per-run; every cache read-modify-write runs under `SELECT … FOR UPDATE` so a dashboard pin can't be lost mid-crawl (real-Postgres interleaving test proves it); the domain-lock double-waiter wake race is fixed. Policy untouched: never-overwrite, no auto-reset, same prune predicate, pin supremacy.
- **`chore/pre-spend-fixes`** (4 commits): `valuesMatch` compares structured values structurally (conflict detection was blind to objects — every pair stringified to `[object Object]`); xpath identity ignores cosmetic whitespace/quote variants (taxonomy class 5 mitigation; stored strings never rewritten); `apiEndpoints` enriches by union instead of freezing at first write; the dead `resolveFromCache` crawl pass is removed and `extraction-architecture.md`/`CLAUDE.md` now describe the real cross-validation; **`effectiveSchema`'s selectorsJson fallback no longer strips `candidate`/`origin`/`input_column`** (a Scratch source's candidate choice — the v2.5 serving order — used to be silently dropped behind an `as OriginField[]` cast; the casts are deleted); the backfill panel gets its checked-set preview from the server instead of a mirrored client derivation; pins are visible in the domain selector table; dead surface removed (`backfillPreview.itemIds`, `scraper.extract.captureId`, `validationResult`/`screenshotPath` reads, `sources.update`'s 15 legacy fields, `requestedFields[].addedAt`).

**Deferred with reasons, not forgotten:** jsonb `fieldPaths` versioning/Zod validation and persisted review flags (hardening features, not fixes); `lastValue` truncation (changes stored shape — decide with the versioning work); `run_items.parentId` FK (migration + delete-semantics decision); dead table/column drops (same); linter wiring (tooling decision); catalogue-tier reputation accounting (v2.5-adjacent design question — selection/displayed serving carries no hit/miss ledger).

**2026-09-02, later: Marko funded the API ($10) and the repair-engine PAID proof PASSED** — Task 12 Step 2 executed on the stack tip: healthy-trio backfill (run `3f094f9c`, 5/5, url+publisher → 40/40, 4 true ISBN absences confirmed-absent, re-preview $0.00) and repair-then-sweep on `listing_id` (guard 5 refused the run without an explicit `deadFieldStrategy`, then run `c96aa7de` completed 40/40 — `listing_id` 0/40 → 40/40 healthy, real ids). Total spend ≤$2.25 by preview upper bound. The cache-reputation fixes were observed working live: the swept json-ld path accrued 36 hits with 2026-09-02 timestamps. Full record: `docs/testing/2026-09-02-repair-engine-paid-proof.md`. **The stack is clear to merge.** Still unspent from the paid queue: probe-confirm Step 3 (No-path diagnosis demo — needs Marko at the dashboard), candidate-labelling live dogfood (~$0.15), the five-domain quality measurement (~$4).

## Repair engine (2026-08-28): built, review-clean, free-proven — paid proof parked on API funding

**Coverage + backfill shipped on `feat/repair-engine` (Tasks 1-11 of `docs/superpowers/plans/2026-08-28-repair-engine.md`, all review-gated).** What exists: per-run coverage (fill counts derived from `extractions.data[0]` key presence against `effectiveSchema` — deliberately no per-field status persisted), gap filters + row selection + "Re-extract selected" in the run view, the `backfill` run flavor (`inputLabel:'backfill'`, `parentRunId`, per-item `target_fields` focus through claim→extract, cell-level merge into the parent with the hard invariant that a filled cell is NEVER overwritten and `'done'` MEANS merged — a merge throw fails the item retryably), `absent_fields` marking so a true absence stops costing money (`confirmed-absent` cells are excluded from future derivations; a heal re-rolls-up the parent without ever un-cancelling it), dead-field repair-then-sweep (`<50%` fill → 3 dead-first-ordered samples → evaluate the PARENT's merged rows → sweep on ≥2/3 or an honest `repair_failed` warning; Stop and duplicate-backfill are re-checked before the sweep), persisted requested fields flowing into analyze (`name: hint` lines, earliest-delimiter split), per-field enable toggles, the add-fields control at Set-up and the confirm gate (save is free; re-analyze is always its own labeled costed click), and a checkbox-following cost preview that can only overstate. The final whole-branch review's money-seam audit passed: every Anthropic-reaching route traces to an explicit click, and the emptiness semantics (`== null || === ''`; 0/false/whitespace are FILLED) are byte-identical across coverage, merge, repair-sweep, and the UI. **Free live proof done** against the AbeBooks crawl `6c0a9463` (badges reproduce the known fill table; filter/select/clear verified; title/author/image_url/listing_id classified dead; add-fields round-trips) — record: `docs/testing/2026-08-28-repair-engine-free-proof.md`; final-review findings + fixes: `docs/testing/2026-08-28-repair-engine-final-review.md`. **NOT done: the paid live proof** (plan Task 12 Step 2 — backfill isbn/publisher/url, repair-then-sweep listing_id) — parked until Marko confirms the Anthropic account is funded. Known accepted gaps, ledger-ruled: spec §2.6's guided "field added → backfill history?" chain exists in no form (ticket); backfill runs' own export carries partial audit rows without a caveat (shaping initiative's export work); "Request more fields" is unavailable on a FAILED probe run (matches the plan literally — product call pending).

**Next initiative, approved and queued:** dataset shaping (`docs/superpowers/plans/2026-08-28-dataset-shaping.md`, all AI-free) — starts on a fresh branch after this merges.

## MVP simplification — Task 12 (2026-08-28): probe-confirm live-proven end to end; five defects found and fixed by the proof

**The declared-sources + probe-confirm flow works, live, on real money, with Marko clicking the gate.** Source `abebooks-com-353m8e` (Scratch project, listing mode, two AbeBooks SearchResults inputs) went through the whole lifecycle: quickCreate via the real home flow → explicit Analyze click (30 rows, `url-pattern` pagination, 19 fields with live examples) → probe run `f89905b1` (row plan **replayed from cache with zero AI**, terminal `partial`, 3 sample rows, gate rendered with evidence and no spend-capable controls) → Marko clicked Yes → `confirmed_at` set, full run `6c0a9463` (completed, 40/40 items, JSON+CSV export sane). **The proof was the point: each probe attempt flushed a real defect per-task reviews couldn't see.** Fixed in-branch, all TDD'd: (D1/final-review F1) a limit-stopped run finalised to `'extracting'` forever — now `limitReached` threads to a terminal `'partial'`, and `completed_at` is the one terminal marker; (D1) listing plans required a fresh `generateSelectors` AI call every time and a swallowed failure produced a silent 0-item `'planned'` run — the proven row plan is now persisted in `domain_intelligence.row_selector` (`source:'verified'`, hit/miss counted, human pins never overwritten) and replayed before AI, and 0-item walks warn; (D2) the duplicate-probe guard keyed on a status allowlist and permanently wedged a source whose probe found 0 items — guards now key on `completed_at IS NULL`; (D4) the crawl budget was spent as a source total, silently starving every listing input after the first — now per listing input with cross-input dedupe; (D5/F4 family) the synthetic `detail_url` planning field leaked into detail extraction, the results table, and the export — filtered at `effectiveSchema`, the dashboard table, and `build-run-export`. Residuals, parked with rulings in the ledger: the row-plan merge is positional (R10 — identity-based matching is future work), and **the garbled titles/authors (4/40) are pre-existing cache poisoning, NOT this flow** — AbeBooks' pricing API echoes normalized search keys as `bibliographicDetail`, the mechanical tier cached the echoes, and replay misses are never recorded so the prune can't retire them (full RCA: `docs/testing/2026-08-28-abebooks-poisoned-titles-rca.md`; the fix — corroborate API display-text against visible page text + record replay misses — is the cache-quality initiative). Step 3 of the live proof (the No-path diagnosis demo) is **deliberately unstarted**: the Anthropic API account is not funded as of 2026-08-28 and nothing that might reach the API runs until Marko confirms payment.

**Next work, specced and planned from Marko's post-proof feedback:** `docs/superpowers/specs/2026-08-28-repair-engine-design.md` (coverage reports, backfill runs, repair-then-sweep, schema add-fields — plan: `docs/superpowers/plans/2026-08-28-repair-engine.md`, Tasks 1-11 AI-free, Task 12 gated on funding) and `docs/superpowers/specs/2026-08-28-dataset-shaping-design.md` (non-destructive per-dataset output shaping; plan not yet written). The live crawl's fill-rate table (`title` 4/40, `image_url` 13/40, `listing_id` 0/40, most fields 36-40/40) is the repair engine's acceptance data — see `docs/testing/2026-08-28-probe-confirm-crawl-verification.md`.

## MVP simplification — Task 11 (2026-08-27): the sandbox/graduate world is deleted

`.superpowers/sdd/2026-08-26-mvp-simplification/`. Tasks 9-10 shipped the replacement world:
declared-mode home flow (paste URLs, pick a mode, land on a real Source under the Scratch
project — no more throwaway `/sandbox/{slug}` draft), the Source workspace
(`packages/dashboard/src/routes/source-setup.tsx`) with the ported schema-discovery wizard
(field table, provenance badges, mode-aware Extract), `sources.quickCreate` / `sources.analyze`
/ `sources.confirm`, and the probe-confirm gate (a listing Source runs a small probe, a human
confirms the schema looks right, only then does `confirm` kick off the full crawl). Task 11
(this entry) deleted the world that flow replaced: `packages/dashboard/src/routes/sandbox-index.tsx`,
`sandbox-detail.tsx`, `packages/dashboard/src/components/graduate-form.tsx`, their route
registrations and the header nav link; `packages/api/src/routers/sandbox.ts` + its test and
router-index registration; the `is_sandbox` filters that hid Scratch's sources from ordinary
project/domain views (`projects-list.tsx`'s `p.slug !== 'scratch'` filter, `domains.ts`'s
`isSandbox` where-clauses, `sources.ts`'s `sources.list` filter) — **Scratch is now a visible,
ordinary project**, and its sources appear in every list like any other project's. The
`is_sandbox` column, its migrations, and the CHECK constraint that uses it are untouched — kept
for the schema shape and for tests that still use `isSandbox: true` to satisfy
`sources_non_sandbox_requires_dataset` without a full dataset chain. `packages/db/src/scripts/seed-sandbox.ts`
(which seeds the always-present Scratch project) was renamed to `seed-scratch.ts`
(package.json script `seed:sandbox` → `seed:scratch`, root `db:seed` updated to match) since
the rename was trivial and the old name no longer matched what it does. `pnpm -r test` (all 7 packages),
`pnpm typecheck`, `pnpm --filter @robot/dashboard exec tsc --noEmit`, and the cache-hygiene gate
are all green as of this commit.

## v2.5 candidate labelling — Task 11 (2026-08-26): Tier 1 fixture gate landed, live dogfood NOT run

Tasks 1-10 of `.superpowers/sdd/2026-08-25-candidate-labelling/` are built and merged into
`feat/candidate-labelling` (catalogue types/plumbing, `lastUrl` + narrowed conflicts, AI-native
catalogue discovery, the cold-catalogue trigger, selection/displayed serving through the real
extraction pipeline per ruling R5, the displayed-verification judge + `markDisplayed`, the API
surface, and the dashboard candidate picker). Task 11 Steps 1-3 (this entry) added the Tier 1
proof that selection and the displayed default actually survive the whole chain on a REAL captured
page, not just a hand-built `PageCapture`: `packages/scraper/src/__fixtures__/catalogue-serving.test.ts`
seeds a `DomainCache` whose `fieldPaths` **and** `candidateCatalogue` both carry two genuine XPath
price candidates from the `newegg-gpu-listing` fixture (`//div[@id="item_cell_..."]//li[@class="price-current"]/strong`,
resolving to two different real on-page prices, 1029 and 649) and calls `runExtraction` directly
(not `runFixtureReplay`, which builds its cache with `as DomainCache` and silently drops
`candidateCatalogue` — see the file's header comment) to prove: (a) no selection + a `displayed`
candidate → the displayed value is served; (b) an explicit selection of the other label → that
value overrides the displayed default. Both assertions were confirmed to bite for the right
reason — verified by temporarily stripping the selection from case (b) (fails: 649 received where
1029 was expected) and by temporarily zeroing `candidateCatalogue` entirely on both cases (fails:
falls back to whichever `xpath-cached` path STEP 1.5 ranks first, wrong value AND wrong source
`xpath-cached` instead of `xpath`), then reverting both. `pnpm -r test` (all 7 packages), the
cache-hygiene gate, `pnpm typecheck`, and `pnpm --filter @robot/dashboard exec tsc --noEmit` are
all green as of this commit.

**Step 4 (live dogfood) RAN on 2026-08-26 with Marko's go — twice, because the first run
found a real bug.** The branch was merged to main (`703c769`) first; then:

- **Run 1: all three extractions succeeded (94/92/95% confidence) and discovery wrote NOTHING,
  silently.** Root cause (`e6bc39d`): the `record_catalogue` tool schema declared
  `properties: {}` because a record with dynamic concept keys cannot be named in JSON schema —
  so the model invented its own output shapes and every response sanitized to `{}` with no log
  line. Diagnosed with a gate-instrumentation run plus a standalone discovery probe (which got
  a third shape — a flat `candidates` wrapper). Fixed by prescribing an explicit envelope
  (`{ concepts: [{ concept, candidates }] }`) the parser unwraps, keeping the bare record as a
  fallback, and warning loudly when discovery returns nothing valid — the silent-empty was the
  exact failure class the "no silent caps" rule exists for.
- **Run 2 (post-fix): Target 14 concepts, B&N 17 concepts, catalogued and saved.** The
  catalogues are good: Target's `price` concept holds five labelled candidates
  (`current_price` $269, `reg_price` $299, numeric twins, and `protection_plan_price` $50 —
  the wrong-entity class, now visible and labelled instead of silently pickable). **Newegg
  returned "no valid candidates" both runs** — the new warning surfaces it; likely the 30KB
  prompt slice truncating Newegg's huge API blobs so the model's paths fail the
  fabricated-path check. Needs its own look (entity-scoping the bodies per spec §4 is the
  probable fix); do NOT weaken the fabricated-path gate to make it pass.
- **Displayed-verification (`verify-displayed.ts` CLI) ran on Target and B&N and hand-review
  caught a real judge weakness:** it marked Target's `price` as
  `displayed: protection_plan_price` — the $50 warranty add-on IS visible on the page, and the
  judge prompt asks "what does the page show for price" without scoping to *the product's own
  price*. **The flag was cleared by hand (`markDisplayed(..., null)`) the same hour — nothing
  serves it.** B&N's verdicts were honest (description matched; NONE elsewhere). Before
  displayed-verification is trusted unattended, the prompt needs product-scoping (and a
  multi-visible-prices calibration case: the current calibration fixture never tests this).
  Until then, treat `displayed` flags as operator-confirmed only.

**Open items from the final-review fix wave (2026-08-26):** the results-table tooltip names the
selected candidate but not the actually-serving one (the displayed-default, when it wins, is
unannotated). Per-hostname selection scoping is a recorded follow-up from ruling R6 (today a
selection applies dataset-wide, not per contributing source hostname).

**Follow-up session, same day: Newegg discovery fixed, judge scoped, conflicts triaged (2026-08-26).**
- **Newegg discovery empty — root-caused and fixed (`1cccc60`), live-proven (5 concepts saved).**
  It was output-side truncation: the catalogue tool call ran at the 4096 default max_tokens, a
  rich page overran it, and a truncated tool_use parses as `{}`. `callWithTool` now throws on
  `stop_reason: max_tokens` (an absent answer must never impersonate an empty one — check this
  on every new tool), the catalogue call gets 8192, `sampleValue` is capped at 160 chars in the
  sanitizer, and API evidence is serialized per body (product-bearing first) instead of one
  30KB slice that used to cut Newegg's first 37KB body mid-JSON.
- **Displayed judge scoped to the main product (`1cccc60`).** The prompt now names the
  wrong-entity values that don't count even when visible (protection plans, accessories,
  bundles…); the calibration fixture carries a visible $9.99 protection-plan distractor and the
  gated case fails if the scoping regresses. `pnpm test:judge` in hand. Target/B&N `displayed`
  flags can be re-verified with `verify-displayed.ts` when screenshots are next in hand.
- **Conflict panels ("large red areas") triaged, 18 → 15 (`e6c3a79`).** Two mechanical rules
  landed: a conflict whose paths include a pinned/human path no longer reports (the pin IS the
  operator's ruling; unpinning re-arms it), and discovery is told to label every
  extraction-used path. Newegg listing `detail_url`'s junk XPaths were resolved by pinning
  `.//a[@class="item-title"]/@href`. **The remaining 15 are honest**: 1 stale cross-page
  artifact (AbeBooks `product_name`, self-heals on its next crawl once `lastUrl` stamps), and
  ~14 genuine same-page multi-valid disagreements (rating systems, granularities, phrasings)
  that stay red until their paths are labelled. **The structural gap, recorded as the next
  increment (do not drive-by):** discovery's evidence carries only each field's WINNING path,
  so the cache's other disagreeing paths cannot be labelled; and `parseCatalogueResponse`
  validates candidate paths only against api bodies + used paths, not against json-ld/meta
  evidence. Extending the evidence with the cached per-field paths (+ their lastValues) and
  teaching the validator to resolve json-ld/meta paths would let the labelled-different
  suppression clear most of the remaining panels.

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

**The consequence: `gained > 0` is too weak a bar for "this config works."** `plan-run.ts` writes `pagination_config` whenever a walk yields at least one new item. 2 + 1 = 3 stray items were enough to pass that bar, so the broken `ds`-based template was certified and cached — a pre-existing gap in the Task 3/4 verification logic that this live run is what exposed it. It was purged by hand (`delete from domain_intelligence where domain='www.abebooks.com' and page_type='listing'`) rather than shipped; the row's exact contents before deletion are recorded in `task-6-report.md`. **Do not re-cache it** without first fixing `deriveTemplate` (in `@robot/browser`) or tightening the verification gate — ideally both. A candidate fix for the gate: treat a page yielding only a small fraction of page 1's item count as evidence of a broken pager, not a thin real page, rather than trusting `gained > 0` alone. **That ratio must not be implemented naively as a refusal.** `absorb` passes `remaining: cap - detailCount()` into `enumerateDetailUrls`, so a genuinely working pager legitimately gains only 1-2 new items on page 2 once the item budget is nearly full — which is this repo's own default `{max_items: 8, max_pages: 2}` shape. A bare ratio gate would refuse those correct configs, the cache would never warm, and the feature would deliver nothing. So as of 2026-08-21 the ratio shipped as a **warning only** (`THIN_WALK_SHARE` in `plan-run.ts`, suppressed whenever the walk was stopped by the item budget rather than by the pager). **UPDATE 2026-08-25: the budget-aware refusal is now implemented** — thin AND not-budget-stopped refuses to cache the config (planned items are kept; only cross-customer certification is withheld), while a budget-stopped thin walk still caches, so the default budget shape still warms the cache. Gated by tests including the AbeBooks 30-vs-3 shape.

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

## DOM-scroll pagination — live proof (2026-08-25)

Task 6 of `docs/superpowers/plans/2026-08-24-dom-scroll-pagination.md`. **Plan-only** — listing pages
only, no detail fetches.

**Target selection was evidence-first, and that is the transferable part.** The `api-param` live proof
failed because its target came from a roadmap note; Newegg renders its grid server-side, so the strategy
never got a candidate to try. This time nothing was spent until a free probe
(`packages/browser/scroll-probe.mts`) had shown the page actually grows. Three candidates, measured by
counting distinct product links across scroll rounds:

| Candidate | Series | Verdict |
|---|---|---|
| `uniqlo.com/us/en/men/tops` | 37 → 73 → 109 → 145 → 181 → 217 → **221** | grows, then tapers — a real finite scroll list |
| `target.com/c/laptops…` | 0, flat, empty `<title>` | anti-bot block page, not a listing |
| `currys.co.uk/…/laptops` | 116, flat | server-rendered, paginated |

The Uniqlo taper (+36 per round, then +4) is what made it the right target: it proves the list *ends*,
so the quiet-round rule could be exercised live rather than the budget simply binding.

**Budget rulings, both deliberate departures from the plan's text.** The plan's Step 2 says
`{max_items: 40, max_pages: 1}`. Both numbers were changed, for reasons worth keeping:

- **`max_items: 250`, not 40.** In plan-only mode item count does not drive spend — the AI cost is page-1
  schema discovery, identical either way. With 37 products on the first screen a cap of 40 binds after one
  round and proves little more than the fixtures already do. 250 let the walk run to natural exhaustion.
- **`max_pages: 3`, not 1.** `max_pages: 1` takes the short-circuit branch that (by follow-up 2 below)
  never consults the cache — so Step 4's warm-replay proof would have been untestable. `max_pages` is not
  consulted by this strategy anyway, so raising it changes nothing about the walk.

> **RESOLVED (same day, commit `5473e89`).** The walk now plans 220 of 220 on this
> listing, twice in a row. Root cause and the two wrong turns on the way to it are below;
> the run-by-run numbers in this section are kept because the *pattern* across them is the
> evidence, and because two confident diagnoses died here.
>
> | Run | page 1 saw | scroll rounds (rows→planned) | planned | verdict |
> |---|---|---|---|---|
> | `a2c67dc9` cold | 144 | *(no trail yet)* 36 / 36 / 4 | 220 | right by luck |
> | `03c5cc22` warm | 144 | *(no trail yet)* — gained 0 | 144 | lost 76 |
> | `4dd07799` warm | 72 | 36→36, 36→36, 4→4 | 148 | lost 72 |
> | `71af7d6b` **fixed** | 144 | **180→36**, 36→36, 4→4 | **220** | complete |
> | `3c007f3a` **fixed** | 108 | **180→72**, 36→36, 4→4 | **220** | complete |
>
> **Root cause.** `scrollPages` opens its OWN page, and how much a lazy listing has loaded
> by the time it starts is a race — 36, 108 and ~144 rows were observed on the same URL.
> Page 1's rows come from `capture`, a different navigation, which observed 144, 144 and 72.
> The generator stamped its whole initial view before the first scroll, reasoning it
> "belongs to page 1, which the caller already has". The two views overlap only by
> coincidence; everything in the gap was stamped unseen and never yielded, invisibly,
> because a stamped row is indistinguishable from one already reported.
>
> **The fix, and why it is the spec's own rule.** The generator now yields what it can see
> on the first round and lets `absorb` dedupe. Spec §4 already said correctness comes from
> the caller's `seen` set and that labels are only an optimisation — stamping the initial
> view had quietly promoted the label to load-bearing. The last two rows above are the
> proof: the round-2 `planned` count (36 vs 72) absorbs page 1's swing (144 vs 108) and the
> total lands on 220 either way. **The total is now invariant under the race that used to
> determine it.**
>
> **Coupled change.** Once the first round yields the initial view, that round is usually
> ALL duplicates of page 1 — which used to break the walk. Only `'budget'` is terminal now;
> a fully-duplicate round is the normal shape of a scroll round, and the generator's
> quiet-round rule is what decides the list has ended. That closes the old follow-up 1.
>
> **Two wrong diagnoses, kept because both were confidently written down.** First: "the
> warm path caches no row definition, so `row_xpath` drifts." Dead — `planned == rows` in
> every round, so nothing was being mis-scoped. Second: "the walk stops after three rounds
> and never exhausts the listing." Also dead — the walk reaches the end and stops correctly
> on two quiet rounds; it was the *start* that was wrong, not the end. Both survived because
> the totals were plausible. What killed them was instrumenting the generator
> (`SCROLL_DEBUG=1`) and watching it run.
>
> <details><summary>Superseded analysis, kept for the reasoning trail</summary>
>
> **CORRECTION (after the audit-trail fix `c029cc6`).** Everything from
> "Cold run" to the end of the warm-run analysis below was written before scroll rounds
> were observable, and two of its conclusions are wrong. A third plan run
> (`4dd07799-eacd-4eb7-8551-a59ae87ea1df`) with the trail in place shows:
>
> | Run | page 1 | scroll rounds (rows/planned) | total |
> |---|---|---|---|
> | cold `a2c67dc9` | 144 | 36 / 36 / 4 | 220 |
> | warm `03c5cc22` | 144 | *(no trail — not observable)* | 144 |
> | warm `4dd07799` | **72** | 36 / 36 / 4, every row planned | 148 |
>
> - **"Ended by the quiet-round rule at the list's end" is not supported.** The walk yields
>   exactly three rounds and stops, identically in both runs where it ran, on a page holding
>   ~221 products. 220 was page 1's 144 plus the walk's 76 — two partial views summing.
>   The budget never bound, but neither did the end of the list.
> - **The warm-path row-definition theory is dead.** `planned` equals `rows` in all three
>   rounds, so the walk plans everything it yields: nothing is being lost to a bad
>   `row_xpath`, and nothing is being lost to duplicates.
> - **Page-1 extraction is itself variable** (144, 144, 72) — capture scrolls the page while
>   tiling screenshots, so how much has loaded when page 1 is extracted is a race. That is a
>   second, independent source of variance and it is not the scroll walk's doing.
> - **The zero-gain warm run did NOT reproduce.** Run `4dd07799` gained 76. Whatever
>   happened in `03c5cc22` is still unexplained; it is now bounded to "no rounds yielded" vs
>   "rounds yielded, all duplicates", and the trail will say which if it recurs.
>
> **Open question for the next cycle:** why three rounds? The free probe walks the same page
> 37 → 73 → 109 → 145 → 181 → 217 → 221 with 2.5s pauses, so the content is there. The walk
> stopping at ~113 products points at the generator's growth wait
> (`GROWTH_TIMEOUT_MS = 3000`) or its quiet-round accounting, neither of which is observable
> from outside. Instrumenting the generator's per-round row counts is the next step — the
> trail records what was *yielded*, not what the generator *saw*.

**Cold run — as originally written (run `a2c67dc9-eeb2-442d-bea3-56e3f27bbcf9`, 173.2s).** 220 detail items, 220
distinct URLs, **zero duplicates**. Detail items by `page_number`, which for this strategy is the scroll
round: **144 / 36 / 36 / 4**. The budget of 250 never bound, so the walk was ended by two consecutive quiet
rounds — **the quiet-round rule, live**. The final +4 round matches the probe's taper exactly.
`domain_intelligence.pagination_config` for `(www.uniqlo.com, listing)` is `{"strategy": "dom-scroll"}`.
The reason-specific `api-param` warning added in the previous cycle also fired correctly and for the right
reason ("no intercepted JSON response carried page 1's detail URLs, 2 considered"), which is incidental
live confirmation that *that* fix works.

**Warm run — the defect (run `03c5cc22-57f0-4ece-a30e-934e591c9a62`, 176.8s).** `domain cache: warm`, so
the cached config was read. But: **144 detail items, `page_number` 1 only**, all 144 a subset of the cold
run's 220. The scroll walk gained nothing, and the only signal was
`pagination (cache: dom-scroll) produced no new items` — which reads as *"the list is finished"*, not
*"I stopped 76 products early"*.

**What is established, and what is inference.** Proven: both runs' numbers above; the page still grows on
scroll when re-probed *after* both runs, so this is not throttling and not a site change; `rowSelector` is
written in exactly one place in the codebase (`packages/api/src/routers/scraper.ts:130`, with
`source: 'human'`), so the automatic path **never** persists it; and the two runs recorded *different*
row-level `detail_url` xpaths (`.//@href` cold, `.//a[contains(@class,"product-tile__link")]/@href` warm).

Inferred, and needing its own cycle to confirm: **`dom-scroll` is the first cached strategy whose
behaviour depends on something the cache does not store.** `url-pattern` caches a self-contained template;
`{"strategy": "dom-scroll"}` caches nothing about *what a row is*, yet the walk's growth detection
(`rowCountScript`), its stamping, and its extraction scoping (`unseenXpath`) all key off `row_xpath`,
which is re-derived per run. A warm run can therefore scroll with a different row definition than the one
that was verified when the config was cached.

**One thing the run could NOT distinguish, and why.** "The generator yielded zero rounds" and "rounds were
yielded but every row was a duplicate" produce identical evidence — same item count, same warning, same
`page_number` distribution. The per-round `listing` rows would have told them apart, but scrolling never
changes the URL, so all of a run's per-round listing rows collapse to one under the unique index. That was
logged as a cosmetic follow-up on the branch; it is not cosmetic, it destroys the per-round audit trail,
and it is now the first thing to fix before re-running this.

</details>

**What these runs do NOT prove.** No detail page was fetched, so per-item extraction is untouched by them.
The load-more *button* trigger was never exercised — Uniqlo scrolls, and `findLoadMore` returned nothing,
so the cached config has no `loadMoreSelector`. Cursor APIs and POST/GraphQL remain uncovered by
`api-param`; this strategy covers them only incidentally, and nothing about those transports was tested.
No anti-bot interference on Uniqlo across four separate sessions; **Target blocked every request**, which
is a corpus fact.

**Corpus addition.** `uniqlo-scroll-live` is seeded (source `ffff6666-…-006`, input set
`eeee5555-…-005`) and is the corpus's only known infinite-scroll target. Its budget is left at the
conservative `{max_items: 40, max_pages: 3}`; the 250 used for the proof was a deliberate one-run raise.

## DOM-scroll pagination (2026-08-25)

The transport-agnostic last rung. Every other strategy needs a thing to act on — a URL template, a
next button, numbered links, a JSON endpoint with a page parameter. A listing that loads by scrolling
has none of them, and until now produced `no pagination detected … — planned page 1 only`.

**What it does.** `IBrowser.scrollPages` (`packages/browser/src/playwright-browser.ts`) is an async
generator that owns its page for the duration: it scrolls (or clicks a heuristic-matched load-more
button), waits for the row count to actually grow rather than sleeping a fixed delay, re-runs page 1's
own extraction plan scoped to unlabelled rows, stamps what it extracted, and yields the batch. It has
to live in the browser package: `IBrowser.evaluate(url, script)` navigates, so a Node-driven loop would
reload the page every round and destroy everything already loaded. `planRun` calls it from two places —
the give-up point where detection came back empty, and the `max_pages <= 1` branch, which is the one
rung such a config can actually use.

**Three things that are load-bearing and non-obvious, each established by measurement, not reasoning:**

- **The scroll trigger scrolls UP and then down.** `window.scrollTo(0, document.body.scrollHeight)`
  alone yields row counts `[1, 2, 2, 2]` — it stalls after one batch, because the page is already at the
  bottom and no new scroll event fires. `scrollTo(0, 0)` then `scrollTo(0, bottom)` yields `[1, 2, 3, 4]`.
  The comment in the source records both sequences; don't "simplify" it back.
- **`rowCountScript` deliberately counts ALL rows, stamped or not.** The growth wait is about the DOM
  growing, not about new *unseen* rows appearing; counting only unstamped rows makes a recycling list
  look permanently quiet.
- **The extraction script forces LISTING page-type.** `buildExtractionScript`'s `auto` heuristic flips to
  detail mode at 0-or-1 rows, and detail mode's fallback re-searches the whole document — which defeats
  the quiet-round check and produced five 60s timeouts before it was found. This was invisible to string
  assertions and to mutation testing; it only surfaced by running the built artifact in a real browser.

**Budgets.** `max_items` is the only budget consulted, and it counts **planned items, not yielded rows** —
`absorb`'s dedupe is what turns rows into items and it lives in Node, where the generator cannot see it.
`max_pages` is deliberately ignored so a Source configured for HTML pagination cannot silently cap a
scroll listing at two rounds. That makes `max_items`, `QUIET_ROUNDS = 2` and `MAX_SCROLL_ROUNDS = 50`
load-bearing rather than backstops, which is why the last exists.

**Labels are an optimisation, never correctness.** Rows are stamped `data-robot-seen` so round N extracts
only new cards — linear instead of quadratic over a 500-item scroll. When a virtualized list recycles a
node the stamp goes with it, the card is re-extracted, and the URL dedupe discards it. Nothing breaks.

**No AI fallback for the load-more selector, on purpose.** The spec allowed one; the cycle did not build it,
and the whole-branch review sharpened the reason: `gained > 0` does not verify a *button*. A "Show more
colours" facet toggle yields real, well-formed detail URLs and would satisfy that gate — so an AI-chosen
selector would be an unverified answer entering the cache tier, which is the failure this project has
been burned by twice (the AbeBooks `ds` template, the api-param fabricated URLs). If it is ever built, it
needs a verification that distinguishes "more of the same list" from "a different subset of the list".

**Quality of the gate.** The whole-branch review prescribed eight mutations and **all eight were killed** —
this repo's first clean mutation sweep, after a cycle that produced ten tests that ran fine and proved
nothing. Two worth remembering: `QUIET_ROUNDS 2 → 1` fails exactly one test *while making the suite
faster* (a mutation that looks like an improvement), and deleting the stamping script fails six tests, of
which only one fails on a **value** rather than a 60s timeout — the kind of coverage that quietly
evaporates during a timeout-tuning session.

**Pre-merge fix wave** (`c9f3105`, `41ed593`, `c1d4dbd`). The review returned DO NOT MERGE on one finding:
both scroll call sites sat **outside** the per-input try/catch that isolates a pagination failure, because
both `continue` before it. A throw from the live walk — `navigateWithFallback`, `dismissPopups`, any
`page.evaluate`, none of them `.catch`-guarded — therefore rejected `planRun` itself, so the run was marked
`failed` and `insert(runItems)` was never reached: **every already-planned input's detail URLs discarded.**
Verified with a throwing stub at both sites, not by reading. Fixed with a wrapper at each site, duplicated
rather than factored out precisely so one deletion cannot unguard both. Two more fixed in the same wave:
the item budget counting yielded rows (silent under-delivery on exactly the virtualized listings this
feature exists for), and the multi-round property having no teeth — every fixture used a single round, so
capping rounds at `max_pages` left the whole suite green.

**Open follow-ups, in rough priority order.** Reordered after the live proof: the warm-path defect it
found now leads, and the "duplicate listing row" item was promoted out of cosmetic because it is what
stopped the run from being self-diagnosing.

0. ~~The walk does not exhaust the listing.~~ **Fixed** in `5473e89` — root cause was the generator
   discarding its own initial view, not an early stop. 220 of 220, twice. See the RESOLVED block above.
0b. ~~Per-round `listing` rows collapse under the unique index.~~ **Fixed** in `c029cc6`: rounds are
   not pages, so the trail lives on page 1's row as `listing_values.scroll_rounds`, one entry per
   yielded round carrying `rows` and `planned`. Every diagnosis since came off that trail.
0c. ~~Page-1 extraction is racy.~~ **Fixed** in `914dd90`. It was not the screenshot tiling — `page.content()`
   is taken before the tiles. It was `expandHiddenContent`'s Phase 1 clicking its structural selectors
   (`[aria-expanded="false"]`, `details summary`) through a Playwright **locator**, which scrolls the
   element into view to click it; on a lazy listing that loads batches. Phase 1 now clicks in the page,
   as Phase 2 already did. Deliberately NOT fixed by skipping out-of-viewport elements — collapsed spec
   panels on a detail page are almost always below the fold, and that would have silently stopped
   expanding them. **Verified against a fixture only**: Uniqlo started returning Akamai "Access Denied"
   before it could be re-checked live, so the JS-click-vs-real-click change has no live confirmation yet.
   If detail-page extraction quality dips, this is the first place to look.
0d. **`uniqlo-scroll-live` is rate-limited.** Akamai "Access Denied" after roughly ten runs on
   2026-08-25 — plan runs, the free scroll probe and the generator harness combined. Not a code defect;
   the spec's risk table predicted repeated scrolling would be a visible bot signal, though cumulative
   request volume is the likelier cause. **Back off before using this source again**, and expect the
   first re-run to be a block rather than a regression.
0e. **The load-more button trigger has never run live.** Uniqlo scrolls, so `findLoadMore` returned
   nothing and the cached config carries no `loadMoreSelector`. That half of the strategy is still
   fixture-only.

1. **`walkScrollPages` breaks on any non-null `absorb` result, so `'all-duplicates'` ends a scroll walk
   after ONE quiet round** — bypassing `QUIET_ROUNDS` and contradicting the spec's own stop-signal
   decision ("a single slow round is not the end of a list; treating it as one is silent truncation").
   Reachable: the generator waits for *row-count* growth, and on a virtualized list growth can be pure
   recycling, so a window re-serving only seen cards reads as all-duplicates mid-list. Not fixed in the
   wave because the break is shared verbatim with the HTML and api-param walkers, where it IS
   load-bearing — diverging scroll from them is a design decision, not a three-line fix.
2. The `max_pages <= 1` branch never consults the cache before scrolling, so it can overwrite a proven
   config without the `replacing` warning the main path emits, and re-writes it once per input.
3. A domain with a stale **non-scroll** cached config can never reach the scroll rung — a site that
   replaces its pager with infinite scroll stays stuck on page 1 until someone clears the row by hand.
4. `[role=button]` is in the spec's load-more heuristic but in neither the code nor the tests.
5. A false-positive `loadMoreSelector` disables scrolling entirely, because the trigger is an if/else.
6. `ScrollOptions.maxItems` now has no production caller; only its doc comment stands between a future
   caller and the row-vs-item bug that was just fixed.

**What this does NOT prove.** No live site has exercised it. Cursor-based APIs, POST and GraphQL endpoints
remain uncovered by `api-param`, and are covered by this rung only insofar as they make the DOM grow —
which is the whole point of the design, but is untested against a real one.

## Cache-conflict triage (2026-08-25)

Marko's "cache conflicts / AI indecisive" complaint, triaged against the actual
`domain_intelligence` contents (15 conflicting fields across 4 domains). Every candidate value was
inspected; the classification below is from that evidence, not from the taxonomy that predicted it.

**The mechanisms actually present — five, not three:**

1. **Poisoned paths** (wrong-entity paths with perfect hit records). Confirmed instances:
   Newegg `product_name` ← api `Configs[0].name` (a feature-flag label — the motivating case
   already documented in `domain-cache.ts`); Newegg `image_url` ← json-ld `thumbnailUrl` (a
   YouTube review thumbnail, and it OUTRANKED the real og:image on hits 6-2); Newegg listing
   `detail_url` ← `.//a` / `.//a[@href]` (privacy-policy links, low-ranked but present); B&N
   `image_url` ← a Yotpo *customer review photo*. Two structural findings: **a poisoned path can
   never prune itself** — `hits` counts "returned non-empty", so garbage paths have 100% hit
   rates and the ≤10% prune bar never triggers; and **a sole poisoned path is invisible to
   conflict detection**, which needs ≥2 valued paths — Target `availability` (delivery date) is
   exactly this, so the worst case never appears in the conflicts UI.
2. **Multiple simultaneously valid values** — the biggest bucket, and exactly Open decision 1 /
   vision Pillar 1: Newegg `category` (breadcrumb "Internal SSDs" vs API "SSD"), `description`
   (json-ld long vs meta short), Target `review_count` (rating count 5 vs review count 3 — two
   different metrics), B&N `rating_value`/`review_count` (site's json-ld vs Yotpo — two different
   review systems). No fix exists at the extraction layer; needs labelling.
3. **Format-only disagreement**: Target `price` "$299.00" (api) vs `299` (api-ai) — same fact,
   `valuesMatch` sees a conflict. A normalization in `valuesMatch` would silence this class.
4. **Stale cross-page comparisons** (false conflicts): AbeBooks `product_name` api-vs-xpath and
   Newegg `product_name` json-ld-vs-og:title "conflicts" compare `lastValue`s captured on
   *different pages* (different products entirely). `detectPathConflicts` has no way to know two
   paths were last exercised on different URLs. **Cross-validation flip-flop, the third
   predicted mechanism, was NOT observed — what looks like it is this staleness artifact.**
5. **AI path-identity churn**: `ai-discovered-variants` uses the AI's prose *description* as the
   path key, so every re-discovery adds a "new" path (Newegg `variants`: 5 near-duplicate
   entries). Inflates conflicts and crowds the 5-path cap.

**Acted on (2026-08-25):** Newegg `product_name` pinned to json-ld `name`, Newegg `image_url`
pinned to meta `og:image` — via the real `pinFieldPath` machinery, verified in the DB (one pin per
field, losers kept with stats). The pin machinery itself is fully wired end to end (ranking,
prune protection, tRPC, domain-detail UI) — nothing needed building.

**Left for Marko:** Target `availability` (delete the sole poisoned path by hand + re-discover, or
wait for labelling); the low-ranked junk `detail_url` xpaths (harmless while outranked); classes
2-5, which are design work — class 2 is the candidate-labelling spec (v2.5), classes 3-5 are
small extraction-layer fixes worth folding into that same cycle.

## What NOT to redo

- **The API-side entity filter.** Tried and reverted (`c606a54`). Documented on `filterRequestsForPage` in `entity-match.ts`, captured as a test.
- **Don't chase the price/rating "wrong" verdicts as bugs.** Four of the eight remaining wrong verdicts are cases where the extractor returned a real value and nothing said which of several valid values was wanted. They need the labelling design (Open decision 1 below), not a fix.
- **Don't re-run the AbeBooks or Newegg live crawls to get a better-looking result.** The two v2 runs above (one broken, one fixed) are what happened; that task was authorised for exactly one planning + one execution run after the fix, and that budget is spent. Both runs stay in the DB as the record.
- **The shared-browser-close bug is fixed** (`376b7ac`, plus the `analysis-orchestrator.ts` half and the structural `withBrowserSession` fix from the review round) — don't reopen it or re-derive the root cause; read "The fix, and its follow-up" above instead.
- **Don't re-run the pagination-walk or cancel/resume proofs to get a better-looking result.** Runs `4bf71da9…`, `aeaab1db…` and the two cancel/resume cycles are the record; that budget is spent and restored. If `deriveTemplate`'s AbeBooks bug gets fixed, a fresh live run to reprove it is legitimate new work, not a re-run of this one.
- **Don't rebuild or "simplify" the three measured details in `scrollPages`** — the up-then-down scroll trigger, `rowCountScript` counting all rows, and the forced LISTING page-type. Each was established by watching real Chromium behave, each carries a comment saying why, and each looks like dead weight to a reader who wasn't there. See "DOM-scroll pagination (2026-08-25)" above.
- **The `deriveTemplate` wrong-page-parameter bug is FIXED (2026-08-25) — don't re-derive it.** The root cause was sharper than "wrong choice among plausible params": it templated the FIRST changed numeric param in URL order, which on AbeBooks was `ds` — the page-size constant — so the 2026-08-21 walk fetched pages sized 2 and 3 items (that is what the 2/1 stray yields were). The fix reads the page's own pager-link series: stride-1 param beats offset beats constant; known-name prior as tiebreak/fallback; old behaviour when no evidence exists. Gated against the real captured AbeBooks page (`p={N}` now). Remaining, recorded in the roadmap: `{N}` is the literal page number while AbeBooks' `p` is 0-indexed, so walks run one page offset until stride/base-aware template semantics exist.
- **Don't re-run the `api-param` live proof against `newegg-gpus-live` to get a better-looking result.** Run `c889faea-3417-4d36-97cd-1907e55653af` (2026-08-24) is the record; that budget is spent and the source's budget is restored to `{max_items: 5, max_pages: 1}`. It fell through to `mechanical` — see "`api-param` pagination — live proof (2026-08-24)" above. If a corpus site is added that is known to load its listing from a same-origin JSON endpoint, a fresh live run against *that* site is legitimate new work, not a re-run of this one.
- **Don't run the v2.5 candidate-labelling live dogfood (Task 11 Step 4) without Marko's explicit go.** It spends ~$0.15 + API budget and sets `ANTHROPIC_API_KEY`. Steps 1-3 (the Tier 1 fixture gate) landed 2026-08-26 — see "v2.5 candidate labelling — Task 11" above.

## Open decisions (need Marko, not code)

1. **Candidate labelling** (`docs/ideas.md` → "Label every candidate instead of picking one"). Premise confirmed: one Newegg page carries four simultaneously valid prices and the *displayed* price matches none of the API fields. Marko's direction — label all candidates, let the customer choose, per-domain catalogue and per-dataset selection — is recorded and deserves its own spec. Still open.
2. **Proxy budget.** Anti-bot remains the dominant schedule risk for the pipeline generally; unrelated to the v2 crawler work above.

## Suggested next work

1. ~~Fix `deriveTemplate`'s page-parameter choice~~ **Both halves done (2026-08-25):** the verification gate refuses thin non-budget-stopped walks, and `deriveTemplate` now chooses the pager by series evidence (see "What NOT to redo"). A fresh live AbeBooks run to re-prove the walk end to end is legitimate new work when a budget is approved for it.
2. **Live-prove DOM-scroll** (Task 6 of `docs/superpowers/plans/2026-08-24-dom-scroll-pagination.md`, unstarted and needing approval): find a corpus-safe site that genuinely infinite-scrolls, confirm with `HEADFUL=1` that scrolling adds products *before* spending anything, then plan-only with the budget shaped so `max_items` binds. Fix follow-up 1 above (the `'all-duplicates'` single-quiet-round stop) first or alongside — it is what a real virtualized listing would trigger.
3. From `docs/roadmap.md`'s v2 section: the progressive-confidence ladder (1 → 5 → 20 → 1000 URLs); a real job queue (an api-server restart still pauses a run — `run_items` survives so `execute` resumes it, but nothing resumes it automatically). `api-param` pagination detection and replay is now built and offline-gated (see above) but still wants a live site that actually exercises it — the corpus doesn't currently have a confirmed one.

## Cheap things worth doing whenever convenient

- **Never pick a live pagination target without `packages/browser/scroll-probe.mts` first.** It is free —
  no LLM, no database — navigates a candidate listing, scrolls it, and prints the distinct-product-link
  count per round. Two live proofs have now turned on this: `api-param`'s failed because its target was
  chosen from a roadmap note, and `dom-scroll`'s succeeded because three candidates were measured before
  anything was spent. Usage: `pnpm --filter @robot/browser exec tsx scroll-probe.mts "<url>" ["<url>"...]`,
  with `HEADFUL=1` to watch it.

- Measure the five unmeasured extraction-quality domains once (~$4): `bhphoto`, `abebooks`, `zalando`, `currys`, `uniqlo`.
- Capture Tier 1 fixtures for the corpus so the commit-time gate covers more than one eighth of it.
- `star_distribution` arrives as an object and is rejected as "not array".
- Target's `availability` returns a delivery date from a poisoned cached XPath — and **pinning cannot fix it**: it is the field's ONLY cached path, so there is nothing better to pin (see "Cache-conflict triage (2026-08-25)" below). It needs the path deleted by hand plus a re-discovery run, or the labelling design.

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
