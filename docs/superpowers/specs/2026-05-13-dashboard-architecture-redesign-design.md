# Dashboard Architecture Redesign — Design Doc

**Date:** 2026-05-13
**Status:** Approved (all open decisions locked 2026-05-13). Ready for implementation planning.

---

## 1. Context & motivation

### What we have today

- `packages/dashboard` is a Next.js 15 app whose entire user flow lives in a single `ExtractionWizard` component holding state via `useState`. Refreshing the page wipes everything in progress.
- The wizard talks to two ad-hoc Next API routes (`/api/scraper/analyze`, `/api/scraper/extract`) via raw `fetch`. The `@robot/api` tRPC routers exist but are not used by the dashboard.
- Results are auto-saved at the end of the flow into a flat `quick_extractions` table that has no relation to the proper data model (`orgs → projects → collections → sources → captures → extractions`).
- The `/extractions` page lists `quick_extractions` grouped by domain. Domain has become the de-facto organizing key, even though the schema says collections own sources.

### Why this hurts

1. **No URL identity for state.** Can't share a link to "this wizard in progress," "this capture," or "this extraction." Refresh = start over.
2. **Two parallel worlds.** `quick_extractions` (wizard output) and `sources/captures/extractions` (proper model) are disconnected. Nothing graduates from "I tried a URL" to "this is a saved source we run on a schedule."
3. **Domain ≠ Source ≠ Project.** The business model expects Customer / Project / Source organization, but the UI organizes by domain. They diverge as soon as one domain serves two customers or one source spans subdomains.
4. **Action ≠ persistence.** Auto-save fires once at the end. Schema edits, field toggles, retries don't persist — they live in React state only.

### Goals

- Every meaningful user action persists to the database immediately.
- URLs reflect state (REST pattern, deep-linkable, refresh-safe).
- Data is organized by customer engagement, not by domain accidents.
- Move from Next.js to a TanStack stack.
- Keep the "paste-and-go" entry UX (one of the few things the current dashboard gets right).

### Non-goals (for this redesign)

- Multi-tenancy / auth (Org stays in the DB but hidden in the UI for now).
- Scheduling / cron jobs (data model leaves room for it; UI does not surface it yet).
- Data export, billing, public API.
- Anti-bot / proxy pool integration.

---

## 2. Mental model — Sandbox + Graduate

The dashboard combines two patterns:

- **Project-first** is the long-term home: customers → projects → datasets → sources.
- **Paste-and-go** is the entry UX: drop a URL on the landing page, the system kicks off analysis immediately.

Resolved by the **Sandbox + Graduate** pattern:

| Stage | Container | URL shape | Purpose |
|---|---|---|---|
| First paste | **Sandbox** (a single special Project per Org) | Opaque ID — `/sandbox/{shortid}` | Throwaway, exploratory. No naming required. |
| "This is worth keeping" | **Graduation** → real Project + Dataset | Hierarchical slug — `/p/{project}/sources/{source}` | First-class asset, has slug, can be re-run, can be assigned a schedule later. |

Graduation is just `UPDATE source SET project_id = ?, dataset_id = ?, input_set_id = ?, slug = ?`. Same row, four foreign keys.

### Why not "Project 1" by default

Every implicit-creation product that defaults to "My Project 1" ends up with that project bloated and named ones empty. Sandbox is clearly labeled as throwaway, so users don't feel they need to clean it up — they just promote what matters.

### Why not opaque IDs everywhere (ChatGPT-style)

The stated goal is REST-pattern URLs. ChatGPT-style `/c/abc123` fights that. Compromise: opaque IDs in Sandbox (cheap throwaway), readable hierarchical slugs in projects (durable assets). The URL itself tells you which world you're in.

### What the chat-thread analogy gets wrong

The "paste a URL, it becomes a thread, threads cluster into projects" pattern from ChatGPT/Claude.ai is attractive but misleading for this domain:

- **Sources are persistent assets, not ephemeral threads.** A scraper source is a configuration you maintain (re-run weekly, fix when the site changes), not a conversation you scroll back through.
- **The unit of value isn't "one URL run."** It's a (URL pattern × InputSet × Schema) tuple that gets executed against many inputs.
- **"Untitled" is cheap for chats, expensive for sources.** 100 untitled chats cost nothing; 100 untitled sources get scheduled, run, billed, and become unidentifiable. Auto-name everything from the URL (`amazon.com – B0CHX1W1XY`).
- **Projects need to be more than folders.** ChatGPT projects are folders + system prompt; ours need shared schema, shared schedule, shared credentials.
- **The big textarea metaphor over-promises.** A textarea invites natural-language input ("scrape these 50 sites"); the pipeline accepts a URL. Either commit to NL parsing as a real surface, or stay honest: it's a URL field with optional schema hints.

---

## 3. Data hierarchy

```
Org                                       (hidden — single tenant for now)
└── Project                               "Acme EU Price Monitor" — a customer engagement
    │
    ├── Datasets                          OUTCOME: a schema + the sources that feed it
    │     schema, default schedule, output destination
    │
    ├── InputSets                         REUSABLE LISTS: typed primary + metadata columns
    │     type, columns, rows
    │
    └── Sources                           CROSSPOINT: tie a Dataset + InputSet + Domain + Strategy
          dataset_id, input_set_id, domain, input_strategy,
          url_template, listing_mode, budget
          │
          └── Run                         one execution at a timestamp
                input_snapshot
                │
                ├── Capture               raw artifact per URL
                └── Extraction            structured rows per URL

Cross-cutting (global, shared across all customers)
- Domain
- DomainIntelligence                      cached selectors, pagination patterns, popup recipes
```

### Datasets and InputSets are siblings, not parent/child

The customer thinks in two dimensions at once:

- *Outcomes* — "I want product data, plus reviews, plus reseller info"
- *Inputs* — "Here are 500 ASINs, here's a list of categories, here are some search terms"

A **Source** is the crosspoint: it picks **one** Dataset (= which schema applies), **one** InputSet (= which values to feed), **one** Domain, and **one** input strategy.

This is what enables the killer case: same customer, same site, different outcomes.

```
Acme Engagement (Project)

Datasets:
  Products    schema={name, price, rating}
  Reviews     schema={author, rating, body, date}
  Reseller    schema={seller, price, condition}

InputSets:
  Acme ASINs Q1            type=template_value,   500 ASINs
  Walmart Categories       type=category,         3 slugs
  Target Search Terms      type=search,           5 queries

Sources:
  amazon-products      → Products  + Acme ASINs           (template, /dp/{asin})
  amazon-reviews       → Reviews   + Acme ASINs           (template, /product-reviews/{asin})
  amazon-reseller      → Reseller  + Acme ASINs           (template, /gp/offer-listing/{asin})
  walmart-products     → Products  + Walmart Categories   (category, listing→detail)
  target-products      → Products  + Target Search Terms  (search,   listing→detail)
```

Three different schemas, one shared InputSet across three Sources for Amazon.

---

## 4. Entities in detail

### Project

- One customer engagement (e.g., "Acme EU Price Monitor").
- Owns Datasets, InputSets, Sources.
- One special Sandbox Project per Org for throwaway work.
- Slug-based, human-named for real projects; opaque ID for Sandbox.

### Dataset (renamed from `collections`)

- "One type of extraction" — an *outcome*.
- Owns a **schema**.
- Same Dataset has many Sources (one per site).
- **Why rename:** "Collection" is ambiguous (could mean set-of-sources or set-of-extracted-items). "Dataset" maps directly to how the customer talks: "I want this dataset for 50 sites." Cheap rename now, painful migration later.

### Schema (lives on Dataset)

Each field declares **where its value comes from**:

| `source` | Meaning |
|---|---|
| `detail` | Extracted from the detail page |
| `listing` | Extracted from the listing row that contained the detail link |
| `input.<col>` | Pulled from the input row (e.g., `input.search`, `input.department`) |
| `system` | Run metadata (timestamp, run_id) |

This is the **explicit join** that makes the protein-bars problem tractable:

```
Schema "Products":
  product_name   { type:'string', source:'detail'         }
  price          { type:'number', source:'detail'         }
  rating         { type:'number', source:'detail'         }
  subcategory    { type:'string', source:'listing'        }   ← only on listing
  category       { type:'string', source:'input.search'   }   ← from input row
  department     { type:'string', source:'input.department' }
  extracted_at   { type:'date',   source:'system'         }
```

Output row = `{ ...from(input), ...from(listing_row), ...from(detail), ...from(system) }`.

**Validation:** A field with `source: 'listing'` only makes sense if at least one Source in the Dataset has `listingMode = 'listing_to_detail'`. Validate at save time.

**Defer:** No `derived` / computed-field source in v1. Transforms come later.

### InputSet

Typed table, not a string array. The customer's "list of inputs" is actually a small CSV.

```
InputSet "Acme Searches"
  type: 'search'                    ← strategy semantics (rigid)
  columns:                          ← shape of each row (flexible)
    { name:'search',     primary:true,  type:'string' }
    { name:'department', primary:false, type:'string', propagate:true }
    { name:'priority',   primary:false, type:'number', propagate:false }
  rows:
    { search:'protein bars', department:'snacks', priority:1 }
    { search:'vitamins',     department:'health', priority:2 }
```

- **Strategy is rigid** — one InputSet has exactly one type. The primary column's *meaning* is fixed.
- **Columns are flexible** — any number of metadata columns of any type.
- **`propagate: true`** columns flow to output rows via `source: 'input.<col>'` in the schema.

Strategy types (v1):

| Type | Primary value is | URL formed by |
|---|---|---|
| `direct` | full URL | the URL itself |
| `template` | substitution value (ASIN, slug, etc.) | template + value |
| `category` | category slug or URL | template + slug, then listing→detail |
| `search` | search query | template + query, then listing→detail |
| `sitemap` | sitemap URL | crawl the sitemap |

### Source — the workhorse entity

```
Source
  dataset_id          → which schema applies (null while in Sandbox)
  input_set_id        → always set; Sandbox uses an inline InputSet (hidden, one per Sandbox Source)
  domain              → 'amazon.com'
  input_strategy      → must equal the InputSet's type (the matched pair)
  url_template        → 'https://amazon.com/dp/{asin}'
  listing_mode        → 'detail' | 'listing' | 'listing_to_detail'
  budget:             { max_pages, max_items, mode: 'all' | 'first_n' }
  slug                → 'amazon-products' (null in Sandbox; auto-display-name still set)
```

The `input_strategy` on Source and the `type` on InputSet are the **same enum** and must match — a Source with `input_strategy='search'` can only reference an InputSet whose `type='search'`. Naming difference is historical (one is "from the Source's perspective", the other "from the InputSet's perspective"); they refer to the same dimension.

**One strategy per Source** is a hard rule. "Walmart categories" and "Walmart search" are two Sources in the same Dataset. The cost is one duplicate row; the win is unambiguous shape (schema validation, UI rendering, AI prompts all simpler).

### Run

- One execution of a Source against its InputSet at a timestamp.
- Snapshots the InputSet rows used (so historical runs stay reproducible even if the InputSet later changes).
- Aggregates status, totals, cost.
- A Dataset doesn't have runs directly — it aggregates runs across its Sources in the UI.

### Capture / Extraction

- **Capture** = raw artifact (HTML, screenshot, intercepted APIs) per URL fetched.
- **Extraction** = structured rows per URL.
- Both belong to a Run. Both are artifacts, **not** top-level navigable resources.
- The current `quick_extractions` flat table is a symptom of the missing hierarchy and will be removed; Sandbox extractions live under a Sandbox Source.

### Domain / DomainIntelligence (the moat)

- **Domain** is the global identity.
- **DomainIntelligence** holds the cross-customer cached knowledge: selectors with hit/miss stats, pagination *pattern*, popup-dismissal recipes.
- **Strictly customer-agnostic.** No customer data ever leaks in. This is the asset that compounds across the business — once we've scraped amazon.com for one customer, every future customer benefits.

### Pagination — where each piece lives

- **Pattern** (page-param / cursor / infinite scroll / load-more) → **DomainIntelligence** (AI-detected on first run, cached, free for subsequent customers).
- **Budget** (max pages, max items, stop conditions) → **Source** (user-controlled, per-engagement).
- **Per-input budget override** allowed (a single category is huge; cap it).
- **Strategy override per input is not allowed** — that's a different Source.

### Listing vs Detail mode

- `detail` — direct or template strategy; one URL → one row.
- `listing_to_detail` — category, search; walk listing pages, follow each link to a detail page.
- `listing` — extract rows directly from listing pages (cheaper but lossy). **Deferred to v2.1.**

`listingMode` is *inferred* from `inputStrategy` (with override). Default mapping:
- `direct`, `template` → `detail`
- `category`, `search` → `listing_to_detail`
- `sitemap` → varies

---

## 5. URL routing (REST pattern)

```
/                                                 → Sandbox paste-and-go landing
/sandbox                                          → drafts list
/sandbox/{shortid}                                → one draft Source (the wizard, deep-linkable)

/p/{project}                                      → project home (both views: by dataset, by domain)
/p/{project}/datasets                             → all datasets in project
/p/{project}/datasets/{dataset}                   → dataset detail (schema + sources contributing)
/p/{project}/inputs                               → all input sets in project
/p/{project}/inputs/{inputset}                    → inputset rows + which sources reference it
/p/{project}/domains                              → all sites this project touches
/p/{project}/domains/{domain}                     → all sources in this project on this site
/p/{project}/sources                              → all sources in project
/p/{project}/sources/{source}                     → SOURCE DETAIL — workhorse view
/p/{project}/sources/{source}/config              → strategy, template, budget
/p/{project}/sources/{source}/inputs              → InputSet view filtered to this source
/p/{project}/sources/{source}/runs                → run history
/p/{project}/sources/{source}/runs/{run}          → one run's results

/domains                                          → global domain library
/domains/{domain}                                 → DomainIntelligence detail (shared asset)
```

Two cross-cutting views the UI must expose at the Project level:

- **By outcome (Dataset)** — "Acme wants Products, Reviews, Reseller info"
- **By site (Domain)** — "All sources in this project that touch amazon.com" — engineers reach for this when amazon.com breaks at 2am

---

## 6. Persistence model — "save after every action"

The current wizard saves once at the end. The new model:

- **First paste creates a draft Source row** in Sandbox **before** the AI even runs. URL updates to `/sandbox/{shortid}` immediately.
- Each wizard step is a mutation on that row:
  - `analyze` → write `schema_preview`, `page_type`, `capture_id`.
  - User toggles fields → mutate `schema_overrides`.
  - `extract` → write latest `Run` + `Extraction` rows.
- Reload at any step → URL rehydrates the wizard from the row's current state.
- **Graduate** = `UPDATE source SET project_id=?, dataset_id=?, input_set_id=?, slug=?` and redirect to `/p/{project}/sources/{source}`.

Mutations target the same `sources` table that hosts graduated sources. There is no separate "wizard state" entity. The wizard *is* a source-in-progress.

---

## 7. Tech stack

**Locked: TanStack Router + TanStack Query as an SPA, hitting a standalone tRPC HTTP server.**

The deciding factor is the existing `@robot/api` tRPC routers — they stay as the canonical API surface. Adding a new `packages/api-server` (thin Hono wrapper) mounts those routers over HTTP. Dashboard consumes them via `@trpc/client`.

```
packages/
  api/           tRPC routers (existing, unchanged)
  api-server/    NEW — Hono entry point: mounts tRPC over HTTP, opens DB connection
  dashboard/     TanStack Router + Query SPA, hits api-server via HTTP
```

**Dev:** Turbo runs `api-server` on :4000 and `dashboard` (Vite) on :3456 concurrently.

**Prod:** Same machine, reverse-proxy `/api/*` → api-server, `/*` → dashboard static files.

### Why SPA over TanStack Start

- The existing tRPC investment is real and reusable. Start would either require a redundant wrapper (server function → tRPC procedure → DB) or rewriting the routers as server functions.
- Internal tool — no SSR benefit (no SEO, no cold-load anxiety).
- TanStack Router 1.x has been stable longer than Start.
- Separation pays later: a future public API or mobile client gets the tRPC server for free.
- Reverse-migration is cheaper: SPA → Start later is mostly mechanical; Start → SPA is painful.

### What this implies

- **All mutations go through tRPC.** The existing Next API routes (`/api/scraper/analyze`, `/api/scraper/extract`) get reimplemented as tRPC procedures in `@robot/api`. Raw `fetch` from the UI is removed.
- **TanStack Query** handles cache, optimistic mutations, refetch on invalidation.
- **TanStack Router** handles URL routing + search-param state — wizard state that today lives in `useState` moves into URL params and tRPC queries.
- **Live progress** (long-running extractions) uses polling for v1 (`runs.getStatus` every ~2s). SSE/WebSocket is a v2 enhancement if polling load becomes a concern.

---

## 8. Critical design rules to enforce

These are the points where the design will erode under pressure if not enforced explicitly.

1. **Dataset = schema, period.** Per-Source config (URL template, strategy) must not leak in.
2. **InputSets are typed.** No raw `string[]`. Strategy declares primary column semantics.
3. **One InputSet per Source.** Multi-InputSet sources sound flexible, become a mess.
4. **One strategy per Source.** "Multi-strategy" Sources break UI rendering and AI prompts.
5. **DomainIntelligence stays customer-agnostic.** The moment customer-specific config leaks in, the moat erodes.
6. **Runs belong to Source, not Dataset.** Datasets aggregate run output across their Sources in the UI; they don't own runs.
7. **Cost/budget control on Source.** Aggregate at Dataset level in the UI; control at Source.
8. **Pre-known metadata (input columns) and mid-crawl context (listing-sourced fields) are different problems.** Don't conflate them. The schema's per-field `source` declaration is the explicit join.
9. **AI classifies field source at analyze time.** Customer reviews and overrides; doesn't manually pick `detail` vs `listing` for every field.
10. **Run snapshots the InputSet.** Historical reproducibility doesn't depend on the InputSet staying unchanged.
11. **Auto-name everything from the URL.** No "untitled source" in the system. `amazon.com – B0CHX1W1XY` beats blank.
12. **Listing-only mode (`listingMode='listing'`) is deferred.** Listing rows usually have less data than detail pages; ship `detail` + `listing_to_detail` first.

---

## 9. Migration & phasing

This redesign is too large for one implementation plan. Each phase below becomes its own implementation plan (using `superpowers:writing-plans`).

### Phase 0 — Schema migration

- Rename `collections` → `datasets` (table + FKs + tRPC router).
- Add `input_sets` table (with columns/rows shape from Section 4).
- Add `input_set_id` FK to `sources`.
- Extend `sources` with: `input_strategy`, `url_template`, `listing_mode`, `budget` (jsonb), `is_sandbox` (bool).
- Add inherited config columns to `projects`: `default_schedule`, `output_destination`, `proxy_pool`, `default_rate_limit`, `notification_channel`, `owner_email` (all nullable).
- Update `captures` and `extractions` to reference `runs` (the current schema has captures→source; the new model is captures→run→source). Add a `run_id` FK; back-fill or accept null for historical captures.
- Seed a Sandbox Project per Org.
- Back-fill `quick_extractions` rows into Sandbox Sources (one Source per unique URL; inline `input_sets` of type `inline`; schema reconstructed from stored `fields` jsonb).
- Drop `quick_extractions` after back-fill verified (Phase 0.5).

### Phase 1 — `packages/api-server` + new dashboard scaffold

- Create `packages/api-server`: Hono entry point, mounts `@robot/api` tRPC routers over HTTP, owns DB connection.
- Replace Next.js dashboard with TanStack Router + Query SPA (Vite).
- Wire `@trpc/client` to api-server.
- Routing skeleton matching Section 5 (empty pages, navigation works).
- Reimplement the existing `/api/scraper/analyze` and `/api/scraper/extract` Next routes as tRPC procedures on `@robot/api` (no Next API routes remain).

### Phase 2 — Sandbox flow

- Paste-and-go on `/` creates a draft Source (with inline InputSet, `is_sandbox=true`).
- URL updates to `/sandbox/{shortid}` immediately, before AI runs.
- Each wizard step is a tRPC mutation on that Source row (schema preview, field toggles, extract → Run creation).
- Reload at any step rehydrates from the row.

### Phase 3 — Project / Dataset / Source views

- Project home (by-dataset + by-domain views).
- Dataset detail (schema editor with `source: detail|listing|input.X|system` field classification).
- Source detail (config, InputSet, runs history) — the workhorse view.
- Run results view replacing the old `/extractions` page.
- Source bulk-create UX (multi-strategy Source creation from Dataset page).

### Phase 4 — Graduate

- "Graduate" action on a Sandbox Source: pick Project + Dataset, optionally promote inline InputSet to a named InputSet.
- Slug assignment + redirect to `/p/{project}/sources/{source}`.

### Phase 5 — DomainIntelligence views

- Global `/domains` library.
- Per-project `/p/{project}/domains/{domain}` fix-it view.
- Per-domain detail showing cached selectors, hit/miss stats, recent runs across customers.

---

## 10. Locked decisions

All resolved 2026-05-13.

1. **Rename `Collection` → `Dataset`** — ✅ locked. Drizzle migration in Phase 0 renames the table, the column references, and the tRPC router.

2. **InputSets in v1** — ✅ locked (Option A). First-class `input_sets` table from day one. Sandbox sources have inline inputs (a hidden InputSet of type `inline`, one per Sandbox Source); graduation can promote inline → named InputSet at the user's option.

3. **One strategy per Source** — ✅ locked. Strict rule. Ergonomic concern ("don't make me click Create three times for one site") is addressed by **Source bulk-create** from the Dataset page: a sheet that lets you check ☑ Direct URLs ☐ Categories ☑ Search and creates 1–N Sources in one action. The data model stays clean; the UX feels like one step.

4. **Tech stack: TanStack Router + Query SPA + `packages/api-server`** — ✅ locked. See Section 7 for full rationale. Dashboard becomes a thin client. tRPC routers stay where they are; a new Hono-thin `api-server` package mounts them over HTTP.

5. **Org hidden in UI** — ✅ locked. Stays in DB for future multi-tenancy. Not surfaced anywhere in v1 UI.

6. **Project-level shared config** — ✅ locked. Phase 0 schema migration adds these inherited columns to `projects`, all nullable with sensible defaults; Source can override:

   | Column | Purpose |
   |---|---|
   | `default_schedule` (cron string) | Default cadence for all sources in the project |
   | `output_destination` (text — s3 URL or webhook URL) | Where extracted data goes |
   | `proxy_pool` (text) | Per-customer proxy contract |
   | `default_rate_limit` (int, requests per minute) | Politeness budget |
   | `notification_channel` (text — Slack webhook or email) | Where failure alerts go |
   | `owner_email` (text) | Operational ownership |

   The UI doesn't surface these in v1 — but the columns exist so we don't need another migration when a "Project settings" page lands in v1.5. **Credentials** (login pool, cookies, basic auth) have richer shape and defer to a separate spec.

7. **Cost-preview UX** — ✅ deferred. Out of scope for this redesign; revisit after Phase 3 (when Runs are visible). Will need its own design spec.

8. **`derived` field source** — ✅ deferred (out of v1). A computed-column system needs an expression evaluator + editor UI; that's a sub-project. Schema field sources in v1 stay `detail | listing | input.X | system`. Customers can compute derived metrics post-extraction in SQL/BI tools.

9. **Removing `quick_extractions`** — ✅ locked. Phase 0 migration back-fills existing `quick_extractions` rows into Sandbox Sources (one Source per unique URL, inline inputs, schema reconstructed from the stored `fields` jsonb). Phase 0.5 drops the `quick_extractions` table after verification.

---

## 11. Out of scope for this design

- Multi-tenancy / auth.
- Scheduling / cron.
- Data export / public API.
- Anti-bot / proxy / CAPTCHA.
- The actual scraper pipeline (no changes to `@robot/scraper`, `@robot/browser`, `@robot/agent` proposed here).
- Domain intelligence cache *internals* — the redesign exposes DomainIntelligence in new views but does not change how it's built or scored.

---

## Appendix A — Worked example: Acme protein bars

To make the model concrete, the full scenario from the brainstorm:

**Customer ask:** Product data for "protein bars" from Walmart, including subcategory (vegan / chocolate / gluten-free), plus the department metadata they tagged.

**Setup:**

```
Project: Acme Engagement

Dataset "Products"
  schema:
    name          { source: 'detail'             }
    price         { source: 'detail'             }
    rating        { source: 'detail'             }
    subcategory   { source: 'listing'            }
    category      { source: 'input.search'       }
    department    { source: 'input.department'   }

InputSet "Acme Searches"   (type='search')
  columns:
    search       primary
    department   propagate
  rows:
    { search: 'protein bars', department: 'snacks' }
    { search: 'vitamins',     department: 'health' }

Source "walmart-products"
  dataset:      Products
  input_set:    Acme Searches
  domain:       walmart.com
  strategy:     search
  url_template: 'https://walmart.com/search?q={search}'
  listing_mode: listing_to_detail
  budget:       { max_pages: 10 }
```

**Run execution against input `{search: 'protein bars', department: 'snacks'}`:**

1. Fetch `https://walmart.com/search?q=protein+bars`. Walk 10 pages using cached pagination pattern from DomainIntelligence.
2. On each listing row: extract `subcategory` from the row markup, capture the detail link.
3. Follow each detail link, extract `name / price / rating`.
4. Join produces each output row:

```
{
  name: 'Quest Protein Bar Chocolate Chip',
  price: 24.99,
  rating: 4.6,
  subcategory: 'chocolate',          ← from listing row
  category: 'protein bars',          ← from input
  department: 'snacks',              ← from input
  extracted_at: 2026-05-13T14:22:11Z ← from system
}
```

This is the case that motivates the entire schema-field-source design. Without it, subcategory has no home.
