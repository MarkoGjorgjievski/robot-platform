// CLI: extract every pending URL in a planned run, and watch it happen.
//
//   pnpm --filter @robot/api exec tsx src/crawl-execute.ts <runId>
//
// This SPENDS MONEY and makes real requests — one page load and, on a cold
// domain, one AI selector pass per URL. Check the work list first.

import { eq } from 'drizzle-orm';
import { db, runItems } from '@robot/db';
import { createCallerFactory } from './trpc.js';
import { appRouter } from './routers/index.js';

const runId = process.argv[2];
if (!runId) {
  console.error('usage: crawl-execute <runId>');
  process.exit(1);
}

const caller = createCallerFactory(appRouter)({ db });

const before = await caller.crawl.status({ runId });
console.log(`\nRun ${runId} — ${before.status}`);
console.log(`  pending ${before.counts.pending} · done ${before.counts.done} · failed ${before.counts.failed}\n`);

await caller.crawl.execute({ runId });

const ACTIVE = new Set(['extracting', 'cancelling']);
let status = before.status;
for (let tick = 0; tick < 240; tick++) {
  await new Promise((resolve) => setTimeout(resolve, 5000));
  const now = await caller.crawl.status({ runId });
  status = now.status;
  console.log(`  [${status}] done ${now.counts.done}/${now.counts.detail} · failed ${now.counts.failed}`);
  if (!ACTIVE.has(status)) break;
}

const items = await db.query.runItems.findMany({
  where: eq(runItems.runId, runId),
  columns: { kind: true, url: true, status: true, error: true },
});
console.log(`\nFinal: ${status}`);
for (const item of items.filter((i) => i.kind === 'detail')) {
  console.log(`  [${item.status}] ${item.url.slice(0, 90)}${item.error ? ` — ${item.error.slice(0, 60)}` : ''}`);
}
process.exit(0);
