// CLI: write a Tier 1 fixture JSON from a live URL.
// Usage: pnpm --filter @robot/scraper exec tsx src/capture-fixture.ts <url> <label> [detail|listing]
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

// Load repo-root .env so DATABASE_URL etc. resolve for the cache lookup.
try {
  const env = readFileSync('/Users/marko/Documents/robot-platform/.env', 'utf-8');
  for (const line of env.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    const k = t.slice(0, i);
    if (!process.env[k]) process.env[k] = t.slice(i + 1);
  }
} catch {}

const url = process.argv[2];
const label = process.argv[3];
const pageType = (process.argv[4] ?? 'detail') as 'detail' | 'listing';
if (!url || !label) {
  console.error('usage: capture-fixture <url> <label> [detail|listing]');
  process.exit(1);
}

const { PlaywrightBrowser } = await import('@robot/browser');
const { lookupDomainCache } = await import('./domain-cache.js');

const domain = new URL(url).hostname;
const browser = new PlaywrightBrowser();
await browser.launch({ headless: true });
let capture;
try {
  capture = await browser.capture(url, {
    waitUntil: 'networkidle',
    interceptNetworkRequests: true,
  });
} finally {
  await browser.close();
}

const cache = await lookupDomainCache(domain, pageType);

const fixture = {
  label,
  url,
  domain,
  pageType,
  capturedAt: new Date().toISOString(),
  html: capture.html,
  structuredData: capture.structuredData,
  // Keep only intercepted requests with a parsed JSON body — those are what cached API paths replay against.
  interceptedRequests: capture.interceptedRequests.filter((r) => r.responseBody && r.parsedJson),
  fieldPaths: cache?.fieldPaths ?? {},
  expected: {} as Record<string, unknown>,
};

const outDir = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__/corpus');
const out = join(outDir, `${label}.json`);
writeFileSync(out, JSON.stringify(fixture, null, 2));
console.log(`wrote ${out}`);
console.log('Next: open the file and fill in "expected" with the known-correct values for the fields you want to gate on.');
process.exit(0);
