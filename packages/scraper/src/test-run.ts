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

import { ScraperPipeline } from './pipeline.js';

const url = process.argv[2];
if (!url) {
  console.error('Usage: tsx src/test-run.ts <url>');
  console.error('  Set ANTHROPIC_API_KEY for Claude (recommended)');
  console.error('  Or run ollama serve for local LLM');
  process.exit(1);
}

// Auto-detect provider
const provider = process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'ollama';
console.log(`\n--- Scraper Pipeline Test ---`);
console.log(`URL: ${url}`);
console.log(`Provider: ${provider}\n`);

const pipeline = new ScraperPipeline({
  browserOptions: { headless: true },
  captureOptions: { waitUntil: 'networkidle' },
  provider,
});

try {
  const result = await pipeline.run(url);

  console.log(`\n--- Schema Discovery ---`);
  console.log(`Page type: ${result.schema.page_type}`);
  console.log(`Description: ${result.schema.description}`);
  console.log(`Fields:`);
  for (const field of result.schema.fields) {
    console.log(`  - ${field.name} (${field.type})${field.required ? ' *required' : ''}: ${field.description}`);
    if (field.example_value) console.log(`    example: ${field.example_value}`);
  }

  console.log(`\n--- Extraction Plan ---`);
  console.log(`Row XPath: ${result.plan.row_xpath}`);
  for (const f of result.plan.fields) {
    console.log(`  - ${f.name}: ${f.xpath} [${f.attribute}] (${f.transform})`);
  }

  console.log(`\n--- Extracted Data (${result.data.length} rows) ---`);
  for (const row of result.data.slice(0, 5)) {
    console.log(JSON.stringify(row, null, 2));
  }
  if (result.data.length > 5) {
    console.log(`  ... and ${result.data.length - 5} more rows`);
  }

  console.log(`\n--- Validation ---`);
  console.log(`Complete: ${result.validation.is_complete}`);
  console.log(`Confidence: ${Math.round(result.validation.confidence * 100)}%`);
  if (result.validation.missing_items.length > 0) {
    console.log(`Missing: ${result.validation.missing_items.join(', ')}`);
  }
  if (result.validation.incorrect_values.length > 0) {
    console.log(`Incorrect values:`);
    for (const iv of result.validation.incorrect_values) {
      console.log(`  - ${iv.field}: extracted="${iv.extracted}" actual="${iv.actual}"`);
    }
  }
} catch (err) {
  console.error('Pipeline failed:', err);
} finally {
  await pipeline.close();
}
