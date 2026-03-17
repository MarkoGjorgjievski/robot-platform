import { chromium, type Browser } from 'playwright';
import { db } from '@robot/db';
import { runs, extractors, extractorInputs, sources, sourceInputs } from '@robot/db/schema';
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

    // Load source or extractor
    let params: Record<string, unknown> = {};
    let entityLabel = '';
    let entityId = '';

    if (run.sourceId) {
      // Source-based run
      const source = await db.query.sources.findFirst({
        where: eq(sources.id, run.sourceId!),
        with: { domain: true, collection: { with: { project: { with: { org: true } } } } },
      });
      if (!source) throw new Error(`Source ${run.sourceId!} not found`);

      params = (source.parameters ?? {}) as Record<string, unknown>;
      entityLabel = `${source.collection.project.org.name}/${source.domain?.name ?? 'unknown'}/${source.country}/${source.variant}`;
      entityId = source.id;
      logger.info(`Source: ${entityLabel}`);
    } else if (run.extractorId) {
      // Legacy extractor-based run
      const extractor = await db.query.extractors.findFirst({
        where: eq(extractors.id, run.extractorId!),
        with: { domain: true, org: true },
      });
      if (!extractor) throw new Error(`Extractor ${run.extractorId!} not found`);

      params = (extractor.parameters ?? {}) as Record<string, unknown>;
      entityLabel = `${extractor.org.name}/${extractor.domain.name}/${extractor.country}/${extractor.variant}`;
      entityId = extractor.id;
      logger.info(`Extractor: ${entityLabel}`);
    } else {
      throw new Error(`Run ${runId} has no sourceId or extractorId`);
    }

    // Load input data
    let inputData: Record<string, unknown> = {};
    if (run.inputLabel) {
      if (run.sourceId) {
        const input = await db.query.sourceInputs.findFirst({
          where: (t, { and, eq: e }) => and(
            e(t.sourceId, run.sourceId!),
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
        const input = await db.query.extractorInputs.findFirst({
          where: (t, { and, eq: e }) => and(
            e(t.extractorId, entityId),
            e(t.label, run.inputLabel!),
          ),
        });
        if (input) {
          inputData = (input.inputData ?? {}) as Record<string, unknown>;
          logger.info(`Using input "${run.inputLabel}": ${JSON.stringify(inputData).slice(0, 200)}`);
        } else {
          logger.warn(`Input "${run.inputLabel}" not found, running without input data`);
        }
      }
    } else {
      // Use first available input
      if (run.sourceId) {
        const firstInput = await db.query.sourceInputs.findFirst({
          where: eq(sourceInputs.sourceId, run.sourceId!),
        });
        if (firstInput) {
          inputData = (firstInput.inputData ?? {}) as Record<string, unknown>;
          await db.update(runs).set({ inputLabel: firstInput.label }).where(eq(runs.id, runId));
          logger.info(`Using first input "${firstInput.label}": ${JSON.stringify(inputData).slice(0, 200)}`);
        }
      } else {
        const firstInput = await db.query.extractorInputs.findFirst({
          where: eq(extractorInputs.extractorId, entityId),
        });
        if (firstInput) {
          inputData = (firstInput.inputData ?? {}) as Record<string, unknown>;
          await db.update(runs).set({ inputLabel: firstInput.label }).where(eq(runs.id, runId));
          logger.info(`Using first input "${firstInput.label}": ${JSON.stringify(inputData).slice(0, 200)}`);
        }
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
        html: html,  // Store in dedicated text column
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
