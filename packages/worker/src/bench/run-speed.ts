// The run-speed benchmark (spec 2026-10-23 run speed §5). A throwaway database, its own queue, a local fixture shop and
// an in-process worker: nothing touches Marko's database, nothing is paid. Writes <out>/<label>.json and prints a summary.
//   cd packages/worker && npx tsx src/bench/run-speed.ts --label before --sites 2 --pages 50 --runs 1 --browsers 3
import { randomUUID } from 'node:crypto';
import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';
import { parseArgs } from 'node:util';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = join(here, '..', '..', '..', '..');
const { values: a } = parseArgs({ options: {
  label: { type: 'string' }, sites: { type: 'string', default: '2' }, pages: { type: 'string', default: '50' },
  runs: { type: 'string', default: '1' }, browsers: { type: 'string', default: '3' }, latency: { type: 'string', default: 'realistic' },
  out: { type: 'string', default: join(repo, 'docs', 'testing', 'results', '2026-10-23-run-speed') },
} });
if (!a.label) throw new Error('--label is required');
const SITES = Number(a.sites); const PAGES = Number(a.pages); const RUNS = Number(a.runs); const BROWSERS = Number(a.browsers);

try { loadEnvFile(join(repo, '.env')); } catch { /* no .env: the default URL below */ }
const { createBenchDatabase } = await import('./bench-db.js');
process.env.JOB_QUEUE = `bench-${randomUUID()}`;
process.env.ANTHROPIC_API_KEY = ''; process.env.JEV_SHADOW = ''; process.env.TYPESAFE_API_KEY = ''; process.env.WEBSITE_CHECKS = 'off';
const capturesDir = mkdtempSync(join(tmpdir(), 'bench-captures-'));
process.env.CAPTURES_DIR = capturesDir;

let exitCode = 0;
let close: (() => Promise<void>) | null = null;
let bench: Awaited<ReturnType<typeof createBenchDatabase>> | null = null;
try {
  // Inside the try (final review M4): a bench that fails from here on still reports and cleans up. A failed
  // migration drops its own database (bench-db.ts).
  bench = await createBenchDatabase(process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/robot_platform');
  // Before anything imports @robot/db: every row of this process goes to the throwaway database.
  process.env.DATABASE_URL = bench.url;
  const { startFixtureShop, REALISTIC, INSTANT } = await import('./fixture-shop.js');
  const shop = await startFixtureShop({ sites: SITES, latency: a.latency === 'instant' ? INSTANT : REALISTIC });
  close = shop.close;
  const { setBrowserOwner } = await import('@robot/browser');
  setBrowserOwner(String(process.pid));
  const { closeOrphanBrowsers } = await import('../orphans.js');
  await closeOrphanBrowsers();
  const { seedBenchRuns } = await import('./seed.js');
  const seeded = await seedBenchRuns(shop, PAGES);
  const { db } = await import('@robot/db');
  const { startRunJob } = await import('@robot/api/jobs');
  for (const s of seeded) await startRunJob(db, { runId: s.runId });
  const { readWorkerConfig } = await import('../config.js');
  const { startWorker } = await import('../worker.js');
  const { startMemorySampler, collectRun, waitForRuns, stats } = await import('./measure.js');
  const sampler = startMemorySampler(process.pid);
  const t0 = Date.now();
  const worker = await startWorker({ ...readWorkerConfig({ JOB_QUEUE: process.env.JOB_QUEUE, WORKER_RUNS: String(RUNS), WORKER_BROWSERS: String(BROWSERS) }), websiteChecks: false });
  try {
    await waitForRuns(seeded.map((s) => s.runId), SITES * PAGES * 30_000);
  } finally {
    await worker.stop();
  }
  const memory = await sampler.stop();
  if (worker.gate.open() !== 0) throw new Error(`bench: ${worker.gate.open()} browser(s) still open after stop`);
  const c = await collectRun(seeded, t0);
  const commit = execSync('git rev-parse --short HEAD', { cwd: repo }).toString().trim();
  const result = {
    label: a.label, commit, at: new Date().toISOString(),
    config: { sites: SITES, pages: PAGES, runs: RUNS, browsers: BROWSERS, latency: a.latency },
    wallMs: c.wallMs, per1000Ms: Math.round((c.wallMs * 1000) / Math.max(1, SITES * PAGES)),
    done: c.done, failed: c.failed, cycleMs: stats(c.cyclesMs), captureMs: stats(c.captureMs), modes: c.modes,
    memory, truth: { checked: c.truth.checked, mismatches: c.truth.mismatches }, values: c.values,
  };
  mkdirSync(a.out!, { recursive: true });
  writeFileSync(join(a.out!, `${a.label}.json`), JSON.stringify(result, null, 1));
  console.log(`[bench] ${a.label} @ ${commit}: ${SITES}×${PAGES} pages, runs ${RUNS}, browsers ${BROWSERS}`);
  console.log(`[bench] wall ${(c.wallMs / 1000).toFixed(1)} s (${(result.per1000Ms / 60_000).toFixed(1)} min per 1,000 pages); done ${c.done}, failed ${c.failed}`);
  console.log(`[bench] per item cycle median ${result.cycleMs.median} ms, p90 ${result.cycleMs.p90} ms; capture median ${result.captureMs.median} ms`);
  console.log(`[bench] modes ${JSON.stringify(c.modes)}; memory peak chromium ${memory.chromiumPeakMb} MB, node ${memory.nodePeakMb} MB`);
  console.log(`[bench] truth: ${c.truth.checked} cells, ${c.truth.mismatches.length} mismatch(es)`);
  if (c.truth.mismatches.length > 0 || c.failed > 0) { exitCode = 1; console.log(JSON.stringify(c.truth.mismatches.slice(0, 20), null, 1)); }
} catch (err) {
  console.error('[bench] failed:', err);
  exitCode = 1;
} finally {
  await close?.();
  rmSync(capturesDir, { recursive: true, force: true });
  const made = bench;
  if (made) await made.drop().catch((err) => { console.error(`[bench] could not drop ${made.name}:`, err); exitCode = 1; });
}
process.exit(exitCode);
