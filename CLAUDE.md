# Robot Platform — AI-Native Web Scraper

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
| `@robot/dashboard2` | Web UI — wizard flow, data preview, source management | Next.js 15, Tailwind v4, Radix UI |
| `@robot/db` | Database schema + migrations | Drizzle ORM, PostgreSQL |
| `@robot/api` | Type-safe API | tRPC v11, Zod, superjson |

## Extraction Chain (priority order)

1. **Domain cache** — reuse stored paths from previous runs (free, instant)
2. **API interception** — capture XHR/fetch JSON responses during page load
3. **JSON-LD** — Schema.org structured data in `<script type="application/ld+json">`
4. **Meta tags** — og:title, product:price:amount, etc.
5. **AI API analysis** — Claude reads raw API JSON, finds field values + paths (~$0.03)
6. **AI XPath generation** — Claude generates XPath selectors for DOM extraction (~$0.05)
7. **Screenshot validation** — Claude vision compares extracted data vs page screenshot

## Commands

- `pnpm --filter @robot/dashboard2 dev` — start dashboard on :3456
- `pnpm --filter @robot/scraper exec tsx src/test-run.ts "URL"` — CLI test run
- `HEADFUL=1 pnpm --filter @robot/scraper exec tsx src/test-run.ts "URL"` — with visible browser

## Environment

- `ANTHROPIC_API_KEY` — Claude API key (falls back to Ollama if not set)
- `DATABASE_URL` — PostgreSQL connection string

## Key Technical Decisions

- XPath over CSS selectors — supports sibling traversal, ancestor access, text matching
- Multi-path extraction — each field has multiple ranked extraction paths, cross-validated
- Domain intelligence cache — enriched over time, never overwritten. 5 consecutive failures → reset.
- Popup auto-dismissal — 3 rounds of click + JS removal before capture
- Provider abstraction — Anthropic and Ollama supported, auto-detected from env
- `"type": "module"` in all packages
- Next.js 15 with Server Components + Server Actions (no client-side tRPC)
- Radix UI + Tailwind v4 + shadcn pattern, light mode

## Conventions

- Don't auto-commit — user commits manually
- Prefer proper fixes over workarounds
- All new packages use ESM (`"type": "module"`)
- Legacy code preserved in `/Users/marko/Documents/robot-platform-legacy/`
