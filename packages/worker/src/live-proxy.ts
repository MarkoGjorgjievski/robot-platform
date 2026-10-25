// The proxy live check (spec 2026-10-24 proxy §4, the queue item's "done when"). Free, local, keyless: a throwaway
// database, the run-speed fixture shop (it records every request and whether the proxy forwarded it), the local
// recording proxy with Basic auth, and an in-process worker. One certified fixture website gets a proxy address with
// {country} in its user and the country Germany through the real sources.update (as an operator); a proof-page
// capture and a three-page run must go through the proxy only (Chromium reaching it through the session's loopback
// forwarder, which adds the real credential upstream), the page must read de-DE / Europe/Berlin, and the shop must
// never receive the proxy's credential. Then a wrong password: the capture fails with the proxy sentence and the shop
// sees nothing new.
//   cd packages/worker && npx tsx src/live-proxy.ts
import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = join(here, '..', '..', '..');
const OUT = join(repo, 'docs', 'testing', 'results', '2026-10-24-proxy');
try { loadEnvFile(join(repo, '.env')); } catch { /* no .env: the default URL below */ }
const { createBenchDatabase } = await import('./bench/bench-db.js');
process.env.JOB_QUEUE = `live-proxy-${randomUUID()}`.slice(0, 64);
// Keyless and quiet: no AI, no Jev, no mail, no checks, no schedules, and no default proxy (the website's own only).
Object.assign(process.env, {
  ANTHROPIC_API_KEY: '', JEV_SHADOW: '', TYPESAFE_API_KEY: '', SMTP_URL: '', WEBSITE_CHECKS: 'off', RECURRING_RUNS: 'off', DEFAULT_PROXY_URL: '',
});
const capturesDir = mkdtempSync(join(tmpdir(), 'live-proxy-captures-'));
process.env.CAPTURES_DIR = capturesDir;

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
  console.log(`[live-proxy] ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) exitCode = 1;
};
/** <html data-env="…"> as page.content() serialises it. */
const envOf = (html: string | null | undefined): { lang?: string; langs?: string[]; tz?: string } => {
  const m = /data-env="([^"]*)"/.exec(html ?? '');
  try { return m ? JSON.parse(m[1]!.replace(/&quot;/g, '"').replace(/&amp;/g, '&')) : {}; } catch { return {}; }
};

let bench: Awaited<ReturnType<typeof createBenchDatabase>> | null = null;
let closeShop: (() => Promise<void>) | null = null;
let closeProxy: (() => Promise<void>) | null = null;
let stopWorker: (() => Promise<void>) | null = null;
try {
  bench = await createBenchDatabase(process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/robot_platform');
  // Before anything imports @robot/db: every row of this check goes to the throwaway database.
  process.env.DATABASE_URL = bench.url;

  const { startRecordingProxy, FORWARDED_HEADER } = await import('@robot/browser/fixtures/proxy');
  const USER = 'live-user-country-de';
  const PASS = 'live@pass';
  const proxy = await startRecordingProxy({ auth: { username: USER, password: PASS } });
  closeProxy = proxy.close;
  /** The upstream credential in every form it could travel in: raw, URL-encoded, Basic. */
  const secrets = [PASS, encodeURIComponent(PASS), Buffer.from(`${USER}:${PASS}`).toString('base64')];
  const shopLog: Array<{ method: string; path: string; forwarded: boolean; acceptLanguage: string; carriesCredential: boolean }> = [];
  const { startFixtureShop, INSTANT } = await import('./bench/fixture-shop.js');
  const shop = await startFixtureShop({
    sites: 1, latency: INSTANT, envProbe: true,
    onRequest: (r) => {
      const all = JSON.stringify(r.headers);
      shopLog.push({
        method: r.method,
        path: r.path,
        forwarded: r.headers[FORWARDED_HEADER] === '1',
        acceptLanguage: String(r.headers['accept-language'] ?? ''),
        carriesCredential: secrets.some((s) => all.includes(s)) || 'proxy-authorization' in r.headers || 'authorization' in r.headers,
      });
    },
  });
  closeShop = shop.close;
  const { setBrowserOwner } = await import('@robot/browser');
  setBrowserOwner(String(process.pid));

  // The website, set up through the real procedures; the operator is this check's own throwaway user.
  const email = `live-proxy-op-${Date.now()}@example.com`;
  process.env.OPS_EMAILS = email;
  const { benchSignIn, seedCertifiedWebsite } = await import('./bench/seed.js');
  const op = await benchSignIn(email);
  const { sourceId } = await seedCertifiedWebsite(op.caller, shop.sites[0]!);
  await op.caller.sources.update({ id: sourceId, proxyUrl: `http://live-user-country-{country}:live%40pass@127.0.0.1:${proxy.port}`, country: 'de' });
  const network = (await op.caller.ops.website({ sourceId })).network;
  check('ops reads proxy (own) · Germany', JSON.stringify(network) === JSON.stringify({ proxy: 'own', country: { code: 'de', name: 'Germany' } }), JSON.stringify(network));

  const { readWorkerConfig } = await import('./config.js');
  const { startWorker } = await import('./worker.js');
  const worker = await startWorker({ ...readWorkerConfig({ JOB_QUEUE: process.env.JOB_QUEUE }), websiteChecks: false, recurringRuns: false });
  stopWorker = () => worker.stop();

  const { db, captures, runs, runItems } = await import('@robot/db');
  const { eq } = await import('drizzle-orm');
  const settled = (captureId: string) => until(`proof-page capture ${captureId}`, 2 * 60_000, async () => {
    const r = await db.query.captures.findFirst({ where: eq(captures.id, captureId) });
    const meta = r?.metadata as { status?: string; error?: string; tiles?: string[] } | null;
    return meta && meta.status !== 'capturing' ? { row: r!, meta } : null;
  });

  // 1. A proof-page capture through the proxy, in Germany.
  const proofUrl = shop.sites[0]!.productUrl(1);
  const first = await settled((await op.caller.sources.captureProofPage({ sourceId, url: proofUrl })).captureId);
  check('the proof page was captured', first.meta.status === 'captured', first.meta.error);
  const env = envOf(first.row.html);
  check('the page reads de-DE and Europe/Berlin', env.lang === 'de-DE' && env.langs?.[0] === 'de-DE' && env.tz === 'Europe/Berlin', JSON.stringify(env));
  mkdirSync(OUT, { recursive: true });
  const tile = first.meta.tiles?.[0];
  if (tile) copyFileSync(join(capturesDir, basename(tile)), join(OUT, 'live-proxy-proof-page.png'));
  check('the proof page has a screenshot', !!tile);

  // 2. A small run (three certified pages) through the proxy.
  const [run] = await db.insert(runs).values({ sourceId, status: 'pending' }).returning({ id: runs.id });
  await db.insert(runItems).values([4, 5, 6].map((id) => ({ runId: run!.id, kind: 'detail', url: shop.sites[0]!.productUrl(id), status: 'pending' })));
  const { startRunJob } = await import('@robot/api/jobs');
  await startRunJob(db, { runId: run!.id });
  const done = await until('the run to finish', 5 * 60_000, async () => {
    const r = await db.query.runs.findFirst({ where: eq(runs.id, run!.id) });
    return r && ['completed', 'partial', 'failed', 'cancelled'].includes(r.status) ? r : null;
  });
  check('the run completed with three rows', done.status === 'completed' && done.resultCount === 3, `${done.status}, ${done.resultCount} rows`);

  // 3. What the proxy and the shop saw.
  const pages = [1, 4, 5, 6].map((id) => `/p/${id}`);
  const proxied = (p: string) => proxy.log.some((e) => e.allowed && e.method === 'GET' && (() => { try { return new URL(e.url).pathname === p; } catch { return false; } })());
  check('every product page went through the proxy', pages.every(proxied), pages.filter((p) => !proxied(p)).join(', ') || 'all four');
  const authed = proxy.log.filter((e) => e.headers['proxy-authorization']);
  check('the proxy got the website’s user with {country} filled in, and its password', authed.length > 0 && authed.every((e) => e.allowed), `${authed.length} authenticated request(s) as ${USER}`);
  check('nothing reached the shop directly', shopLog.length > 0 && shopLog.every((r) => r.forwarded), `${shopLog.filter((r) => !r.forwarded).length} direct of ${shopLog.length}`);
  check('the shop never received the proxy’s credential', shopLog.every((r) => !r.carriesCredential), `${shopLog.filter((r) => r.carriesCredential).length} of ${shopLog.length} carried it`);
  // The page loads (GET); the session's proxy check before a host's first page is a bare HEAD from Node.
  const productHits = shopLog.filter((r) => r.method === 'GET' && /^\/p\/\d+$/.test(r.path));
  check('the shop was asked in German first', productHits.length >= 4 && productHits.every((r) => r.acceptLanguage.startsWith('de-DE')), `${productHits.length} page loads, first ${productHits[0]?.acceptLanguage ?? 'none'}`);

  // 4. A wrong password: the proxy sentence, and nothing direct.
  await op.caller.sources.update({ id: sourceId, proxyUrl: `http://live-user-country-{country}:wrong@127.0.0.1:${proxy.port}` });
  const before = shopLog.length;
  const refused = await settled((await op.caller.sources.captureProofPage({ sourceId, url: shop.sites[0]!.productUrl(2) })).captureId);
  check('a wrong password fails with the proxy sentence', refused.meta.status === 'failed' && refused.meta.error === 'The proxy refused the connection.', refused.meta.error);
  check('…and the shop saw nothing new', shopLog.length === before, `${shopLog.length - before} new request(s)`);
  const stored = JSON.stringify([first.meta, refused.meta]);
  check('no stored error carries the password', !stored.includes('live@pass') && !stored.includes('live%40pass'));

  await worker.stop();
  stopWorker = null;
  check('the worker closed its browsers', worker.gate.open() === 0, `${worker.gate.open()} open`);
  const { listOwnedBrowsers } = await import('./orphans.js');
  const left = (await listOwnedBrowsers()).filter((p) => p.commandLine.includes(`--robot-owner=${process.pid}`));
  check('no Chromium of this check is left', left.length === 0, left.map((p) => p.pid).join(', ') || 'none');

  writeFileSync(join(OUT, 'live-proxy.json'), `${JSON.stringify({
    at: new Date().toISOString(), sourceId, runId: run!.id, env,
    proxy: { requests: proxy.log.length, authenticated: authed.length, refused: proxy.log.filter((e) => !e.allowed).length, user: USER },
    shop: {
      requests: shopLog.length, direct: shopLog.filter((r) => !r.forwarded).length,
      carriedCredential: shopLog.filter((r) => r.carriesCredential).length, acceptLanguage: productHits[0]?.acceptLanguage,
    },
    run: { status: done.status, rows: done.resultCount }, wrongPassword: { status: refused.meta.status, error: refused.meta.error },
    checks,
  }, null, 1)}\n`);
} catch (err) {
  console.error('[live-proxy] failed:', err);
  exitCode = 1;
} finally {
  await stopWorker?.().catch(() => {});
  await closeShop?.().catch(() => {});
  await closeProxy?.().catch(() => {});
  rmSync(capturesDir, { recursive: true, force: true });
  const made = bench;
  if (made) await made.drop().catch((err) => { console.error(`[live-proxy] could not drop ${made.name}:`, err); exitCode = 1; });
}
console.log(`[live-proxy] ${exitCode === 0 ? 'PASS' : 'FAIL'}`);
process.exit(exitCode);
