// CLI: plan a crawl for a Source and print the work list it produced.
//
//   pnpm --filter @robot/api exec tsx src/crawl-plan.ts <sourceId|sourceSlug>
//
// Phase 1 only — this fetches listing pages and enumerates detail URLs, but
// extracts no detail page and spends nothing per item. Run it before phase 2
// to see the fan-out a Source will actually produce.
//
// An operator script: it addresses the Source by id or slug and calls the
// same functions `crawl.plan` does (`requireCertification`, `planSource`)
// directly against the database. The customer API needs a signed-in session
// and works in that session's org only, so this script does not go through it.
//
// @robot/db loads the repo-root .env on import, so DATABASE_URL and
// ANTHROPIC_API_KEY resolve without exporting anything in the shell.

import { eq } from 'drizzle-orm';
import { db, sources, runItems } from '@robot/db';
import { planSource } from './crawl/plan-source.js';
import { requireCertification } from './crawl/require-certification.js';

const arg = process.argv[2];
if (!arg) {
  console.error('usage: crawl-plan <sourceId|sourceSlug>');
  process.exit(1);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const source = await db.query.sources.findFirst({
  where: UUID_RE.test(arg) ? eq(sources.id, arg) : eq(sources.slug, arg),
  columns: { id: true, name: true, slug: true, listingMode: true, budget: true },
});
if (!source) {
  console.error(`Source not found: ${arg}`);
  process.exit(1);
}

console.log(`\nPlanning ${source.name} (${source.slug})`);
console.log(`  mode:   ${source.listingMode}`);
console.log(`  budget: ${JSON.stringify(source.budget)}\n`);

// A full plan spends against the certified paths, so it is gated exactly as
// `crawl.plan` gates it.
await requireCertification(db, source.id);
const startedAt = Date.now();
const result = await planSource(db, source.id, { probe: false });
const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);

console.log(`Run ${result.runId} — planned in ${elapsed}s`);
console.log(`  detail items:  ${result.itemCount}`);
console.log(`  listing pages: ${result.listingPages}`);
console.log(`  domain cache:  ${result.cacheWarm ? 'warm' : 'cold'}`);
for (const input of result.inputs) {
  console.log(`  input ${input.inputIndex}: ${input.status} (${input.itemCount} items)`);
}
for (const warning of result.warnings) console.log(`  ! ${warning}`);
for (const error of result.errors) console.log(`  x input ${error.inputIndex}: ${error.message}`);

const items = await db.query.runItems.findMany({
  where: eq(runItems.runId, result.runId),
  columns: { kind: true, url: true, status: true, pageNumber: true, listingValues: true },
});
console.log(`\nWork list (${items.length} rows):`);
for (const item of items.slice(0, 20)) {
  const listing = JSON.stringify(item.listingValues);
  console.log(`  [${item.kind}/${item.status}] p${item.pageNumber ?? '-'} ${item.url}`);
  if (item.kind === 'detail' && listing !== '{}') console.log(`      listing values: ${listing}`);
}
if (items.length > 20) console.log(`  ... and ${items.length - 20} more`);

process.exit(0);
