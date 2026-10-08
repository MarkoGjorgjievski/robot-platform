// CLI: judge a completed run's stored values against the live pages.
//
//   pnpm --filter @robot/api exec tsx src/judge-run.ts <runId> [--max-items N] [--max-usd X] [--fields a,b,c] [--dry-run]
//
// A run fills cells; nothing says the values are right (campaign 2026-10-08:
// B&N's certified price and ISBN read another format's, at "100% confidence").
// This re-captures each item's URL — a run stores no screenshot — and asks the
// Tier 2 judge (@robot/agent judgeFieldExtraction) about every non-empty value,
// one browser for the whole run, items in stored order, sequentially with a 2 s
// pause between pages. Writes docs/testing/results/<stamp>-judge-run-<site>.md.
//
// SPENDS MONEY (~$0.0086 per judged value, plus one extra call per wrong value
// to say what the page shows) unless --dry-run. Stops before the item that
// would take spend past --max-usd (default $5). Writes nothing to the database.
//
// @robot/db loads the repo-root .env on import (DATABASE_URL, ANTHROPIC_API_KEY).

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { asc, eq } from 'drizzle-orm';
import { db, runs, runItems, extractions } from '@robot/db';
import { contractFields } from './contract.js';
import {
  JUDGE_USD_PER_FIELD, isEmptyValue, renderReport, shouldStop, summaryTable,
  type Cell, type FieldDef, type ItemResult,
} from './judge-run-report.js';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const POLITENESS_MS = 2_000;

function usage(msg?: string): never {
  if (msg) console.error(msg);
  console.error('usage: judge-run <runId> [--max-items N] [--max-usd X] [--fields a,b,c] [--dry-run]');
  process.exit(1);
}

// ─── Arguments ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
let runId: string | undefined;
let maxItems = Infinity;
let maxUsd = 5;
let fieldFilter: string[] | null = null;
let dryRun = false;
for (let i = 0; i < args.length; i++) {
  const a = args[i]!;
  if (a === '--dry-run') dryRun = true;
  else if (a === '--max-items') { maxItems = Number(args[++i]); if (!Number.isInteger(maxItems) || maxItems < 1) usage('--max-items needs a positive integer'); }
  else if (a === '--max-usd') { maxUsd = Number(args[++i]); if (!Number.isFinite(maxUsd) || maxUsd <= 0) usage('--max-usd needs a positive number'); }
  else if (a === '--fields') { fieldFilter = (args[++i] ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean); if (fieldFilter.length === 0) usage('--fields needs a,b,c'); }
  else if (a.startsWith('-')) usage(`unknown option ${a}`);
  else if (!runId) runId = a;
  else usage(`unexpected argument ${a}`);
}
if (!runId) usage();

// ─── Load the run ────────────────────────────────────────────────────────────

const run = await db.query.runs.findFirst({
  where: eq(runs.id, runId),
  columns: { id: true, status: true },
  with: {
    source: {
      columns: { name: true, slug: true, schemaDefinition: true },
      with: { dataset: { columns: { schema: true }, with: { project: { columns: { name: true } } } } },
    },
  },
});
if (!run) usage(`Run not found: ${runId}`);
if (run.status !== 'completed') {
  console.error(`Run ${runId} is '${run.status}', not 'completed' — refusing to judge a run that has not finished.`);
  process.exit(1);
}
if (!run.source) usage(`Run ${runId} has no website`);

// The project's field list (the contract) is the authority on names; a source
// that predates the contract falls back to its own schema definition.
let contract = contractFields(run.source.dataset?.schema);
if (contract.length === 0) contract = contractFields(run.source.schemaDefinition);
if (contract.length === 0) usage(`Run ${runId}'s project has no field definitions`);
let fields: FieldDef[] = contract.map((f) => ({ key: f.key, name: f.name }));
if (fieldFilter) {
  const unknown = fieldFilter.filter((n) => !fields.some((f) => f.key.toLowerCase() === n || f.name.toLowerCase() === n));
  if (unknown.length > 0) usage(`Unknown field(s): ${unknown.join(', ')}. Fields: ${fields.map((f) => f.key).join(', ')}`);
  fields = fields.filter((f) => fieldFilter!.includes(f.key.toLowerCase()) || fieldFilter!.includes(f.name.toLowerCase()));
}

const rows = await db
  .select({ id: runItems.id, url: runItems.url, kind: runItems.kind, status: runItems.status, data: extractions.data })
  .from(runItems)
  .leftJoin(extractions, eq(extractions.id, runItems.extractionId))
  .where(eq(runItems.runId, runId))
  .orderBy(asc(runItems.createdAt), asc(runItems.id));
const details = rows.filter((r) => r.kind === 'detail');
const withData = details.filter((r) => Array.isArray(r.data) && r.data.length > 0);
const queue = withData.slice(0, maxItems);

/** The item's product row: the first row of its extraction (variant rows, if any, are not judged). */
const firstRow = (data: unknown) => ((data as Array<Record<string, unknown>>)[0] ?? {});
const isVariantList = (v: unknown) => Array.isArray(v) && v.some((x) => x !== null && typeof x === 'object');
const judgeable = (row: Record<string, unknown>) => fields.filter((f) => !isEmptyValue(row[f.key]) && !isVariantList(row[f.key]));

const site = run.source.name;
const project = run.source.dataset?.project?.name ?? '(no project)';
const plannedJudgements = queue.reduce((n, r) => n + judgeable(firstRow(r.data)).length, 0);

console.log(`[judge-run] run ${run.id} — ${site} (project ${project})`);
console.log(`[judge-run] ${details.length} detail items, ${withData.length} with stored values${details.length > withData.length ? ` (${details.length - withData.length} without — not judged)` : ''}; judging ${queue.length}`);
console.log(`[judge-run] fields: ${fields.map((f) => f.key).join(', ')}`);
console.log(`[judge-run] ${plannedJudgements} non-empty values to judge — max cost ~$${(plannedJudgements * JUDGE_USD_PER_FIELD).toFixed(2)} at $${JUDGE_USD_PER_FIELD}/value (plus one explain call per wrong value); cap $${maxUsd.toFixed(2)}`);

if (dryRun) {
  for (const [i, r] of queue.entries()) {
    const row = firstRow(r.data);
    const j = judgeable(row).map((f) => f.key);
    const empty = fields.filter((f) => isEmptyValue(row[f.key])).map((f) => f.key);
    console.log(`  ${String(i + 1).padStart(3)}. ${r.url}\n       judge: ${j.join(', ') || '(none)'}${empty.length ? ` | empty: ${empty.join(', ')}` : ''}`);
  }
  console.log('[judge-run] --dry-run: nothing captured, nothing judged, no report written.');
  process.exit(0);
}

// ─── Judge ───────────────────────────────────────────────────────────────────

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) { console.error('ANTHROPIC_API_KEY required (or pass --dry-run)'); process.exit(1); }

const { judgeFieldExtraction, explainWrongValue, snapshotUsage, diffUsage, estimateCostUsd, formatUsage, resetUsage } = await import('@robot/agent');
const { PlaywrightBrowser } = await import('@robot/browser');

resetUsage();
const start = snapshotUsage();
const spent = () => estimateCostUsd(diffUsage(start, snapshotUsage())).usd;
const startedAt = new Date();
const results: ItemResult[] = [];
let stoppedByCap = false;
let abortReason: string | undefined;
let consecutiveErrors = 0;

const browser = new PlaywrightBrowser();
try {
  await browser.launch({ headless: true });
  for (const [i, r] of queue.entries()) {
    const row = firstRow(r.data);
    const toJudge = judgeable(row);
    // Stop before an item whose judging could take spend over the cap; the
    // current item always finishes.
    if (shouldStop(spent() + toJudge.length * JUDGE_USD_PER_FIELD, maxUsd)) { stoppedByCap = true; break; }
    if (i > 0) await new Promise((res) => setTimeout(res, POLITENESS_MS));

    console.log(`[judge-run] ${i + 1}/${queue.length} ${r.url}`);
    let screenshot: Buffer;
    try {
      const capture = await browser.capture(r.url, { waitUntil: 'load', maxTiles: 1 });
      screenshot = capture.screenshot;
    } catch (err) {
      const msg = (err instanceof Error ? err.message : String(err)).split('\n')[0]!;
      console.warn(`  capture failed: ${msg}`);
      results.push({ url: r.url, cells: [], captureError: msg });
      continue;
    }

    const cells: Cell[] = [];
    for (const f of fields) {
      const value = row[f.key];
      if (isEmptyValue(value)) { cells.push({ field: f.key, value, verdict: 'empty' }); continue; }
      if (isVariantList(value)) { cells.push({ field: f.key, value, verdict: 'skipped' }); continue; }
      const verdict = await judgeFieldExtraction({ screenshot, field: f.key, value, apiKey });
      const cell: Cell = { field: f.key, value, verdict };
      if (verdict === 'wrong') cell.pageShows = (await explainWrongValue({ screenshot, field: f.key, value, apiKey })) ?? undefined;
      cells.push(cell);
      console.log(`  [${verdict}] ${f.key}: ${String(JSON.stringify(value)).slice(0, 80)}`);
      // judgeFieldExtraction folds an unavailable API (no credit, bad key) into
      // 'error'; a long unbroken run of them means every remaining call fails too.
      consecutiveErrors = verdict === 'error' ? consecutiveErrors + 1 : 0;
    }
    results.push({ url: r.url, cells });
    if (consecutiveErrors >= 10) { abortReason = `the judge returned ${consecutiveErrors} errors in a row (API unavailable?).`; break; }
  }
} finally {
  await browser.close().catch((err) => console.error('[judge-run] browser.close() failed:', err));
}

// ─── Report ──────────────────────────────────────────────────────────────────

const judgeUsage = diffUsage(start, snapshotUsage());
const costUsd = estimateCostUsd(judgeUsage).usd;
const report = renderReport({
  runId: run.id, site, project,
  when: startedAt.toISOString(),
  durationMs: Date.now() - startedAt.getTime(),
  fields, items: results, totalItems: withData.length,
  costUsd, usageText: formatUsage(judgeUsage), maxUsd, stoppedByCap, abortReason,
});

const stamp = startedAt.toISOString().replace(/[:.]/g, '-').slice(0, 16);
const siteSlug = (run.source.slug || site).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const outDir = join(repoRoot, 'docs', 'testing', 'results');
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, `${stamp}-judge-run-${siteSlug}.md`);
writeFileSync(outPath, report);

console.log('');
console.log(summaryTable(fields, results).join('\n'));
console.log('');
if (stoppedByCap) console.log(`[judge-run] STOPPED at the $${maxUsd.toFixed(2)} cap after ${results.length}/${withData.length} items.`);
if (abortReason) console.log(`[judge-run] ABORTED: ${abortReason}`);
console.log(`[judge-run] judge cost $${costUsd.toFixed(4)}; wrote ${outPath}`);
process.exit(abortReason ? 2 : 0);
