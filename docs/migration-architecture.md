# Migration Architecture

## Monorepo Structure

```
packages/
  core/        — Original robot-library source (CJS + TS hybrid)
  db/          — Drizzle ORM schema, PostgreSQL migrations
  api/         — tRPC v11 routers (orgs, extractors, domains, inputs, credentials, runs)
  config/      — YAML parser, DB seed script, YAML exporter
  runner/      — Standalone Playwright worker (executes extractors)
  dashboard/   — Next.js 15 app (App Router, Tailwind v4, port 3456)
  domain-overrides/  — (exists, minimal)
```

## Package Details

### @robot/core
- **tsconfig**: `allowImportingTsExtensions: true`, `noEmit: true`, `allowJs: true`, `checkJs: false`
- **Test runner**: vitest (202 tests across 13 files)
- **vitest.setup.js**: Patches `Module._resolveFilename` to resolve `.ts` from `require()` calls
- **tsc --noEmit**: ~164 remaining errors (implicit `any` in untyped config files — acceptable)

### Helpers Sub-modules (`core/src/helpers/`)

| File | Functions |
|------|-----------|
| fetch.ts | backendFetch, helperFetch, fetchRetry |
| dom.ts | checkSelector, isValidCSS, checkAndClick + 8 more |
| wait.ts | optionalWait, waitToDisappear, waitForInDifferentContext, waitForFrameToLoad |
| scroll.ts | scrollIntoView, scrollBy, scrollToElementUntil + 2 more |
| dom-mutation.ts | addItemToDocument, moveShadowToMainDom + 5 more |
| captcha.ts | waitBlocking, solveCaptcha, gotoWithCaptchaSolver |
| iframe.ts | searchInFrame, searchInFullPage |
| misc.ts | throwError, reload, ifThereClickOnIt + 8 more |
| helpersIndex.js | CJS facade class — `new Helpers(context)` delegates to sub-modules |

### @robot/db
- **7 tables**: orgs, domains, extractors, extractor_inputs, credentials, robot_overrides, runs
- **Schema**: UUID PKs, JSONB for parameters/inputData/extraFields, cascading deletes
- **Migration**: `drizzle/0000_tan_retro_girl.sql`

### @robot/runner
- Standalone worker process with Playwright chromium
- PlaywrightContext wraps Playwright Page → IContext interface
- Executor: load config → launch browser → navigate → validate → capture → update DB
- Worker: polls runs table every 5s, processes sequentially
- Entry: `pnpm --filter @robot/runner worker` (via tsx)
- See [runner-service.md](runner-service.md) for full details

### @robot/api
- tRPC v11 + superjson + Zod
- 6 routers with full CRUD: orgs, extractors, domains, inputs, credentials, runs
- Server-side caller via `createCallerFactory`

### @robot/config
- **parser.ts**: Walks `robot-library/src/orgs/` → finds 615 extractors, 445K inputs, 1.2K credentials
- **exporter.ts**: Converts DB records back to YAML format
- **seed.ts**: `pnpm --filter @robot/config seed` — inserts parsed configs into DB
- Directory structure: `orgs/{org}/domains/{letter}/{domain}/{country}/{robot}/{variant}/`

### @robot/dashboard
- Next.js 15, App Router, Tailwind CSS v4
- Server Components + Server Actions (no client-side tRPC provider needed)
- `transpilePackages: ['@robot/api', '@robot/config', '@robot/db']`
- Sidebar navigation component
- Pages: home (stats), orgs (list/detail/new/edit), extractors (list/detail/new/edit), domains (list/detail/new/edit), runs (detail)
- YAML export: `/api/extractors/[id]/yaml` route
- Run button on extractor detail → creates queued run → redirects to run detail page

## File Renames Done (Phase 3)
- 16 navigation files: .js → .ts
- 4 captcha files: .js → .ts
- 3 robot files: .js → .ts

## What's Left
- Polish/refine all phases
- CI/CD, deployment
- DI string system migration (deferred — needs local DI resolver)
- require.cache introspection migration (deferred — platform-level change)
