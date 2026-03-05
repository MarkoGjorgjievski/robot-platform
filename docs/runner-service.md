# Runner Service (Phase 5)

## Architecture
Standalone worker process polls `runs` table for queued jobs, launches Playwright chromium, navigates using extractor config, validates page load, captures screenshot/HTML, writes results back to DB.

## Design Docs
- Design: [plans/2026-03-05-runner-service-design.md](plans/2026-03-05-runner-service-design.md)
- Implementation plan: [plans/2026-03-05-runner-service-plan.md](plans/2026-03-05-runner-service-plan.md)

## Package: @robot/runner

```
packages/runner/
  package.json          — deps: playwright, @robot/db, drizzle-orm; dev: tsx
  tsconfig.json         — extends ../../tsconfig.base.json
  src/
    url-builder.ts      — buildUrl(params, inputData) — URLTemplate interpolation or direct _url
    logger.ts           — RunLogger class — accumulates entries, flushes to runs.logs as JSON
    context.ts          — PlaywrightContext — wraps Playwright Page to satisfy IContext interface
    executor.ts         — executeRun(runId) — orchestrates single run end-to-end
    worker.ts           — Poll loop (5s), resets stale runs on startup, entry point via `tsx`
```

### Key Classes/Functions

**PlaywrightContext** (`context.ts`):
- Wraps Playwright `Page` + `BrowserContext`
- Implements: goto, evaluate, click, fill, waitForSelector, waitForXPath, waitForNavigation, waitForFunction, waitForMutation, content, screenshot, cookies, scrollToBottom, captureRequests, setBlockAds, setLoadImages, setLoadAllResources, halt, reportBlocked
- Stubs: extract() and solveCaptcha() throw "not implemented in MVP"
- ~475 lines

**executeRun** (`executor.ts`):
- Loads run → extractor (with org/domain) → input data from DB
- Builds URL via url-builder
- Launches headless chromium (HEADFUL=1 env var for headed mode)
- Configures: blockAds, loadImages, loadAllResources
- Navigates with configurable timeout/waitUntil
- Validates: loadedXpath/loadedSelector, noResultsXPath, accessDeniedXPath
- Executes orderedActionsToPerform (click/fill with template interpolation)
- Captures full-page screenshot (base64, capped 200KB) + HTML length
- Updates run status: running → completed/failed
- Always flushes logs and closes browser in finally block

**worker** (`worker.ts`):
- Entry: `pnpm --filter @robot/runner worker` (runs via tsx)
- On startup: resets stale "running" runs to "failed"
- Polls every 5s for oldest queued run
- Processes one run at a time (sequential)

## API Changes (@robot/api)

Added `packages/api/src/routers/runs.ts`:
- `runs.list({ extractorId? })` — latest 50 runs, optionally filtered
- `runs.getById({ id })` — with extractor.org and extractor.domain
- `runs.create({ extractorId, inputLabel? })` — inserts with status='queued'

Registered in `packages/api/src/routers/index.ts` as `runs: runsRouter`.

## Dashboard Changes

**Server action** (`packages/dashboard/src/app/runs/actions.ts`):
- `createRun(formData)` — creates run via tRPC, redirects to `/runs/{id}`

**Extractor detail page** (`extractors/[id]/page.tsx`):
- Added green "Run" button (form with hidden extractorId)
- Added "Recent Runs" table section (status badge, input, started, completed, view link)

**Run detail page** (`packages/dashboard/src/app/runs/[id]/page.tsx`):
- Header with back link, run ID, org/domain, status badge
- Timing grid (created/started/completed)
- Error section (red, conditional)
- Results section (finalUrl, responseStatus, htmlLength, screenshot image)
- Scrollable logs timeline (color-coded by level)

## DB Schema (runs table)
Already existed from Phase 4. Fields: id, extractorId, status, inputLabel, startedAt, completedAt, resultCount, results (jsonb), logs (text), videoUrl, errorMessage, createdAt. Default status is 'pending' in schema but worker creates with 'queued'.

## Testing
1. Terminal 1: `cd robot-platform && pnpm --filter @robot/runner worker`
2. Terminal 2: `cd robot-platform && pnpm --filter @robot/dashboard dev`
3. Open http://localhost:3456/extractors → pick one → click "Run"
4. Redirects to /runs/{id} → refresh to see status updates
5. Headed mode: `HEADFUL=1 pnpm --filter @robot/runner worker`
