import { chromium, type Browser, type Page } from 'playwright';
import { db } from '@robot/db';
import { runs, extractors, extractorInputs, sources, sourceInputs, robotOverrides } from '@robot/db/schema';
import { eq, and } from 'drizzle-orm';
import { PlaywrightContext } from './context';
import { RunLogger } from './logger';
import { buildUrl } from './url-builder';
import { extractData, applyFieldTransforms, applyGlobalTransform, type SchemaData, type SchemaField } from './extractor';

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

    const jsOverrides = (override?.jsOverrides ?? {}) as Record<string, string>;
    const overrideSchemas = (override?.schemas ?? {}) as Record<string, unknown>;

    // ── Resolve schema ───────────────────────────────────────────────────
    // Priority: params._schema (source-level) > override schemas > collection schema
    const schemaYAML = params.schemaYAML as string | undefined;
    let schemaName = schemaYAML ?? Object.keys(overrideSchemas)[0] ?? null;
    let schema: SchemaData | null = null;

    // 1. Source-level schema (saved from Schema panel into parameters._schema)
    const sourceSchema = params._schema as SchemaData | undefined;
    logger.info(`Schema resolution: _schema=${sourceSchema ? 'present' : 'absent'}, overrideKeys=[${Object.keys(overrideSchemas).join(',')}], collectionFields=${Array.isArray(collectionSchema) ? (collectionSchema as unknown[]).length : 0}`);
    if (sourceSchema) {
      logger.info(`_schema fields: ${JSON.stringify((sourceSchema.fields ?? []).map(f => {
        const ff = f as unknown as Record<string, unknown>;
        return { name: ff.name, xpath: ff.xpath, css: ff.css };
      }))}`);
    }
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

    // ── Scroll ───────────────────────────────────────────────────────────
    const maxScrolls = params.maxScrolls as number | undefined;
    if (maxScrolls && maxScrolls > 0) {
      await ctx.scrollToBottom({ maxScrolls });
    }

    // ── Ordered actions ──────────────────────────────────────────────────
    const orderedActions = params.orderedActionsToPerform as Array<Record<string, unknown>> | undefined;
    if (orderedActions && orderedActions.length > 0) {
      logger.info(`Executing ${orderedActions.length} ordered actions`);
      for (const action of orderedActions) {
        const selector = action.selectorOrXpath as string;
        const inputValue = action.inputValue as string | undefined;
        const wait = action.wait as number | undefined;

        if (selector && selector !== 'dummy') {
          let resolvedSelector = selector;
          for (const [key, value] of Object.entries({ ...params, ...inputData })) {
            resolvedSelector = resolvedSelector.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value));
          }

          const isXPath = resolvedSelector.startsWith('//') || resolvedSelector.startsWith('(//');
          try {
            if (inputValue) {
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

    // ── Capture screenshot & HTML ────────────────────────────────────────
    logger.info('Taking screenshot');
    const screenshotBuffer = await ctx.screenshot({ fullPage: true });
    const screenshotBase64 = screenshotBuffer.toString('base64');

    const html = (await ctx.content()).slice(0, 500_000);

    // ── Store results ────────────────────────────────────────────────────
    await db.update(runs)
      .set({
        status: 'completed',
        completedAt: new Date(),
        html,
        results: {
          screenshotBase64: screenshotBase64.slice(0, 200_000),
          htmlLength: html.length,
          finalUrl: page.url(),
          responseStatus: response.status,
          records,
        },
        resultCount: records.length || 1,
      })
      .where(eq(runs.id, runId));

    logger.info(`Run completed: ${page.url()} — ${records.length} record(s) extracted`);

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
