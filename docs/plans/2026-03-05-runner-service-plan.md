# Runner Service Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create `@robot/runner` — a background worker that executes extractors via Playwright, tracking runs in the database, with dashboard integration for triggering and monitoring.

**Architecture:** Standalone worker process polls `runs` table for queued jobs, launches Playwright, navigates to URLs using extractor config, validates page load, captures screenshots/HTML, writes results back. Dashboard creates run records and displays status.

**Tech Stack:** Playwright (chromium), Drizzle ORM, tRPC, Next.js Server Actions, tsx

---

### Task 1: Create @robot/runner package scaffold

**Files:**
- Create: `packages/runner/package.json`
- Create: `packages/runner/tsconfig.json`

**Step 1: Create package.json**

```json
{
  "name": "@robot/runner",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "worker": "tsx src/worker.ts"
  },
  "dependencies": {
    "@robot/db": "workspace:*",
    "drizzle-orm": "^0.44.0",
    "playwright": "^1.52.0"
  },
  "devDependencies": {
    "@types/node": "^25.3.3",
    "tsx": "^4.0.0",
    "typescript": "^5.7.0"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 3: Install dependencies**

Run: `cd /Users/marko/Documents/robot-platform && pnpm install`
Then: `cd packages/runner && npx playwright install chromium`

**Step 4: Commit**

```bash
git add packages/runner/package.json packages/runner/tsconfig.json
git commit -m "feat(runner): scaffold @robot/runner package"
```

---

### Task 2: Implement URL builder

**Files:**
- Create: `packages/runner/src/url-builder.ts`

**Step 1: Create url-builder.ts**

Builds URLs from extractor parameters. Two modes: URLTemplate interpolation, or direct `_url` from input data.

```typescript
export function buildUrl(
  parameters: Record<string, unknown>,
  inputData: Record<string, unknown>,
): string {
  const template = parameters.URLTemplate as string | undefined;
  const directUrl = inputData._url as string | inputData.URL as string | undefined;

  if (template) {
    // Interpolate {fieldName} placeholders with input data values
    return template.replace(/\{(\w+)\}/g, (match, key) => {
      const value = inputData[key] ?? parameters[key];
      return value !== undefined ? String(value) : match;
    });
  }

  if (directUrl) {
    return directUrl;
  }

  throw new Error('No URL: extractor has no URLTemplate parameter and input has no _url field');
}
```

**Step 2: Verify it compiles**

Run: `cd /Users/marko/Documents/robot-platform/packages/runner && npx tsc --noEmit`
Expected: no errors

**Step 3: Commit**

```bash
git add packages/runner/src/url-builder.ts
git commit -m "feat(runner): add URL builder with template interpolation"
```

---

### Task 3: Implement run logger

**Files:**
- Create: `packages/runner/src/logger.ts`

**Step 1: Create logger.ts**

Accumulates log entries and writes them to the `runs.logs` field as a JSON array.

```typescript
import { db } from '@robot/db';
import { runs } from '@robot/db/schema';
import { eq } from 'drizzle-orm';

type LogLevel = 'info' | 'warn' | 'error';

type LogEntry = {
  timestamp: string;
  level: LogLevel;
  message: string;
};

export class RunLogger {
  private entries: LogEntry[] = [];
  private runId: string;

  constructor(runId: string) {
    this.runId = runId;
  }

  log(level: LogLevel, message: string) {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
    };
    this.entries.push(entry);
    console.log(`[${entry.timestamp}] [${level.toUpperCase()}] ${message}`);
  }

  info(message: string) { this.log('info', message); }
  warn(message: string) { this.log('warn', message); }
  error(message: string) { this.log('error', message); }

  async flush() {
    await db.update(runs)
      .set({ logs: JSON.stringify(this.entries) })
      .where(eq(runs.id, this.runId));
  }
}
```

**Step 2: Verify it compiles**

Run: `cd /Users/marko/Documents/robot-platform/packages/runner && npx tsc --noEmit`
Expected: no errors

**Step 3: Commit**

```bash
git add packages/runner/src/logger.ts
git commit -m "feat(runner): add run logger with DB persistence"
```

---

### Task 4: Implement PlaywrightContext

**Files:**
- Create: `packages/runner/src/context.ts`

**Step 1: Create context.ts**

This is the core class — wraps a Playwright `Page` to satisfy the IContext interface from `types/globals.d.ts`. MVP methods only.

```typescript
import type { Page, BrowserContext } from 'playwright';
import type { RunLogger } from './logger';

type GotoOptions = {
  timeout?: number;
  waitUntil?: 'load' | 'networkidle';
  method?: string;
  referer?: string;
};

type GotoResponse = {
  headers: Record<string, string[]>;
  status: number;
  ok: boolean;
  url: string;
};

export class PlaywrightContext {
  private page: Page;
  private browserContext: BrowserContext;
  private logger: RunLogger;
  private halted = false;
  private blockAds = false;
  private blockImages = false;
  private capturedRequests: Array<{ url: string; method: string; timestamp: number }> = [];

  constructor(page: Page, browserContext: BrowserContext, logger: RunLogger) {
    this.page = page;
    this.browserContext = browserContext;
    this.logger = logger;
  }

  get isHalted() {
    return this.halted;
  }

  async goto(url: string, options: GotoOptions = {}): Promise<GotoResponse> {
    this.logger.info(`goto: ${url}`);
    const response = await this.page.goto(url, {
      timeout: options.timeout ?? 60000,
      waitUntil: options.waitUntil === 'networkidle' ? 'networkidle' : 'load',
      referer: options.referer,
    });

    const status = response?.status() ?? 0;
    const headers: Record<string, string[]> = {};
    if (response) {
      for (const [key, value] of Object.entries(response.headers())) {
        headers[key] = [value];
      }
    }

    return {
      headers,
      status,
      ok: status >= 200 && status < 300,
      url: this.page.url(),
    };
  }

  async evaluate(pageFunction: string | Function, ...args: unknown[]): Promise<unknown> {
    return this.page.evaluate(pageFunction as any, ...args);
  }

  async click(selector: string): Promise<void> {
    this.logger.info(`click: ${selector}`);
    await this.page.click(selector, { timeout: 10000 }).catch(() => {
      this.logger.warn(`click failed: ${selector}`);
    });
  }

  async setInputValue(selector: string, value: string): Promise<void> {
    this.logger.info(`setInputValue: ${selector}`);
    await this.page.fill(selector, value);
  }

  async select(selector: string, ...values: string[]): Promise<void> {
    await this.page.selectOption(selector, values);
  }

  async waitForSelector(selector: string, options?: { timeout?: number }): Promise<void> {
    await this.page.waitForSelector(selector, {
      timeout: options?.timeout ?? 30000,
    });
  }

  async waitForXPath(xpath: string, options?: { timeout?: number }): Promise<void> {
    await this.page.locator(`xpath=${xpath}`).waitFor({
      timeout: options?.timeout ?? 30000,
    });
  }

  async waitForNavigation(options?: { timeout?: number; waitUntil?: string }): Promise<() => Promise<void>> {
    const waitPromise = this.page.waitForLoadState(
      options?.waitUntil === 'networkidle' ? 'networkidle' : 'load',
      { timeout: options?.timeout ?? 30000 },
    );
    return async () => { await waitPromise; };
  }

  async waitForFunction(predicate: string | Function, options?: { timeout?: number }): Promise<void> {
    await this.page.waitForFunction(predicate as any, undefined, {
      timeout: options?.timeout ?? 30000,
    });
  }

  async waitForMutation(selector: string, options?: { timeout?: number }): Promise<void> {
    const timeout = options?.timeout ?? 30000;
    await this.page.evaluate(
      ([sel, ms]) => new Promise<void>((resolve, reject) => {
        const el = document.querySelector(sel as string);
        if (!el) { reject(new Error(`Element not found: ${sel}`)); return; }
        const timer = setTimeout(() => reject(new Error('Mutation timeout')), ms as number);
        const observer = new MutationObserver(() => {
          observer.disconnect();
          clearTimeout(timer);
          resolve();
        });
        observer.observe(el, { childList: true, subtree: true, attributes: true });
      }),
      [selector, timeout],
    );
  }

  async content(): Promise<string> {
    return this.page.content();
  }

  async stop(): Promise<void> {
    await this.page.evaluate(() => window.stop());
  }

  async screenshot(options?: { type?: string; fullPage?: boolean }): Promise<Buffer> {
    const buffer = await this.page.screenshot({
      type: (options?.type as 'png' | 'jpeg') ?? 'png',
      fullPage: options?.fullPage ?? false,
    });
    return Buffer.from(buffer);
  }

  async cookies(): Promise<Array<{ name: string; value: string; domain: string; path: string; secure: boolean; httpOnly: boolean }>> {
    const cookies = await this.browserContext.cookies();
    return cookies.map(c => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      hostOnly: !c.domain.startsWith('.'),
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
      session: c.expires === -1,
    }));
  }

  async scrollToBottom(options?: { maxScrolls?: number; stopXPath?: string; waitTime?: number }): Promise<void> {
    const maxScrolls = options?.maxScrolls ?? 1;
    const waitTime = options?.waitTime ?? 1000;
    this.logger.info(`scrollToBottom: ${maxScrolls} scrolls`);

    for (let i = 0; i < maxScrolls; i++) {
      await this.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await this.page.waitForTimeout(waitTime);

      if (options?.stopXPath) {
        const found = await this.page.locator(`xpath=${options.stopXPath}`).count();
        if (found > 0) break;
      }
    }
  }

  async captureRequests(): Promise<void> {
    this.page.on('request', (req) => {
      this.capturedRequests.push({
        url: req.url(),
        method: req.method(),
        timestamp: Date.now(),
      });
    });
  }

  async setBypassCSP(enabled: boolean): Promise<void> {
    await this.browserContext.route('**/*', async (route) => {
      await route.continue();
    });
  }

  async setBlockAds(enabled: boolean): Promise<void> {
    this.blockAds = enabled;
    if (enabled) {
      await this.page.route('**/*', async (route) => {
        const url = route.request().url();
        const blocked = /doubleclick|googlesyndication|adservice|facebook.*pixel|analytics/i.test(url);
        if (blocked) {
          await route.abort();
        } else {
          await route.continue();
        }
      });
    }
  }

  async setLoadImages(enabled: boolean): Promise<void> {
    if (!enabled) {
      this.blockImages = true;
      await this.page.route('**/*.{png,jpg,jpeg,gif,svg,webp}', (route) => route.abort());
    }
  }

  async setLoadAllResources(enabled: boolean): Promise<void> {
    // In Playwright all resources load by default — this is a no-op for the enabled case
    if (!enabled) {
      await this.page.route('**/*', async (route) => {
        const type = route.request().resourceType();
        if (['stylesheet', 'font', 'media'].includes(type)) {
          await route.abort();
        } else {
          await route.continue();
        }
      });
    }
  }

  async setCssEnabled(enabled: boolean): Promise<void> {
    if (!enabled) {
      await this.page.route('**/*.css', (route) => route.abort());
    }
  }

  async setUserAgent(ua: string): Promise<void> {
    // Must be set on context level before page creation — log warning
    this.logger.warn('setUserAgent called after page creation — not supported in MVP');
  }

  async setExtraHTTPHeaders(headers: Record<string, string>): Promise<void> {
    await this.page.setExtraHTTPHeaders(headers);
  }

  async setJavaScriptEnabled(enabled: boolean): Promise<void> {
    this.logger.warn('setJavaScriptEnabled not supported after page creation');
  }

  async setViewPort(viewport: { width: number; height: number }): Promise<void> {
    await this.page.setViewportSize(viewport);
  }

  async setFirstRequestTimeout(_ms: number): Promise<void> {
    // Handled by goto timeout — no-op in MVP
  }

  async setInputValue_deprecated(selector: string, value: string): Promise<void> {
    await this.page.fill(selector, value);
  }

  async reportBlocked(code: number, details?: string): Promise<void> {
    this.logger.error(`BLOCKED: code=${code} details=${details ?? 'none'}`);
  }

  async halt(returnExtractedData: boolean): Promise<void> {
    this.logger.info(`halt called (returnExtractedData=${returnExtractedData})`);
    this.halted = true;
  }

  async extract(_id: string): Promise<never> {
    throw new Error('extract() not implemented in MVP runner — requires YAML extraction engine');
  }

  async solveCaptcha(_options: unknown): Promise<never> {
    throw new Error('solveCaptcha() not implemented in MVP runner');
  }

  async clickAndWaitForNavigation(selector: string): Promise<void> {
    await Promise.all([
      this.page.waitForLoadState('load'),
      this.page.click(selector),
    ]);
  }

  async searchForRequest(_urlPattern: string, _method: string, _pastTimestamp: number, _timeout: number): Promise<null> {
    this.logger.warn('searchForRequest not implemented in MVP');
    return null;
  }
}
```

**Step 2: Verify it compiles**

Run: `cd /Users/marko/Documents/robot-platform/packages/runner && npx tsc --noEmit`
Expected: no errors

**Step 3: Commit**

```bash
git add packages/runner/src/context.ts
git commit -m "feat(runner): implement PlaywrightContext wrapping Playwright Page"
```

---

### Task 5: Implement executor (single run execution)

**Files:**
- Create: `packages/runner/src/executor.ts`

**Step 1: Create executor.ts**

Orchestrates a single run: load config, launch browser, navigate, validate, capture results.

```typescript
import { chromium, type Browser } from 'playwright';
import { db } from '@robot/db';
import { runs, extractors, extractorInputs } from '@robot/db/schema';
import { eq } from 'drizzle-orm';
import { PlaywrightContext } from './context';
import { RunLogger } from './logger';
import { buildUrl } from './url-builder';

export async function executeRun(runId: string): Promise<void> {
  const logger = new RunLogger(runId);

  // Mark as running
  await db.update(runs)
    .set({ status: 'running', startedAt: new Date() })
    .where(eq(runs.id, runId));

  let browser: Browser | null = null;

  try {
    // Load run record
    const run = await db.query.runs.findFirst({
      where: eq(runs.id, runId),
    });
    if (!run) throw new Error(`Run ${runId} not found`);

    // Load extractor with domain info
    const extractor = await db.query.extractors.findFirst({
      where: eq(extractors.id, run.extractorId),
      with: { domain: true, org: true },
    });
    if (!extractor) throw new Error(`Extractor ${run.extractorId} not found`);

    const params = (extractor.parameters ?? {}) as Record<string, unknown>;
    logger.info(`Extractor: ${extractor.org.name}/${extractor.domain.name}/${extractor.country}/${extractor.variant}`);

    // Load input data
    let inputData: Record<string, unknown> = {};
    if (run.inputLabel) {
      const input = await db.query.extractorInputs.findFirst({
        where: (t, { and, eq: e }) => and(
          e(t.extractorId, extractor.id),
          e(t.label, run.inputLabel!),
        ),
      });
      if (input) {
        inputData = (input.inputData ?? {}) as Record<string, unknown>;
        logger.info(`Using input "${run.inputLabel}": ${JSON.stringify(inputData).slice(0, 200)}`);
      } else {
        logger.warn(`Input "${run.inputLabel}" not found, running without input data`);
      }
    } else {
      // Use first available input
      const firstInput = await db.query.extractorInputs.findFirst({
        where: eq(extractorInputs.extractorId, extractor.id),
      });
      if (firstInput) {
        inputData = (firstInput.inputData ?? {}) as Record<string, unknown>;
        await db.update(runs).set({ inputLabel: firstInput.label }).where(eq(runs.id, runId));
        logger.info(`Using first input "${firstInput.label}": ${JSON.stringify(inputData).slice(0, 200)}`);
      }
    }

    // Build URL
    const url = buildUrl(params, inputData);
    logger.info(`Target URL: ${url}`);

    // Launch browser
    const headless = process.env.HEADFUL !== '1';
    logger.info(`Launching browser (headless=${headless})`);
    browser = await chromium.launch({ headless });
    const browserContext = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
    });
    const page = await browserContext.newPage();
    const ctx = new PlaywrightContext(page, browserContext, logger);

    // Configure browser
    const blockAds = params.setBlockAds as boolean | undefined;
    if (blockAds) await ctx.setBlockAds(true);

    const loadImages = params.setLoadImages as boolean | undefined;
    if (loadImages === false) await ctx.setLoadImages(false);

    const loadAll = params.setLoadAllResources as boolean | undefined;
    if (loadAll === false) await ctx.setLoadAllResources(false);

    await ctx.captureRequests();

    // Navigate
    const timeout = (params.timeout as number) ?? 60000;
    const waitUntil = (params.goto2 as Record<string, unknown>)?.waitUntil as string | undefined;
    logger.info(`Navigating (timeout=${timeout}, waitUntil=${waitUntil ?? 'load'})`);

    const response = await ctx.goto(url, {
      timeout,
      waitUntil: waitUntil === 'networkidle' ? 'networkidle' : 'load',
    });
    logger.info(`Response: ${response.status} ${response.url}`);

    // Validate page load
    const loadedXpath = params.loadedXpath as string | undefined;
    const loadedSelector = params.loadedSelector as string | undefined;

    if (loadedXpath) {
      logger.info(`Waiting for XPath: ${loadedXpath}`);
      await ctx.waitForXPath(loadedXpath, { timeout: 30000 });
      logger.info('XPath found');
    } else if (loadedSelector) {
      logger.info(`Waiting for selector: ${loadedSelector}`);
      await ctx.waitForSelector(loadedSelector, { timeout: 30000 });
      logger.info('Selector found');
    }

    // Check for no results / access denied
    const noResultsXPath = params.noResultsXPath as string | undefined;
    if (noResultsXPath) {
      const found = await page.locator(`xpath=${noResultsXPath}`).count();
      if (found > 0) {
        logger.warn('No results XPath matched — page has no data');
      }
    }

    const accessDeniedXPath = params.accessDeniedXPath as string | undefined;
    if (accessDeniedXPath) {
      const found = await page.locator(`xpath=${accessDeniedXPath}`).count();
      if (found > 0) {
        throw new Error('Access denied detected on page');
      }
    }

    // Scroll if configured
    const maxScrolls = params.maxScrolls as number | undefined;
    if (maxScrolls && maxScrolls > 0) {
      await ctx.scrollToBottom({ maxScrolls });
    }

    // Execute ordered actions if configured
    const orderedActions = params.orderedActionsToPerform as Array<Record<string, unknown>> | undefined;
    if (orderedActions && orderedActions.length > 0) {
      logger.info(`Executing ${orderedActions.length} ordered actions`);
      for (const action of orderedActions) {
        const selector = action.selectorOrXpath as string;
        const inputValue = action.inputValue as string | undefined;
        const wait = action.wait as number | undefined;

        if (selector && selector !== 'dummy') {
          // Interpolate template variables in selector
          let resolvedSelector = selector;
          for (const [key, value] of Object.entries({ ...params, ...inputData })) {
            resolvedSelector = resolvedSelector.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value));
          }

          const isXPath = resolvedSelector.startsWith('//') || resolvedSelector.startsWith('(//');
          try {
            if (inputValue) {
              // Interpolate input value
              let resolvedValue = inputValue;
              for (const [key, value] of Object.entries({ ...params, ...inputData })) {
                resolvedValue = resolvedValue.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value));
              }
              if (isXPath) {
                await page.locator(`xpath=${resolvedSelector}`).fill(resolvedValue, { timeout: 10000 });
              } else {
                await page.fill(resolvedSelector, resolvedValue, { timeout: 10000 });
              }
              logger.info(`Filled "${resolvedSelector}" with value`);
            } else {
              if (isXPath) {
                await page.locator(`xpath=${resolvedSelector}`).click({ timeout: 10000 });
              } else {
                await page.click(resolvedSelector, { timeout: 10000 });
              }
              logger.info(`Clicked "${resolvedSelector}"`);
            }
          } catch (e) {
            logger.warn(`Action failed on "${resolvedSelector}": ${(e as Error).message}`);
          }
        }

        // Wait for selector to appear if specified
        const waitForSelector = action.selectorOrXpathToWaitFor as string | undefined;
        if (waitForSelector) {
          try {
            const isXPath = waitForSelector.startsWith('//');
            if (isXPath) {
              await page.locator(`xpath=${waitForSelector}`).waitFor({ timeout: wait ?? 10000 });
            } else {
              await page.waitForSelector(waitForSelector, { timeout: wait ?? 10000 });
            }
          } catch {
            logger.warn(`Wait for "${waitForSelector}" timed out`);
          }
        } else if (wait) {
          await page.waitForTimeout(wait);
        }
      }
    }

    // Capture screenshot
    logger.info('Taking screenshot');
    const screenshotBuffer = await ctx.screenshot({ fullPage: true });
    const screenshotBase64 = screenshotBuffer.toString('base64');

    // Capture HTML (truncated to 500KB)
    const html = (await ctx.content()).slice(0, 500_000);

    // Mark success
    await db.update(runs)
      .set({
        status: 'completed',
        completedAt: new Date(),
        results: {
          screenshotBase64: screenshotBase64.slice(0, 200_000), // Cap at ~150KB image
          htmlLength: html.length,
          finalUrl: page.url(),
          responseStatus: response.status,
        },
        resultCount: 1,
      })
      .where(eq(runs.id, runId));

    logger.info(`Run completed: ${page.url()}`);

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Run failed: ${message}`);

    await db.update(runs)
      .set({
        status: 'failed',
        completedAt: new Date(),
        errorMessage: message,
      })
      .where(eq(runs.id, runId));
  } finally {
    await logger.flush();
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}
```

**Step 2: Verify it compiles**

Run: `cd /Users/marko/Documents/robot-platform/packages/runner && npx tsc --noEmit`
Expected: no errors

**Step 3: Commit**

```bash
git add packages/runner/src/executor.ts
git commit -m "feat(runner): implement single run executor with navigation + validation"
```

---

### Task 6: Implement worker poll loop

**Files:**
- Create: `packages/runner/src/worker.ts`

**Step 1: Create worker.ts**

```typescript
import { db } from '@robot/db';
import { runs } from '@robot/db/schema';
import { eq, asc } from 'drizzle-orm';
import { executeRun } from './executor';

const POLL_INTERVAL = 5000;

async function pollForRun(): Promise<string | null> {
  const [run] = await db
    .select({ id: runs.id })
    .from(runs)
    .where(eq(runs.status, 'queued'))
    .orderBy(asc(runs.createdAt))
    .limit(1);

  return run?.id ?? null;
}

async function main() {
  console.log('Runner worker started. Polling for queued runs...');

  // Reset any stale "running" runs from previous crashes
  const stale = await db.update(runs)
    .set({ status: 'failed', errorMessage: 'Worker restarted — run was interrupted', completedAt: new Date() })
    .where(eq(runs.status, 'running'))
    .returning({ id: runs.id });

  if (stale.length > 0) {
    console.log(`Reset ${stale.length} stale running runs to failed`);
  }

  while (true) {
    try {
      const runId = await pollForRun();

      if (runId) {
        console.log(`\nPicked up run: ${runId}`);
        await executeRun(runId);
        console.log(`Run ${runId} finished\n`);
      } else {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
      }
    } catch (error) {
      console.error('Worker error:', error);
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
    }
  }
}

main().catch((err) => {
  console.error('Worker fatal error:', err);
  process.exit(1);
});
```

**Step 2: Verify it compiles**

Run: `cd /Users/marko/Documents/robot-platform/packages/runner && npx tsc --noEmit`
Expected: no errors

**Step 3: Test worker starts** (will just poll with no runs)

Run: `cd /Users/marko/Documents/robot-platform && pnpm --filter @robot/runner worker`
Expected: "Runner worker started. Polling for queued runs..."
Kill with Ctrl+C after confirming it starts.

**Step 4: Commit**

```bash
git add packages/runner/src/worker.ts
git commit -m "feat(runner): implement worker poll loop"
```

---

### Task 7: Add runs router to @robot/api

**Files:**
- Create: `packages/api/src/routers/runs.ts`
- Modify: `packages/api/src/routers/index.ts` (add runs router to appRouter)

**Step 1: Create runs.ts router**

Follow the exact same pattern as `packages/api/src/routers/orgs.ts`:

```typescript
import { z } from 'zod';
import { eq, desc } from 'drizzle-orm';
import { runs } from '@robot/db';
import { router, publicProcedure } from '../trpc';

export const runsRouter = router({
  list: publicProcedure
    .input(
      z.object({
        extractorId: z.string().uuid().optional(),
      }).optional(),
    )
    .query(async ({ ctx, input }) => {
      const results = await ctx.db.query.runs.findMany({
        where: input?.extractorId ? eq(runs.extractorId, input.extractorId) : undefined,
        orderBy: [desc(runs.createdAt)],
        limit: 50,
      });
      return results;
    }),

  getById: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const run = await ctx.db.query.runs.findFirst({
        where: eq(runs.id, input.id),
        with: {
          extractor: {
            with: {
              org: { columns: { id: true, name: true } },
              domain: { columns: { id: true, name: true } },
            },
          },
        },
      });

      if (!run) {
        throw new Error(`Run with id ${input.id} not found`);
      }

      return run;
    }),

  create: publicProcedure
    .input(
      z.object({
        extractorId: z.string().uuid(),
        inputLabel: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [run] = await ctx.db.insert(runs).values({
        extractorId: input.extractorId,
        inputLabel: input.inputLabel ?? null,
        status: 'queued',
      }).returning();
      return run;
    }),
});
```

**Step 2: Add to appRouter in `packages/api/src/routers/index.ts`**

Add import and registration:

```typescript
import { router } from '../trpc';
import { orgsRouter } from './orgs';
import { extractorsRouter } from './extractors';
import { domainsRouter } from './domains';
import { inputsRouter } from './inputs';
import { credentialsRouter } from './credentials';
import { runsRouter } from './runs';

export const appRouter = router({
  orgs: orgsRouter,
  extractors: extractorsRouter,
  domains: domainsRouter,
  inputs: inputsRouter,
  credentials: credentialsRouter,
  runs: runsRouter,
});

export type AppRouter = typeof appRouter;
```

**Step 3: Verify it compiles**

Run: `cd /Users/marko/Documents/robot-platform/packages/api && npx tsc --noEmit`
Expected: no errors

**Step 4: Commit**

```bash
git add packages/api/src/routers/runs.ts packages/api/src/routers/index.ts
git commit -m "feat(api): add runs router with create, list, getById"
```

---

### Task 8: Add "Run" button and run history to extractor detail page

**Files:**
- Create: `packages/dashboard/src/app/runs/actions.ts`
- Modify: `packages/dashboard/src/app/extractors/[id]/page.tsx` (add Run button + run history table)

**Step 1: Create runs server action**

Create `packages/dashboard/src/app/runs/actions.ts`:

```typescript
"use server";

import { api } from "@/trpc/server";
import { redirect } from "next/navigation";

export async function createRun(formData: FormData) {
  const extractorId = formData.get("extractorId") as string;
  const inputLabel = formData.get("inputLabel") as string | null;
  const run = await api.runs.create({
    extractorId,
    inputLabel: inputLabel || undefined,
  });
  redirect(`/runs/${run.id}`);
}
```

**Step 2: Add run button and history to extractor detail page**

Modify `packages/dashboard/src/app/extractors/[id]/page.tsx`:

- Import `createRun` from `@/app/runs/actions`
- Add `const recentRuns = await api.runs.list({ extractorId: id });` after loading extractor
- Add a "Run" button (form with hidden extractorId, submit action = createRun) in the header buttons area, between "Export YAML" and "Edit"
- Add a "Recent Runs" section after Credentials with a table: Status (badge), Input, Started, Completed, link to `/runs/[id]`

Status badge colors:
- queued: `bg-gray-100 text-gray-800`
- running: `bg-blue-100 text-blue-800`
- completed: `bg-green-100 text-green-800`
- failed: `bg-red-100 text-red-800`

**Step 3: Verify it compiles**

Run: `cd /Users/marko/Documents/robot-platform/packages/dashboard && npx tsc --noEmit`
Expected: no errors

**Step 4: Commit**

```bash
git add packages/dashboard/src/app/runs/actions.ts packages/dashboard/src/app/extractors/\[id\]/page.tsx
git commit -m "feat(dashboard): add Run button and run history to extractor detail"
```

---

### Task 9: Create run detail page

**Files:**
- Create: `packages/dashboard/src/app/runs/[id]/page.tsx`

**Step 1: Create run detail page**

Server component that shows full run details. Pattern: same as `packages/dashboard/src/app/extractors/[id]/page.tsx`.

```tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { api } from '@/trpc/server';

const statusColors: Record<string, string> = {
  queued: 'bg-gray-100 text-gray-800',
  running: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
};

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const run = await api.runs.getById({ id });

  if (!run) {
    notFound();
  }

  const logs = run.logs ? JSON.parse(run.logs) as Array<{ timestamp: string; level: string; message: string }> : [];
  const results = run.results as Record<string, unknown> | null;

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center gap-4">
        <Link
          href={`/extractors/${run.extractorId}`}
          className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
        >
          &larr; Back to Extractor
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900">
            Run {run.id.slice(0, 8)}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {run.extractor.org.name} / {run.extractor.domain.name}
            {run.inputLabel ? ` — input: ${run.inputLabel}` : ''}
          </p>
        </div>
        <span className={`inline-flex rounded-full px-3 py-1 text-sm font-semibold ${statusColors[run.status] ?? statusColors.queued}`}>
          {run.status}
        </span>
      </div>

      {/* Timing */}
      <section className="mb-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <p className="font-medium text-gray-500">Created</p>
            <p className="text-gray-900">{new Date(run.createdAt).toLocaleString()}</p>
          </div>
          <div>
            <p className="font-medium text-gray-500">Started</p>
            <p className="text-gray-900">{run.startedAt ? new Date(run.startedAt).toLocaleString() : '—'}</p>
          </div>
          <div>
            <p className="font-medium text-gray-500">Completed</p>
            <p className="text-gray-900">{run.completedAt ? new Date(run.completedAt).toLocaleString() : '—'}</p>
          </div>
        </div>
      </section>

      {/* Error */}
      {run.errorMessage && (
        <section className="mb-6 rounded-xl border border-red-200 bg-red-50 p-6">
          <h2 className="mb-2 text-lg font-semibold text-red-900">Error</h2>
          <pre className="whitespace-pre-wrap text-sm text-red-800">{run.errorMessage}</pre>
        </section>
      )}

      {/* Results */}
      {results && (
        <section className="mb-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-2 text-lg font-semibold text-gray-900">Results</h2>
          <div className="text-sm text-gray-700">
            <p>Final URL: {results.finalUrl as string}</p>
            <p>Response Status: {results.responseStatus as number}</p>
            <p>HTML Length: {(results.htmlLength as number)?.toLocaleString()} chars</p>
          </div>
          {results.screenshotBase64 && (
            <div className="mt-4">
              <h3 className="mb-2 text-sm font-medium text-gray-500">Screenshot</h3>
              <img
                src={`data:image/png;base64,${results.screenshotBase64}`}
                alt="Page screenshot"
                className="max-h-96 rounded-lg border border-gray-200"
              />
            </div>
          )}
        </section>
      )}

      {/* Logs */}
      <section className="mb-6 rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">Logs ({logs.length})</h2>
        </div>
        <div className="max-h-96 overflow-y-auto">
          {logs.map((entry, i) => (
            <div key={i} className="flex gap-3 border-b border-gray-100 px-6 py-2 text-xs">
              <span className="shrink-0 text-gray-400">
                {new Date(entry.timestamp).toLocaleTimeString()}
              </span>
              <span className={`shrink-0 font-medium uppercase ${
                entry.level === 'error' ? 'text-red-600' :
                entry.level === 'warn' ? 'text-yellow-600' : 'text-gray-500'
              }`}>
                {entry.level}
              </span>
              <span className="text-gray-800">{entry.message}</span>
            </div>
          ))}
          {logs.length === 0 && (
            <p className="px-6 py-8 text-center text-sm text-gray-500">No logs yet.</p>
          )}
        </div>
      </section>
    </div>
  );
}
```

**Step 2: Verify it compiles**

Run: `cd /Users/marko/Documents/robot-platform/packages/dashboard && npx tsc --noEmit`
Expected: no errors

**Step 3: Commit**

```bash
git add packages/dashboard/src/app/runs/\[id\]/page.tsx
git commit -m "feat(dashboard): add run detail page with logs, screenshot, error display"
```

---

### Task 10: Push schema changes and end-to-end test

**Step 1: Push updated schema to DB**

Run: `cd /Users/marko/Documents/robot-platform/packages/db && npx drizzle-kit push`

(The `runs` table should already exist from Phase 4, but if the status default changed from 'pending' to 'queued', this will sync it.)

**Step 2: Type check all packages**

Run these in sequence:
```bash
cd /Users/marko/Documents/robot-platform/packages/runner && npx tsc --noEmit
cd /Users/marko/Documents/robot-platform/packages/api && npx tsc --noEmit
cd /Users/marko/Documents/robot-platform/packages/dashboard && npx tsc --noEmit
```

Expected: all clean

**Step 3: Start worker in one terminal**

Run: `cd /Users/marko/Documents/robot-platform && pnpm --filter @robot/runner worker`
Expected: "Runner worker started. Polling for queued runs..."

**Step 4: Start dashboard in another terminal**

Run: `cd /Users/marko/Documents/robot-platform && pnpm --filter @robot/dashboard dev`
Expected: Ready on http://localhost:3456

**Step 5: End-to-end test**

1. Open http://localhost:3456/extractors
2. Click on an extractor (e.g. one with a simple `_url` input)
3. Click "Run" button
4. Should redirect to `/runs/[id]` showing status "queued"
5. Refresh — worker should pick it up, status changes to "running" then "completed" or "failed"
6. Check logs timeline and screenshot

**Step 6: Commit**

```bash
git add -A
git commit -m "feat(runner): Phase 5 complete — runner service with dashboard integration"
```
