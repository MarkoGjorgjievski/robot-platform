---
name: AI Scraper product roadmap and feature backlog
description: Two parallel tracks — pipeline (Track A) and dashboard/platform (Track B). Source of truth for what's planned.
type: project
---

The roadmap runs as **two parallel tracks**:

- **Track A — Pipeline / Backend.** The scraper itself: capture, extraction chain, AI, cache.
- **Track B — Platform / Dashboard.** The UI, data organization, how customers interact with the product.

Tracks are decoupled but v1.5 (Track B) is the bottleneck for *seeing* any Track A work in the UI. After v1.5 lands, v2 pipeline features have a real home.

Exploratory backlog items (not yet release-staged) live in `docs/ideas.md`. Long-horizon direction
and the post-MVP ordering of everything below live in `docs/vision.md` — when this backlog is
ambiguous about priority, the pillar ordering there is the tiebreak.

---

## v1.0 — Core Pipeline (DONE)

Pipeline:
- [x] Browser capture with fallback navigation (networkidle → domcontentloaded)
- [x] Popup/consent dismissal (cookie, health consent, modals — 3 rounds)
- [x] JSON-LD / __NEXT_DATA__ / meta tag extraction
- [x] API interception during page load (rank by content signals)
- [x] Schema discovery via Claude (screenshot + markdown + structured data)
- [x] XPath selector generation (listing + detail page modes)
- [x] Sibling-row extraction (following-sibling:: axis)
- [x] Data extraction with XPath executor + plausibility checks
- [x] AI-powered API JSON analysis (Claude reads raw API, returns dot-notation paths)
- [x] Validation via Claude vision
- [x] Dual provider support (Anthropic + Ollama)
- [x] Domain intelligence cache (multi-path per field, OR-logic, hit/miss scoring)
- [x] Cached API path replay (dot-notation traversal, zero AI cost)
- [x] Cached XPath replay (execute stored selectors, zero AI cost)
- [x] Cross-validation between sources (majority wins)
- [x] Auto-pruning dead paths (>10 uses, <10% hit rate)
- [x] Cache degradation flagging (no auto-reset — human review required)
- [x] Hit rate decay (recency-weighted, only penalizes recent misses)
- [x] Blocked/error page detection (403, captcha, Cloudflare, empty pages)
- [x] Per-domain concurrency locks + politeness delay
- [x] Schema evolution detection (new/removed/degraded fields)
- [x] Human override system (click-to-select + manual XPath/API path)
- [x] Human paths saved to global cache with highest priority
- [x] Cache-first source creation (known domains return instant, $0.00)
- [x] Brand/TLD grouping (amazon.com → amazon.co.uk cache sharing)
- [x] Value transforms (word-to-number, brand cleanup, whitespace collapse)
- [x] Content-based API ranking (product key counting, penalize UI layout blobs)
- [x] Retry with exponential backoff for transient API errors

Dashboard:
- [x] Next.js 15 wizard (URL → Schema → Preview) — local state only, no persistence
- [x] Flat `/extractions` list grouped by domain (retired in v1.5 Phase 0)

Note: earlier roadmap versions claimed Source detail page, Domain library page, and Domain detail page as v1.0 done. They existed in an older dashboard that has since been simplified into the current single-wizard app. Those pages are now targets of v1.5 (Phase 3 and Phase 5).

---

## Track A — Pipeline / Backend

### v1.1a — Extraction Completeness (DONE 2026-05-19)

Landed in 7 commits. Every discovered+toggled field returns a row; the cache remembers fields it failed to resolve; `__NEXT_DATA__`/JSON-LD became first-class extraction sources.

Closed three loops uncovered during Phase 4 dogfooding on Amazon: discovered+toggled fields silently dropped from results; cache forgets discovered-but-unresolved fields; `__NEXT_DATA__` / JSON-LD blobs orphaned (too noisy for mechanical, invisible to AI). Restored the *"every toggled-on field returns a row"* invariant and made structured-data blobs first-class extraction sources via entity-subtree identification + shape validation.

- [x] **Task 1 — Contract:** `discoveredResults` returns a row per toggled-on field (`null` + `not_found` if unresolved); extracted into pure `buildResultRows` helper with unit tests.
- [x] **Task 2 — Cache memory:** `saveDomainCache` persists discovered-but-unresolved fields as empty-path entries; analyze cache-hit returns them so they reappear in the next run's schema.
- [x] **Task 3 — Cache rediscovery hint:** analyze marks empty-path entries with `needsRediscovery: true`; extract re-runs AI for them naturally via the existing missing-fields flow.
- [x] **Task 4 — Structured-data inputs:** AI API analysis consumes `nextData` + large JSON-LD blobs alongside intercepted XHRs (`inline://nextdata`, `inline://ld+json[i]`).
- [x] **Task 5 — Entity-subtree identification:** heuristic that scopes a nextData blob to its product subtree before AI sees it, cutting noise ~100×.
- [x] **Task 6 — Shape validation:** post-filter at the resolution boundary rejects UI labels for description fields, non-numeric prices, empty arrays, wrong types — so the next step in the chain still gets a chance.
- [x] **Task 7 — Docs:** updated `docs/extraction-architecture.md` to reflect the new structured-data flow.

Verification: 72/72 scraper tests + 46/46 api tests pass, typecheck clean across both packages. Amazon Godiva dogfood pending (user-driven, requires real Claude API calls).

Out-of-scope follow-ups: cross-source corroboration weighting, scheduled cache rediscovery, embedding-based description matching, cache-hit eclipses user-typed requested fields. Tracked in `docs/ideas.md`.

### v1.1b — Extraction Quality (DONE 2026-05-20)

Thread A multimodal reverse-search selectors + ai-vision fallback; entity-subtree substring scoping + inline-source priority (verified on Nike); always-consult cache; analyze shows current-URL examples + removed reliability badge.

- [x] **Thread A — Multimodal reverse-search selectors:** `agent.generateSelectors` / `retrySelectorGeneration` send the page screenshot + HTML; the tool returns both an `xpath` and the AI-seen value per field. If the generated xpath returns nothing, the pipeline delivers the AI-seen value with source `ai-vision` (not cached as a reusable selector).
- [x] **Phase 0.3 — Entity-subtree substring scoping:** `findEntitySubtree` scores objects by counting DISTINCT schema tokens matched as case-insensitive substrings of direct keys, with tiebreak preference for nodes reached via a key containing "selected". Correctly scopes Nike `__NEXT_DATA__` to the product node.
- [x] **Phase 0.4 — Inline-source priority:** `collectAiAnalysisSources` always retains `inline://` structured-data sources first; the 5-source size cap applies only to intercepted requests. A scoped `nextData` source is never evicted by large junk intercepted requests.
- [x] **Phase 2 — Always-consult cache:** removed the three `consecutiveFailures < 5` gates in `scraper.ts`. The cache is an accumulator (no auto-reset; multi-path coexistence; recency-weighted ranking; cross-validation; conservative per-path prune at ≥5 uses & ≤10% hit rate; max 5 paths/field) — always consulted on every run.
- [x] **Phase 3 — UI:** `analyze` on a cache-hit captures the current URL and resolves cached paths so the Example column shows current-page values; removed the misleading "Cached — N runs, X% reliability" badge.
- [x] **Dogfood fixes (Amazon Godiva, real `extract` path):** the dogfood caught (a) a `tryAssign` crash on absent values that silently disabled the entire XPath/ai-vision fallback, and (b) the vision model's not-found sentinels (`"UNKNOWN"`/`"N/A"`/`"-"`) being accepted as resolved values. Both fixed: absent values are silent not-founds; sentinels are rejected and the prompt is told to leave `value` empty when it can't see one.

**Result:** Amazon Godiva resolution went from 4/16 (baseline) → **12/16 (75%)**, with not-founds reported honestly instead of fabricated. Remaining wrong fields (`diet_type`, `product_description` resolving to the title) come from stale cached xpaths — the separate "cache trusts itself / wrong-but-non-null" issue tracked in `docs/ideas.md`, out of v1.1b scope.

### v1.1 — Backend Stability (DONE — 2026-05-22)

- [x] **Data quality checks** (prices > 0, URLs valid, no HTML in text) — implemented in `data-quality.ts` (`validateExtractedData`), wired into extract STEP 5.
- [x] **Progressive screenshot tiles** — capture the full page as legible ≤1536px tiles (cap 3); feed tile 0, escalate to lower tiles only for unresolved fields. Replaces the single fixed crop; reaches below-the-fold data without sending oversized/illegible images. (Supersedes the original "crop to viewport" item.)
- [x] **Human row-selector override (backend)** — `domain_intelligence.row_selector` + `scraper.setRowSelector` mutation; `extract` overrides the AI's `row_xpath` with the human pick on both the first and tile-escalation passes. (Click-to-select UI lands in v2.1.)

(Removed: "Fix save flow end-to-end" — superseded by v1.5 Phase 2. "Per-source browser config" — folded into v1.5 Phase 3. "Wizard improvements" — superseded by v1.5. "Fix BBC-style complex listings" — subsumed by v2's listing→detail strategy (we'll follow links to detail pages rather than fight the listing). "Side panel / expandable sections (Amazon reseller data)" — the new data model makes reseller data its own Dataset, not a side panel of products.)

### v2 — Multi-Page Pipeline (Phases 1 + 2 DONE — 2026-08-20; multi-page walk + config caching live-proven with a caveat — 2026-08-21; `api-param` built and offline-gated, its one live run fell through to `mechanical` — 2026-08-24; DOM-scroll/load-more built and live-proven complete — 2026-08-25)

Two-phase crawler: `crawl.plan` walks listing pages and enumerates detail URLs into `run_items` without fetching them; `crawl.execute` fetches and extracts each pending item, one extraction per URL, with per-item status and no automatic retries. Both phases proven end to end against a live site (`abebooks-pagination`) — see `docs/handoff.md` for the run's actual numbers. An initial live run exposed a shared-browser lifecycle bug in `runExtraction` that limited throughput to 1/8 items; fixed same day (`376b7ac`) and reproven with a second live run at 8/8.

**Multi-page walking and pagination-config caching are now live-proven — with a live-proven bug alongside them.** A run against `abebooks-pagination` (budget raised so `max_pages`, not `max_items`, would bind) walked listing pages 1, 2 and 3, enumerated 33 detail URLs across all three `page_number`s, wrote `domain_intelligence.pagination_config` for the first time in this repo's history, and replayed it on a second plan without re-detecting. (That the replay read the config from cache is an inference, not a logged fact: the CLI never prints a `source: cache` line. The `[cache] pagination for …` save-line — which fires only on a fresh, non-cache detection — was absent, and the fan-out was identical; together that is conclusive about the code path taken, but it is read off an absence rather than asserted by a log line. `docs/handoff.md` states it the same way.) `crawl.cancel` stop-and-resume — previously unit-tested only — was also exercised live: cancelled twice mid-run, resumed once, settled cleanly to `cancelled` both times, no item lost or double-processed. **But** the config that walk verified and cached was wrong: `deriveTemplate` chose AbeBooks' `ds` parameter as the page cursor while pinning `p=1` (the actual pager), so pages 2 and 3 substantially re-fetched page 1 — confirmed by the 30/2/1 detail-URL split (page 1: 30, page 2: 2, page 3: 1; a working pager would produce roughly 30 per page). The 2+1 stray items were enough to satisfy the `gained > 0` verification gate, so a broken template got cached; it was purged by hand rather than shipped. Full evidence, run ids, and SQL: `docs/handoff.md` → "Pagination walk + caching — live proof (2026-08-21)" and `.superpowers/sdd/2026-08-21-pagination-proof-and-caching/task-6-report.md`.

**What remains open, updated for what this run actually showed:**
1. **The `gained > 0` verification gate is too weak.** It certified a broken pager on the very first live use. Needs a stronger signal — e.g. treating a page that yields only a small fraction of page 1's item count as evidence of a broken pager rather than a thin real page — before this domain (or any domain) is trusted to auto-cache again. **Do not implement that ratio naively as a refusal.** `absorb` passes `remaining: cap - detailCount()` into `enumerateDetailUrls`, so a genuinely WORKING pager legitimately gains only 1-2 new items on page 2 once the item budget is nearly full — which is this repo's own default `{max_items: 8, max_pages: 2}` shape. A ratio used as a gate would refuse correct configs, the cache would never warm, and the feature would deliver nothing. As of 2026-08-21 the ratio therefore ships as a *warning* only (`THIN_WALK_SHARE` in `plan-run.ts`, suppressed when the walk was budget-stopped); any future refusal has to be built on a budget-aware signal, not on the ratio alone.
2. **`deriveTemplate`'s page-parameter choice is wrong for at least one real site.** Choosing correctly between several plausible query parameters is a design problem, not a quick fix; deliberately not patched as part of this task.
3. **Infinite scroll and load-more are live-proven and enumerate a listing completely and reproducibly.** The 2026-08-25 cycle added a fifth strategy, `dom-scroll`: a `scrollPages` generator that grows the DOM (by scrolling, or by clicking a heuristic-matched load-more button), waits for the row count to actually increase, re-extracts unstamped rows, and stops after two consecutive quiet rounds. It is the LAST rung and is deliberately never *detected* — nothing in static markup reliably says "this list will grow when scrolled", so `planRun` finds out by trying once everything else has come back empty. Five live runs against `uniqlo-scroll-live` (220 tiles) planned 220, 144, 148, then **220 and 220** after the root-cause fix. The first 220 was luck: `scrollPages` opens its own page and used to stamp everything already loaded there before scrolling, assuming page 1 had it — but page 1 comes from `capture`, a different navigation, and the overlap was a race. It now yields its first round and lets `absorb` dedupe, per spec §4. Two capture-side races were fixed alongside (`5473e89`, `914dd90`), and the whole-branch review's eight prescribed mutations were all killed. **Still fixture-only: the load-more *button* trigger**, because Uniqlo scrolls. Full narrative including two wrong diagnoses: `docs/handoff.md` → "DOM-scroll pagination — live proof (2026-08-25)".
4. **`api-param` pagination is built and gated offline, but NOT live-proven.** 2026-08-24: the one authorised live run (`newegg-gpus-live`, run `c889faea-3417-4d36-97cd-1907e55653af`) fell through to `mechanical` (`url-pattern`) — `findListingApi` found no intercepted JSON response whose array-of-objects overlapped page 1's detail URLs at ≥3 matches / ≥50% share (`API_MATCH_MIN_COUNT`/`API_MATCH_MIN_SHARE` in `find-listing-api.ts`), so no candidate parameter was ever probed and `REPLAY_MAX_OVERLAP = 0.5` in `api-param-candidates.ts` was never exercised. This is the first real traffic these three reasoning-derived thresholds have seen, and the result is negative-but-specific: it says Newegg's category page doesn't expose a same-origin listing JSON endpoint at all (server-rendered HTML + JSON-LD instead), not that the thresholds are wrong. Full evidence: `docs/handoff.md` → "`api-param` pagination — live proof (2026-08-24)" and `.superpowers/sdd/2026-08-22-api-param-pagination/task-8-report.md`. Cursor-based APIs, POST/GraphQL endpoints, and DOM-driven infinite scroll remain unsupported by `api-param` regardless of this run's outcome — it only ever considers GET requests with a page-number-shaped query parameter.

- [x] `crawl()` method on `@robot/browser` — page-by-page async generator, `startPage` support.
- [x] AI auto-detects pagination patterns — `url-pattern`, `next-button`, `page-numbers` strategies via `detectPagination` (heuristic + AI fallback), verified against real captured pages. **`dom-scroll` is deliberately NOT among the detected strategies** — it cannot be detected from a static capture at all, so it is attempted as the last rung instead of predicted; see point 3 above.
- [x] **Listing → Detail crawler:** `planRun` follows links from listing to detail pages, live-proven on AbeBooks (1 listing page → 8 detail URLs enumerated, deduped, budget-capped). Absorbs BBC-style cases — instead of fighting custom React listings, fetch each detail page.
- [x] Honor per-Source pagination budget (max_pages / max_items / mode) — `max_items` is live-proven: `abebooks-pagination`'s `{max_items: 8, max_pages: 2}` stopped enumeration at exactly 8 items on page 1 and logged `budget reached: 8 items`. `max_pages` is now also live-proven independently (2026-08-21): a budget of `{max_items: 60, max_pages: 3}` walked exactly 3 listing pages and stopped there, not on item count.
- [x] Batch extraction with per-input status tracking — `crawl.execute` claims one pending item at a time (`SKIP LOCKED`), records each outcome (`done` with an extraction id, or `failed` with a reason) independently, and rolls the run up to `completed` or `partial` from the DB rather than a local counter. First live run proved status tracking and failure isolation (each of 7 failures got its own recorded reason and the run still reached a terminal `partial` state) but not throughput — a shared-browser lifecycle bug in `runExtraction` limited it to 1/8. Fixed (`376b7ac`, `packages/scraper/src/extraction-orchestrator.ts`: `runExtraction` no longer closes a browser it doesn't own) and reproven live: run `bd44fa22-c667-4538-9a48-0e8066c8f444` completed 8/8, `result_count=8`, CSV export 8 data rows across 8 distinct `_url`s.
- [x] **Multi-page walk, live-proven (2026-08-21).** `planRun` walked listing pages 2 and 3 against a live site for the first time — run `4bf71da9-edf3-4155-8fdb-67b4cc30d7c2`, 33 detail URLs deduped across `page_number` 1/2/3. See the caveat above: the walk mechanism works, but the specific AbeBooks template it walked was wrong.
- [x] **Pagination config caching, live-proven (2026-08-21).** `domain_intelligence.pagination_config` written on a verified walk and replayed on a subsequent plan (run `aeaab1db-0f1f-4da5-8230-d59b3ef771af`, identical fan-out, no re-detection — the cache path inferred from the absent save-line, not from any log line saying `source: cache`). See the caveat above: the verification gate that decides what counts as "verified" needs to be stronger.
- [x] **`crawl.cancel` stop-and-resume, live-proven (2026-08-21).** Cancelled twice mid-execution, resumed once, settled cleanly to `cancelled` each time with the untouched remainder left `pending`. Previously unit-tested only.
- [x] **`api-param` pagination detection and replay — built and offline-gated (2026-08-22 cycle); live run 2026-08-24 fell through to `mechanical`, so live-proven only that the fallback and the "never cache an unverified parameter" guard hold, not that `api-param` itself can win on a real site yet.** See point 4 above and `docs/handoff.md`.
- [x] **Infinite scroll and load-more pagination strategies — built, Chromium-gated, and live-proven (2026-08-25 cycle, merge `382eacd`).** One strategy with two triggers; `max_items` is the only budget consulted (counted in planned items, not yielded rows) and `max_pages` is deliberately ignored so an HTML-pagination budget cannot silently cap a scroll listing. See point 3 above.
- [x] **Run `dom-scroll` live** — done 2026-08-25 against `uniqlo-scroll-live`: 220 of 220 tiles, twice, invariant under the capture race that used to set the total. Target was chosen by measurement rather than by note (the lesson from `api-param`'s failed proof) — see the probe table in `docs/handoff.md`.
- [x] **Give scroll rounds a per-round audit trail** — `c029cc6`. Rounds are not pages; the trail lives on page 1's listing row as `listing_values.scroll_rounds`, one entry per yielded round with `rows` and `planned`. It immediately corrected the live-proof write-up.
- [x] **Find out why the walk under-delivered** — `5473e89`. Not an early stop: the generator was discarding the view it started with, because that view comes from a different navigation than page 1's. Fixed by yielding the first round and deduping in the caller. 220 of 220, twice, invariant under the race that used to set the total.
- [x] **Make page-1 extraction reproducible** — `914dd90`. `expandHiddenContent` clicked below-the-fold controls through a Playwright locator, which scrolls to reach them, which loads more of a lazy grid. It now clicks in the page. Fixture-verified; not yet live-verified, because the only known scroll target is rate-limited.
- [ ] **Exercise the load-more trigger live.** Uniqlo scrolls, so `findLoadMore` never fired and the cached config has no `loadMoreSelector`. Half the strategy is still fixture-only. Needs a corpus site with a real "show more" button — the free `scroll-probe.mts` is the way to find one.
- [x] **Let a scroll walk survive a fully-recycled window** — `5473e89`. Only `'budget'` is terminal for a scroll walk now. A fully-duplicate round is the NORMAL shape of one (the first round, and every recycled window on a virtualized list), not a signal the list ended; the generator's quiet-round rule decides that, and `MAX_SCROLL_ROUNDS` bounds the pathological case. Shipped coupled to the fix above, which made duplicate first rounds the common case.
- [x] **Strengthen the pagination-config verification gate** (DONE — 2026-08-25). The thin-walk condition is now a refusal, not just a warning: a walk gaining under `THIN_WALK_SHARE` of page 1's yield **when the item budget was not what stopped it** does not cache its config (`plan-run.ts`). The budget-aware signal avoids the false negative — a budget-stopped thin walk still caches, so the default `{max_items: 8, max_pages: 2}` shape still warms the cache. The walk's planned items are kept either way; only cross-customer certification is refused. Gated by tests including the AbeBooks 30-vs-3 shape and the stale-path overwrite case.
- [ ] **Payload termination signals for `api-param`** (`total`, `totalPages`, `totalCount`, `hasMore`, `has_next`). Spec §4 asks for them; the 2026-08-22 plan deliberately deferred them, on the grounds that pages 2..N are fetched in ONE batch — one navigation instead of one per page — and a `hasMore` flag can only be acted on *between* fetches. **This is the revisit condition the plan says is "recorded in the roadmap by Task 8"; until 2026-08-24 it was recorded nowhere.** Revisit when a walk legitimately needs more pages than `API_WALK_MAX_BATCH` (10, `plan-run.ts`) — i.e. when the batch cap starts biting in practice. At that point the extra navigations buy more than they cost, and the signals become the right way to stop early. Related and worth fixing at the same time: `resolveBudget` puts no ceiling on `max_pages` at all (`max_items` has `HARD_ITEM_CEILING`; `max_pages` has nothing), so `API_WALK_MAX_BATCH` is currently the only thing standing between a `max_pages: 100` budget and 99 sequential in-page fetches at one endpoint — a burst the domain lock's politeness delay does NOT space, because it spaces inputs, not the fetches inside one batch.
- [x] **Fix `deriveTemplate`'s page-parameter selection** (DONE — 2026-08-25). It templated the first changed numeric param in URL order; on AbeBooks that was `ds` — the page-size constant — so the live walk fetched pages sized 2 and 3 items (which is what the 2026-08-21 run's 2/1 stray yields actually were). It now collects every changed numeric candidate and lets the page's own pager-link series discriminate: a stride-1 series param (`p`: 1, 2) beats an offset (`spo`: 30, 60), and a constant-across-series param is disqualified outright; with no series evidence a known pager name breaks the tie, and with neither the old behaviour stands. Gated against the real captured AbeBooks page, which now yields `p={N}`. Known limitation (recorded, not fixed): `{N}` substitutes the literal page number while AbeBooks' `p` is 0-indexed, so walks are offset by one page — exact templates need stride/base-aware `PaginationConfig` semantics, an interface change left as future work.
- [ ] **Back off `uniqlo-scroll-live`.** Akamai "Access Denied" after roughly ten runs on 2026-08-25. Not a code defect; expect the first re-run to be a block rather than a regression.
- [x] **Progressive confidence (1 → 5 → 20 → 1000 URLs) — delivered in its MVP shape as probe-confirm** (2026-08-27, `.superpowers/sdd/2026-08-26-mvp-simplification/` Tasks 9-10). Not the full 1 → 5 → 20 → 1000 ladder — a two-step version: a listing Source runs a small probe, a human reviews the schema/sample rows, and confirming (`sources.confirm`) kicks off the full crawl. The wider ladder remains open future work if the two-step shape proves insufficient.
- [ ] Real job queue — an api-server restart still pauses a run (`run_items` survives, so calling `execute` again resumes it, but nothing resumes it automatically)
  - [ ] **Prerequisite:** `domain-lock.ts`'s waiter handling does not serialize more than two waiters. N callers awaiting the same in-flight promise all wake together, all serve the politeness delay concurrently, and each then installs its own map entry with the last write overwriting the rest — so the lock stops being a lock at 3+ waiters. Pre-existing and harmless today, because nothing creates three concurrent runs against the same domain. A job queue is exactly the thing that will, so it has to be fixed as part of that work rather than after it.

(Note: the *data model* for input sets, source type selection, and budget already landed in v1.5 Phase 0. v2 is the pipeline work that consumes that model.)

### v2.1 — Click-to-Select (Manual Fallback)

- [ ] Full 3-step correction flow (type value → click element → confirm path)
- [ ] XPath generator (id > data-testid > class > positional)
- [ ] Reverse-search (find path to desired value in API/HTML/meta)
- [ ] Auto-generate transform rules from raw text vs desired value

### v3 — Production Scale (Pipeline)

- [ ] Multi-LLM provider support (OpenAI GPT-4o, Gemini Flash, xAI Grok)
- [ ] Task-based provider routing (vision→Claude, large context→Gemini, cheap→GPT-4o-mini)
- [ ] Provider failover (429/529 → auto-switch to next provider)
- [ ] Change detection + selector health monitoring
- [ ] Proxy pool integration (Bright Data, Oxylabs)
- [ ] Anti-bot stealth (playwright-extra + stealth plugin)
- [ ] CAPTCHA solving service integration
- [ ] Multiple browser engines (Firefox, WebKit)
- [ ] Auth flows (login before scraping)
- [ ] Rate limiting + robots.txt compliance
- [ ] Pre-training: bulk-run against top 500 sites

---

## Track B — Platform / Dashboard

### v1.5 — Dashboard Redesign (DONE — 2026-05-20)

Full spec: `docs/superpowers/specs/2026-05-13-dashboard-architecture-redesign-design.md`

Replaces the current Next.js wizard with a TanStack Router + Query SPA backed by a new `packages/api-server` (Hono mounting the existing tRPC routers over HTTP). Introduces Sandbox + Graduate model, renames `collections` → `datasets`, makes `input_sets` first-class, and lays the data-model foundation for v2 pipeline features. **The Sandbox + Graduate model itself was superseded and deleted in `.superpowers/sdd/2026-08-26-mvp-simplification/` (2026-08-27, Task 11) — see the Phase 2 / Phase 4 notes below; the schema/data-model groundwork this phase laid (`datasets`, `input_sets`, `is_sandbox` column) stands.**

- [x] **Phase 0 — Schema migration** (DONE — 2026-05-14, 18 commits)
  - [x] Rename `collections` → `datasets`
  - [x] Add `input_sets` table (typed columns + rows)
  - [x] Extend `sources` (input_strategy, url_template, listing_mode, budget, input_set_id, is_sandbox)
  - [x] Add project-level inherited columns (default_schedule, output_destination, proxy_pool, default_rate_limit, notification_channel, owner_email)
  - [x] Add `run_id` FK to `captures` and `extractions`
  - [x] Seed Sandbox Project per Org
  - [x] Back-fill `quick_extractions` → Sandbox Sources; drop `quick_extractions`
  - [x] Cleanup pass: constraint name fixes, CHECK on sources, consolidated migration baseline, pre-existing TS errors fixed, legacy save-extraction route removed
- [x] **Phase 1 — `packages/api-server` + TanStack scaffold** (DONE — 2026-05-15)
  - [x] Drop legacy `source_inputs` table (superseded by `input_sets`)
  - [x] New `packages/api-server` (Hono + tRPC HTTP)
  - [x] Replace Next.js dashboard with TanStack Router + Query SPA (Vite)
  - [x] Reimplement `/api/scraper/analyze` + `/api/scraper/extract` as tRPC procedures
  - [x] Routing skeleton (all routes from spec Section 5)
- [x] **Phase 2 — Sandbox flow** (DONE — 2026-05-15). **Superseded (2026-08-27) — see
  `.superpowers/sdd/2026-08-26-mvp-simplification/`.** The throwaway `/sandbox/{shortid}` draft
  world (its routes, `sandbox.ts` router, and the `is_sandbox` visibility filters) was deleted in
  that spec's Task 11; declared-mode `quickCreate` + the Source workspace (spec Tasks 9-10) now
  do what this phase did, landing directly on a real Source under the always-visible Scratch
  project instead of a fenced-off draft.
  - [x] Paste-and-go creates draft Source on first action
  - [x] Wizard mutations persist per step (new save flow — replaces the v1.0 save-extraction route)
  - [x] `/sandbox/{shortid}` rehydration on reload
- [x] **Phase 3 — Project / Dataset / Source views** (DONE — 2026-05-16)
  - [x] Project home (by-dataset + by-domain views)
  - [x] Dataset detail (schema editor with per-field source classification: detail / listing / input.X / system)
  - [x] Source detail (the workhorse view): config, inputs, runs
  - [x] Per-source browser config (viewport, user agent, cookie injection) — folded in from old v1.1
  - [x] Run results view (replaces `/extractions`)
  - [x] Source bulk-create from Dataset page (multi-strategy in one action)
- [x] **Phase 4 — Graduate** (DONE — 2026-05-18). **Superseded (2026-08-27) — see
  `.superpowers/sdd/2026-08-26-mvp-simplification/`.** The Sandbox → Project "Graduate" move
  (`graduate-form.tsx`, `sandbox.graduate`) was deleted in that spec's Task 11; there is no longer
  a separate throwaway project to graduate out of — sources are created directly against a real
  project (Scratch by default) and stay there.
  - [x] Move-from-Sandbox-to-Project flow
  - [x] Inline InputSet promotion to named InputSet
- [x] **Phase 5 — DomainIntelligence views** (DONE — 2026-05-20)
  - [x] Global `/domains` library (aggregated per-domain run/success/field stats)
  - [x] Per-domain detail `/domains/{domain}` — flat sortable selectors table (hit/miss, last value, failing paths first), summary stats, cross-customer sources. Read-only.
  - [x] Two read-only `domainsRouter` procedures (`intelligenceList`, `intelligenceDetail`)
  - (Per-project domain views were already delivered in Phase 3.)

### v2 — Dashboard hooks for pipeline work

- [x] Run progress UI for batch extractions (DONE — 2026-08-20). Source Runs page triggers `crawl.plan`; Run detail page has Extract N pending / Retry N failed / Stop, wired to `crawl.execute` / `crawl.cancel`, polling-based progress. SSE/WebSocket still deferred.
- [ ] Pagination preview / pre-run cost estimate
- [ ] Per-input status grid beyond the work list already shipped (which inputs succeeded / failed in a run, at a glance)
- [ ] InputSet CSV import + bulk paste

### v2.1 — Dashboard for click-to-select

- [ ] Visual element picker UI in Source detail
- [ ] Override → save to `DomainIntelligence` with highest priority

### v3 — Production / Operations Dashboard

- [ ] Scheduling UI (project-level cron + per-source overrides)
- [ ] Cost-preview UX (deferred from v1.5)
- [ ] Multi-tenant auth shell — surface Org level in UI; **drop legacy `extractors` / `extractor_inputs` / `credentials` / `robot_overrides` tables here** (they tie to the pre-multi-tenant extractor model and need re-modeling with proper auth)
  - Audit (2026-06-30): these tables are defined in `packages/db/src/schema.ts` but have **zero readers in the dashboard** — they're dead until re-modeled. Their tRPC routers (`extractorsRouter`, `credentialsRouter` in `packages/api/src/routers/`, ~190 lines) are likewise uncalled. `runs` carries **both** `extractorId` (legacy) and `sourceId` (current) FKs, both nullable; only `sourceId` is written by the current pipeline. The cleanup is: drop the four tables + their two routers, then drop `runs.extractorId` and its relation. Self-contained (~400 lines, ~1 day), but the column drop needs a tenant migration, so it's correctly staged here behind the auth re-model rather than done as loose cleanup.
- [x] **Run export (DONE — 2026-08-19).** `GET /export/runs/{id}.csv|.json` on `@robot/api-server`, plus CSV/JSON buttons on the run detail page. Columns come from the Source schema (stable header across runs; unresolved fields keep an empty column; undeclared data keys are appended). CSV is RFC 4180 with a UTF-8 BOM, arrays/objects JSON-encoded in-cell; JSON is an envelope with run + source provenance. Unauthenticated — the run UUID is the only guard.
- [ ] Data export: multi-run / dataset scope, webhook destinations, scheduled delivery
- [ ] Public API surface — comes nearly free from `packages/api-server` landing in v1.5 Phase 1
- [ ] Cost tracking per source/customer

---

## Track interactions

- **v1.5 Phase 0 unblocks v2 pipeline work.** Once `input_sets`, `Source.listing_mode`, and `Source.budget` exist (now done), the v2 pipeline (pagination + listing→detail) has somewhere to read its config from.
- **v1.5 Phase 1 de-risks v3's public API.** `packages/api-server` exists as a standalone HTTP service from day one; exposing a public `/extract` endpoint in v3 is a matter of auth and rate-limiting, not infrastructure.
- **v1.1 and v1.5 run in parallel.** Both are pipeline-only or dashboard-only and don't share files. v1.1 touches scraper subsystems; v1.5 Phase 5 is the dashboard. v1.1a (extraction completeness) shipped 2026-05-19.
- **v2 listing→detail subsumes the BBC fix and the Amazon reseller side-panel.** Both former v1.1 items become moot because the new strategy is "always go to the detail page when listing extraction is lossy."

**How to apply:** v1.5 is complete (Phases 0-5 done). v1.1 (backend stability) remains the open Track A polish item; v2's core pipeline (plan + execute, listing→detail, budget, multi-page walk, pagination-config caching, cancel/resume) and its dashboard hooks are now done and live-proven — see `docs/handoff.md`. That same live proof surfaced a real bug (a wrong pagination template got certified by a too-weak verification gate) — fixing the gate and `deriveTemplate`'s page-parameter selection are now the top of the list. `api-param` pagination is now built and offline-gated too, but its one live run (2026-08-24) fell through to `mechanical` rather than winning, so it is not yet live-proven as a strategy that actually wins on a real site — see point 4 under this section. Infinite scroll and load-more are live-proven end to end and now enumerate a listing completely and reproducibly (2026-08-25). What remains of v2, in order: make page-1 extraction reproducible, exercise the load-more trigger live, strengthen the verification gate, fix `deriveTemplate`, find/confirm a corpus site that actually exercises `api-param` live, then progressive confidence and a real job queue.

---

## Testing & Quality Harness (IN PROGRESS)

Spec: `docs/superpowers/specs/2026-05-22-testing-strategy-design.md`. Plan: `docs/superpowers/plans/2026-05-22-testing-strategy.md`. How-to: `docs/testing.md`.

- [x] **P1 — Deterministic fixture-replay gate (DONE — 2026-05-25).** Tier 1 harness (`packages/scraper/src/__fixtures__/`), `setContentEvaluate` on the browser, first seed fixture (IKEA Kallax with 15 golden fields). `pnpm -r test` is now a real green gate. Surfaced and fixed a critical pre-existing v1.1 bug: every PlaywrightBrowser capture against a page taller than the 800px viewport had been throwing on `page.screenshot` since v1.1's tile-capture shipped — needed `fullPage:true` alongside the clip.
- [x] **P2 — Live dogfood + LLM-judge (DONE — 2026-05-26).** CLI in `packages/api/src/dogfood.ts`, `liveCorpus` manifest, per-run Markdown reports under `docs/testing/results/`. First report (`2026-05-26T08-15-dogfood.md`) judged 15/16 IKEA Kallax fields — 2 flagged `wrong`, 6 `not-on-page`; the LLM-judge is doing real work.
- [x] **P3 — Corpus growth (PARTIAL — 2026-05-26).** Nike Air Jordan fixture added. Second IKEA page-shape attempted on BILLY, LACK, and POÄNG — IKEA's headless anti-bot serves a degraded page (no JSON-LD, no nextData, no ingka.com API) for every IKEA URL except the originally captured Kallax, so a second IKEA fixture is deferred until the headless capture story is hardened (same family of problem as Amazon, recorded here so it doesn't get forgotten).

- [x] **P3b — Corpus diversity (DONE — 2026-08-18).** Live corpus is now Newegg (JSON-LD + APIs), Target (no JSON-LD, `__NEXT_DATA__`), and Barnes & Noble (no JSON-LD, no nextData, API-only) — chosen so each exercises a different branch of the extraction chain rather than a different brand. IKEA removed from the *live* corpus: its anti-bot now serves a category page for the Kallax URL, so it produced `category_name` / `subcategories` noise in the 2026-08-18 reports. Its Tier 1 fixture is untouched and still guards the JSON-LD variant walker.

  **Anti-bot, not page complexity, is the binding constraint on corpus growth.** A headless probe of six candidates found Wayfair and Etsy behind CAPTCHA, B&H Photo behind Cloudflare, and REI failing on HTTP/2 — only three of six were capturable at all. This makes the v3 "proxy pool / stealth / CAPTCHA" items a prerequisite for measurement, not a late-stage scaling concern.

- [x] **P4 — Judge calibration (DONE — 2026-08-18).** `packages/agent/src/judge-calibration.test.ts` scores `judgeFieldExtraction` against a fixed fixture page with 9 known answers. Live and paid, so it is gated behind `RUN_JUDGE_CALIBRATION=1` and skipped by the default `pnpm -r test`; run it with `pnpm test:judge`. Threshold ≥8/9 tolerates one nondeterministic flip while catching real degradation — Sonnet 5 scores 9/9, Haiku 4.5 scores 7/9. Motivated by nearly adopting Haiku 4.5 as the cheaper judge: its two misses are a false `not-on-page` on `currency` and a false `wrong` on a correct SKU, i.e. it manufactures the exact bogus-verdict cluster the harness exists to measure. Every verdict in `docs/testing/results/` is the judge's opinion and nothing checked that opinion before. **Not yet covered: `judgeVariantArray`** — needs a fixture page with visible variant swatches.

- [x] **P5 — Corpus liveness (DONE — 2026-08-18).** `pnpm test:liveness` captures each fixture's URL and checks whether that page still carries the values the fixture calls golden. Tier 1 replays a frozen snapshot, so it stays green forever against a site that has changed — IKEA served a category page while its fixture passed, which is precisely the false confidence this closes. Network-bound, no AI, opt-in via `RUN_LIVENESS=1`. Self-calibrating: only goldens that were *visible in the fixture's own capture* are demanded live, so schema.org-only values (Nike's `category: FOOTWEAR`) don't produce false alarms. Searching raw HTML instead was tried and over-corrected — a live IKEA category page still mentions Kallax in its markup. Current state: **IKEA fails (1/4 goldens, live title "Products - IKEA")**, Newegg and Nike pass.

(Dashboard smoke E2E is a separate follow-up, not part of this initiative.)

---

## Variants (DONE — 2026-05-28)

Spec: `docs/superpowers/specs/2026-05-28-variants-design.md`. Plan: `docs/superpowers/plans/2026-05-28-variants.md`.

First-class `variant_array` FieldType for products with color/size/capacity/quantity/finish options. Extraction chain: JSON-LD `ProductGroup.hasVariant[]` walker (mechanical) → cache replay → `SchemaAgent.extractVariants` AI fallback (vision + truncated nextData, cached for repeat domains by `path_hint`). Tier 1 fixture gates Nike's 2 ProductGroup colorways. Tier 2 dogfood routes `variant_array` rows to `judgeVariantArray` — IKEA Kallax now extracts `{Black, White, Birch}` via the AI fallback with judge verdict `correct`. Shape validator accepts axes-only variants (color/size without SKU) while still rejecting recommendations carousels. Deferred: nextData walker, intercepted-API walker, dashboard variant rendering (blocked by v1.5 UI freeze), and the `otFlat` cache-poisoning fix.
