// The recurring-extraction live check (spec 2026-10-24 §5, the queue item's "done when"). Free, local, keyless: a
// throwaway database, the run-speed fixture shop, a local webhook receiver, the api-server on its own port (it
// serves the signed links; it never starts a browser) and an in-process worker. One certified fixture website gets
// a schedule due within two minutes and a webhook to the receiver; the check waits for the run to start by itself,
// finish, write its three files and post once, then downloads the three links and compares them with the run.
//   cd packages/worker && npx tsx src/live-recurring.ts
import { createHmac, randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = join(here, '..', '..', '..');
const API_PORT = 4310;
const OUT = join(repo, 'docs', 'testing', 'results', '2026-10-24-recurring');
try { loadEnvFile(join(repo, '.env')); } catch { /* no .env: the default URL below */ }
const { createBenchDatabase } = await import('./bench/bench-db.js');
process.env.JOB_QUEUE = `live-recurring-${randomUUID()}`.slice(0, 64);
// Keyless, no website checks; the private-address lift exists only in this process and the api-server it starts.
Object.assign(process.env, {
  ANTHROPIC_API_KEY: '', JEV_SHADOW: '', TYPESAFE_API_KEY: '', WEBSITE_CHECKS: 'off', RECURRING_RUNS: 'on',
  WEBHOOK_ALLOW_PRIVATE: 'on', PUBLIC_API_URL: `http://127.0.0.1:${API_PORT}`,
});
const capturesDir = mkdtempSync(join(tmpdir(), 'live-recurring-captures-'));
process.env.CAPTURES_DIR = capturesDir;

const hits: Array<{ at: string; method: string; path: string; headers: IncomingHttpHeaders; body: string }> = [];
const receiver = createServer((req, res) => {
  let body = '';
  req.setEncoding('utf8');
  req.on('data', (c: string) => { body += c; });
  req.on('end', () => {
    hits.push({ at: new Date().toISOString(), method: req.method ?? '', path: req.url ?? '', headers: req.headers, body });
    res.writeHead(200).end('ok');
  });
});
await new Promise<void>((r) => receiver.listen(0, '127.0.0.1', r));
const hookUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/hook`;

async function until<T>(what: string, ms: number, probe: () => Promise<T | null | undefined | false>): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await probe();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

let exitCode = 0;
const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];
const check = (name: string, ok: boolean, detail?: string) => {
  checks.push({ name, ok, ...(detail ? { detail } : {}) });
  console.log(`[live-recurring] ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) exitCode = 1;
};
const ms = (a: Date | string | null | undefined, b: Date | string | null | undefined) => (a && b ? new Date(b).getTime() - new Date(a).getTime() : null);

let bench: Awaited<ReturnType<typeof createBenchDatabase>> | null = null;
let api: ChildProcess | null = null;
let closeShop: (() => Promise<void>) | null = null;
let stopWorker: (() => Promise<void>) | null = null;
try {
  bench = await createBenchDatabase(process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/robot_platform');
  // Before anything imports @robot/db: every row of this check goes to the throwaway database.
  process.env.DATABASE_URL = bench.url;
  if (await fetch(`http://127.0.0.1:${API_PORT}/healthz`).then(() => true).catch(() => false)) throw new Error(`port ${API_PORT} is already in use`);
  api = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: join(repo, 'packages', 'api-server'), env: { ...process.env, PORT: String(API_PORT) }, stdio: ['ignore', 'inherit', 'inherit'],
  });
  await until('the api-server', 60_000, () => fetch(`http://127.0.0.1:${API_PORT}/healthz`).then((r) => r.ok).catch(() => false));

  const { startFixtureShop, INSTANT } = await import('./bench/fixture-shop.js');
  const shop = await startFixtureShop({ sites: 1, latency: INSTANT });
  closeShop = shop.close;
  const { setBrowserOwner } = await import('@robot/browser');
  setBrowserOwner(String(process.pid));
  const { benchCaller, seedCertifiedWebsite } = await import('./bench/seed.js');
  const caller = await benchCaller();
  const { sourceId } = await seedCertifiedWebsite(caller, shop.sites[0]!);
  const due = new Date(Date.now() + 60_000);
  const time = `${String(due.getUTCHours()).padStart(2, '0')}:${String(due.getUTCMinutes()).padStart(2, '0')}`;
  const savedAt = new Date();
  await caller.sources.update({ id: sourceId, schedule: { days: [1, 2, 3, 4, 5, 6, 7], time, timeZone: 'UTC' }, webhookUrl: hookUrl });

  const { db, runs, runFiles, sources, webhookDeliveries } = await import('@robot/db');
  const { and, eq } = await import('drizzle-orm');
  const src = (await db.query.sources.findFirst({ where: eq(sources.id, sourceId), columns: { nextRunAt: true, webhookSecret: true } }))!;
  check('the schedule is due within two minutes', !!src.nextRunAt && src.nextRunAt.getTime() - Date.now() <= 125_000, `${time} UTC → ${src.nextRunAt?.toISOString()}`);

  const { readWorkerConfig } = await import('./config.js');
  const { startWorker } = await import('./worker.js');
  const worker = await startWorker({ ...readWorkerConfig({ JOB_QUEUE: process.env.JOB_QUEUE }), websiteChecks: false, recurringRuns: true });
  stopWorker = () => worker.stop();

  const run = await until('the scheduled run to start', 4 * 60_000, () => db.query.runs.findFirst({ where: and(eq(runs.sourceId, sourceId), eq(runs.inputLabel, 'scheduled')) }));
  check('a run started by itself, labelled scheduled', true, run.id);
  const done = await until('the run to finish', 5 * 60_000, async () => {
    const r = await db.query.runs.findFirst({ where: eq(runs.id, run.id) });
    return r && ['completed', 'partial', 'failed', 'cancelled'].includes(r.status) ? r : null;
  });
  check('the run completed', done.status === 'completed', `${done.status}, ${done.resultCount} rows`);
  const files = await until('three files', 2 * 60_000, async () => {
    const f = await db.select().from(runFiles).where(eq(runFiles.runId, run.id));
    return f.length === 3 ? f : null;
  });
  check('three files were written', files.length === 3, files.map((f) => `${f.format} ${f.bytes.length} B, ${f.rows} rows`).join('; '));
  const hit = await until('the webhook', 2 * 60_000, async () => hits[0] ?? null);
  await new Promise((r) => setTimeout(r, 3000));
  check('one POST reached the receiver', hits.length === 1 && hit.method === 'POST' && hit.path === '/hook', `${hits.length} request(s), ${hit.method} ${hit.path}`);
  const secret = src.webhookSecret!;
  check('the POST is signed with the website secret', hit.headers['x-robot-signature'] === `sha256=${createHmac('sha256', secret).update(hit.body).digest('hex')}`);
  check('the headers', hit.headers['x-robot-event'] === 'run.finished' && hit.headers['user-agent'] === 'robot-platform-webhook/1'
    && hit.headers['content-type'] === 'application/json' && typeof hit.headers['x-robot-delivery'] === 'string');
  const body = JSON.parse(hit.body) as {
    event: string; deliveryId: string; runId: string; status: string; scheduled: boolean; rows: number;
    website: { id: string }; files: Record<'csv' | 'json' | 'xlsx', string>; filesExpireAt: string;
  };
  check('the body names the run', body.event === 'run.finished' && body.runId === run.id && body.status === done.status && body.scheduled === true
    && body.website.id === sourceId && body.deliveryId === hit.headers['x-robot-delivery']);

  const { loadRunExport, renderRunExport } = await import('@robot/api/export');
  const live = (await loadRunExport(db, run.id))!;
  const downloads: Record<string, { status: number; bytes: number }> = {};
  for (const format of ['csv', 'json', 'xlsx'] as const) {
    const link = body.files[format];
    check(`the ${format} link is on the api-server`, link.startsWith(`http://127.0.0.1:${API_PORT}/export/runs/${run.id}.${format}?`), link.replace(/sig=[0-9a-f]+/, 'sig=…'));
    const res = await fetch(link);
    const got = Buffer.from(await res.arrayBuffer());
    downloads[format] = { status: res.status, bytes: got.length };
    const stored = Buffer.from(files.find((f) => f.format === format)!.bytes);
    check(`the ${format} link downloads the run's file`, res.status === 200 && got.equals(stored), `${res.status}, ${got.length} B`);
    // CSV and JSON are byte-for-byte the live export of the same rows; an XLSX carries its own timestamps.
    if (format !== 'xlsx') check(`the ${format} file holds the run's rows`, got.equals((await renderRunExport(live, format)).bytes));
  }
  check('the row count matches the run', body.rows === live.rows.length && live.rows.length === done.resultCount && files.every((f) => f.rows === live.rows.length),
    `webhook ${body.rows} / export ${live.rows.length} / run ${done.resultCount} / files ${files.map((f) => f.rows).join(',')}`);
  const tampered = body.files.csv.replace(/sig=([0-9a-f])/, (_m, c: string) => `sig=${c === '0' ? '1' : '0'}`);
  const tamperedStatus = (await fetch(tampered)).status;
  check('a tampered link is refused', tamperedStatus === 404, String(tamperedStatus));
  const attempts = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.runId, run.id));
  check('one delivery attempt, delivered', attempts.length === 1 && attempts[0]!.ok === true, `${attempts.length} attempt(s), status ${attempts[0]?.statusCode}`);

  await worker.stop();
  stopWorker = null;
  check('the worker closed its browsers', worker.gate.open() === 0, `${worker.gate.open()} open`);
  const { listOwnedBrowsers } = await import('./orphans.js');
  const left = (await listOwnedBrowsers()).filter((p) => p.commandLine.includes(`--robot-owner=${process.pid}`));
  check('no Chromium of this check is left', left.length === 0, left.map((p) => p.pid).join(', ') || 'none');

  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'live-recurring.json'), `${JSON.stringify({
    at: new Date().toISOString(), runId: run.id, status: done.status, rows: done.resultCount,
    scheduleSavedAt: savedAt.toISOString(), scheduledFor: src.nextRunAt?.toISOString(), startedAt: run.startedAt, completedAt: done.completedAt, webhookAt: hit.at,
    timings: {
      saveToStartMs: ms(savedAt, run.startedAt), scheduledToStartMs: ms(src.nextRunAt, run.startedAt),
      startToCompleteMs: ms(run.startedAt, done.completedAt), completeToWebhookMs: ms(done.completedAt, hit.at),
    },
    files: files.map((f) => ({ format: f.format, filename: f.filename, bytes: f.bytes.length, rows: f.rows })),
    webhook: {
      requests: hits.length, bodyKeys: Object.keys(body), filesExpireAt: body.filesExpireAt,
      headers: { 'user-agent': hit.headers['user-agent'], 'x-robot-event': hit.headers['x-robot-event'], 'x-robot-delivery': hit.headers['x-robot-delivery'], 'content-type': hit.headers['content-type'] },
    },
    downloads, tamperedStatus, deliveries: attempts.map((d) => ({ attempt: d.attempt, ok: d.ok, statusCode: d.statusCode })),
    checks,
  }, null, 1)}\n`);
} catch (err) {
  console.error('[live-recurring] failed:', err);
  exitCode = 1;
} finally {
  await stopWorker?.().catch(() => {});
  api?.kill();
  await closeShop?.().catch(() => {});
  receiver.close();
  rmSync(capturesDir, { recursive: true, force: true });
  const made = bench;
  if (made) await made.drop().catch((err) => { console.error(`[live-recurring] could not drop ${made.name}:`, err); exitCode = 1; });
}
console.log(`[live-recurring] ${exitCode === 0 ? 'PASS' : 'FAIL'}`);
process.exit(exitCode);
