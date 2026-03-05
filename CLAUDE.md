# Robot Platform

## Project Overview
Migrating `robot-library` (CommonJS web scraping framework on Import.io) into `robot-platform` (modern TypeScript monorepo).

- **Source repo**: `../robot-library` (branch: DDF-679)
- **Monorepo**: pnpm workspaces + Turborepo
- **Detailed docs**: [docs/migration-architecture.md](docs/migration-architecture.md), [docs/technical-gotchas.md](docs/technical-gotchas.md), [docs/runner-service.md](docs/runner-service.md)

## Migration Status

| Phase | Status | Notes |
|-------|--------|-------|
| 1. Monorepo Foundation | Done | pnpm workspaces, turbo, tsconfig |
| 2. Test Coverage | Done | 207 tests (vitest), 13 test files |
| 3. TypeScript Migration | Done | helpers split into 8 sub-modules, .js→.ts renames |
| 4. Database + Dashboard | Done | db, api, config, dashboard packages |
| 5. Runner Service | Done | @robot/runner with Playwright, worker poll loop, dashboard integration |
| 6. CI/CD + Deployment | Not started | |

## Package Map

| Package | Purpose | Key Tech |
|---------|---------|----------|
| `@robot/core` | Original robot-library source | CJS+TS hybrid, vitest |
| `@robot/db` | Database schema + migrations | Drizzle ORM, PostgreSQL |
| `@robot/api` | Type-safe API | tRPC v11, Zod, superjson, 6 routers |
| `@robot/config` | YAML parser, seeder, exporter | Parses 615 extractors from robot-library |
| `@robot/runner` | Execute extractors | Playwright, standalone worker, DB poll |
| `@robot/dashboard` | Web UI | Next.js 15, Tailwind v4, port 3456 |

## Key Technical Decisions
- ESM imports use `.ts` extensions + `allowImportingTsExtensions: true` in @robot/core
- `vitest.setup.js` patches `Module._resolveFilename` for CJS→TS resolution
- `helpersIndex.js` is a CJS facade wrapping 8 TypeScript sub-modules
- Circular dep (dom↔misc) solved with lazy `await import()` in dom.ts
- Next.js 15 async params: `params: Promise<{ id: string }>`
- Dashboard uses Server Components + Server Actions (no client-side tRPC provider)

## Commands
- `pnpm test` — run all tests
- `pnpm --filter @robot/core test` — run core tests (202 tests)
- `pnpm --filter @robot/config seed` — seed DB from YAML configs
- `pnpm --filter @robot/dashboard dev` — start dashboard on :3456
- `pnpm --filter @robot/runner worker` — start runner worker (polls for queued runs)
- `HEADFUL=1 pnpm --filter @robot/runner worker` — runner with visible browser
- `tsc --noEmit` — type check (core has ~164 acceptable `any` errors)

## Conventions
- Don't auto-commit — user commits manually
- Prefer proper fixes over workarounds
- `"type": "module"` in db, api, config packages; core remains CJS-compatible
