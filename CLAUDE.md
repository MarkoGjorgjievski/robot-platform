# Robot Platform — AI-Native Web Scraper

## Start here

**[docs/handoff.md](docs/handoff.md)** — current state, what not to redo, open decisions, and the next work. Read it before starting.

## Project Overview

AI-powered web scraping platform for in-house use. Customers request data from websites — we configure extractors with minimal manual effort. AI agents handle schema discovery, selector generation, and extraction. Humans review and refine.

- **Monorepo**: pnpm workspaces + Turborepo
- **Architecture docs**: [docs/extraction-architecture.md](docs/extraction-architecture.md), [docs/project-overview.md](docs/project-overview.md)

## Package Map

| Package | Purpose | Key Tech |
|---------|---------|----------|
| `@robot/browser` | Page capture, popup dismissal, network interception | Playwright |
| `@robot/agent` | LLM orchestration — schema discovery, selectors, validation | Anthropic Claude, Ollama |
| `@robot/scraper` | Pipeline, XPath executor, structured data extraction | Multi-source extraction chain |
| `@robot/dashboard` | Web UI — extraction wizard, results browser | Vite + TanStack Router/Query SPA, Tailwind v4, Radix UI |
| `@robot/db` | Database schema + migrations | Drizzle ORM, PostgreSQL |
| `@robot/api` | Type-safe API | tRPC v11, Zod, superjson |
| `@robot/api-server` | HTTP host — mounts the tRPC routers over HTTP, serves captures | Hono |

## Extraction Chain (priority order)

0. **Customer-verified paths** — a Source with a verified schema (the Schema tab of a website inside a project) runs its certified paths only; nothing below applies to it. A miss leaves the cell empty and is counted.
1. **Mechanical** — flatten intercepted APIs + JSON-LD + meta tags (free, instant)
2. **Cached API paths** — replay stored dot-notation paths against fresh API JSON (free)
3. **Cached XPaths** — execute stored XPath selectors on live page (free)
4. **Cross-validation** — agreement among a field's stored paths sets confidence; every value must corroborate against the rendered page (free)
5. **AI API analysis** — Claude reads raw API JSON, finds field values + paths (~$0.03)
6. **AI XPath generation** — Claude generates XPath selectors for DOM extraction (~$0.05)
7. **Save to cache** — store all paths with hit/miss stats for future runs

## Commands

- `pnpm dev:all` — start api-server (:4000) **and** dashboard (:3456); the dashboard is useless without the api-server
- `pnpm dev:all:noai` — same as `dev:all`, but forces `ANTHROPIC_API_KEY` unset in the api-server process (`--env-mode=loose`, since turbo's default strict env mode otherwise swallows an ad-hoc `ANTHROPIC_API_KEY=` shell override). Use this to test the mechanical-only / AI-unavailable path
- `pnpm --filter @robot/dashboard dev` — dashboard only, on :3456
- `pnpm -r test` — the green gate (Tier 1 fixture replay + unit tests). Needs Postgres running
- `pnpm test:judge` — calibrate the Tier 2 judge against known answers (live, paid)
- `pnpm test:liveness` — do the corpus fixtures still match the pages their URLs serve? (live, free)
- `pnpm test:ui` — dashboard route smoke tests; needs `pnpm dev:all` running (live, free)
- `pnpm --filter @robot/api dogfood` — Tier 2 live dogfood + LLM judge; writes `docs/testing/results/`. Needs `ANTHROPIC_API_KEY`
- `pnpm --filter @robot/scraper exec tsx src/test-run.ts "URL"` — CLI test run
- `HEADFUL=1 pnpm --filter @robot/scraper exec tsx src/test-run.ts "URL"` — with visible browser

## First-time setup

1. `pnpm install`
2. `pnpm --filter @robot/browser exec playwright install chromium`
3. Start Postgres 16 (see `.env.example` for the Docker one-liner)
4. `cp .env.example .env` and fill in `ANTHROPIC_API_KEY`
5. `pnpm db:migrate && pnpm db:seed`

Node ≥20.12 is required (`process.loadEnvFile`). pnpm version is pinned via `packageManager`.

## Environment

Config lives in a repo-root `.env` (gitignored; template in `.env.example`). `@robot/db` loads it on
import, so tests, CLIs and the api-server all pick it up without exporting anything in the shell.
Variables already set in the shell take precedence over `.env`.

- `ANTHROPIC_API_KEY` — Claude API key (falls back to Ollama if not set)
- `DATABASE_URL` — PostgreSQL connection string

## Key Technical Decisions

- XPath over CSS selectors — supports sibling traversal, ancestor access, text matching
- Multi-path extraction — each field has multiple ranked extraction paths, cross-validated
- Domain intelligence cache — enriched over time, never overwritten. Always consulted (no consecutive-failures reset gate; removed in v1.1b). Conservative per-path prune only (≥5 uses & ≤10% hit rate; max 5 paths/field); degradation is flagged for human review, never auto-reset.
- Verification-first sources (2026-09): the customer defines fields + expected values on three URLs; paths certify only when they produce the expected value on all three; extraction at scale runs certified paths only.
- Popup auto-dismissal — 3 rounds of click + JS removal before capture
- Provider abstraction — Anthropic and Ollama supported, auto-detected from env
- `"type": "module"` in all packages
- Dashboard is a Vite + TanStack Router/Query SPA (client-side), talking to `@robot/api-server` (Hono) over tRPC-HTTP. NOTE: this replaced the original Next.js dashboard in v1.5 (commit 0937bad, 2026-05-15) — older docs/commits that say "Next.js 15 / Server Components / App Router" are stale.
- Customer routes live under `/projects/…`; `/p/…` and `/domains/…` are redirects (2026-09-08, spec `docs/superpowers/specs/2026-09-08-mvp-flow-and-workspace-design.md`). Operator views are under `/ops/…`.
- Field name and type live on the project's dataset (the contract); a website owns only its location hints, proof pages, expected values and certification, which is current per field (2026-09-09, spec section 4).
- Radix UI + Tailwind v4 + shadcn pattern, light mode

## Conventions

- Commits are fine when the work is done — use focused, single-purpose commits
- Prefer proper fixes over workarounds
- All new packages use ESM (`"type": "module"`)
- Legacy code preserved in `/Users/marko/Documents/robot-platform-legacy/`
