// packages/api/src/isolation/two-orgs.ts
// Two throwaway organisations, A and B, each holding one of everything a customer owns (spec 2026-10-24 tenant
// isolation §2.1): the procedure, money and file-route sweeps aim A's caller at B's ids. Cheap things go through the
// real procedures; anything that would start work (a run, a capture, a Verify, a check) is inserted directly, as the
// seed-* helpers do. `cleanup` removes every org the two owners own (a sweep may create one), the four users and the
// files written. Test-only: it reaches `deleteOwnOrg`, which asserts with vitest's `expect`.
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { eq, inArray, sql, type SQL } from 'drizzle-orm';
import {
  db, orgs, users, memberships, sources, runs, runItems, captures, extractions, sourceVerifications, coverageChecks,
  staffActions, emailMessages, runFiles, jobs,
} from '@robot/db';
import type { CertifiedPath } from '@robot/scraper';
import { signedInCaller, deleteOwnOrg, type SignedIn } from '../test-helpers/identity.js';
import { createProjectWithSource } from '../test-helpers/customer-source.js';
import { seedPassingVerification } from '../test-helpers/seed-coverage-check.js';
import { seedDriftCheck } from '../test-helpers/seed-drift-check.js';
import { seedJevReading } from '../test-helpers/seed-jev-reading.js';
import { getCapturesDir } from '../persist-screenshot.js';
import { jobQueueName } from '../jobs/queue.js';

/** What org A's and B's run and verification cost (the money sweep's amounts). */
export const FIXTURE_COST = { runUsd: '0.1234', verificationUsd: '0.0300' } as const;

export type OrgFixture = {
  tag: string;
  owner: SignedIn;
  member: { id: string; email: string };
  org: { id: string; slug: string; name: string };
  projectId: string; projectSlug: string; projectName: string; datasetId: string;
  sourceId: string; sourceSlug: string; sourceName: string; host: string; urls: string[];
  keys: { title: string; price: string }; axisKey: string;
  runId: string; itemIds: string[]; runCaptureId: string;
  captureId: string; tileFile: string;
  verificationId: string; driftCheckId: string; coverageCheckId: string; jevReadingId: string;
  staffActionId: string; staffEmail: string; emailMessageId: string; webhookSecret: string;
};

export type TwoOrgs = { a: OrgFixture; b: OrgFixture; capturesDir: string; cleanup: () => Promise<void> };

const TITLE_PATH: CertifiedPath = { source: 'json-ld', path: 'name', transform: 'identity' };
const PRICE_PATH: CertifiedPath = { source: 'json-ld', path: 'offers.price', transform: 'identity' };

/** What a build has made so far, so a build that fails halfway still leaves nothing behind. */
type Made = { users: string[]; files: string[] };

async function buildOrg(tag: string, dir: string, made: Made): Promise<OrgFixture> {
  const owner = await signedInCaller(tag);
  made.users.push(owner.user.id);
  const host = `test-${tag}.example.com`;
  const urls = [1, 2, 3].map((n) => `https://${host}/p/${n}`);
  // The project, its dataset and fields, and the website with its binding: the real procedures (cheap, no work).
  const site = await createProjectWithSource(owner.caller, {
    tag,
    urls,
    fields: [{ name: 'Title', type: 'text' }, { name: 'Price', type: 'money' }],
    expected: {
      Title: Object.fromEntries(urls.map((u, i) => [u, `Lamp ${i + 1}`])),
      Price: Object.fromEntries(urls.map((u, i) => [u, `${19 + i}.99`])),
    },
  });
  const keys = { title: site.keys.Title!, price: site.keys.Price! };
  const axis = await owner.caller.datasets.addAxis({ datasetId: site.datasetId, name: 'Colour' });

  // The variant setup and the webhook secret: direct (setVariantSetup and sources.update are covered by the sweep).
  const webhookSecret = randomBytes(32).toString('hex');
  await db.update(sources).set({ variantSetup: { method: 'none', axes: [], confirmedAt: new Date().toISOString() }, webhookSecret })
    .where(eq(sources.id, site.sourceId));

  // A second member.
  const [member] = await db.insert(users)
    .values({ email: `${tag}-member-${randomUUID().slice(0, 8)}@example.com`, name: `Member ${tag}`, avatarColour: '#52a8ff' })
    .returning({ id: users.id, email: users.email });
  made.users.push(member!.id);
  await db.insert(memberships).values({ userId: member!.id, orgId: owner.org.id, role: 'member' });

  // A completed run with a cost: one extracted product, one failed (a gap), its delivered files.
  const [run] = await db.insert(runs)
    .values({ sourceId: site.sourceId, status: 'completed', startedAt: new Date(), completedAt: new Date(), resultCount: 1, costUsd: FIXTURE_COST.runUsd })
    .returning({ id: runs.id });
  const [runCapture] = await db.insert(captures).values({ sourceId: site.sourceId, runId: run!.id, url: urls[0]! }).returning({ id: captures.id });
  const [extraction] = await db.insert(extractions)
    .values({ sourceId: site.sourceId, captureId: runCapture!.id, runId: run!.id, data: [{ [keys.title]: 'Lamp 1', [keys.price]: '19.99', _url: urls[0] }], rowCount: 1 })
    .returning({ id: extractions.id });
  const items = await db.insert(runItems).values([
    { runId: run!.id, kind: 'detail', url: urls[0]!, status: 'done', extractionId: extraction!.id, completedAt: new Date() },
    { runId: run!.id, kind: 'detail', url: urls[1]!, status: 'failed', error: 'This page could not be read.' },
  ]).returning({ id: runItems.id });
  await db.insert(runFiles).values((['csv', 'json', 'xlsx'] as const).map((format) => ({
    runId: run!.id, format, filename: `site-${tag}.${format}`, bytes: Buffer.from(`${tag}:${format}`), rows: 1,
  })));

  // A proof-page capture with its tile and its sidecar on disk (no browser).
  const tileFile = `iso-${randomUUID()}.png`;
  const now = new Date().toISOString();
  const [capture] = await db.insert(captures).values({
    sourceId: site.sourceId, url: urls[0]!,
    metadata: { kind: 'proof-page', status: 'captured', url: urls[0], startedAt: now, capturedAt: now, tiles: [`/captures/${tileFile}`], boxes: [], pageHeight: 10, capturedHeight: 10, contentHeight: 10, title: 'Lamp 1' },
  }).returning({ id: captures.id });
  await mkdir(dir, { recursive: true });
  made.files.push(join(dir, tileFile), join(dir, `${capture!.id}.capture.json`));
  await writeFile(join(dir, tileFile), Buffer.from(`tile ${tag}`));
  await writeFile(join(dir, `${capture!.id}.capture.json`), JSON.stringify({
    url: urls[0],
    html: '<html><head><title>Lamp 1</title></head><body><h1>Lamp 1</h1><p class="price">19.99</p></body></html>',
    structuredData: { ldJson: [{ '@type': 'Product', name: 'Lamp 1', offers: { price: '19.99' } }], nextData: null, initialState: null, meta: {} },
    interceptedRequests: [],
  }));
  const { readingId } = await seedJevReading({ sourceId: site.sourceId, captureId: capture!.id, url: urls[0]!, answers: {} });

  // A drift check (with its own baseline), then the newest, passing, paid verification, then a coverage check.
  const { checkId: driftCheckId } = await seedDriftCheck(site.sourceId, keys.price);
  const { verificationId } = await seedPassingVerification(site.sourceId, { [keys.title]: [TITLE_PATH], [keys.price]: [PRICE_PATH] });
  await db.update(sourceVerifications).set({ costUsd: FIXTURE_COST.verificationUsd, aiCalls: 1 }).where(eq(sourceVerifications.id, verificationId));
  const [coverage] = await db.insert(coverageChecks)
    .values({ sourceId: site.sourceId, verificationId, status: 'done', completedAt: new Date() })
    .returning({ id: coverageChecks.id });

  // A staff action on the run, and an email message.
  const staffEmail = `staff-${tag}@example.com`;
  const [action] = await db.insert(staffActions).values({
    orgId: owner.org.id, userId: null, actorEmail: staffEmail, action: 'crawl.execute', summary: `Ran an extraction on Site ${tag}`,
    projectId: site.projectId, sourceId: site.sourceId, runId: run!.id,
  }).returning({ id: staffActions.id });
  const [mail] = await db.insert(emailMessages).values({
    orgId: owner.org.id, userId: owner.user.id, kind: 'attention', dedupeKey: `isolation:${owner.org.id}`, toAddress: owner.user.email,
    subject: `Site ${tag} needs your attention`, text: 'Price needs you.\n', html: '<p>Price needs you.</p>', status: 'skipped',
  }).returning({ id: emailMessages.id });

  return {
    tag, owner, member: { id: member!.id, email: member!.email },
    org: { id: owner.org.id, slug: owner.org.slug, name: owner.org.name },
    projectId: site.projectId, projectSlug: site.projectSlug, projectName: `Test ${tag}`, datasetId: site.datasetId,
    sourceId: site.sourceId, sourceSlug: site.sourceSlug, sourceName: `Site ${tag}`, host, urls,
    keys, axisKey: axis.key,
    runId: run!.id, itemIds: items.map((i) => i.id), runCaptureId: runCapture!.id,
    captureId: capture!.id, tileFile,
    verificationId, driftCheckId, coverageCheckId: coverage!.id, jevReadingId: readingId,
    staffActionId: action!.id, staffEmail, emailMessageId: mail!.id, webhookSecret,
  };
}

/**
 * Removes what a build made: its files; every org its users own (their personal orgs, and any a sweep created with
 * `orgs.create`), each through `deleteOwnOrg`'s guard (never `default`), so projects, websites, runs, checks, messages
 * and staff actions cascade; then `alsoOrgs` (a personal org whose owner column were ever cleared); then the users.
 */
async function removeMade(made: Made, alsoOrgs: string[] = []): Promise<void> {
  for (const file of made.files) await rm(file, { force: true });
  if (made.users.length > 0) {
    const owned = await db.select({ id: orgs.id }).from(orgs).where(inArray(orgs.ownerUserId, made.users));
    for (const o of owned) await deleteOwnOrg(o.id);
  }
  for (const id of alsoOrgs) await deleteOwnOrg(id);
  if (made.users.length > 0) await db.delete(users).where(inArray(users.id, made.users));
}

export async function buildTwoOrgs(opts: { tag: string; capturesDir?: string }): Promise<TwoOrgs> {
  const dir = opts.capturesDir ?? getCapturesDir();
  const stamp = `${Date.now()}-${randomUUID().slice(0, 4)}`;
  const made: Made = { users: [], files: [] };
  let a: OrgFixture;
  let b: OrgFixture;
  try {
    a = await buildOrg(`${opts.tag}-${stamp}-a`, dir, made);
    b = await buildOrg(`${opts.tag}-${stamp}-b`, dir, made);
  } catch (err) {
    // A build that fails halfway leaves nothing behind either.
    await removeMade(made);
    throw err;
  }
  return { a, b, capturesDir: dir, cleanup: () => removeMade(made, [a.org.id, b.org.id]) };
}

/** Everything that names `f`: what another org's answer must never contain. */
export function needlesOf(f: OrgFixture): string[] {
  return [
    f.org.id, f.org.slug, f.org.name, f.owner.user.id, f.owner.user.email, f.member.id, f.member.email,
    f.projectId, f.projectSlug, f.projectName, f.datasetId, f.sourceId, f.sourceSlug, f.sourceName, f.host,
    f.runId, ...f.itemIds, f.runCaptureId, f.captureId, f.tileFile, f.verificationId, f.driftCheckId, f.coverageCheckId,
    f.jevReadingId, f.staffActionId, f.staffEmail, f.emailMessageId, f.webhookSecret,
  ];
}

const sourcesOf = (orgId: string) =>
  sql`(SELECT s.id FROM sources s JOIN datasets d ON d.id = s.dataset_id JOIN projects p ON p.id = d.project_id WHERE p.org_id = ${orgId})`;
const runsOf = (orgId: string) => sql`(SELECT r.id FROM runs r WHERE r.source_id IN ${sourcesOf(orgId)})`;

function snapshotQueries(f: OrgFixture): Record<string, SQL> {
  const org = f.org.id;
  const people = sql`(${f.owner.user.id}::uuid, ${f.member.id}::uuid)`;
  return {
    orgs: sql`SELECT * FROM orgs WHERE id = ${org}`,
    users: sql`SELECT * FROM users WHERE id IN ${people}`,
    sessions: sql`SELECT * FROM sessions WHERE user_id IN ${people}`,
    memberships: sql`SELECT * FROM memberships WHERE org_id = ${org}`,
    projects: sql`SELECT * FROM projects WHERE org_id = ${org}`,
    datasets: sql`SELECT d.* FROM datasets d JOIN projects p ON p.id = d.project_id WHERE p.org_id = ${org}`,
    input_sets: sql`SELECT i.* FROM input_sets i JOIN projects p ON p.id = i.project_id WHERE p.org_id = ${org}`,
    sources: sql`SELECT * FROM sources WHERE id IN ${sourcesOf(org)}`,
    runs: sql`SELECT * FROM runs WHERE source_id IN ${sourcesOf(org)}`,
    run_items: sql`SELECT * FROM run_items WHERE run_id IN ${runsOf(org)}`,
    run_files: sql`SELECT id, run_id, format, filename, md5(bytes) AS bytes_md5, rows, created_at FROM run_files WHERE run_id IN ${runsOf(org)}`,
    webhook_deliveries: sql`SELECT * FROM webhook_deliveries WHERE run_id IN ${runsOf(org)}`,
    captures: sql`SELECT * FROM captures WHERE source_id IN ${sourcesOf(org)}`,
    extractions: sql`SELECT * FROM extractions WHERE source_id IN ${sourcesOf(org)}`,
    source_verifications: sql`SELECT * FROM source_verifications WHERE source_id IN ${sourcesOf(org)}`,
    drift_checks: sql`SELECT * FROM drift_checks WHERE source_id IN ${sourcesOf(org)}`,
    coverage_checks: sql`SELECT * FROM coverage_checks WHERE source_id IN ${sourcesOf(org)}`,
    field_holds: sql`SELECT * FROM field_holds WHERE source_id IN ${sourcesOf(org)}`,
    value_refreshes: sql`SELECT * FROM value_refreshes WHERE source_id IN ${sourcesOf(org)}`,
    jev_readings: sql`SELECT * FROM jev_readings WHERE source_id IN ${sourcesOf(org)}`,
    staff_actions: sql`SELECT * FROM staff_actions WHERE org_id = ${org}`,
    email_messages: sql`SELECT * FROM email_messages WHERE org_id = ${org}`,
  };
}

/** Every row `f` owns, in a stable order: equal before and after a call means the call changed nothing of `f`. */
export async function snapshotOrg(f: OrgFixture): Promise<string> {
  const out: Record<string, unknown> = {};
  for (const [table, inner] of Object.entries(snapshotQueries(f))) {
    const res = await db.execute(sql`SELECT coalesce(json_agg(t ORDER BY row_to_json(t)::text), '[]'::json) AS rows FROM (${inner}) t`);
    out[table] = (res as unknown as Array<{ rows: unknown }>)[0]!.rows;
  }
  return JSON.stringify(out);
}

/** Jobs on this test file's queue, any status: a refused call must leave it as it was. */
export async function queuedJobCount(): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(jobs).where(eq(jobs.queue, jobQueueName()));
  return Number(row!.n);
}
