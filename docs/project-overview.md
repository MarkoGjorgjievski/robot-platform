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

Cache invalidation uses a scoring system: one bad page doesn't wipe the cache. Only 5 consecutive failures trigger a rebuild. Dead paths are auto-pruned.

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
  dashboard2/  — Next.js 15 UI, API routes, wizard flow
  db/          — PostgreSQL schema (Drizzle ORM)
  api/         — tRPC v11 routers
```

### @robot/browser
- Playwright-based page capture
- Auto-dismisses popups/consent banners (cookie, health, newsletter)
- Intercepts all XHR/fetch JSON responses during page load
- Extracts JSON-LD, __NEXT_DATA__, meta tags
- Full-page screenshots
- Navigation fallback: networkidle → domcontentloaded + wait

### @robot/agent
- Provider abstraction: Anthropic (Claude Sonnet) or Ollama (local)
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

### @robot/dashboard2
- Next.js 15 with App Router
- Tailwind v4 + Radix UI + shadcn component pattern
- Light mode, clean design
- 4-step wizard: URL → Schema → Preview → Save
- Customer → Project → Source hierarchy
- Server Components + Server Actions

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
| LLM | Anthropic Claude Sonnet | Best structured output, vision, instruction following |
| LLM (local) | Ollama (llama3.2-vision) | Free development/testing |
| Database | PostgreSQL + Drizzle ORM | Type-safe queries, migrations |
| API | tRPC v11 | End-to-end type safety |
| UI Framework | Next.js 15 | Server Components, App Router |
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

### v1 — Single Page Extraction (current)
- [x] Browser capture with popup dismissal
- [x] Schema discovery via AI (Claude + Ollama)
- [x] XPath selector generation
- [x] Multi-source extraction (API, JSON-LD, meta, XPath)
- [x] Screenshot validation
- [x] Dashboard wizard (URL → Schema → Preview → Save)
- [x] API interception during page load
- [ ] Domain intelligence cache with multi-path scoring
- [ ] Fix detail page extraction (Target)
- [ ] Fix save flow (persist to DB)

### v1.5 — API-First Extraction
- [ ] AI-powered API response analysis
- [ ] API path caching per domain
- [ ] Fast mode (API-only, no screenshot/DOM)

### v1.6 — Site Intelligence Cache
- [ ] Multi-path field resolution with scoring
- [ ] Cross-validation between sources
- [ ] Auto-pruning dead paths
- [ ] Cache hit/miss logging

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

| Scenario | AI Cost | Speed |
|----------|---------|-------|
| First run (no cache) | ~$0.12 per URL | 30-90s |
| Cached run (same domain) | ~$0.00 | 5-20s |
| Cache miss (fluke page) | ~$0.08 | 20-60s |
| 1,000 URLs (same template) | ~$0.12 total | Minutes |
| 1,000 URLs (unique domains) | ~$120 total | Hours |

## Environment Variables

| Variable | Required | Default |
|----------|----------|---------|
| `ANTHROPIC_API_KEY` | No | Falls back to Ollama |
| `DATABASE_URL` | Yes | `postgresql://localhost:5432/robot_platform` |
| `HEADFUL` | No | `false` — set `1` for visible browser |
