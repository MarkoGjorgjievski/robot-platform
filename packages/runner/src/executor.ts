import { chromium, type Browser, type Page } from 'playwright';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { db } from '@robot/db';
import { runs, extractors, extractorInputs, sources, sourceInputs, robotOverrides } from '@robot/db/schema';
import { eq, and } from 'drizzle-orm';
import { PlaywrightContext } from './context';
import { RunLogger } from './logger';
import { buildUrl } from './url-builder';
import { extractData, applyFieldTransforms, applyGlobalTransform, type SchemaData, type SchemaField } from './extractor';

// Load rrweb recorder script once at module level
const rrwebRequire = createRequire(import.meta.url);
const RRWEB_RECORD_SCRIPT = readFileSync(
  rrwebRequire.resolve('rrweb/dist/record/rrweb-record.min.js'),
  'utf-8',
);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function deepMerge(base: Record<string, unknown>, overrides: Record<string, unknown>): Record<string, unknown> {
  const result = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined && value !== null) {
      if (
        typeof value === 'object' && !Array.isArray(value) &&
        typeof result[key] === 'object' && result[key] !== null && !Array.isArray(result[key])
      ) {
        result[key] = deepMerge(result[key] as Record<string, unknown>, value as Record<string, unknown>);
      } else {
        result[key] = value;
      }
    }
  }
  return result;
}

function computeOverrides(
  defaults: Record<string, unknown>,
  source: Record<string, unknown>,
): Array<{ key: string; from: unknown; to: unknown }> {
  const overrides: Array<{ key: string; from: unknown; to: unknown }> = [];
  const allKeys = new Set([...Object.keys(defaults), ...Object.keys(source)]);
  for (const key of allKeys) {
    // Skip internal keys
    if (key.startsWith('_')) continue;
    const fromVal = defaults[key];
    const toVal = source[key];
    if (toVal !== undefined && JSON.stringify(fromVal) !== JSON.stringify(toVal)) {
      overrides.push({ key, from: fromVal, to: toVal });
    }
  }
  return overrides;
}

// ─── Main executor ───────────────────────────────────────────────────────────

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

    // ── Load source or extractor ─────────────────────────────────────────
    let sourceParams: Record<string, unknown> = {};
    let entityLabel = '';
    let entityId = '';
    let domainId: string | null = null;
    let country = '';
    let collectionSchema: unknown = null;
    let collectionName: string | null = null;

    if (run.sourceId) {
      const source = await db.query.sources.findFirst({
        where: eq(sources.id, run.sourceId!),
        with: { domain: true, collection: { with: { project: { with: { org: true } } } } },
      });
      if (!source) throw new Error(`Source ${run.sourceId!} not found`);

      sourceParams = (source.parameters ?? {}) as Record<string, unknown>;
      entityLabel = `${source.collection.project.org.name}/${source.domain?.name ?? 'unknown'}/${source.country}/${source.variant}`;
      entityId = source.id;
      domainId = source.domainId;
      country = source.country;
      collectionSchema = source.collection.schema;
      collectionName = source.collection.name;
      logger.info(`Source: ${entityLabel}`);
    } else if (run.extractorId) {
      const extractor = await db.query.extractors.findFirst({
        where: eq(extractors.id, run.extractorId!),
        with: { domain: true, org: true },
      });
      if (!extractor) throw new Error(`Extractor ${run.extractorId!} not found`);

      sourceParams = (extractor.parameters ?? {}) as Record<string, unknown>;
      entityLabel = `${extractor.org.name}/${extractor.domain.name}/${extractor.country}/${extractor.variant}`;
      entityId = extractor.id;
      domainId = extractor.domainId;
      country = extractor.country;
      logger.info(`Extractor: ${entityLabel}`);
    } else {
      throw new Error(`Run ${runId} has no sourceId or extractorId`);
    }

    // ── Load robot override & merge parameters ───────────────────────────
    let override: {
      parameterOverrides: unknown;
      schemas: unknown;
      jsOverrides: unknown;
      hasBeforeExtract: boolean;
      hasTransform: boolean;
    } | null = null;

    if (domainId) {
      override = await db.query.robotOverrides.findFirst({
        where: and(
          eq(robotOverrides.domainId, domainId),
          eq(robotOverrides.country, country),
        ),
        columns: {
          parameterOverrides: true,
          schemas: true,
          jsOverrides: true,
          hasBeforeExtract: true,
          hasTransform: true,
        },
      }) ?? null;

      // Also try country-agnostic override if no country-specific one found
      if (!override) {
        override = await db.query.robotOverrides.findFirst({
          where: eq(robotOverrides.domainId, domainId),
          columns: {
            parameterOverrides: true,
            schemas: true,
            jsOverrides: true,
            hasBeforeExtract: true,
            hasTransform: true,
          },
        }) ?? null;
      }
    }

    // Merge: domain defaults as base, source/extractor params override
    const domainDefaults = (override?.parameterOverrides ?? {}) as Record<string, unknown>;
    const params = deepMerge(domainDefaults, sourceParams);
    if (Object.keys(domainDefaults).length > 0) {
      logger.info(`Merged ${Object.keys(domainDefaults).length} domain default parameter(s)`);
    }

    // Log key merged params for debugging
    const paramKeys = Object.keys(params).filter(k => !k.startsWith('_'));
    logger.info(`Merged params: ${paramKeys.join(', ')}`);
    if (params.loadedXpath) logger.info(`  loadedXpath: ${params.loadedXpath}`);
    if (params.loadedSelector) logger.info(`  loadedSelector: ${params.loadedSelector}`);
    if (params.loadingTimeout) logger.info(`  loadingTimeout: ${params.loadingTimeout}`);
    if (params.orderedActionsToPerform) logger.info(`  orderedActions: ${(params.orderedActionsToPerform as unknown[]).length} action(s)`);

    // Config snapshot for the Config tab
    const configOverrides = computeOverrides(domainDefaults, sourceParams);
    if (configOverrides.length > 0) {
      logger.info(`${configOverrides.length} parameter override(s): ${configOverrides.map(o => o.key).join(', ')}`);
    }

    const jsOverrides = (override?.jsOverrides ?? {}) as Record<string, string>;
    const overrideSchemas = (override?.schemas ?? {}) as Record<string, unknown>;

    // ── Resolve schema ───────────────────────────────────────────────────
    // Priority: params._schema (source-level) > override schemas > collection schema
    const schemaYAML = params.schemaYAML as string | undefined;
    let schemaName = schemaYAML ?? Object.keys(overrideSchemas)[0] ?? null;
    let schema: SchemaData | null = null;

    // 1. Source-level schema (saved from Schema panel into parameters._schema)
    const sourceSchema = params._schema as SchemaData | undefined;
    if (sourceSchema && sourceSchema.fields && sourceSchema.fields.length > 0) {
      schema = sourceSchema;
      schemaName = schemaName ?? 'source';
      logger.info(`Using source schema (${schema.fields?.length ?? 0} fields)`);
    }
    // 2. Override schema (from robot_overrides table)
    else if (schemaName && overrideSchemas[schemaName]) {
      schema = overrideSchemas[schemaName] as SchemaData;
      logger.info(`Using override schema "${schemaName}" (${schema.fields?.length ?? 0} fields)`);
    }
    // 3. Collection schema fallback (field names only, no selectors)
    else if (collectionSchema) {
      const fields = Array.isArray(collectionSchema) ? collectionSchema : [];
      if (fields.length > 0) {
        schema = {
          singleRecord: true,
          recordSelector: null,
          recordXPath: null,
          fields: (fields as Array<{ name: string; type?: string }>).map((f) => ({
            name: f.name,
            type: f.type?.toUpperCase() ?? 'TEXT',
          })),
        };
        schemaName = collectionName ?? 'collection';
        logger.info(`Using collection schema "${schemaName}" (${schema.fields?.length ?? 0} fields)`);
      }
    }

    // ── Load input data ──────────────────────────────────────────────────
    let inputData: Record<string, unknown> = {};
    if (run.inputLabel) {
      if (run.sourceId) {
        const input = await db.query.sourceInputs.findFirst({
          where: (t, { and: a, eq: e }) => a(
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
          where: (t, { and: a, eq: e }) => a(
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

    // ── Build URL ────────────────────────────────────────────────────────
    const url = buildUrl(params, inputData);
    logger.info(`Target URL: ${url}`);

    // ── Launch browser ───────────────────────────────────────────────────
    const headless = process.env.HEADFUL !== '1';
    logger.info(`Launching browser (headless=${headless})`);
    browser = await chromium.launch({ headless });

    const browserContext = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
    });
    const page = await browserContext.newPage();
    const ctx = new PlaywrightContext(page, browserContext, logger);

    // Inject rrweb recorder BEFORE navigation to capture the full page lifecycle
    await page.addInitScript({ content: RRWEB_RECORD_SCRIPT + `\n;window.__rrwebEvents=[];if(typeof rrwebRecord==='function'){rrwebRecord({emit:function(e){window.__rrwebEvents.push(e)},inlineStylesheet:true,collectFonts:true,recordCanvas:false});}` });

    // ── Configure browser ────────────────────────────────────────────────
    const blockAds = params.setBlockAds as boolean | undefined;
    if (blockAds) await ctx.setBlockAds(true);

    const loadImages = params.setLoadImages as boolean | undefined;
    if (loadImages === false) await ctx.setLoadImages(false);

    const loadAll = params.setLoadAllResources as boolean | undefined;
    if (loadAll === false) await ctx.setLoadAllResources(false);

    await ctx.captureRequests();

    // ── Navigate ─────────────────────────────────────────────────────────
    const timeout = (params.timeout as number) ?? 60000;
    const waitUntil = (params.goto2 as Record<string, unknown>)?.waitUntil as string | undefined;
    logger.info(`Navigating (timeout=${timeout}, waitUntil=${waitUntil ?? 'load'})`);

    const response = await ctx.goto(url, {
      timeout,
      waitUntil: waitUntil === 'networkidle' ? 'networkidle' : 'load',
    });
    logger.info(`Response: ${response.status} ${response.url}`);

    // ── Validate page load ───────────────────────────────────────────────
    const loadedXpath = params.loadedXpath as string | undefined;
    const loadedSelector = params.loadedSelector as string | undefined;
    const loadingTimeout = (params.loadingTimeout as number) ?? 30000;

    if (loadedXpath) {
      logger.info(`Waiting for XPath: ${loadedXpath} (timeout=${loadingTimeout}ms)`);
      await ctx.waitForXPath(loadedXpath, { timeout: loadingTimeout });
      logger.info('XPath found');
    } else if (loadedSelector) {
      logger.info(`Waiting for selector: ${loadedSelector} (timeout=${loadingTimeout}ms)`);
      await ctx.waitForSelector(loadedSelector, { timeout: loadingTimeout });
      logger.info('Selector found');
    } else {
      logger.info('No loadedXpath or loadedSelector — skipping page validation');
    }

    // ── Wait for additional selectors (waitForSelectorToLoad / waitForXPathToLoad)
    const waitForSelector = params.waitForSelectorToLoad as string | undefined;
    const waitForXPath = params.waitForXPathToLoad as string | undefined;
    if (waitForSelector) {
      logger.info(`Waiting for CSS: ${waitForSelector} (timeout=${loadingTimeout}ms)`);
      try {
        await page.waitForSelector(waitForSelector, { timeout: loadingTimeout });
        logger.info('CSS selector found');
      } catch { logger.warn(`waitForSelectorToLoad timed out: ${waitForSelector}`); }
    }
    if (waitForXPath) {
      logger.info(`Waiting for XPath: ${waitForXPath} (timeout=${loadingTimeout}ms)`);
      try {
        await ctx.waitForXPath(waitForXPath, { timeout: loadingTimeout });
        logger.info('XPath found');
      } catch { logger.warn(`waitForXPathToLoad timed out: ${waitForXPath}`); }
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

    // ── Scroll ───────────────────────────────────────────────────────────
    const maxScrolls = params.maxScrolls as number | undefined;
    if (maxScrolls && maxScrolls > 0) {
      await ctx.scrollToBottom({ maxScrolls });
    }

    // ── orderedSelectorsToClickOn (simple selector strings) ─────────────
    // ── Process actions (orderedSelectorsToClickOn + orderedActionsToPerform) ──
    // Both params are concatenated, matching the old robot-library behavior.
    // Each entry can be a plain string (selector to click) or an object:
    //   { selectorOrXpath, inputValue?, wait?, selectorOrXpathToWaitFor?, waitDisappear? }
    const selectorsToClick = (params.orderedSelectorsToClickOn ?? []) as unknown[];
    const actionsToPerform = (params.orderedActionsToPerform ?? []) as unknown[];
    const allActions = [...selectorsToClick, ...actionsToPerform];

    if (allActions.length > 0) {
      logger.info(`Processing ${allActions.length} action(s)`);
      for (const raw of allActions) {
        if (!raw) continue;

        // Normalize: string → { selectorOrXpath: string }
        const action = typeof raw === 'string'
          ? { selectorOrXpath: raw }
          : raw as Record<string, unknown>;

        const sel = (action.selectorOrXpath ?? raw) as string;
        if (!sel || sel === 'dummy') continue;

        const actionWait = (action.wait as number) ?? 0;
        const actionInput = action.inputValue as string | undefined;
        const waitForSel = action.selectorOrXpathToWaitFor as string | undefined;
        const waitDisappear = action.waitDisappear as boolean | undefined;

        // Resolve {placeholders} in selector and value
        let resolvedSel = String(sel);
        let resolvedValue = actionInput ? String(actionInput) : '';
        for (const [key, value] of Object.entries({ ...params, ...inputData })) {
          const re = new RegExp(`\\{${key}\\}`, 'g');
          resolvedSel = resolvedSel.replace(re, String(value));
          if (resolvedValue) resolvedValue = resolvedValue.replace(re, String(value));
        }

        const isXPath = resolvedSel.startsWith('//') || resolvedSel.startsWith('(//');

        try {
          const locator = isXPath
            ? page.locator(`xpath=${resolvedSel}`).first()
            : page.locator(resolvedSel).first();

          // Wait for visible before interacting
          await locator.waitFor({ state: 'visible', timeout: actionWait || 10000 });

          if (actionInput) {
            await locator.fill(resolvedValue, { timeout: 10000 });
            logger.info(`Filled "${resolvedSel}" with value`);
          } else {
            await locator.click({ timeout: 10000 });
            logger.info(`Clicked "${resolvedSel}"`);
          }

          // Post-click: wait for another selector, or wait for element to disappear, or fixed wait
          if (waitForSel) {
            const isWaitXPath = waitForSel.startsWith('//') || waitForSel.startsWith('(//');
            try {
              if (isWaitXPath) {
                await page.locator(`xpath=${waitForSel}`).first().waitFor({ timeout: actionWait || 10000 });
              } else {
                await page.waitForSelector(waitForSel, { timeout: actionWait || 10000 });
              }
              logger.info(`  Wait-for selector found: "${waitForSel}"`);
            } catch {
              logger.warn(`  Wait-for selector timed out: "${waitForSel}"`);
            }
          } else if (waitDisappear) {
            try {
              await locator.waitFor({ state: 'hidden', timeout: actionWait || 5000 });
              logger.info(`  Element disappeared after click`);
            } catch {
              logger.info(`  Element still visible after click`);
            }
          } else if (actionWait > 0) {
            await page.waitForTimeout(actionWait);
          } else {
            // Default: short wait for DOM to settle after click
            await page.waitForTimeout(500);
          }
        } catch (e) {
          logger.warn(`Action failed on "${resolvedSel}": ${(e as Error).message}`);
        }
      }
    }

    // ── beforeExtract ────────────────────────────────────────────────────
    if (jsOverrides.beforeExtract) {
      await runBeforeExtract(page, jsOverrides.beforeExtract, inputData, params, logger);
    }

    // ── Extract data ─────────────────────────────────────────────────────
    let records: Record<string, string | null>[] = [];
    if (schema && schema.fields && schema.fields.length > 0) {
      records = await extractData(page, schema, logger);

      // Per-field transforms
      if (records.length > 0) {
        records = applyFieldTransforms(records, schema.fields as SchemaField[], logger);
      }

      // Global transform.js
      const useTransform = Boolean(params.useTransform);
      if (useTransform && jsOverrides.transform && records.length > 0) {
        records = applyGlobalTransform(records, jsOverrides.transform, logger);
      }
    } else {
      logger.info('No schema with selectors — skipping extraction');
    }

    // ── Capture screenshot ──────────────────────────────────────────────
    logger.info('Taking screenshot');
    const screenshotBuffer = await ctx.screenshot({ fullPage: true });
    const screenshotBase64 = screenshotBuffer.toString('base64');

    // ── Capture final HTML with inlined CSS ──────────────────────────
    const html = await captureInlinedHtml(page);
    const finalUrl = page.url();

    // ── Collect rrweb events (small delay to flush pending mutations) ──
    await page.waitForTimeout(500);
    let replayEvents: unknown[] = [];
    try {
      replayEvents = await page.evaluate(() =>
        (window as unknown as { __rrwebEvents: unknown[] }).__rrwebEvents ?? []
      );
      logger.info(`Captured ${replayEvents.length} replay events`);
    } catch (e) {
      logger.warn(`Failed to collect replay events: ${(e as Error).message}`);
    }

    // ── Store results ────────────────────────────────────────────────────
    await db.update(runs)
      .set({
        status: 'completed',
        completedAt: new Date(),
        html,
        replayData: replayEvents.length > 0 ? JSON.stringify(replayEvents) : null,
        results: {
          screenshotBase64,
          htmlLength: html.length,
          finalUrl,
          responseStatus: response.status,
          records,
          configSnapshot: {
            overrides: configOverrides,
            merged: params,
          },
        },
        resultCount: records.length || 1,
      })
      .where(eq(runs.id, runId));

    logger.info(`Run completed: ${finalUrl} — ${records.length} record(s), ${replayEvents.length} replay events`);

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

// ─── Inline CSS HTML capture ──────────────────────────────────────────────────

async function captureInlinedHtml(page: Page): Promise<string> {
  const origin = new URL(page.url()).origin;
  const html = await page.evaluate(async (org: string) => {
    // 1. Inline all loaded stylesheets
    const inlinedStyles: string[] = [];
    for (let i = 0; i < document.styleSheets.length; i++) {
      const sheet = document.styleSheets[i];
      try {
        let css = '';
        for (let j = 0; j < sheet.cssRules.length; j++) {
          css += sheet.cssRules[j].cssText + '\n';
        }
        inlinedStyles.push(css);
      } catch {
        // Cross-origin: try fetching
        if (sheet.href) {
          try {
            const resp = await fetch(sheet.href);
            if (resp.ok) inlinedStyles.push(await resp.text());
          } catch { /* skip */ }
        }
      }
    }

    // 2. Remove <link rel="stylesheet"> tags
    const links = document.querySelectorAll('link[rel="stylesheet"]');
    for (let i = 0; i < links.length; i++) links[i].remove();

    // 3. Inject inlined styles
    if (inlinedStyles.length > 0) {
      const styleEl = document.createElement('style');
      styleEl.setAttribute('data-inlined', 'true');
      styleEl.textContent = inlinedStyles.join('\n');
      (document.head || document.documentElement).prepend(styleEl);
    }

    // 4. Add <base href> for images/fonts
    let base = document.querySelector('base');
    if (!base) {
      base = document.createElement('base');
      (document.head || document.documentElement).prepend(base);
    }
    base.setAttribute('href', org + '/');

    return document.documentElement.outerHTML;
  }, origin);
  return html.slice(0, 1_000_000);
}

// ─── beforeExtract execution ─────────────────────────────────────────────────

async function runBeforeExtract(
  page: Page,
  code: string,
  inputData: Record<string, unknown>,
  params: Record<string, unknown>,
  logger: RunLogger,
): Promise<void> {
  logger.info('Running beforeExtract');
  try {
    // The old format is CJS: module.exports = { implementation: async (...) => {} }
    // Try to extract the implementation function body.
    // New format is ESM: export default async function beforeExtract(context, inputs, params) { ... }

    // For in-browser execution, we create a simplified context object
    // that exposes click/waitForSelector via page methods.
    // Since beforeExtract runs complex page interactions, we execute it
    // as a series of Playwright commands rather than inside page.evaluate().

    // Strategy: evaluate the code server-side to get the function, then
    // provide a context proxy that calls Playwright methods.

    type BeforeExtractFn = (ctx: unknown, inputs: unknown, params: unknown) => Promise<void>;
    let fn: BeforeExtractFn | null = null;

    // Try new ESM-style: export default async function beforeExtract(context, inputs, params) { ... }
    const esmMatch = code.match(
      /export\s+default\s+async\s+function\s+\w*\s*\([^)]*\)\s*\{([\s\S]*)\}\s*$/
    );
    if (esmMatch) {
      fn = new Function(
        'context', 'inputs', 'params',
        `return (async () => { ${esmMatch[1]} })()`,
      ) as unknown as BeforeExtractFn;
    }

    // Try old CJS-style: module.exports = { implementation: async (...) => {} }
    if (!fn) {
      const cjsMatch = code.match(/implementation\s*:\s*async\s*\([^)]*\)\s*=>\s*\{([\s\S]*?)\}\s*,?\s*\}/);
      if (cjsMatch) {
        fn = new Function(
          'inputs', 'parameters', 'context', 'dependencies',
          `return (async () => { ${cjsMatch[1]} })()`,
        ) as unknown as BeforeExtractFn;
      }
    }

    if (!fn) {
      // Fallback: try wrapping the whole code as a function body
      fn = new Function(
        'context', 'inputs', 'params',
        `return (async () => { ${code} })()`,
      ) as unknown as BeforeExtractFn;
    }

    // Create a simple context proxy for beforeExtract
    const context = {
      click: async (selector: string, options?: { timeout?: number }) => {
        await page.click(selector, { timeout: options?.timeout ?? 10000 }).catch(() => {
          logger.warn(`beforeExtract click failed: ${selector}`);
        });
      },
      waitForSelector: async (selector: string, options?: { timeout?: number }) => {
        await page.waitForSelector(selector, { timeout: options?.timeout ?? 30000 });
      },
      evaluate: async (pageFn: string | Function, ...args: unknown[]) => {
        return page.evaluate(pageFn as any, ...args);
      },
      waitForTimeout: async (ms: number) => {
        await page.waitForTimeout(ms);
      },
      fill: async (selector: string, value: string) => {
        await page.fill(selector, value);
      },
    };

    await fn!(context, inputData, params);
    logger.info('beforeExtract completed');
  } catch (e) {
    logger.warn(`beforeExtract failed: ${(e as Error).message}`);
  }
}
