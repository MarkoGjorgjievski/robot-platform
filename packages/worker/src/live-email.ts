// The email live check (spec 2026-10-24 email §5, the queue item's "done when"). Free, local, keyless: its own Mailpit
// container (robot-mailpit-check, random ports, removed at the end), a throwaway database, the run-speed fixture shop
// and an in-process worker sending to that Mailpit. Each of the five messages is triggered through its real code path
// — a website check that finds a proof page gone, a run whose pages are gone, ops.enterOrg, setRole, remove — then
// read back from Mailpit's API: once each, to the right address, with the right subject and link; repeats send nothing.
//   cd packages/worker && npx tsx src/live-email.ts
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = join(here, '..', '..', '..');
const OUT = join(repo, 'docs', 'testing', 'results', '2026-10-24-email');
const MAILPIT_IMAGE = 'axllent/mailpit:v1.32.0';
const CONTAINER = 'robot-mailpit-check';
const APP = 'http://app.live-email.test';
const stamp = Date.now();
const OPERATOR = `live-email-op-${stamp}@example.com`;
try { loadEnvFile(join(repo, '.env')); } catch { /* no .env: the default URL below */ }
const { createBenchDatabase } = await import('./bench/bench-db.js');
process.env.JOB_QUEUE = `live-email-${randomUUID()}`.slice(0, 64);
Object.assign(process.env, {
  ANTHROPIC_API_KEY: '', JEV_SHADOW: '', TYPESAFE_API_KEY: '', WEBSITE_CHECKS: 'off', RECURRING_RUNS: 'off',
  PUBLIC_APP_URL: APP, OPS_EMAILS: OPERATOR, MAIL_FROM: '',
});
const capturesDir = mkdtempSync(join(tmpdir(), 'live-email-captures-'));
process.env.CAPTURES_DIR = capturesDir;

const docker = (...args: string[]) => execFileSync('docker', args, { encoding: 'utf8' }).trim();

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
  console.log(`[live-email] ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) exitCode = 1;
};
const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n');

type MailpitMessage = { ID: string; To: Array<{ Address: string }>; Subject: string };
let mailpit = '';
const inbox = async () => ((await (await fetch(`${mailpit}/api/v1/messages?limit=100`)).json()) as { messages: MailpitMessage[] }).messages;
const bodyOf = async (id: string) => (await (await fetch(`${mailpit}/api/v1/message/${id}`)).json()) as { Text: string; HTML: string };

let bench: Awaited<ReturnType<typeof createBenchDatabase>> | null = null;
let closeShop: (() => Promise<void>) | null = null;
let stopWorker: (() => Promise<void>) | null = null;
let containerStarted = false;
try {
  try { docker('rm', '-f', CONTAINER); } catch { /* none left from an earlier check */ }
  docker('run', '-d', '--name', CONTAINER, '-p', '127.0.0.1::1025', '-p', '127.0.0.1::8025', MAILPIT_IMAGE);
  containerStarted = true;
  const portOf = (p: string) => docker('port', CONTAINER, `${p}/tcp`).split('\n')[0]!.split(':').pop()!;
  process.env.SMTP_URL = `smtp://127.0.0.1:${portOf('1025')}`;
  mailpit = `http://127.0.0.1:${portOf('8025')}`;
  await until('Mailpit', 60_000, () => fetch(`${mailpit}/api/v1/messages`).then((r) => r.ok).catch(() => false));

  bench = await createBenchDatabase(process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/robot_platform');
  // Before anything imports @robot/db: every row of this check goes to the throwaway database.
  process.env.DATABASE_URL = bench.url;

  const { startFixtureShop, INSTANT } = await import('./bench/fixture-shop.js');
  const shop = await startFixtureShop({ sites: 1, latency: INSTANT });
  closeShop = shop.close;
  const site = shop.sites[0]!;
  const { setBrowserOwner } = await import('@robot/browser');
  setBrowserOwner(String(process.pid));
  const { benchSignIn, benchCallerFor, seedCertifiedWebsite } = await import('./bench/seed.js');
  const { db, datasets, emailMessages, memberships, projects, runItems, runs, sources } = await import('@robot/db');
  const { and, eq } = await import('drizzle-orm');

  const owner = await benchSignIn(`live-email-owner-${stamp}@example.com`);
  const admin = await benchSignIn(`live-email-admin-${stamp}@example.com`);
  const member = await benchSignIn(`live-email-member-${stamp}@example.com`);
  const outsider = await benchSignIn(`live-email-outsider-${stamp}@example.com`);
  await db.insert(memberships).values([
    { userId: admin.userId, orgId: owner.orgId, role: 'admin' },
    { userId: member.userId, orgId: owner.orgId, role: 'member' },
  ]);
  const { sourceId } = await seedCertifiedWebsite(owner.caller, site);
  const [place] = await db.select({ website: sources.name, siteSlug: sources.slug, projectSlug: projects.slug }).from(sources)
    .innerJoin(datasets, eq(sources.datasetId, datasets.id)).innerJoin(projects, eq(datasets.projectId, projects.id)).where(eq(sources.id, sourceId));
  const siteLink = `${APP}/projects/${place!.projectSlug}/sites/${place!.siteSlug}`;
  const rowsOf = (kind: string) => db.select().from(emailMessages).where(and(eq(emailMessages.orgId, owner.orgId), eq(emailMessages.kind, kind)));

  const { readWorkerConfig } = await import('./config.js');
  const { startWorker } = await import('./worker.js');
  const worker = await startWorker({ ...readWorkerConfig({ JOB_QUEUE: process.env.JOB_QUEUE }), websiteChecks: false, recurringRuns: false });
  stopWorker = () => worker.stop();
  const { awaitJob, enqueue, notifyRunFailed, startRunJob } = await import('@robot/api/jobs');

  // 1. Needs attention: proof page 2 is gone; the scheduled website check (the worker's real job) finds it.
  shop.gone.add('/p/2');
  await awaitJob(await enqueue(db, 'website-check', { sourceId }), 5 * 60_000);
  const attention = await until('the attention emails', 60_000, async () => { const r = await rowsOf('attention'); return r.length >= 2 ? r : null; });
  check('needs attention: one message each to the owner and the admin', sameSet(attention.map((r) => r.toAddress), [owner.email, admin.email]), attention.map((r) => r.toAddress).join(', '));
  await awaitJob(await enqueue(db, 'website-check', { sourceId }), 5 * 60_000);
  check('a second check while it still needs attention queues nothing more', (await rowsOf('attention')).length === 2);

  // 2. A failed run: both of its pages are gone.
  shop.gone.add('/p/901');
  shop.gone.add('/p/902');
  const [run] = await db.insert(runs).values({ sourceId, status: 'pending' }).returning({ id: runs.id });
  await db.insert(runItems).values([901, 902].map((id) => ({ runId: run!.id, kind: 'detail', url: site.productUrl(id), status: 'pending' })));
  await startRunJob(db, { runId: run!.id });
  const settled = await until('the run to settle', 5 * 60_000, async () => {
    const r = await db.query.runs.findFirst({ where: eq(runs.id, run!.id) });
    return r && ['completed', 'partial', 'failed', 'cancelled'].includes(r.status) ? r : null;
  });
  check('the run failed', settled.status === 'failed', `${settled.status}: ${settled.errorMessage ?? ''}`);
  const failed = await until('the failed-run emails', 60_000, async () => { const r = await rowsOf('run-failed'); return r.length >= 2 ? r : null; });
  check('a failed run: one message each to the owner and the admin', sameSet(failed.map((r) => r.toAddress), [owner.email, admin.email]));
  await notifyRunFailed(db, run!.id);
  check('the same failed run reported again queues nothing more', (await rowsOf('run-failed')).length === 2);

  // 3. Staff enter the organisation; entering again (already inside) is no new visit.
  const op = await benchSignIn(OPERATOR);
  await op.caller.ops.enterOrg({ sourceId });
  await (await benchCallerFor(op.token)).ops.enterOrg({ sourceId });
  const staff = await rowsOf('staff-access');
  check('staff access: one message each to the owner and the admin, none to the operator or the member', sameSet(staff.map((r) => r.toAddress), [owner.email, admin.email]));

  // 4. A role change; the same role again changes nothing.
  await owner.caller.orgs.members.setRole({ userId: member.userId, role: 'admin' });
  await owner.caller.orgs.members.setRole({ userId: member.userId, role: 'admin' });
  const role = await rowsOf('role-changed');
  check('a role change: one message to that member', sameSet(role.map((r) => r.toAddress), [member.email]));
  // A message is sent only while its recipient may still get it (send-email's recheck): let the role change
  // go out before the removal, or the removal would rightly turn it into `skipped`.
  await until('the role-change email to be sent', 60_000, async () => (await rowsOf('role-changed')).every((r) => r.status !== 'queued'));

  // 5. A removal; removing them again is refused.
  await owner.caller.orgs.members.remove({ userId: member.userId });
  let refused = false;
  try { await owner.caller.orgs.members.remove({ userId: member.userId }); } catch { refused = true; }
  const removed = await rowsOf('removed');
  check('a removal: one message to the former member; again is refused', refused && sameSet(removed.map((r) => r.toAddress), [member.email]));

  // Mailpit: exactly these eight, each once, with its link.
  const expected = [
    ...[owner, admin].map((u) => ({ to: u.email, subject: `${place!.website} needs your attention`, link: siteLink })),
    ...[owner, admin].map((u) => ({ to: u.email, subject: `A run of ${place!.website} failed`, link: `${siteLink}/runs/${run!.id}` })),
    ...[owner, admin].map((u) => ({ to: u.email, subject: 'Our team is working in your organisation', link: `${APP}/settings` })),
    { to: member.email, subject: `Your role in ${owner.orgName} changed`, link: `${APP}/settings` },
    { to: member.email, subject: `You were removed from ${owner.orgName}`, link: `${APP}/login` },
  ];
  await until(`${expected.length} messages in Mailpit`, 2 * 60_000, async () => (await inbox()).length >= expected.length);
  await new Promise((r) => setTimeout(r, 5000));
  const mail = await inbox();
  check(`Mailpit holds exactly ${expected.length} messages`, mail.length === expected.length, String(mail.length));
  const bodies = new Map<string, { Text: string; HTML: string }>();
  for (const m of mail) bodies.set(m.ID, await bodyOf(m.ID));
  for (const e of expected) {
    const hits = mail.filter((m) => m.Subject === e.subject && m.To.some((t) => t.Address.toLowerCase() === e.to));
    check(`"${e.subject}" reached ${e.to} once`, hits.length === 1, String(hits.length));
    const b = hits[0] ? bodies.get(hits[0].ID) : undefined;
    check(`… with its link ${e.link}`, !!b && b.Text.includes(e.link) && b.HTML.includes(e.link));
  }
  const strangers = [op.email, outsider.email];
  check('nothing reached the operator or anyone outside the organisation', !mail.some((m) => m.To.some((t) => strangers.includes(t.Address.toLowerCase()))));
  check('no message names the shop’s address', [...bodies.values()].every((b) => !b.Text.includes(site.host) && !b.HTML.includes(site.host)));
  const all = await db.select().from(emailMessages);
  check('every message row is sent', all.length === expected.length && all.every((r) => r.status === 'sent'), all.map((r) => r.status).join(', '));

  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'live-email.json'), JSON.stringify({
    at: new Date().toISOString(), image: MAILPIT_IMAGE, runId: run!.id, runStatus: settled.status,
    messages: mail.map((m) => ({ to: m.To.map((t) => t.Address), subject: m.Subject })), checks,
  }, null, 1));
} catch (err) {
  console.error('[live-email] failed:', err);
  exitCode = 1;
} finally {
  await stopWorker?.().catch(() => {});
  await closeShop?.().catch(() => {});
  rmSync(capturesDir, { recursive: true, force: true });
  if (containerStarted) { try { docker('rm', '-f', CONTAINER); } catch (err) { console.error(`[live-email] could not remove ${CONTAINER}:`, err); exitCode = 1; } }
  const made = bench;
  if (made) await made.drop().catch((err) => { console.error(`[live-email] could not drop ${made.name}:`, err); exitCode = 1; });
}
process.exit(exitCode);
