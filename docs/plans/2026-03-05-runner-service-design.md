# Phase 5: Runner Service Design

## Overview

A `@robot/runner` package that executes extractors via Playwright, tracking runs in the database. The worker is a standalone process that polls for queued runs.

## Architecture

```
Dashboard (Next.js)          @robot/runner (standalone process)
     │                              │
     │ "Run" button                 │ polls every 5s
     │ → creates run                │ → picks queued run
     │   (status: queued)           │ → launches Playwright
     │                              │ → navigates + validates
     │ /runs/[id] page              │ → writes results/logs/status
     │ → shows status, logs         │ → closes browser
     └──────── PostgreSQL ──────────┘
```

## Components

### 1. PlaywrightContext (IContext implementation)

Wraps a Playwright `Page` to satisfy the IContext interface expected by the robot pipeline.

**Implemented methods (MVP):**
- `goto(url, opts)` — `page.goto()` with timeout and waitUntil
- `evaluate(fn, ...args)` — `page.evaluate()`
- `click(selector)` — `page.click()`
- `setInputValue(selector, value)` — `page.fill()`
- `waitForSelector(selector, opts)` — `page.waitForSelector()`
- `waitForXPath(xpath, opts)` — `page.locator()` with xpath
- `waitForNavigation(opts)` — `page.waitForLoadState()`
- `waitForFunction(fn, opts)` — `page.waitForFunction()`
- `content()` — `page.content()`
- `screenshot(opts)` — `page.screenshot()`
- `cookies()` — `context.cookies()`
- `scrollToBottom(opts)` — evaluate scroll JS in page
- `select(selector, ...values)` — `page.selectOption()`
- `setBypassCSP(enabled)` — `page.setBypassCSP()` (Playwright built-in... actually route-based)
- `setBlockAds(enabled)` — route-based request blocking
- `setLoadImages(enabled)` — route-based image blocking
- `captureRequests()` — attach request listener
- `halt()` — sets a flag, checked by pipeline
- `reportBlocked(code, details)` — logs the block event

**Stubbed (not MVP):**
- `extract()` — throws "not implemented" (requires YAML extraction engine)

### 2. Worker Process

Entry: `packages/runner/src/worker.ts`

```
Loop:
  1. Query: SELECT * FROM runs WHERE status = 'queued' ORDER BY created_at LIMIT 1
  2. If none, sleep 5s, continue
  3. Set status = 'running', startedAt = now()
  4. Load extractor config (with domain, org, inputs, credentials)
  5. Pick first input (or inputLabel from run record)
  6. Launch chromium (headless, or HEADFUL=1 for debug)
  7. Create PlaywrightContext(page)
  8. Execute:
     a. Build URL from parameters.URLTemplate + input data, or use input._url
     b. page.goto(url) with timeout from parameters
     c. Validate: check loadedXpath or loadedSelector exists
     d. Execute orderedActionsToPerform (click, type, wait sequences)
     e. Take screenshot
     f. Capture page HTML
  9. On success: status = 'completed', results = { html, screenshot }, completedAt
  10. On error: status = 'failed', errorMessage, completedAt
  11. Close browser
  12. Continue loop
```

Processes one run at a time. No concurrency in MVP.

### 3. API Additions (@robot/api)

New `runs` router:
- `runs.create({ extractorId, inputLabel? })` — insert with status 'queued'
- `runs.list({ extractorId? })` — list runs, newest first
- `runs.getById({ id })` — full run with logs, results

### 4. Dashboard Changes

**Extractor detail page:**
- "Run" button (Server Action → `api.runs.create()` → redirect to `/runs/[id]`)
- Run history table: status badge, input label, started, completed, result count

**New run detail page (`/runs/[id]`):**
- Status badge (queued=gray, running=blue, completed=green, failed=red)
- Logs timeline (JSON array of `{ timestamp, level, message }`)
- Screenshot display (if available)
- Error message (if failed)
- Page HTML preview (collapsible)

**No websockets/polling** — user refreshes to see updates.

## Package Structure

```
packages/runner/
  package.json
  tsconfig.json
  src/
    context.ts        — PlaywrightContext class
    worker.ts         — poll loop + execution logic
    executor.ts       — single run execution (used by worker)
    url-builder.ts    — build URLs from templates + inputs
    logger.ts         — run logger (writes to DB)
```

## Commands

- `pnpm --filter @robot/runner worker` — start the worker
- `HEADFUL=1 pnpm --filter @robot/runner worker` — start with visible browser

## Dependencies

- `playwright` (chromium only)
- `@robot/db` (workspace)
- `drizzle-orm`
- `tsx` (for running TypeScript)
