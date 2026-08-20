# v2 — Pagination + Listing→Detail Crawler — Design Spec

**Date:** 2026-08-19
**Status:** Approved — ready for implementation planning
**Related:** [`2026-05-13-dashboard-architecture-redesign-design.md`](2026-05-13-dashboard-architecture-redesign-design.md), [`2026-05-22-testing-strategy-design.md`](2026-05-22-testing-strategy-design.md), [`docs/handoff.md`](../../handoff.md), [`docs/roadmap.md`](../../roadmap.md)

## Motivation

A customer order is rarely one URL. It is "every product in these 12 categories" or "these 500 ASINs". The pipeline today extracts exactly one URL per run, driven from a tRPC mutation that returns when that single page is done.

v1.5 Phase 0 landed the *data model* for multi-input work — `input_sets`, `sources.listing_mode`, `sources.budget` — and **nothing reads it**. `sources.budget` has zero readers in the entire repo; `listing_mode` is only ever displayed. The extraction chain was lifted out of the tRPC router into `@robot/scraper`'s `runExtraction` specifically so a crawler could reuse it rather than duplicate it. This spec is the consumer that was promised.

Run export (2026-08-19) made a run deliverable. This makes a run *worth* delivering.

## Pinned decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Run unit of work | The whole InputSet; one `run_items` row per URL |
| Detail-link discovery | A reserved `detail_url` field extracted by the existing chain in listing mode |
| Spend control | Enumerate first (cheap), extract second, under `sources.budget` caps |
| Results storage | One capture + extraction per URL; union them on read |
| Execution model | Two phases, `run_items` as the queue, in-process worker (no new infrastructure) |
| Listing-only metadata | Per-field `origin` classification partitions the schema by where each field lives |
| Pagination strategy order | cached → `api-param` → `url-pattern` → `next-button` → `page-numbers` |
| Retries | None automatic; `execute` is resumable and can be asked to retry failures |

## What already exists (and is unwired)

Auditing before designing found most of the capture-side machinery already built:

| Asset | Location | State |
|---|---|---|
| `crawl()` async generator | `packages/browser/src/playwright-browser.ts:720` | Implemented, **not on the `IBrowser` interface**, called by nothing |
| Mechanical pagination detection | `packages/browser/src/pagination-detector.ts` | Implemented + unit-tested, called only by `crawl()` |
| AI pagination detection | `SchemaAgent.detectPagination` + `detectPaginationTool` | Implemented, called by nothing |
| `pagination_config` column | `domain_intelligence` | Exists, never written |
| `api_endpoints` column | `domain_intelligence` | Written (top 10 intercepted requests), read only by the domains UI |
| `href` / `absolute_url` support | `SelectorField.attribute`, `.transform` | Fully supported by the executor |
| Reusable extraction chain | `runExtraction` | Reusable, with injectable `capture` |
| Per-domain lock + politeness delay | `packages/scraper/src/domain-lock.ts` | In-memory, 2s minimum spacing |

**Correction to the roadmap:** v1.5 Phase 3 is recorded as delivering a "schema editor with per-field source classification: detail / listing / input.X / system". It did not. `datasets.updateSchema` accepts only `{ name, type, required?, description? }` and the Dataset page has no such control. This spec builds it.

## Goals

1. A Source with a `category` or `search` InputSet produces detail-page rows for every input, within a budget.
2. Detail URLs are discovered without new bespoke machinery, and cached per domain so the second run is free.
3. Pagination is detected once per domain and cached; API-backed listings are paginated through the API.
4. A run's fan-out and estimated cost are visible **before** any per-detail money is spent.
5. Fields that exist only on the listing page (category, breadcrumb, listing price) reach the detail rows.
6. A 500-URL run is startable, cancellable, resumable, and reports per-URL status.

## Non-goals

| Excluded | Why |
|---|---|
| Run progress UI / per-input status grid | Track B; `crawl.status` gives it everything it needs later |
| `listing` mode (rows straight off listings, no detail visit) | v2.1 in the v1.5 spec |
| `sitemap` input strategy | XML fetch + parse, unrelated machinery |
| Infinite scroll / load-more pagination | Needs scroll/click loops with their own termination problems |
| POST / GraphQL body pagination | Needs body mutation and per-site query knowledge |
| Job queue, multi-process workers | `run_items` is the seam to swap in later |
| Progressive-confidence ladder (1→5→20→1000) | Needs rung-confirmation UI, which is Track B |
| InputSet CSV import | Track B |
| Automatic retries | See *Failure handling* — deliberate, not deferred |

---

## 1. Data model

### 1.1 New table `run_items`

Simultaneously the work list, the queue, and the per-URL status record.

```
run_items
  id              uuid pk
  run_id          uuid → runs (on delete cascade)
  kind            varchar(10)   'listing' | 'detail'
  url             text          absolute
  input_index     integer       which InputSet row this descends from
  input_values    jsonb         snapshot of that row
  listing_values  jsonb         values captured on the listing page for this row
  page_number     integer       listing items only
  parent_id       uuid → run_items  the listing page that discovered this URL
  status          varchar(12)   'pending' | 'running' | 'done' | 'failed'
  attempts        integer default 0   incremented on each claim; no automatic retries
  error           text
  extraction_id   uuid → extractions
  started_at, completed_at, created_at  timestamptz

  unique (run_id, url)
  index (run_id, status), (run_id, kind)
```

`unique (run_id, url)` is the dedupe mechanism: the same product appearing on two listing pages inserts once (`ON CONFLICT DO NOTHING`).

`input_values` also satisfies the v1.5 requirement that "a Run snapshots the InputSet rows used", so historical runs stay reproducible when the InputSet later changes.

Run-level counts are **derived** by aggregating `run_items`, never denormalized onto `runs`.

### 1.2 Run status vocabulary

`runs.status` gains crawl states: `planning → planned → extracting → completed | partial | failed`, plus `cancelling` / `cancelled`.

`partial` is the important addition — at scale, "480 of 500 succeeded" is the normal outcome and today's binary completed/failed cannot express it.

### 1.3 `sources.budget` gets its first reader

Shape as declared in the v1.5 spec, with defaults applied when absent:

```
{ max_pages = 3, max_items = 50, mode = 'first_n' }
```

`mode` was ambiguous in the original spec and is now defined:

- `first_n` — stop enumerating once `max_items` detail URLs exist
- `all` — ignore `max_items`; stop only at `max_pages`

Defaults are deliberately conservative, and the thing they conserve is **requests to the site, not dollars**. AI cost per detail page collapses after the first one (§2.5), but every item is still one or two page loads against a domain whose anti-bot is the project's binding constraint. An unset budget must never mean an unbounded number of requests.

A hard ceiling of **5000 items per run** applies regardless of configuration, because a mis-detected `url-pattern` template is a loop generator.

### 1.4 Field `origin` on Dataset schema fields

```
origin: 'detail' | 'listing' | 'input' | 'system'   // absent ⇒ 'detail'
input_column: string                                 // when origin = 'input'
```

Lives inside the existing `datasets.schema` jsonb — no migration. `datasets.updateSchema`'s zod contract widens; the Dataset page gains a minimal per-field control.

The classification **partitions** the schema, and each partition is resolved where it lives:

| origin | Resolved |
|---|---|
| `detail` | per detail page, phase 2 |
| `listing` | during phase 1, carried down to the row's detail item |
| `input` | copied from the InputSet row by `input_column` |
| `system` | `_url`, `_page_number`, run metadata |

System fields are defined rather than open-ended: `_url` is the detail URL the row was extracted from, and `_page_number` is the listing page the URL was discovered on (`null` for `listing_mode: 'detail'` Sources, which have no listing phase).

Because the partitions are disjoint, the final row is a plain key merge with no precedence rules. A listing-classified field is **never** looked for on the detail page — cheaper, and it cannot silently return a wrong value from a page that does not have it.

A field that resolves nowhere stays `null` with `not_found`, as today. Honest failure over substituted values.

---

## 2. Phase 1 — `plan`

Cheap, no per-detail AI, and it ends with a work list you can inspect before spending.

### 2.1 Input URLs

For each InputSet row, `build-input-urls.ts` forms the starting URL from `input_strategy` + `url_template`:

| Strategy | URL |
|---|---|
| `direct` | the primary value itself |
| `template` | `url_template` with the primary value substituted |
| `category` | `url_template` with the category slug substituted |
| `search` | `url_template` with the query substituted |

A `listing_mode: 'detail'` Source stops here: one `detail` item per input row, no listing capture at all. **This is how batch runs over plain detail Sources fall out of the same machinery for free** — most of handoff item 3, with no second design.

### 2.2 Listing capture and link discovery

Page 1 is captured through the existing `runExtraction` in listing mode against a schema of:

- the synthetic field `{ name: 'detail_url', type: 'url', attribute: 'href', transform: 'absolute_url' }`
- plus every Dataset field with `origin: 'listing'`

The entire chain applies unchanged — mechanical, cached paths, cached XPaths, cross-validation, AI selector generation, cache save. A domain crawled before costs **$0** for this step.

### 2.3 Listing fields: per-row and page-level

Listing-origin fields come in two shapes and both are handled without new schema vocabulary:

1. **Per-row** (listing price, listing title) — extracted relative to `row_xpath`, so each value follows its own `detail_url`.
2. **Page-level** (the category name in a breadcrumb or header, shown once) — not per-row at all.

Phase 1 resolves per-row first, then runs a second **document-mode** pass over the *same capture* for anything still unresolved, applying those values to every row from that page. Re-using the capture is free — `ExtractionDeps.capture` already exists for fixture replay — so the second pass costs no fetch and no AI beyond selector generation for those fields.

Resolved values are written to the detail item's `listing_values`.

**Warning at plan time:** if a Source is `listing_mode: 'detail'` but its Dataset has listing-origin fields, `plan` returns a warning. Those fields can only ever be null, and learning that at plan time beats learning it from the export.

### 2.4 Pagination

Strategy order, with automatic fallback at each step:

```
cached config → api-param → url-pattern → next-button → page-numbers
```

The winner is written to `domain_intelligence.pagination_config` for `(domain, 'listing')`, so later runs — including other customers' — pay nothing for detection.

#### `api-param` (preferred when available)

Page 1's capture already holds every intercepted XHR with URL, method, headers and parsed JSON.

**Detection uses evidence comparable by construction.** The listing API is the intercepted response whose JSON contains the *same* detail URLs or slugs the row extraction just produced. This is a match on shared concrete values, not on "this looks like a product endpoint" — the standard the reverted API entity filter (`c606a54`) failed to meet, and the bar the handoff sets for any replacement. If no response contains those values, there is no API pagination and we fall through.

**Paging parameter** is found by scanning the request's query string for `page`, `offset`, `start`, `from`, `skip`, `cursor`, with the AI as fallback.

**Replay happens inside the page context** via `page.evaluate(fetch)`, never from Node, so cookies, auth headers and CSRF tokens apply automatically and the request is indistinguishable from the site's own.

**Detail URLs come out of the JSON** through the existing cached-API-path tier: `detail_url` gets an `api`-sourced dot-notation path in `field_paths`, so later runs enumerate for $0.

**Termination** prefers real signals from the payload — `total`, `totalPages`, `hasMore`, `nextCursor` — over the heuristics HTML forces on us.

**When the API returns ids or slugs rather than URLs:** if the values are not absolute URLs and the Source has a `url_template`, substitute; otherwise fall back to HTML pagination rather than guess.

Scope: **GET query-parameter pagination only.**

#### HTML strategies

`url-pattern`, `next-button` and `page-numbers` come from the existing `detectPaginationFromHtml`, with `SchemaAgent.detectPagination` as the AI fallback. Pages 2..`max_pages` reuse page 1's `ExtractionPlan` via `browser.crawl()` with `buildExtractionScript(plan)` — no further AI.

#### Stop conditions

Beyond `max_pages` / `max_items`:

- a page yields zero detail URLs
- a page yields **only URLs already seen** — the signature of a site that clamps out-of-range page numbers back to page 1, which would otherwise walk to `max_pages` on every run

#### Cache degradation

When a cached config produces nothing on page 2, phase 1 re-detects once, stores the new config, and stamps the failure. Consistent with the project rule that degradation is recorded, never silently reset.

### 2.5 Output

One `listing` item is recorded per listing page actually walked (with its `page_number`), so the plan is auditable: which pages were fetched, and which detail URLs each produced. Detail items are inserted (absolute, deduped, budget-capped). The run moves to `planned` and `plan` returns item count, per-input breakdown, warnings, and a cost estimate.

**`plan` reports item count and whether the domain cache is warm. It does not report a dollar figure.**

Every AI step in `runExtraction` is gated on fields still missing: STEP 2 fires on `missingAfterCache`, STEP 3 on `missingAfterApi`. Within one crawl over one domain, detail page 1 is cold (selector generation + API analysis, ~$0.47), writes the cache, and pages 2..N resolve from that cache for **$0** apart from individual pages carrying a field the cache misses. A 180-item crawl costs a few dollars, not a few hundred.

The handoff's "~$0.20 warm per URL" was measured across the dogfood corpus — different sites, different page shapes, partial cache coverage — and does not describe a homogeneous crawl. Multiplying it by item count produces a confidently wrong number, which is worse than no number. Hence: report items and cache warmth, and let the operator judge.

**What is worth counting is page loads**, and §8 records why.

---

## 3. Phase 2 — `execute`

Claims pending `detail` items in order and calls `runExtraction` per URL with the Dataset's `origin: 'detail'` fields only. Each item produces a capture and an extraction, and the item is stamped `done` with its `extraction_id`.

The persisted row is the merge `{ ...input_values, ...listing_values, ...detail_extraction, _url }` — disjoint by construction (§1.4).

**Driving it.** 200 items × ~30s is ~100 minutes, which no HTTP mutation can hold open. `crawl.execute` starts the loop in the api-server process and returns immediately; all state lives in `run_items`, so progress is observed by polling `crawl.status`. This is the honest limit of "no new infrastructure": if the api-server restarts mid-run, the run pauses until someone resumes it. A real job queue is the upgrade path, and `run_items` is the seam.

**Concurrency: sequential, deliberately.** A Source is one domain, and `acquireDomainLock` plus the 2s politeness delay already serialize same-domain work — parallelism inside a run would only fight the politeness rule. Different runs still overlap. Claiming uses `FOR UPDATE SKIP LOCKED` regardless, so a second worker or a re-entered `execute` can never double-process an item.

### 3.1 Failure handling

An item that throws is marked `failed` with its error text; the run continues. Run status rolls up to `completed`, `partial`, or `failed`.

**No automatic retries.** The dominant failure mode here is anti-bot blocking, and retrying a blocked page two seconds later spends money to get blocked again. Instead `execute` is idempotent and resumable: call it again to pick up `pending` items after a crash, or with `retryFailed: true` to re-attempt failures once conditions actually change.

### 3.2 Cancellation

`crawl.cancel` flips the run to `cancelling`; the loop checks between items and stops, leaving pending items `pending`. Cancel and resume are therefore the same mechanism.

---

## 4. Read side

`runs.getWithDetails` unions all of a run's extractions in work-item order, adds status counts, and takes a row limit for the UI (the results table shows 100 today). `loadRunExport` takes them all — a 5000-row export is a few MB, so no streaming is needed.

Export columns become the Dataset schema fields in schema order, plus `_url` and propagated input columns. The column derivation added with run export already appends undeclared keys, so this is a widening rather than a rewrite.

**Back-compatibility:** today's single-URL sandbox runs have one extraction and no `run_items`. Aggregation handles both — with no items, extraction order falls back to `created_at`, and the run detail page and export behave exactly as they do now.

---

## 5. Code layout

New `packages/scraper/src/crawl/`, decisions in pure functions and I/O in two thin orchestrators:

| Unit | Responsibility |
|---|---|
| `build-input-urls.ts` | InputSet rows + strategy + template → starting URLs. Pure. |
| `enumerate-detail-urls.ts` | listing rows → absolute, deduped, budget-capped URLs. Pure. |
| `budget.ts` | defaults, caps, `mode` semantics, hard ceiling. Pure. |
| `merge-row.ts` | input + listing + detail + system → final row. Pure. |
| `detect-api-pagination.ts` | intercepted requests + known detail URLs → `api-param` config. Pure. |
| `plan-run.ts` | phase 1 orchestration, deps injected |
| `execute-run.ts` | phase 2 loop |

`packages/api/src/routers/crawl.ts` stays thin: `plan`, `execute`, `status`, `cancel`.

`@robot/browser` changes: `crawl()` joins the `IBrowser` interface (today it exists only on the concrete class, so nothing can fake it), gains a "start from page 2" option so phase 1 does not re-fetch the page it already captured, and gains API-replay page fetching.

**As built, `startPage: 2` skips only the page-1 extraction and yield — the page-1 navigation still happens**, because pagination is detected from page 1's live DOM inside `crawl()` and the click-based strategies need that page loaded. The duplicate page-1 load therefore remains until a cached `pagination_config` can be handed to `crawl()` in place of detection.

---

## 6. Testing strategy

Following the project's three tiers.

**Pure units** carry the weight: all input strategies; URL absolutization and dedupe; budget defaults, `mode`, and hard ceiling; both stop conditions; `merge-row` partition merging including missing values; `api-param` detection including the negative case where no response contains the known URLs.

**Orchestrator tests with fakes** — a fake `IBrowser` (now possible, since `crawl()` joins the interface) plus a stub agent: phase 1 produces the expected `run_items`; phase 2 marks statuses; one throwing item does not stop the run; cancel halts between items; resume picks up pending items.

**DB-level**: two concurrent claims never return the same item; `unique (run_id, url)` dedupes; status rollup produces `partial` correctly.

**A new Tier 1 listing fixture** — a captured category page plus its page 2. This is the most valuable asset in the spec: the corpus is entirely detail pages today, so link enumeration and pagination detection currently have no deterministic gate at all.

**Live dogfood** extended with a deliberately tiny crawl (1 input, `max_pages: 2`, `max_items: 3`), ~$1.50 rather than ~$90.

---

## 7. Migration

One Drizzle migration for `run_items` and the widened run-status vocabulary, generated with `pnpm db:generate` and committed as SQL alongside `packages/db/drizzle/*.sql`. `origin` needs no migration — it lives inside the existing `datasets.schema` jsonb.

---

## 8. Risks

**Anti-bot is made worse by this feature, not better.** Walking 10 listing pages plus 200 detail pages from one IP is exactly the access pattern that degrades stealth, and four of eleven probed sites are already hard-blocked. `api-param` pagination reduces the surface (one request per page instead of a full render) but does not remove it. The proxy-budget decision in the handoff remains open and this raises its priority.

**Requests and wall-clock are what scale, not AI spend.** A 180-item crawl is a few dollars of AI but 180–360 page loads and, with the 2s politeness delay, one to two and a half hours of browsing against a single domain. `evaluate()` opens a new page and re-navigates, so any item falling through to cached XPaths loads its page **twice** — precisely the warm path a crawl spends most of its time in.

`setContentEvaluate(html, script)` already exists on `IBrowser` and runs a script against captured HTML with no navigation. Routing the cached-XPath tier through it removes the second load, roughly halving a warm crawl's request footprint and wall-clock. That optimisation is only worth doing because of this feature, so it belongs to this spec (§9 step 4) rather than to general scraper polish.

The enumerate-then-extract gate, conservative budget defaults, and the hard ceiling are the mitigations; none is a substitute for looking at the plan output before running phase 2.

**An in-process worker loses its run on restart.** Mitigated by durable `run_items` and idempotent resume, not solved. Approach C (a real queue) is the upgrade when this stops being acceptable.

**`origin` classification is new UI surface** on a Dataset page that currently has none of it. Kept minimal deliberately; the pipeline half works with `origin` absent (everything defaults to `detail`), so the UI can lag without blocking the crawler.

---

## 9. Suggested implementation order

1. Field `origin`: schema model, `updateSchema` contract, minimal Dataset editor control
2. `run_items` migration + run status vocabulary
3. Pure crawl units (`budget`, `build-input-urls`, `enumerate-detail-urls`, `merge-row`)
4. `IBrowser.crawl` + start-from-page-2 option + fake browser for tests; route the cached-XPath tier through `setContentEvaluate` so a warm item stops re-navigating (§8)
5. `plan-run` (phase 1) — HTML pagination first, plus the new Tier 1 listing fixture
6. `detect-api-pagination` + API replay, layered in front of HTML detection
7. `execute-run` (phase 2), including cancel and resume
8. `crawl` router + wiring
9. Read-side aggregation (`runs.getWithDetails`, `loadRunExport`)
10. Dogfood on one real category URL with a tiny budget
