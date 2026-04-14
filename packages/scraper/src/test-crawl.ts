import { readFileSync } from 'fs';
import { resolve } from 'path';

// Load .env from project root
try {
  const envPath = resolve(process.cwd(), '../../.env');
  const envContent = readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx);
    const value = trimmed.slice(eqIdx + 1);
    if (!process.env[key]) process.env[key] = value;
  }
} catch {}

import { PlaywrightBrowser } from '@robot/browser';
import { SchemaAgent } from '@robot/agent';
import { buildExtractionScript } from './executor.js';
import { calculateFieldCoverage, getMissingFields } from './field-coverage.js';

const url = process.argv[2];
if (!url) {
  console.error('Usage: tsx src/test-crawl.ts <URL> [maxPages]');
  process.exit(1);
}

const maxPages = parseInt(process.argv[3] ?? '3', 10);

console.log(`\n--- Crawl Test ---`);
console.log(`URL: ${url}`);
console.log(`Max pages: ${maxPages}\n`);

const browser = new PlaywrightBrowser();
await browser.launch({ headless: !process.env.HEADFUL });

try {
  // Step 1: Capture and discover schema
  const capture = await browser.capture(url, { waitUntil: 'networkidle', interceptNetworkRequests: true });
  const agent = new SchemaAgent();
  const schema = await agent.discoverSchema(capture);

  console.log(`Page type: ${schema.page_type}`);
  console.log(`Fields: ${schema.fields.map(f => f.name).join(', ')}\n`);

  if (!['listing', 'search_results', 'table'].includes(schema.page_type)) {
    console.log('Not a listing page — skipping crawl');
    process.exit(0);
  }

  // Step 2: Generate selectors
  let plan = await agent.generateSelectors(capture, schema.fields, schema.page_type);
  plan.page_type = schema.page_type;
  let script = buildExtractionScript(plan);

  // Step 2.5: Test extraction on page 1, retry if field coverage is low
  const testResult = await browser.evaluate<{ data: Record<string, unknown>[]; totalRows: number }>(
    url, script, { waitUntil: 'domcontentloaded' },
  );

  const coverage = calculateFieldCoverage(testResult.data, schema.fields);
  console.log(`Initial extraction: ${testResult.data.length} rows, ${Math.round(coverage * 100)}% field coverage`);

  if (coverage < 0.5 && testResult.data.length > 0) {
    const missing = getMissingFields(testResult.data, schema.fields);
    console.log(`Low coverage — retrying selectors (missing: ${missing.join(', ')})`);
    plan = await agent.retrySelectorGeneration(capture, schema.fields, schema.page_type, {
      missingFields: missing,
      rowCount: testResult.data.length,
      previousRowXpath: plan.row_xpath,
    });
    plan.page_type = schema.page_type;
    script = buildExtractionScript(plan);

    const retryResult = await browser.evaluate<{ data: Record<string, unknown>[]; totalRows: number }>(
      url, script, { waitUntil: 'domcontentloaded' },
    );
    const retryCoverage = calculateFieldCoverage(retryResult.data, schema.fields);
    console.log(`Retry: ${retryResult.data.length} rows, ${Math.round(retryCoverage * 100)}% field coverage\n`);
  } else {
    console.log('');
  }

  // Step 3: Crawl with the (possibly improved) selectors
  let totalItems = 0;
  for await (const page of browser.crawl(url, { extractionScript: script, maxPages })) {
    console.log(`Page ${page.pageNumber} (${page.url}):`);
    console.log(`  ${page.data.length} items extracted`);
    if (page.data[0]) {
      console.log(`  First item: ${JSON.stringify(page.data[0]).slice(0, 200)}`);
    }
    totalItems += page.data.length;
  }

  console.log(`\n--- Total: ${totalItems} items across all pages ---`);
} finally {
  await browser.close();
}
