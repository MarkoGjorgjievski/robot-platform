// The turned-away live check (spec 2026-10-28 turned away §5). Free, local, keyless: a throwaway database, the fixture
// shop, the local recording proxy as FALLBACK_PROXY_URL, and an in-process worker on its own queue with one browser.
//
// How the shop tells a direct load from one through the fallback: the recording proxy forwards every request with
// FORWARDED_HEADER set (`x-test-proxy-forwarded: 1`, the same marker the proxy live check counts on). The shop walls
// (403, an "Access denied" page that `detectWall` reads as `refused`) every request to a walled website WITHOUT that
// header and serves the product page to every request with it. A real wall cares about the address, not a header;
// here the header stands in for "came from the proxy's exit".
//
// The waits are short: ROBOT_BACKOFF_FIRST_MS (the host backoff's first step, read once when @robot/scraper loads)
// and PROOF_LADDER_WAIT_SCALE (the ladder's waits and the 30 s retry spacing, test-only) are set before anything
// imports them. Three scenarios, each on its own fixture website (its own loopback host, so its own backoff):
//   (a) a fallback configured: tries 1 and 2 walled direct, waiting rows with retryAt and attempt, try 3 by the fallback
//       captured, `sources.fallback_proxy_at` set and the country guessed from `/de-de/` written, then another product's
//       capture goes through the proxy from its first try;
//   (b) no fallback: four walls, then failed with gaveUp and attempts 4;
//   (c) two products walled together: their retries come back at least the spacing (30 s × scale) apart.
//   cd packages/worker && npx tsx src/live-turned-away.ts
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = join(here, '..', '..', '..');
const OUT = join(repo, 'docs', 'testing', 'results', '2026-10-28-turned-away');
try { loadEnvFile(join(repo, '.env')); } catch { /* no .env: the default URL below */ }
const BACKOFF_FIRST_MS = 1000;
const SCALE = 0.05;
process.env.JOB_QUEUE = `live-turned-away-${randomUUID()}`.slice(0, 64);
// Keyless and quiet: no AI, no Jev, no mail, no checks, no schedules, no default proxy; the short waits; no fallback
// until scenario (a) names the recording proxy.
Object.assign(process.env, {
  ANTHROPIC_API_KEY: '', JEV_SHADOW: '', TYPESAFE_API_KEY: '', SMTP_URL: '', WEBSITE_CHECKS: 'off', RECURRING_RUNS: 'off',
  DEFAULT_PROXY_URL: '', FALLBACK_PROXY_URL: '', ERROR_REPORT_URL: '',
  ROBOT_BACKOFF_FIRST_MS: String(BACKOFF_FIRST_MS), PROOF_LADDER_WAIT_SCALE: String(SCALE),
});
const capturesDir = mkdtempSync(join(tmpdir(), 'live-turned-away-captures-'));
process.env.CAPTURES_DIR = capturesDir;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let exitCode = 0;
const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];
const check = (name: string, ok: boolean, detail?: string) => {
  checks.push({ name, ok, ...(detail ? { detail } : {}) });
  console.log(`[live-turned-away] ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) exitCode = 1;
};
/** <html data-env="…"> as page.content() serialises it. */
const envOf = (html: string | null | undefined): { lang?: string; tz?: string } => {
  const m = /data-env="([^"]*)"/.exec(html ?? '');
  try { return m ? JSON.parse(m[1]!.replace(/&quot;/g, '"').replace(/&amp;/g, '&')) : {}; } catch { return {}; }
};

type Meta = { status: string; attempt?: number; attempts?: number; via?: string; retryAt?: string; startedAt?: string; firstStartedAt?: string; gaveUp?: boolean; error?: string; verdict?: { kind?: string } };
/** One state a row was seen in (a new entry each time status, attempt, via or retryAt changes). */
type Seen = { at: string; status: string; attempt?: number; via?: string; retryAt?: string; inMs?: number; attempts?: number; gaveUp?: boolean; verdict?: string };

const summary: Record<string, unknown> = {};
let bench: { name: string; url: string; drop(): Promise<void> } | null = null;
let closeShop: (() => Promise<void>) | null = null;
let closeProxy: (() => Promise<void>) | null = null;
let stopWorker: (() => Promise<void>) | null = null;
try {
  const { createBenchDatabase } = await import('./bench/bench-db.js');
  bench = await createBenchDatabase(process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/robot_platform');
  // Before anything imports @robot/db: every row of this check goes to the throwaway database.
  process.env.DATABASE_URL = bench.url;

  const { startRecordingProxy, FORWARDED_HEADER } = await import('@robot/browser/fixtures/proxy');
  const USER = 'fb-country-de';
  const PASS = 'fb@pass';
  const proxy = await startRecordingProxy({ auth: { username: USER, password: PASS } });
  closeProxy = proxy.close;

  // Websites 0, 1 and 2 (scenarios a, b, c) wall every direct request; the proxy's requests pass.
  const shopLog: Array<{ site: number; method: string; path: string; forwarded: boolean; walled: boolean }> = [];
  const forwarded = (h: Record<string, unknown>) => h[FORWARDED_HEADER] === '1';
  const { startFixtureShop, INSTANT } = await import('./bench/fixture-shop.js');
  const shop = await startFixtureShop({
    sites: 3, latency: INSTANT, envProbe: true,
    wall: (r) => !forwarded(r.headers),
    onRequest: (r) => shopLog.push({ site: r.site, method: r.method, path: r.path, forwarded: forwarded(r.headers), walled: !forwarded(r.headers) }),
  });
  closeShop = shop.close;
  const { setBrowserOwner } = await import('@robot/browser');
  setBrowserOwner(String(process.pid));

  const email = `live-turned-away-op-${Date.now()}@example.com`;
  process.env.OPS_EMAILS = email;
  const { benchSignIn, seedCertifiedWebsite } = await import('./bench/seed.js');
  const op = await benchSignIn(email);
  const [siteA, siteB, siteC] = [shop.sites[0]!, shop.sites[1]!, shop.sites[2]!];
  const a = await seedCertifiedWebsite(op.caller, siteA);
  const b = await seedCertifiedWebsite(op.caller, siteB);
  const c = await seedCertifiedWebsite(op.caller, siteC);

  const { readWorkerConfig } = await import('./config.js');
  const { startWorker } = await import('./worker.js');
  // One browser at a time; no memory floor (the check's own pages are tiny).
  const worker = await startWorker({ ...readWorkerConfig({ JOB_QUEUE: process.env.JOB_QUEUE, WORKER_BROWSERS: '1', WORKER_MIN_FREE_MB: '0' }), websiteChecks: false, recurringRuns: false });
  stopWorker = () => worker.stop();

  const { db, captures, sources } = await import('@robot/db');
  const { eq } = await import('drizzle-orm');
  /** `RETRY_SPACING_MS` in packages/api/src/verify/proof-page-capture.ts (not exported from @robot/api), scaled as it scales it. */
  const RETRY_SPACING_MS = 30_000;
  const spacingMs = Math.round(RETRY_SPACING_MS * SCALE);
  const metaOf = async (id: string) => {
    const r = await db.query.captures.findFirst({ where: eq(captures.id, id) });
    return r ? { row: r, meta: r.metadata as Meta } : null;
  };
  const note = (log: Seen[], m: Meta) => {
    const last = log[log.length - 1];
    if (last && last.status === m.status && last.attempt === m.attempt && last.via === m.via && last.retryAt === m.retryAt) return;
    const now = Date.now();
    log.push({
      at: new Date(now).toISOString(), status: m.status,
      ...(m.attempt !== undefined ? { attempt: m.attempt } : {}), ...(m.via ? { via: m.via } : {}),
      ...(m.retryAt ? { retryAt: m.retryAt, inMs: Date.parse(m.retryAt) - now } : {}),
      ...(m.attempts !== undefined ? { attempts: m.attempts } : {}), ...(m.gaveUp ? { gaveUp: true } : {}),
      ...(m.verdict?.kind ? { verdict: m.verdict.kind } : {}),
    });
  };
  /** Watch rows every 200 ms until each is settled (captured or failed), noting every state; `each` sees every poll. */
  const watch = async (ids: string[], ms: number, each?: (metas: Meta[]) => void | Promise<void>) => {
    const logs: Seen[][] = ids.map(() => []);
    const end = Date.now() + ms;
    for (;;) {
      const metas = await Promise.all(ids.map(async (id) => (await metaOf(id))?.meta ?? { status: 'missing' }));
      metas.forEach((m, i) => note(logs[i]!, m));
      await each?.(metas);
      if (metas.every((m) => m.status === 'captured' || m.status === 'failed')) return { logs, metas };
      if (Date.now() > end) throw new Error(`timed out watching ${ids.join(', ')}: ${metas.map((m) => m.status).join(', ')}`);
      await sleep(200);
    }
  };
  const productLoads = (site: number, path: string) => shopLog.filter((r) => r.site === site && r.method === 'GET' && r.path === path);
  const proxied = (path: string) => proxy.log.some((e) => e.allowed && e.method === 'GET' && (() => { try { return new URL(e.url).pathname === path; } catch { return false; } })());

  // (a) A fallback configured: two walls direct, then the fallback, kept.
  process.env.FALLBACK_PROXY_URL = `http://fb-country-{country}:fb%40pass@127.0.0.1:${proxy.port}`;
  const pathA1 = '/de-de/p/1';
  const capA1 = (await op.caller.sources.captureProofPage({ sourceId: a.sourceId, url: `${siteA.origin}${pathA1}` })).captureId;
  // The answer a screen reads while it waits: the route by name, never an address.
  const answers: { waiting: string | null } = { waiting: null };
  const seenA = await watch([capA1], 3 * 60_000, async (ms) => {
    if (!answers.waiting && ms[0]!.status === 'waiting') answers.waiting = JSON.stringify(await op.caller.sources.proofPageCapture({ captureId: capA1 }));
  });
  const logA = seenA.logs[0]!;
  const waitsA = logA.filter((s) => s.status === 'waiting');
  const doneA = seenA.metas[0]!;
  check('(a) try 1 walled direct: waiting for try 2 by the direct route', waitsA.some((s) => s.attempt === 2 && s.via === 'direct' && !!s.retryAt), JSON.stringify(waitsA[0] ?? null));
  check('(a) try 2 walled direct: waiting for try 3 by the fallback', waitsA.some((s) => s.attempt === 3 && s.via === 'fallback' && !!s.retryAt), JSON.stringify(waitsA.find((s) => s.attempt === 3) ?? null));
  const w2 = waitsA.find((s) => s.attempt === 2);
  check('(a) try 2 waits the scaled 2 minutes (or the backoff, whichever is longer)', !!w2 && (w2.inMs ?? 0) >= 2 * 60_000 * SCALE - 1000, `${w2?.inMs} ms after the wall was seen`);
  check('(a) try 3 by the fallback was captured', doneA.status === 'captured' && doneA.attempt === 3 && doneA.via === 'fallback', JSON.stringify({ status: doneA.status, attempt: doneA.attempt, via: doneA.via, error: doneA.error }));
  const directA1 = productLoads(0, pathA1).filter((r) => !r.forwarded);
  check('(a) the shop walled exactly two direct loads of the product', directA1.length === 2 && directA1.every((r) => r.walled), `${directA1.length} direct load(s)`);
  check('(a) the fallback try went through the proxy', proxied(pathA1) && productLoads(0, pathA1).some((r) => r.forwarded));
  check('(a) a waiting answer names the route, never the proxy’s address', !!answers.waiting && answers.waiting.includes('"status":"waiting"') && !answers.waiting.includes(String(proxy.port)) && !answers.waiting.toLowerCase().includes('proxy'), answers.waiting ?? 'none read');
  const srcA = await db.query.sources.findFirst({ where: eq(sources.id, a.sourceId) });
  check('(a) sources.fallback_proxy_at is set', !!srcA?.fallbackProxyAt, srcA?.fallbackProxyAt?.toISOString() ?? 'null');
  check('(a) the country guessed from /de-de/ was written', srcA?.country === 'de', String(srcA?.country));
  const authed = proxy.log.filter((e) => e.headers['proxy-authorization']);
  check('(a) the proxy got the user with {country} filled in as de', authed.length > 0 && authed.every((e) => e.allowed), `${authed.length} authenticated request(s), ${proxy.log.filter((e) => !e.allowed).length} refused`);

  // (a) continued: another product goes through the proxy from its first try (the website kept the fallback).
  const pathA2 = '/de-de/p/2';
  const capA2 = (await op.caller.sources.captureProofPage({ sourceId: a.sourceId, url: `${siteA.origin}${pathA2}` })).captureId;
  const seenA2 = await watch([capA2], 2 * 60_000);
  const doneA2 = seenA2.metas[0]!;
  check('(a) the next product was captured on its first try by the fallback', doneA2.status === 'captured' && (doneA2.attempt ?? 1) === 1 && doneA2.via === 'fallback', JSON.stringify({ status: doneA2.status, attempt: doneA2.attempt, via: doneA2.via, error: doneA2.error }));
  check('(a) …through the proxy, and never direct', proxied(pathA2) && productLoads(0, pathA2).length > 0 && productLoads(0, pathA2).every((r) => r.forwarded), `${productLoads(0, pathA2).length} load(s) at the shop`);
  const envA2 = envOf((await metaOf(capA2))?.row.html);
  check('(a) …reading de-DE / Europe/Berlin (the kept country)', envA2.lang === 'de-DE' && envA2.tz === 'Europe/Berlin', JSON.stringify(envA2));
  summary.a = { url: pathA1, states: logA, next: { url: pathA2, states: seenA2.logs[0] }, fallbackProxyAt: srcA?.fallbackProxyAt?.toISOString() ?? null, country: srcA?.country ?? null, waitingAnswer: answers.waiting ? JSON.parse(answers.waiting) : null };

  // (b) and (c): no fallback configured. Website 1 has one product; website 2 two, walled together.
  process.env.FALLBACK_PROXY_URL = '';
  const proxyBefore = proxy.log.length;
  const capB = (await op.caller.sources.captureProofPage({ sourceId: b.sourceId, url: siteB.productUrl(1) })).captureId;
  const [capC1, capC2] = await Promise.all([1, 2].map(async (id) => (await op.caller.sources.captureProofPage({ sourceId: c.sourceId, url: siteC.productUrl(id) })).captureId));
  const gaps: number[] = [];
  const seenBC = await watch([capB, capC1!, capC2!], 6 * 60_000, (ms) => {
    const [, m1, m2] = ms;
    if (m1!.status === 'waiting' && m2!.status === 'waiting' && m1!.retryAt && m2!.retryAt) gaps.push(Math.abs(Date.parse(m1!.retryAt) - Date.parse(m2!.retryAt)));
  });
  const [logB, logC1, logC2] = seenBC.logs;
  const [doneB, doneC1, doneC2] = seenBC.metas;
  const waitsB = logB!.filter((s) => s.status === 'waiting');
  check('(b) tries 2, 3 and 4 each waited, all by the direct route', [2, 3, 4].every((n) => waitsB.some((s) => s.attempt === n && s.via === 'direct')), waitsB.map((s) => `try ${s.attempt} in ${s.inMs} ms`).join(', '));
  const firstWait = (n: number) => waitsB.find((s) => s.attempt === n)?.inMs ?? 0;
  check('(b) the waits grow (2, 4, 8 minutes, scaled)', firstWait(2) < firstWait(3) && firstWait(3) < firstWait(4), `${firstWait(2)} < ${firstWait(3)} < ${firstWait(4)} ms`);
  check('(b) four walls end failed, gaveUp, attempts 4', doneB!.status === 'failed' && doneB!.gaveUp === true && doneB!.attempts === 4 && doneB!.verdict?.kind === 'refused', JSON.stringify({ status: doneB!.status, gaveUp: doneB!.gaveUp, attempts: doneB!.attempts, verdict: doneB!.verdict?.kind }));
  check('(b) the shop saw four direct loads, all walled', productLoads(1, '/p/1').length === 4 && productLoads(1, '/p/1').every((r) => r.walled), `${productLoads(1, '/p/1').length} load(s)`);
  check('(b, c) with no fallback configured nothing went through the proxy', proxy.log.length === proxyBefore, `${proxy.log.length - proxyBefore} new proxy request(s)`);
  const minGap = gaps.length ? Math.min(...gaps) : null;
  check(`(c) two products walled together come back at least ${spacingMs} ms (30 s × ${SCALE}) apart`, minGap !== null && minGap >= spacingMs, `min gap ${minGap} ms over ${gaps.length} poll(s) with both waiting`);
  check('(c) both gave up after their own four tries', [doneC1, doneC2].every((m) => m!.status === 'failed' && m!.gaveUp === true && m!.attempts === 4), [doneC1, doneC2].map((m) => `${m!.status}/${m!.attempts}`).join(', '));
  summary.b = { url: '/p/1', states: logB };
  summary.c = { spacingMs, minGapMs: minGap, pollsBothWaiting: gaps.length, products: [{ url: '/p/1', states: logC1 }, { url: '/p/2', states: logC2 }] };

  // Ops reads what the customer's screen does not: the automatic switch, and the websites that gave up.
  const ops = await op.caller.ops.websites();
  const rowOf = (id: string) => ops.rows.find((r) => r.sourceId === id);
  check('ops: website (a) carries fallbackProxyAt (the "Proxy (automatic)" badge)', !!rowOf(a.sourceId)?.fallbackProxyAt, String(rowOf(a.sourceId)?.fallbackProxyAt));
  check('ops: website (b) is turned away, gave up, not through the proxy ("may need a proxy")', rowOf(b.sourceId)?.turnedAway?.gaveUp === true && rowOf(b.sourceId)?.turnedAway?.viaFallback === false, JSON.stringify(rowOf(b.sourceId)?.turnedAway ?? null));
  check('ops: no fallback configured now', ops.fallbackConfigured === false);
  summary.ops = { a: rowOf(a.sourceId)?.fallbackProxyAt ?? null, b: rowOf(b.sourceId)?.turnedAway ?? null, c: rowOf(c.sourceId)?.turnedAway ?? null, fallbackConfigured: ops.fallbackConfigured };

  await worker.stop();
  stopWorker = null;
  check('the worker closed its browsers', worker.gate.open() === 0, `${worker.gate.open()} open`);
  const { listOwnedBrowsers } = await import('./orphans.js');
  const left = (await listOwnedBrowsers()).filter((p) => p.commandLine.includes(`--robot-owner=${process.pid}`));
  check('no Chromium of this check is left', left.length === 0, left.map((p) => p.pid).join(', ') || 'none');
  summary.shop = { requests: shopLog.length, walled: shopLog.filter((r) => r.walled).length, forwarded: shopLog.filter((r) => r.forwarded).length };
  summary.proxy = { requests: proxy.log.length, authenticated: authed.length, refused: proxy.log.filter((e) => !e.allowed).length, user: USER };
} catch (err) {
  console.error('[live-turned-away] failed:', err);
  exitCode = 1;
} finally {
  await stopWorker?.().catch(() => {});
  await closeShop?.().catch(() => {});
  await closeProxy?.().catch(() => {});
  rmSync(capturesDir, { recursive: true, force: true });
  const made = bench;
  if (made) await made.drop().catch((err) => { console.error(`[live-turned-away] could not drop ${made.name}:`, err); exitCode = 1; });
}
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'live-turned-away.json'), `${JSON.stringify({
  at: new Date().toISOString(), settings: { ROBOT_BACKOFF_FIRST_MS: BACKOFF_FIRST_MS, PROOF_LADDER_WAIT_SCALE: SCALE, workerBrowsers: 1 },
  ...summary, checks, pass: exitCode === 0,
}, null, 1)}\n`);
console.log(`[live-turned-away] ${exitCode === 0 ? 'PASS' : 'FAIL'}`);
process.exit(exitCode);
