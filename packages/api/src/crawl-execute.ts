// CLI: extract every pending URL in a planned run, and watch it happen.
//
//   pnpm --filter @robot/api exec tsx src/crawl-execute.ts <runId>
//
// This SPENDS MONEY and makes real requests — one page load and, on a cold
// domain, one AI selector pass per URL. Check the work list first.
//
// An operator script: it addresses the run by id and calls the same functions
// `crawl.execute` does (`requireCertification`, `requeueStaleRunningItems`,
// `markRunExtracting`, `startExecution`) directly against the database. The
// customer API needs a signed-in session and works in that session's org
// only, so this script does not go through it.

import { eq } from 'drizzle-orm';
import { db, runs, runItems } from '@robot/db';
import { describeCrawlExecuteOutcome } from './crawl-execute-outcome.js';
import { requireCertification } from './crawl/require-certification.js';
import { requeueStaleRunningItems } from './crawl/requeue-stale.js';
import { markRunExtracting } from './crawl/mark-extracting.js';
import { startExecution } from './crawl/start-execution.js';
import { effectiveSchema } from './crawl/effective-schema.js';

const runId = process.argv[2];
if (!runId) {
  console.error('usage: crawl-execute <runId>');
  process.exit(1);
}

/** The run's status and its detail items' counts — what `crawl.status` reports. */
async function readStatus() {
  const run = await db.query.runs.findFirst({ where: eq(runs.id, runId!), columns: { status: true } });
  if (!run) throw new Error(`Run ${runId} not found`);
  const rows = await db.query.runItems.findMany({ where: eq(runItems.runId, runId!), columns: { kind: true, status: true } });
  const counts = { pending: 0, running: 0, done: 0, failed: 0, detail: 0 };
  for (const row of rows) {
    if (row.kind === 'listing') continue;
    counts.detail++;
    if (row.status in counts) counts[row.status as 'pending' | 'running' | 'done' | 'failed']++;
  }
  return { status: run.status, counts };
}

const run = await db.query.runs.findFirst({
  where: eq(runs.id, runId),
  with: {
    source: {
      columns: { id: true, datasetId: true, selectorsJson: true, schemaDefinition: true },
      with: { dataset: { columns: { schema: true } } },
    },
  },
});
if (!run) {
  console.error(`Run not found: ${runId}`);
  process.exit(1);
}
if (!run.source) {
  console.error(`Run ${runId} has no Source`);
  process.exit(1);
}

const before = await readStatus();
console.log(`\nRun ${runId} — ${before.status}`);
console.log(`  pending ${before.counts.pending} · done ${before.counts.done} · failed ${before.counts.failed}\n`);

// The same sequence `crawl.execute` runs, in the same order.
await requireCertification(db, run.source.id);
await requeueStaleRunningItems(db, runId);
await markRunExtracting(db, runId);
void startExecution(
  runId,
  run.source.id,
  effectiveSchema(run.source),
  undefined,
  run.parentRunId ? { mergeToParent: true } : undefined,
).catch((err) => {
  console.error(`[crawl] startExecution rejected outside its own guards for run ${runId}:`, err);
});

const ACTIVE = new Set(['extracting', 'cancelling']);
let status = before.status;
let hitPollCap = true;
for (let tick = 0; tick < 240; tick++) {
  await new Promise((resolve) => setTimeout(resolve, 5000));
  const now = await readStatus();
  status = now.status;
  console.log(`  [${status}] done ${now.counts.done}/${now.counts.detail} · failed ${now.counts.failed}`);
  if (!ACTIVE.has(status)) { hitPollCap = false; break; }
}

const items = await db.query.runItems.findMany({
  where: eq(runItems.runId, runId),
  columns: { kind: true, url: true, status: true, error: true },
});
console.log(`\nFinal: ${status}`);
for (const item of items.filter((i) => i.kind === 'detail')) {
  console.log(`  [${item.status}] ${item.url.slice(0, 90)}${item.error ? ` — ${item.error.slice(0, 60)}` : ''}`);
}

const outcome = describeCrawlExecuteOutcome(status, hitPollCap);
console.log(`\n${outcome.message}`);
process.exit(outcome.exitCode);
