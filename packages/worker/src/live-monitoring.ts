// The monitoring live check (spec 2026-10-25 monitoring §4 "Live check"). Free, local, keyless: a throwaway database,
// an in-process worker with WORKER_HEALTH_PORT and the test jobs, a local error receiver, and the api-server app
// in-process. It checks: /readyz is ok with the worker beating; a job made to hang shows as silent in ops.queue and in
// a watchdog warn line; a job made to throw reaches the receiver once, redacted; stopping the worker turns /readyz to
// 503 (`worker`) within 2 minutes; the logger's lines parse as JSON with LOG_FORMAT=json. No browser, no page.
//   cd packages/worker && npx tsx src/live-monitoring.ts
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadEnvFile } from 'node:process';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = join(here, '..', '..', '..');
const OUT = join(repo, 'docs', 'testing', 'results', '2026-10-25-monitoring');
try { loadEnvFile(join(repo, '.env')); } catch { /* no .env: the default URL below */ }
/** In test-throw's message (packages/api/src/jobs/test-jobs.ts): it must reach no report and no line. */
const SECRET = 'live-secret';
const TOKEN = 'live-report-token-0001';
process.env.JOB_QUEUE = `live-monitoring-${randomUUID()}`.slice(0, 64);
// Keyless and quiet: no AI, no Jev, no mail, no checks, no schedules, no proxy; JSON logs at debug (the request log's
// /readyz lines are debug); the receiver's token.
Object.assign(process.env, {
  ANTHROPIC_API_KEY: '', JEV_SHADOW: '', TYPESAFE_API_KEY: '', SMTP_URL: '', WEBSITE_CHECKS: 'off', RECURRING_RUNS: 'off', DEFAULT_PROXY_URL: '',
  LOG_FORMAT: 'json', LOG_LEVEL: 'debug', ERROR_REPORT_TOKEN: TOKEN,
});

// Every line this process writes, kept (and still printed): the JSON and secret checks read them.
const written: string[] = [];
for (const stream of [process.stdout, process.stderr]) {
  const original = stream.write.bind(stream) as (...a: unknown[]) => boolean;
  stream.write = ((chunk: unknown, ...rest: unknown[]) => {
    written.push(...String(chunk).split(/\r?\n/).filter(Boolean));
    return original(chunk, ...rest);
  }) as typeof stream.write;
}
type Line = { t: string; level: string; scope: string; msg: string; [k: string]: unknown };
/** The logger's lines: they, and only they, start with `{"t":` (other code still prints with console.*). */
const LOGGER_LINE = '{"t":';
const jsonLines = (): Line[] => written.filter((l) => l.startsWith(LOGGER_LINE)).flatMap((l) => { try { return [JSON.parse(l) as Line]; } catch { return []; } });

async function until<T>(what: string, ms: number, probe: () => Promise<T | null | undefined | false>): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await probe();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}
const freePort = () => new Promise<number>((resolve, reject) => {
  const s = createServer();
  s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address() as { port: number }; s.close(() => resolve(port)); });
});

let exitCode = 0;
const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];
const check = (name: string, ok: boolean, detail?: string) => {
  checks.push({ name, ok, ...(detail ? { detail } : {}) });
  console.log(`[live-monitoring] ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) exitCode = 1;
};

const { createBenchDatabase } = await import('./bench/bench-db.js');
let bench: Awaited<ReturnType<typeof createBenchDatabase>> | null = null;
let receiver: { url: string; reports: Array<{ body: any; raw: string; headers: Record<string, unknown> }>; close(): Promise<void> } | null = null;
let worker: { stop(): Promise<void> } | null = null;
const summary: Record<string, unknown> = {};
try {
  bench = await createBenchDatabase(process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/robot_platform');
  // Before anything imports @robot/db: every row of this check goes to the throwaway database.
  process.env.DATABASE_URL = bench.url;

  const { startErrorReceiver } = await import('@robot/api/test-helpers/error-receiver');
  receiver = await startErrorReceiver();
  process.env.ERROR_REPORT_URL = receiver.url;

  const email = `live-monitoring-op-${Date.now()}@example.com`;
  process.env.OPS_EMAILS = email;
  const { benchSignIn } = await import('./bench/seed.js');
  const op = await benchSignIn(email);

  // The api-server's app, in-process (no port): /readyz on this check's queue.
  const { createApp } = (await import(pathToFileURL(join(repo, 'packages', 'api-server', 'src', 'app.ts')).href)) as { createApp: () => { fetch(r: Request): Promise<Response> } };
  const app = createApp();
  const readyz = async () => {
    const res = await app.fetch(new Request('http://localhost/readyz'));
    return { status: res.status, body: (await res.json()) as { status: string; checks: Record<string, boolean> } };
  };

  const before = await readyz();
  check('/readyz is 503 (worker) before any worker beats', before.status === 503 && before.body.checks.worker === false, JSON.stringify(before.body));

  const healthPort = await freePort();
  const { readWorkerConfig } = await import('./config.js');
  const { startWorker } = await import('./worker.js');
  const w = await startWorker(
    { ...readWorkerConfig({ JOB_QUEUE: process.env.JOB_QUEUE, WORKER_HEALTH_PORT: String(healthPort), WORKER_MIN_FREE_MB: '0' }), websiteChecks: false, recurringRuns: false, testJobs: true },
    { heartbeatMs: 2000, watchEveryMs: 3000 },
  );
  worker = w;
  const ok = await until('/readyz to be ok', 30_000, async () => { const r = await readyz(); return r.status === 200 ? r : null; });
  check('/readyz is ok with the worker beating', ok.body.status === 'ok' && Object.values(ok.body.checks).every((v) => v === true), JSON.stringify(ok.body));
  check('/readyz says only check names and booleans', JSON.stringify(Object.keys(ok.body)) === '["status","checks"]'
    && JSON.stringify(Object.keys(ok.body.checks).sort()) === '["db","migrations","queue","worker"]' && Object.values(ok.body.checks).every((v) => typeof v === 'boolean'));
  const health = await fetch(`http://127.0.0.1:${healthPort}/healthz`);
  check('the worker’s health port answers 200', health.status === 200, String(health.status));

  const { enqueueJob } = await import('@robot/api/jobs');
  const { db } = await import('@robot/db');
  const hang = await enqueueJob(db, { type: 'test-hang', payload: {} });
  const thrown = await enqueueJob(db, { type: 'test-throw', payload: {} });

  // 1. A job made to hang: silent past max(half its 60 s stuckMs, 45 s) — in ops.queue and in a watchdog warn line.
  const silent = await until('the hanging job to read as silent in ops.queue', 90_000, async () =>
    (await op.caller.ops.queue()).attention.find((a) => a.kind === 'silent' && a.jobId === hang.id) ?? null);
  check('a hanging job shows as silent in ops.queue', silent.type === 'test-hang' && silent.ageMs >= 45_000, `${Math.round(silent.ageMs / 1000)} s without progress`);
  const warn = await until('a watchdog warn line for it', 30_000, async () =>
    jsonLines().find((l) => l.scope === 'watchdog' && l.level === 'warn' && l.kind === 'silent' && l.jobId === hang.id) ?? null);
  check('…and in a watchdog warn line', !!warn, warn.msg);

  // 2. A job made to throw: one report, as the worker, with the token, redacted.
  await until('the receiver to get the thrown job', 60_000, async () => receiver!.reports.some((r) => r.body?.context?.jobId === thrown.id));
  await new Promise((r) => setTimeout(r, 5000));
  const mine = receiver.reports.filter((r) => r.body?.context?.jobId === thrown.id);
  check('a job made to throw reaches the receiver once', mine.length === 1, `${mine.length} report(s)`);
  const report = mine[0]!;
  check('…as the worker, with the Bearer token, redacted',
    report.body.service === 'worker' && report.headers.authorization === `Bearer ${TOKEN}` && !report.raw.includes(SECRET) && report.raw.includes('http://***@proxy.test:7000'),
    String(report.body.message));

  // 3. Stop the worker: its row goes, /readyz turns 503 (worker) within 2 minutes.
  const stopAt = Date.now();
  await w.stop();
  worker = null;
  const down = await until('/readyz to turn 503 (worker)', 2 * 60_000, async () => { const r = await readyz(); return r.status === 503 && r.body.checks.worker === false ? r : null; });
  check('stopping the worker turns /readyz to 503 (worker) within 2 minutes', Date.now() - stopAt < 2 * 60_000, `${Math.round((Date.now() - stopAt) / 1000)} s; ${JSON.stringify(down.body)}`);

  // 4. The lines: every logger line parses as JSON; the ones this check needs are there; no secret anywhere.
  const raw = written.filter((l) => l.startsWith(LOGGER_LINE));
  const parsed = jsonLines();
  check('every logger line parses as JSON with t, level, scope and msg', raw.length > 0 && parsed.length === raw.length
    && parsed.every((l) => typeof l.t === 'string' && typeof l.level === 'string' && typeof l.scope === 'string' && typeof l.msg === 'string'), `${parsed.length} line(s)`);
  const scopes = new Set(parsed.map((l) => l.scope));
  check('the worker, the runner, the watchdog, the error hook and the request log all wrote JSON', ['worker', 'jobs', 'watchdog', 'errors', 'api-server'].every((s) => scopes.has(s)), [...scopes].join(', '));
  check('no line carries the secret or the token', !written.some((l) => l.includes(SECRET) || l.includes(TOKEN)));

  Object.assign(summary, {
    readyzBefore: before.body, readyzOk: ok.body, readyzAfterStop: down.body, silent: { ageMs: silent.ageMs, msg: warn.msg },
    report: { service: report.body.service, message: report.body.message, version: report.body.version }, reports: receiver.reports.length,
    lines: parsed.length, scopes: [...scopes],
  });
} catch (err) {
  console.error('[live-monitoring] failed:', err);
  exitCode = 1;
} finally {
  await worker?.stop().catch(() => {});
  await receiver?.close().catch(() => {});
  const made = bench;
  if (made) await made.drop().catch((err) => { console.error(`[live-monitoring] could not drop ${made.name}:`, err); exitCode = 1; });
}
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'live-monitoring.json'), `${JSON.stringify({ at: new Date().toISOString(), ...summary, checks }, null, 1)}\n`);
console.log(`[live-monitoring] ${exitCode === 0 ? 'PASS' : 'FAIL'}`);
process.exit(exitCode);
