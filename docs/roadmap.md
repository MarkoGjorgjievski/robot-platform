---
name: AI Scraper product roadmap and feature backlog
description: Two parallel tracks — pipeline (Track A) and dashboard/platform (Track B). Source of truth for what's planned.
type: project
---

The roadmap runs as **two parallel tracks**:

- **Track A — Pipeline / Backend.** The scraper itself: capture, extraction chain, AI, cache.
- **Track B — Platform / Dashboard.** The UI, data organization, how customers interact with the product.

Tracks are decoupled but v1.5 (Track B) is the bottleneck for *seeing* any Track A work in the UI. After v1.5 lands, v2 pipeline features have a real home.

Exploratory backlog items (not yet release-staged) live in `docs/ideas.md`.

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

### v2 — Multi-Page Pipeline

- [ ] AI auto-detects pagination patterns (Next button, page numbers, infinite scroll, load-more)
- [ ] Pagination pattern cached in `DomainIntelligence.pagination_config`
- [ ] **Listing → Detail crawler:** follow links from listing to detail pages (absorbs BBC-style cases — instead of fighting custom React listings, fetch each detail page)
- [ ] Honor per-Source pagination budget (max_pages / max_items / mode)
- [ ] Progressive confidence (1 → 5 → 20 → 1000 URLs)
- [ ] Batch extraction with per-input status tracking
- [ ] `crawl()` method on `@robot/browser`

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

Replaces the current Next.js wizard with a TanStack Router + Query SPA backed by a new `packages/api-server` (Hono mounting the existing tRPC routers over HTTP). Introduces Sandbox + Graduate model, renames `collections` → `datasets`, makes `input_sets` first-class, and lays the data-model foundation for v2 pipeline features.

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
- [x] **Phase 2 — Sandbox flow** (DONE — 2026-05-15)
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
- [x] **Phase 4 — Graduate** (DONE — 2026-05-18)
  - [x] Move-from-Sandbox-to-Project flow
  - [x] Inline InputSet promotion to named InputSet
- [x] **Phase 5 — DomainIntelligence views** (DONE — 2026-05-20)
  - [x] Global `/domains` library (aggregated per-domain run/success/field stats)
  - [x] Per-domain detail `/domains/{domain}` — flat sortable selectors table (hit/miss, last value, failing paths first), summary stats, cross-customer sources. Read-only.
  - [x] Two read-only `domainsRouter` procedures (`intelligenceList`, `intelligenceDetail`)
  - (Per-project domain views were already delivered in Phase 3.)

### v2 — Dashboard hooks for pipeline work

- [ ] Run progress UI for batch extractions (polling-based for v1; SSE/WebSocket later)
- [ ] Pagination preview / pre-run cost estimate
- [ ] Per-input status grid (which inputs succeeded / failed in a run)
- [ ] InputSet CSV import + bulk paste

### v2.1 — Dashboard for click-to-select

- [ ] Visual element picker UI in Source detail
- [ ] Override → save to `DomainIntelligence` with highest priority

### v3 — Production / Operations Dashboard

- [ ] Scheduling UI (project-level cron + per-source overrides)
- [ ] Cost-preview UX (deferred from v1.5)
- [ ] Multi-tenant auth shell — surface Org level in UI; **drop legacy `extractors` / `extractor_inputs` / `credentials` / `robot_overrides` tables here** (they tie to the pre-multi-tenant extractor model and need re-modeling with proper auth)
- [ ] Data export (CSV / JSON / webhook destinations)
- [ ] Public API surface — comes nearly free from `packages/api-server` landing in v1.5 Phase 1
- [ ] Cost tracking per source/customer

---

## Track interactions

- **v1.5 Phase 0 unblocks v2 pipeline work.** Once `input_sets`, `Source.listing_mode`, and `Source.budget` exist (now done), the v2 pipeline (pagination + listing→detail) has somewhere to read its config from.
- **v1.5 Phase 1 de-risks v3's public API.** `packages/api-server` exists as a standalone HTTP service from day one; exposing a public `/extract` endpoint in v3 is a matter of auth and rate-limiting, not infrastructure.
- **v1.1 and v1.5 run in parallel.** Both are pipeline-only or dashboard-only and don't share files. v1.1 touches scraper subsystems; v1.5 Phase 5 is the dashboard. v1.1a (extraction completeness) shipped 2026-05-19.
- **v2 listing→detail subsumes the BBC fix and the Amazon reseller side-panel.** Both former v1.1 items become moot because the new strategy is "always go to the detail page when listing extraction is lossy."

**How to apply:** v1.5 is complete (Phases 0-5 done). v1.1 (backend stability) remains the open Track A polish item; v2 pipeline features (pagination, listing→detail) are the next major capability and now have their full dashboard foundation. v2 pipeline features land on the v1.5 Phase 0 data model and gain a UI via the existing v1.5 Phase 3+ views.
