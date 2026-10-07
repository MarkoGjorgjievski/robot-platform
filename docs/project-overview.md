# Robot Platform — Project Overview

## What is this?

An AI-native web scraping platform built for in-house use. Our company scrapes data from websites on behalf of customers. Each customer has specific data requirements (fields, schemas) that we configure once and run at scale.

**Core principle:** Minimal human interaction. The AI does the heavy lifting — schema discovery, selector generation, extraction, validation. Humans review, refine, and approve.

## Business Model

- Customer approaches us with a data need ("I want product prices from these 50 retailer sites")
- We create a schema (reusable set of fields) for the customer
- We add source URLs — AI analyzes each site and auto-generates extraction logic
- AI suggests additional fields we can extract beyond the customer's requirements
- We run extractions at scale, deliver structured data

## Architecture

### High-Level Flow

```
User pastes URL
     ↓
Browser captures page (HTML, screenshot, APIs, JSON-LD, meta)
     ↓
AI discovers schema (proposes fields from page content)
     ↓
User reviews fields (toggle on/off, add custom fields)
     ↓
AI generates extraction plan (XPaths, API paths, JSON-LD paths)
     ↓
Executor runs plan on live page → structured data
     ↓
AI validates data against screenshot
     ↓
Results displayed in preview table
     ↓
User saves source → schema + selectors + cache stored in DB
```

### Extraction Chain

The extractor tries multiple data sources in priority order. Each step only runs for fields not yet resolved by earlier steps.

1. **Domain Intelligence Cache** — Reuse paths from previous successful runs (free)
2. **Intercepted APIs** — JSON responses captured during page load
3. **JSON-LD** — Schema.org structured data
4. **Meta tags** — Open Graph, product meta
5. **AI API Analysis** — Claude reads raw API JSON, extracts values + paths
6. **AI XPath Generation** — Claude generates XPath selectors for DOM extraction
7. **Screenshot Validation** — Claude vision cross-checks data vs page

### Domain Intelligence Cache

Every successful extraction enriches a per-domain cache. Each field stores multiple ranked paths (API, XPath, meta) with hit/miss statistics. On subsequent runs, cached paths are tried first — **zero AI cost**.

One bad page doesn't wipe the cache — the cache is always consulted, and there is no failure-count reset (the consecutive-failures gate was removed in v1.1b). Individual paths are pruned conservatively (≥5 uses and ≤10% hit rate); domain-level degradation is flagged for human review, never auto-reset.

### Multi-Path Cross-Validation

Each field can have up to 5 extraction paths from different sources. When multiple paths return values:
- All agree → highest confidence
- Majority agree → use majority, flag outlier
- Disagree → use path with best historical hit rate

This makes extraction resilient — if one path breaks (site redesign), others still work.

## Package Architecture

```
packages/
  browser/     — Playwright page capture, popup dismissal, network interception
  agent/       — LLM orchestration (Claude + Ollama), schema/selector/validation
  scraper/     — Pipeline, XPath executor, structured data extraction, cache
  app/         — TanStack Start + Router/Query (SSR) customer app; :3000
  db/          — PostgreSQL schema (Drizzle ORM)
  api/         — tRPC v11 routers
  api-server/  — Hono HTTP host that mounts the tRPC routers + serves captures
```

(`@robot/dashboard`, the old Vite + TanStack Router/Query SPA, was deleted at
cut-over (2026-10, plan 6) once `@robot/app` reached parity with it.)

### @robot/browser
- Playwright-based page capture
- Auto-dismisses popups/consent banners (cookie, health, newsletter)
- Intercepts all XHR/fetch JSON responses during page load
- Extracts JSON-LD, __NEXT_DATA__, meta tags
- Full-page screenshots
- Navigation fallback: networkidle → domcontentloaded + wait

### @robot/agent
- Provider abstraction: Anthropic (`claude-sonnet-5`) or Ollama (local); model IDs in `src/models.ts`
- Schema discovery: screenshot + markdown → proposed fields with examples
- Selector generation: HTML → XPath expressions
- API analysis: raw JSON → field values + dot-notation paths
- Validation: extracted data + screenshot → completeness check
- All structured output via tool_use (Claude) or JSON prompting (Ollama)

### @robot/scraper
- Pipeline orchestration (capture → analyze → extract → validate)
- XPath executor (detail pages + listing pages with sibling traversal)
- Structured data extractor (JSON-LD, meta, API response flattening)
- Domain intelligence cache (multi-path, scored, auto-pruning)
- CLI test runner for quick iteration

### @robot/dashboard
- Vite + TanStack Router/Query SPA (client-side; talks to @robot/api-server over tRPC-HTTP)
- Tailwind v4 + Radix UI + shadcn component pattern
- Light mode, clean design
- Sandbox-and-graduate flow: paste a URL → Schema → Preview, then graduate into a Project
- Org → Project → Dataset → Source hierarchy
- NOTE: replaced the original Next.js dashboard in v1.5 (2026-05-15). References to "Next.js 15 / App Router / Server Components" elsewhere are stale.

### @robot/api-server
- Hono HTTP server; mounts the @robot/api tRPC routers under /trpc, serves capture screenshots
- Standalone from day one — the seam a public /extract API would hang off in v3

### @robot/db
- Drizzle ORM with PostgreSQL
- Tables: customers, projects, schemas, sources, captures, extractions, runs, domain_intelligence

### @robot/api
- tRPC v11 with Zod validation
- Routers: customers, projects, sources, collections

## Tech Stack

| Category | Choice | Why |
|----------|--------|-----|
| Runtime | Node.js + TypeScript (ESM) | Type safety, ecosystem |
| Monorepo | pnpm workspaces + Turborepo | Fast, reliable |
| Browser | Playwright (Chromium) | Best automation library, screenshot support |
| LLM | Anthropic `claude-sonnet-5` | Best structured output, vision, instruction following |
| LLM (local) | Ollama (`llama3.2-vision`) | Free development/testing |
| Database | PostgreSQL + Drizzle ORM | Type-safe queries, migrations |
| API | tRPC v11 | End-to-end type safety |
| UI Framework | Vite + TanStack Router/Query (SPA) | Client-side routing/data, decoupled from a Node UI server (see @robot/api-server) |
| UI Components | Radix UI + Tailwind v4 | Accessible, composable, light mode |
| Selectors | XPath (not CSS) | Sibling traversal, ancestor access, text matching |

## Data Model

```
Customer (who we scrape for)
  └── Project (a scraping campaign)
       └── Source (a specific URL + extraction config)
            ├── Uses a Schema (reusable field definitions)
            ├── Has Captures (HTML, screenshot, APIs per URL)
            └── Has Extractions (structured data output)

Domain Intelligence (cached per domain, shared across all sources)
  └── Field paths with hit/miss stats, auto-pruning, cross-validation
```

## Roadmap

### v1 — Single Page Extraction (done)
- [x] Full extraction chain (7 steps: mechanical → cache → AI API → AI XPath → save)
- [x] Browser capture with popup dismissal + fallback navigation
- [x] API interception with content-based ranking
- [x] Schema discovery via Claude (screenshot + markdown + structured data)
- [x] XPath generation (listing + detail modes, sibling traversal)
- [x] Domain intelligence cache (multi-path, OR-logic, cross-validation)
- [x] Cached path replay (API dot-notation + XPath, zero AI cost)
- [x] Blocked page detection (403, captcha, Cloudflare, empty pages)
- [x] Per-domain concurrency locks + politeness delay
- [x] Schema evolution detection (new/removed/degraded fields)
- [x] Human override system (click-to-select, saved globally)
- [x] Cache-first source creation (known domains = instant)
- [x] Brand/TLD grouping (amazon.com → amazon.co.uk cache sharing)
- [x] Dashboard: source detail, domain library, pre-training, search/filters
- [x] Value transforms, plausibility checks, hit rate decay

### v1.1 — Multi-Provider + Stability (next)
- [ ] Add OpenAI GPT-4o, Gemini Flash, xAI Grok as providers
- [ ] Task-based routing (vision→Claude, large context→Gemini, cheap→mini)
- [ ] Provider failover on errors
- [ ] Fix save flow end-to-end
- [ ] Data quality checks
- [ ] Fix complex listing pages (BBC-style custom React)

### v2 — Multi-Page + Pagination
- [ ] User selects source type: listing / detail / listing→detail
- [ ] AI auto-detects pagination (Next button, page numbers, infinite scroll)
- [ ] Configurable: N pages / X items / all pages
- [ ] Listing→Detail: follow links from listing to detail pages
- [ ] crawl() method on browser

### v2.1 — Click-to-Select (Manual Fallback)
- [ ] User clicks element in rendered page view
- [ ] System generates robust XPath by ranking attributes (id > data-testid > class > positional)
- [ ] Override AI-generated selector for specific fields

### v3 — Production Scale
- [ ] Proxy pool integration (Bright Data, Oxylabs)
- [ ] Anti-bot stealth (playwright-extra + stealth plugin)
- [ ] CAPTCHA solving service integration
- [ ] Multiple browser engines (Firefox, WebKit)
- [ ] Scheduling + cron jobs
- [ ] Batch execution with progress tracking
- [ ] Data export (CSV, JSON, API endpoint)
- [ ] Pre-training: run against top 500 sites to pre-populate cache

## Cost Model

**Measured 2026-08-19** on `claude-sonnet-5` at list rates ($3/$15 per MTok; a $2/$10
introductory rate applies through 2026-08-31, so real spend is currently ~1/3 lower).
Figures are **pipeline only** — the Tier 2 judge costs a further ~$0.10–0.15 per URL but
ships to nobody. Source: `docs/testing/results/2026-08-19T03-*-dogfood.md`.

| Scenario | AI Cost | Measured on |
|----------|---------|-------------|
| **First run, cold domain** | **~$0.47 per URL** | B&N, no cache at all |
| **Warm domain, most fields cached** | **~$0.12 per URL** | Newegg, 6 prior runs, 14/18 from cache |
| **Partly warm** | **~$0.25 per URL** | Target, 2 prior runs, 4/13 from cache |
| 1,000 URLs, same template | ~$0.47 + 999 × ~$0.12 ≈ **$120** | extrapolated |
| 1,000 URLs, unique domains | ≈ **$470** | extrapolated |

**Two corrections to what this table used to claim.**

*A cold first run is ~4x more expensive than documented* — $0.47, not $0.12. It pays for
schema discovery and selector generation, which a warm run skips entirely.

*A cached run is not free.* The old table said ~$0.00. Newegg had six prior runs and still
resolved only 14 of 18 fields from cache; the remaining four went to AI and cost $0.12. The
cache reduces per-URL cost by roughly 4x — it does not eliminate it — because any field the
cache cannot resolve falls through to the model on every single run. That makes
`ai-vision`-only fields (see `docs/ideas.md`) a recurring cost, not a one-off.

Speeds are unmeasured; the old 30-90s / 5-20s figures are retained nowhere because nothing
timed them.

## Environment Variables

| Variable | Required | Default |
|----------|----------|---------|
| `ANTHROPIC_API_KEY` | No | Falls back to Ollama |
| `DATABASE_URL` | Yes | `postgresql://localhost:5432/robot_platform` |
| `HEADFUL` | No | `false` — set `1` for visible browser |
