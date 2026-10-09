// CLI: judge a completed run's stored values against the live pages.
//
//   pnpm --filter @robot/api exec tsx src/judge-run.ts <runId> [--max-items N] [--max-usd X] [--fields a,b,c] [--tiles N] [--dry-run]
//
// A run fills cells; nothing says the values are right (campaign 2026-10-08:
// B&N's certified price and ISBN read another format's, at "100% confidence").
// This re-captures each item's URL — a run stores no screenshot — and asks the
// Tier 2 judge (@robot/agent judgeFieldExtraction) about every non-empty value,
// one browser for the whole run, items in stored order, sequentially with a 2 s
// pause between pages. Writes docs/testing/results/<stamp>-judge-run-<site>.md.
//
// A value is judged against screenshot tile 1; while the verdict is
// not-on-page and more tiles exist (up to --tiles, default 3), it is judged
// again on the next tile. URL values (image/url fields, absolute links) are
// marked unverifiable locally, without a call.
//
// SPENDS MONEY (~$0.0086 per judge call, plus one explain call per wrong
// value) unless --dry-run. Stops before the item whose estimate would take
// spend past --max-usd (default $5); stops after 3 items in a row where the
// page showed nothing (bot wall?); Ctrl+C stops after the current value and
// still writes the report. Writes nothing to the database.
//
// @robot/db loads the repo-root .env on import (DATABASE_URL, ANTHROPIC_API_KEY).

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { asc, eq } from 'drizzle-orm';
import { db, runs, runItems, extractions } from '@robot/db';
import { contractFields } from './contract.js';
import {
  JUDGE_USD_PER_FIELD, RETRY_ALLOWANCE, estimateItemUsd, isEmptyValue, isUrlValued, pageShowsNothing, renderReport, shouldStop, summaryTable,
  type AbortReason, type Cell, type FieldDef, type ItemResult, type ReportInput,
} from './judge-run-report.js';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const POLITENESS_MS = 2_000;
const NOTHING_STREAK_LIMIT = 3;
const ERROR_STREAK_LIMIT = 10;

function usage(msg?: string): never {
  if (msg) console.error(msg);
  console.error('usage: judge-run <runId> [--max-items N] [--max-usd X] [--fields a,b,c] [--tiles N] [--dry-run]');
  process.exit(1);
}

// ─── Arguments ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
let runId: string | undefined;
let maxItems = Infinity;
let maxUsd = 5;
let tiles = 3;
let fieldFilter: string[] | null = null;
let dryRun = false;
for (let i = 0; i < args.length; i++) {
  const a = args[i]!;
  if (a === '--dry-run') dryRun = true;
  else if (a === '--max-items') { maxItems = Number(args[++i]); if (!Number.isInteger(maxItems) || maxItems < 1) usage('--max-items needs a positive integer'); }
  else if (a === '--max-usd') { maxUsd = Number(args[++i]); if (!Number.isFinite(maxUsd) || maxUsd <= 0) usage('--max-usd needs a positive number'); }
  else if (a === '--tiles') { tiles = Number(args[++i]); if (!Number.isInteger(tiles) || tiles < 1) usage('--tiles needs a positive integer'); }
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
let fields: FieldDef[] = contract.map((f) => ({ key: f.key, name: f.name, type: f.type }));
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

/** The item's first stored row (on a row-per-variant run, the default variant); further rows are not judged. */
const firstRow = (data: unknown) => ((data as Array<Record<string, unknown>>)[0] ?? {});
const isVariantList = (v: unknown) => Array.isArray(v) && v.some((x) => x !== null && typeof x === 'object');
/** Fields whose value needs a judge call: non-empty, not a variant list, not URL-valued. */
const toCall = (row: Record<string, unknown>) =>
  fields.filter((f) => !isEmptyValue(row[f.key]) && !isVariantList(row[f.key]) && !isUrlValued(f.type, row[f.key]));
const urlValued = (row: Record<string, unknown>) =>
  fields.filter((f) => !isEmptyValue(row[f.key]) && !isVariantList(row[f.key]) && isUrlValued(f.type, row[f.key]));

const site = run.source.name;
const project = run.source.dataset?.project?.name ?? '(no project)';
const plannedCalls = queue.reduce((n, r) => n + toCall(firstRow(r.data)).length, 0);
const plannedLocal = queue.reduce((n, r) => n + urlValued(firstRow(r.data)).length, 0);

console.log(`[judge-run] run ${run.id} — ${site} (project ${project})`);
console.log(`[judge-run] ${details.length} detail items, ${withData.length} with stored values${details.length > withData.length ? ` (${details.length - withData.length} without — not judged)` : ''}; judging ${queue.length}`);
console.log(`[judge-run] fields: ${fields.map((f) => f.key).join(', ')}; up to ${tiles} screenshot tile(s) per value`);
console.log(`[judge-run] ${plannedCalls} values to judge (+${plannedLocal} URL values marked unverifiable for free) — estimate ~$${(plannedCalls * JUDGE_USD_PER_FIELD).toFixed(2)} at $${JUDGE_USD_PER_FIELD}/call on tile 1, ~$${(plannedCalls * JUDGE_USD_PER_FIELD * (1 + RETRY_ALLOWANCE)).toFixed(2)} with the ${RETRY_ALLOWANCE * 100}% retry/explain allowance; cap $${maxUsd.toFixed(2)}`);

if (dryRun) {
  for (const [i, r] of queue.entries()) {
    const row = firstRow(r.data);
    const j = toCall(row).map((f) => f.key);
    const u = urlValued(row).map((f) => f.key);
    const empty = fields.filter((f) => isEmptyValue(row[f.key])).map((f) => f.key);
    console.log(`  ${String(i + 1).padStart(3)}. ${r.url}\n       judge: ${j.join(', ') || '(none)'}${u.length ? ` | url (local): ${u.join(', ')}` : ''}${empty.length ? ` | empty: ${empty.join(', ')}` : ''}`);
  }
  console.log('[judge-run] --dry-run: nothing captured, nothing judged, no report written.');
  process.exit(0);
}

// ─── Judge ───────────────────────────────────────────────────────────────────

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) { console.error('ANTHROPIC_API_KEY required (or pass --dry-run)'); process.exit(1); }

const { judgeFieldExtraction, explainWrongValue, snapshotUsage, diffUsage, estimateCostUsd, formatUsage, resetUsage } = await import('@robot/agent');
const { PlaywrightBrowser, TILE_HEIGHT, verdictSentence } = await import('@robot/browser');

// Ctrl+C: finish the current call, then fall through to the report.
// The browser is launched with handleSIGINT: false — Playwright's default
// handler would close it and exit(130) on the first Ctrl+C, before any report.
let interrupted = false;
const onSigint = () => {
  if (interrupted) process.exit(130);
  interrupted = true;
  console.log('\n[judge-run] interrupted — stopping after the current call and writing the report (Ctrl+C again to quit now).');
};
process.on('SIGINT', onSigint);

resetUsage();
const start = snapshotUsage();
const spent = () => estimateCostUsd(diffUsage(start, snapshotUsage())).usd;
const startedAt = new Date();
const results: ItemResult[] = [];
let stoppedByCap = false;
let abortReason: AbortReason | undefined;
let errorStreak = 0;
let nothingStreak = 0;

const browser = new PlaywrightBrowser();
try {
  await browser.launch({ headless: true, handleSIGINT: false });
  for (const [i, r] of queue.entries()) {
    if (interrupted) { abortReason = 'interrupted'; break; }
    const row = firstRow(r.data);
    // Stop before an item whose estimate could take spend over the cap. The
    // current item always finishes, so the overshoot is bounded by one item's
    // calls (up to tiles x values + explains), not by its tile-1 estimate.
    if (shouldStop(spent() + estimateItemUsd(toCall(row).length), maxUsd)) { stoppedByCap = true; break; }
    if (i > 0) await new Promise((res) => setTimeout(res, POLITENESS_MS));

    console.log(`[judge-run] ${i + 1}/${queue.length} ${r.url}`);
    let shots: Buffer[];
    let title: string;
    try {
      const capture = await browser.capture(r.url, { waitUntil: 'load', maxTiles: tiles });
      // A wall, a 404 or an empty page is not the product page: judging it
      // spends credit (~$0.0086 a call) to read every value as "wrong".
      if (capture.verdict.kind !== 'ok') {
        const msg = verdictSentence(capture.verdict, r.url);
        console.warn(`  not judged: ${msg}`);
        results.push({ url: r.url, cells: [], captureError: msg });
        continue;
      }
      shots = capture.screenshotTiles.length > 0 ? capture.screenshotTiles : [capture.screenshot];
      title = capture.title;
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
      if (isUrlValued(f.type, value)) { cells.push({ field: f.key, value, verdict: 'unverifiable', local: true }); continue; }
      if (interrupted) { cells.push({ field: f.key, value, verdict: 'not-judged' }); continue; }
      // Tile 1 first; a further tile only while the value is not on the page so far.
      let cell: Cell = { field: f.key, value, verdict: 'error' };
      for (const [t, shot] of shots.entries()) {
        const verdict = await judgeFieldExtraction({ screenshot: shot, field: f.name, value, apiKey });
        cell = { field: f.key, value, verdict, tile: t + 1 };
        if (verdict !== 'not-on-page' || interrupted) break;
      }
      if (cell.verdict === 'wrong') {
        cell.judgeReading = (await explainWrongValue({ screenshot: shots[cell.tile! - 1]!, field: f.name, value, apiKey })) ?? undefined;
      }
      cells.push(cell);
      console.log(`  [${cell.verdict} @tile ${cell.tile}] ${f.key}: ${String(JSON.stringify(value)).slice(0, 80)}`);
      // judgeFieldExtraction folds an unavailable API (no credit, bad key) into
      // 'error'; a long unbroken run of them means every remaining call fails too.
      errorStreak = cell.verdict === 'error' ? errorStreak + 1 : 0;
      if (errorStreak >= ERROR_STREAK_LIMIT) break;
    }
    results.push({ url: r.url, title, cells });

    if (errorStreak >= ERROR_STREAK_LIMIT) { abortReason = 'judge-errors'; break; }
    if (interrupted) { abortReason = 'interrupted'; break; }
    // A bot wall or challenge page captures cleanly and shows none of the values.
    nothingStreak = pageShowsNothing(cells) ? nothingStreak + 1 : 0;
    if (nothingStreak >= NOTHING_STREAK_LIMIT) { abortReason = 'pages-show-nothing'; break; }
  }
} finally {
  process.off('SIGINT', onSigint);
  await browser.close().catch((err) => console.error('[judge-run] browser.close() failed:', err));
}

// ─── Report ──────────────────────────────────────────────────────────────────

const judgeUsage = diffUsage(start, snapshotUsage());
const costUsd = estimateCostUsd(judgeUsage).usd;
const limitedBy: ReportInput['limitedBy'] = abortReason ? 'abort'
  : stoppedByCap ? 'cap'
  : queue.length < withData.length ? '--max-items'
  : undefined;
const report = renderReport({
  runId: run.id, site, project,
  when: startedAt.toISOString(),
  durationMs: Date.now() - startedAt.getTime(),
  fields, items: results,
  itemsInRun: details.length, itemsWithValues: withData.length, limitedBy,
  tiles, tileHeight: TILE_HEIGHT,
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
process.exit(abortReason && abortReason !== 'interrupted' ? 2 : 0);
