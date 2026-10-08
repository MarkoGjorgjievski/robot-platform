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
| `@robot/app` | The customer app — login, org switcher, projects, and a project's websites, Fields and Output, a website's Verification / Extract / Runs / Settings, and the organisation's Runs, Usage, Settings and Account; plus a read-only ops mode for staff at `/ops`, from which staff can also work inside a customer's org; :3000 | TanStack Start + Router/Query (SSR), Tailwind v4, shadcn/ui + Base UI |
| `@robot/db` | Database schema + migrations | Drizzle ORM, PostgreSQL |
| `@robot/api` | Type-safe API | tRPC v11, Zod, superjson |
| `@robot/api-server` | HTTP host — mounts the tRPC routers over HTTP, serves captures | Hono |

## Extraction Chain (priority order)

0. **Customer-verified paths** — a Source with a verified schema (the Verification tab of a website inside a project) runs its certified paths only; nothing below applies to it. A miss leaves the cell empty and is counted.
1. **Mechanical** — flatten intercepted APIs + JSON-LD + meta tags (free, instant)
2. **Cached API paths** — replay stored dot-notation paths against fresh API JSON (free)
3. **Cached XPaths** — execute stored XPath selectors on live page (free)
4. **Cross-validation** — agreement among a field's stored paths sets confidence; every value must corroborate against the rendered page (free)
5. **AI API analysis** — Claude reads raw API JSON, finds field values + paths (~$0.03)
6. **AI XPath generation** — Claude generates XPath selectors for DOM extraction (~$0.05)
7. **Save to cache** — store all paths with hit/miss stats for future runs

## Commands

- `pnpm dev:all` — start both servers: api-server (:4000) and the app (:3000); the app is no use without the api-server
- `pnpm dev:all:noai` — same as `dev:all`, but forces `ANTHROPIC_API_KEY` unset in the api-server process (`--env-mode=loose`, since turbo's default strict env mode otherwise swallows an ad-hoc `ANTHROPIC_API_KEY=` shell override). Use this to test the mechanical-only / AI-unavailable path
- `pnpm db:adopt-default -- --email <email>` — make that user the owner of the seeded `default` org, so an existing checkout's projects are visible after a first sign-in (sign-in never adopts anything itself)
- `pnpm -r test` — the green gate (Tier 1 fixture replay + unit tests). Needs Postgres running
- `pnpm test:judge` — calibrate the Tier 2 judge against known answers (live, paid)
- `pnpm test:liveness` — do the corpus fixtures still match the pages their URLs serve? (live, free)
- `pnpm test:ui:app` — `@robot/app` route smoke: signs in through `/login` as a throwaway address, walks every screen in both themes, screenshots into `docs/testing/screens/app-*.png`; needs `pnpm dev:all` running (live, free)
- `pnpm test:ui:staff` — staff-access smoke: a throwaway operator works on a throwaway customer's website as staff, and the customer reads the log; screenshots into `docs/testing/screens/staff-*.png`. Runs only against an isolated pair (keyless api-server on :4100 with `OPS_EMAILS=staff-smoke-op@example.com APP_ORIGINS=http://localhost:3100`, the app on :3100 with `VITE_API_URL=http://localhost:4100`; see the top of `packages/app/src/staff-smoke.test.ts`), never `pnpm dev:all` (live, free)
- `pnpm --filter @robot/api dogfood` — Tier 2 live dogfood + LLM judge; writes `docs/testing/results/`. Needs `ANTHROPIC_API_KEY`
- `pnpm --filter @robot/scraper exec tsx src/test-run.ts "URL"` — CLI test run
- `HEADFUL=1 pnpm --filter @robot/scraper exec tsx src/test-run.ts "URL"` — with visible browser
- `pnpm --filter @robot/api exec tsx src/judge-run.ts <runId> [--max-items N] [--max-usd X] [--fields a,b] [--dry-run]` — judge a completed run's stored values against freshly captured pages; writes `docs/testing/results/`, no DB writes. Needs `ANTHROPIC_API_KEY` (paid, default cap $5) unless `--dry-run`

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
- `OPS_EMAILS` — comma-separated emails that land in ops mode (staff), matched case-insensitively and trimmed; empty or unset means nobody is an operator
- `APP_ORIGINS` — comma-separated origins the api-server accepts (CORS); default `http://localhost:3000`. An isolated pair (app :3100 → api :4100) sets its own

## Key Technical Decisions

- XPath over CSS selectors — supports sibling traversal, ancestor access, text matching
- Multi-path extraction — each field has multiple ranked extraction paths, cross-validated
- Domain intelligence cache — enriched over time, never overwritten. Always consulted (no consecutive-failures reset gate; removed in v1.1b). Conservative per-path prune only (≥5 uses & ≤10% hit rate; max 5 paths/field); degradation is flagged for human review, never auto-reset.
- Verification-first sources (2026-09): the customer defines fields + expected values on three URLs; paths certify when, together, they cover every proof page a field is checked on and none is wrong on any (three to six pages; 2026-09-17); extraction at scale runs certified paths only.
- Popup auto-dismissal — 3 rounds of click + JS removal before capture
- Provider abstraction — Anthropic and Ollama supported, auto-detected from env
- `"type": "module"` in all packages
- History: the old `@robot/dashboard` (a Vite + TanStack Router/Query SPA) was deleted 2026-10-07, cut-over plan 6 — `@robot/app` had reached parity with it. Before that it replaced the original Next.js dashboard in v1.5 (commit 0937bad, 2026-05-15) — older docs/commits that say "Next.js 15 / Server Components / App Router" are stale.
- Customer routes live under `/projects/…` in `@robot/app` — a project's websites, Fields and Output, and a website's Verification / Extract / Runs / Settings. `/p/…` and `/domains/…` were the old dashboard's routes and have no equivalent in `@robot/app` (the dashboard was deleted at cut-over, plan 6). Operator views are under `/ops/…` — a read-only ops mode for staff (`OPS_EMAILS`), rebuilt in `@robot/app` at cut-over: one row per customer website across every org, and a website's certified paths in customer words with real run hit rates. Ops itself stays read-only; staff change a customer's data only by entering their org (next line).
- Staff access (2026-10-07): an operator's session can enter a customer org from ops (`ops.enterOrg`), 8 hours max; deny-list in `packages/api/src/auth/staff-guard.ts`; every staff-mode mutation is logged in `staff_actions` and shown in ops and the customer's Settings.
- Field name and type live on the project's dataset (the contract); a website owns only its location hints, proof pages, expected values and certification, which is current per field (2026-09-09, spec section 4).
- `@robot/app`'s actual stack: shadcn/ui + Base UI on Tailwind v4, Geist/Geist Mono, dark and light themes (dark default)

## Conventions

- Commits are fine when the work is done — use focused, single-purpose commits
- Prefer proper fixes over workarounds
- All new packages use ESM (`"type": "module"`)
- Legacy code preserved in `/Users/marko/Documents/robot-platform-legacy/`
