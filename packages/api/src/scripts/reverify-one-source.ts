// One-off (queue item "Re-verify the one-source websites", approved 2026-10-21): a full, free
// Verify of every website the one-source check flagged (docs/testing/results/2026-10-20-one-source/
// recertify.md) — the same selection `one-source-recertify.ts` made: the latest completed, clean
// verification certified a field on two or more paths that are all API or all JSON-LD.
//
// Per website, one at a time and one browser at a time, it does what the app does for a full Verify:
//   1. the Verification tab's proof-page capture of every proof page (a Jev reading each, when
//      JEV_SHADOW=1 and TYPESAFE_API_KEY are set), awaited one by one, then the readings awaited;
//   2. `sources.verify`'s body without a session: the binding checks (a refused binding is skipped
//      and recorded), the in-flight check, the verification row, then `runSourceVerification` with
//      `free: true` (no agent at all), awaited;
//   3. the coverage check a passing Verify starts, awaited here instead of fired.
// It signs in as nobody and changes no binding, field, project or org. Writes JSON results beside
// the report. ANTHROPIC_API_KEY must be empty; Jev spend is capped at $1.
//
//   cd packages/api && ANTHROPIC_API_KEY= JEV_SHADOW=1 \
//     CAPTURES_DIR=/c/Users/Marko/Documents/projects/robot-platform/packages/api-server/public/captures \
//     npx tsx src/scripts/reverify-one-source.ts [--dry-run]
import { writeFileSync, mkdirSync } from 'node:fs';
import { and, desc, eq, inArray, isNotNull, isNull, sum } from 'drizzle-orm';
import { coverageChecks, datasets, db, jevReadings, orgs, projects, sources, sourceVerifications } from '@robot/db';
import { readsOneSource, sourceKey, type CertifiedPath, type FieldVerification, type SchemaDefinitionField, type VerificationSet } from '@robot/scraper';
import { contractFields } from '../contract.js';
import { bindingProblemList } from '../verify/binding-input.js';
import { sourceDefinitionHash } from '../verify/current-certification.js';
import { resolveInFlightVerification, startVerificationRow } from '../verify/in-flight.js';
import { runProofPageCaptureInSlot, startProofPageCapture } from '../verify/proof-page-capture.js';
import { runSourceVerification } from '../verify/run-source-verification.js';
import { runCoverageCheck, startCoverageCheck } from '../verify/run-coverage-check.js';
import { jevEnabled } from '../verify/jev-reading.js';

const DRY = process.argv.includes('--dry-run');
const OUT_DIR = process.argv.find((a) => a.startsWith('--out='))?.slice(6) ?? '../../docs/testing/results/2026-10-21-reverify-one-source';
const JEV_PER_PAGE_USD = 0.0003;
const JEV_CAP_USD = 1;

if (process.env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY must be empty for this run.'); process.exit(1); }
if (!process.env.CAPTURES_DIR) { console.error('Set CAPTURES_DIR to the api-server captures folder.'); process.exit(1); }
console.log(`Jev: ${jevEnabled() ? 'on' : 'off'}${DRY ? ' (dry run: nothing is written)' : ''}`);

// --coverage=<checkId,...>: finish existing coverage checks left `running`, one at a time, and exit.
const resume = process.argv.find((a) => a.startsWith('--coverage='))?.slice(11).split(',').filter(Boolean);
if (resume) {
  for (const id of resume) {
    await runCoverageCheck(id);
    const c = await db.query.coverageChecks.findFirst({ where: eq(coverageChecks.id, id), columns: { status: true, error: true } });
    console.log(`coverage check ${id}: ${c?.status}${c?.error ? ` (${c.error})` : ''}`);
  }
  process.exit(0);
}

const oldRule = (ps: CertifiedPath[]) => ps.length >= 2 && (ps.every((p) => p.source === 'api') || ps.every((p) => p.source === 'json-ld'));
const label = (p: CertifiedPath) => `${p.source} ${p.path}${p.container ? ` @ ${p.container}` : ''}`;
const pathIdentity = (p: CertifiedPath) => `${p.source} ${p.path} ${p.transform}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type FieldReport = {
  key: string; name: string;
  before: string[]; beforeSources: string[];
  after: string[]; afterSources: string[];
  firstPathChanged: boolean; passedBefore: true; passedAfter: boolean; failReason?: string;
};
type SiteReport = {
  website: string; sourceId: string; proofPages: number;
  skipped?: string; verificationId?: string; allPassed?: boolean; errorMessage?: string | null;
  failedFields?: Array<{ name: string; reason: string }>;
  fields: FieldReport[];
  proofCaptures?: Array<{ url: string; captureId: string; status: string; error?: string }>;
  jev?: Array<{ url: string; status: string; costUsd: number; error?: string | null }>;
  coverage?: { checkId: string; status: string; error?: string | null } | null;
  agreement?: { asked: number; agreed: number } | null;
};

const withSets = await db
  .select({ id: sources.id, name: sources.name, schemaDefinition: sources.schemaDefinition, verificationSet: sources.verificationSet, project: projects.name, org: orgs.name })
  .from(sources)
  .leftJoin(datasets, eq(datasets.id, sources.datasetId))
  .leftJoin(projects, eq(projects.id, datasets.projectId))
  .leftJoin(orgs, eq(orgs.id, projects.orgId))
  .where(isNotNull(sources.verificationSet));

type Picked = { s: (typeof withSets)[number]; flagged: SchemaDefinitionField[]; results: Record<string, FieldVerification> };
const picked: Picked[] = [];
for (const s of withSets) {
  if (!Array.isArray(s.schemaDefinition)) continue;
  const [latest] = await db
    .select({ results: sourceVerifications.results })
    .from(sourceVerifications)
    .where(and(eq(sourceVerifications.sourceId, s.id), isNotNull(sourceVerifications.completedAt), isNull(sourceVerifications.errorMessage)))
    .orderBy(desc(sourceVerifications.completedAt))
    .limit(1);
  if (!latest) continue;
  const results = latest.results as Record<string, FieldVerification>;
  const flagged = (s.schemaDefinition as SchemaDefinitionField[]).filter((f) => oldRule(results[f.key]?.certified ?? []));
  if (flagged.length) picked.push({ s, flagged, results });
}
const totalPages = picked.reduce((n, p) => n + ((p.s.verificationSet as VerificationSet).urls?.length ?? 0), 0);
const projected = totalPages * JEV_PER_PAGE_USD;
console.log(`${picked.length} website(s), ${picked.reduce((n, p) => n + p.flagged.length, 0)} flagged field(s), ${totalPages} proof page(s); projected Jev spend $${projected.toFixed(4)}`);
if (projected > JEV_CAP_USD) { console.error(`Projected Jev spend over $${JEV_CAP_USD}; stopping.`); process.exit(1); }

const startedAt = new Date();
async function jevSpentSinceStart(): Promise<number> {
  const [r] = await db.select({ usd: sum(jevReadings.costUsd) }).from(jevReadings).where(and(isNotNull(jevReadings.costUsd), inArray(jevReadings.sourceId, picked.map((p) => p.s.id))));
  return Number(r?.usd ?? 0);
}
const jevBaseline = await jevSpentSinceStart();

const reports: SiteReport[] = [];
mkdirSync(OUT_DIR, { recursive: true });
const save = () => writeFileSync(`${OUT_DIR}/results.json`, JSON.stringify({ startedAt, dry: DRY, sites: reports }, null, 2));

for (const { s, flagged, results: beforeResults } of picked) {
  const website = `${s.org ?? '?'}/${s.project ?? '?'}/${s.name}`;
  const set = s.verificationSet as VerificationSet;
  const rep: SiteReport = {
    website, sourceId: s.id, proofPages: set.urls.length,
    fields: flagged.map((f) => {
      const before = beforeResults[f.key]!.certified;
      return { key: f.key, name: f.name, before: before.map(label), beforeSources: [...new Set(before.map(sourceKey))], after: [], afterSources: [], firstPathChanged: false, passedBefore: true, passedAfter: false };
    }),
  };
  reports.push(rep);
  console.log(`\n== ${website} (${flagged.map((f) => f.name).join(', ')})`);

  // sources.verify's checks, as the mutation runs them (no session: this is not a user's request).
  const source = await db.query.sources.findFirst({
    where: eq(sources.id, s.id),
    columns: { id: true, schemaDefinition: true, verificationSet: true, variantSetup: true },
    with: { dataset: { columns: { schema: true, variantMode: true } } },
  });
  const hash = source ? sourceDefinitionHash(source) : null;
  if (!source || !hash) { rep.skipped = `Source has no schema definition to verify`; console.log(`  skipped: ${rep.skipped}`); save(); continue; }
  const defs = (source.schemaDefinition ?? []) as SchemaDefinitionField[];
  const problems = bindingProblemList({
    urls: set.urls, ...(set.listing_url ? { listingUrl: set.listing_url } : {}),
    descriptions: Object.fromEntries(defs.map((d) => [d.key, d.description])),
    expected: set.expected, ...(set.marks ? { marks: set.marks } : {}),
    ...(set.absent ? { absent: set.absent } : {}), ...(set.defaults ? { defaults: set.defaults } : {}),
  }, contractFields(source.dataset?.schema));
  if (problems.length) { rep.skipped = `binding refused: ${problems.map((p) => p.text).join('; ')}`; console.log(`  skipped: ${rep.skipped}`); save(); continue; }
  if (DRY) { console.log(`  would verify (${set.urls.length} proof pages)`); save(); continue; }

  const spent = (await jevSpentSinceStart()) - jevBaseline;
  if (spent + set.urls.length * JEV_PER_PAGE_USD > JEV_CAP_USD) { rep.skipped = `Jev spend cap: $${spent.toFixed(4)} spent`; console.log(`  stopped: ${rep.skipped}`); save(); break; }

  const inFlight = await resolveInFlightVerification(db, s.id);
  if (inFlight) { rep.skipped = `a verification is already in flight (${inFlight.id})`; console.log(`  skipped: ${rep.skipped}`); save(); continue; }

  // 1. Proof pages, captured as the Verification tab captures them — one at a time.
  rep.proofCaptures = [];
  const captureIds: string[] = [];
  for (const url of set.urls) {
    const { captureId } = await startProofPageCapture(s.id, url, { fire: false });
    await runProofPageCaptureInSlot(captureId);
    captureIds.push(captureId);
    const row = await db.query.captures.findFirst({ where: (c, { eq: e }) => e(c.id, captureId), columns: { metadata: true } });
    const m = row?.metadata as { status: string; error?: string } | undefined;
    rep.proofCaptures.push({ url, captureId, status: m?.status ?? '?', ...(m?.error ? { error: m.error } : {}) });
    console.log(`  proof page ${m?.status}${m?.error ? ` (${m.error})` : ''}: ${url}`);
  }
  // Their Jev readings (started un-awaited by each capture): wait for them to finish. The last
  // capture's row may not be inserted yet, so wait (up to 15 s) for a row per captured page too —
  // a page with nothing ambiguous to ask never gets one.
  const deadline = Date.now() + 90_000;
  const rowDeadline = Date.now() + 15_000;
  const captured = rep.proofCaptures.filter((p) => p.status === 'captured').length;
  let readings = await db.select().from(jevReadings).where(inArray(jevReadings.captureId, captureIds));
  while (Date.now() < deadline && (readings.some((r) => r.status === 'running') || (readings.length < captured && Date.now() < rowDeadline))) {
    await sleep(2000);
    readings = await db.select().from(jevReadings).where(inArray(jevReadings.captureId, captureIds));
  }
  rep.jev = readings.map((r) => ({ url: r.url, status: r.status, costUsd: Number(r.costUsd ?? 0), error: r.error }));
  console.log(`  Jev readings: ${readings.length} (${readings.map((r) => r.status).join(', ') || 'none'})`);

  // 2. The verification row and its run, free, awaited.
  // Under the website row lock, as every Verify start (fix wave 1, item 5): a Verify or refresh begun meanwhile wins.
  const start = await startVerificationRow(db, s.id, hash);
  if (start.status === 'in-progress') { rep.skipped = `a verification is already in flight (${start.verificationId})`; console.log(`  skipped: ${rep.skipped}`); save(); continue; }
  const row = { id: start.verificationId };
  rep.verificationId = row!.id;
  // `runSourceVerification` fires the coverage start without awaiting it, so the promise is taken
  // synchronously here (the 2026-10-21 run first set it after an await, raced, and two checks ran
  // beside the next websites and were cut off by the exit; finished afterwards with --coverage=).
  let coverageRun: Promise<string | null> | null = null;
  await runSourceVerification(s.id, row!.id, {
    free: true,
    // 3. The coverage check a passing Verify starts — run here, awaited below, so one browser at a time.
    startCoverage: (sourceId, verificationId) => {
      const started = startCoverageCheck(sourceId, verificationId, { fire: false });
      coverageRun = started.then(async (st) => { if (st.status === 'started') await runCoverageCheck(st.checkId); return st.checkId; });
      return started;
    },
  });
  const v = await db.query.sourceVerifications.findFirst({ where: eq(sourceVerifications.id, row!.id) });
  rep.allPassed = v?.allPassed ?? false;
  rep.errorMessage = v?.errorMessage ?? null;
  const after = (v?.results ?? {}) as Record<string, FieldVerification>;
  rep.failedFields = defs.filter((f) => after[f.key] && !passed(after[f.key])).map((f) => ({ name: f.name, reason: failReason(after[f.key]!) }));
  for (const fr of rep.fields) {
    const before = beforeResults[fr.key]!.certified;
    const now = after[fr.key]?.certified ?? [];
    fr.after = now.map(label);
    fr.afterSources = [...new Set(now.map(sourceKey))];
    fr.firstPathChanged = (before[0] ? pathIdentity(before[0]) : null) !== (now[0] ? pathIdentity(now[0]) : null);
    fr.passedAfter = passed(after[fr.key]);
    if (!fr.passedAfter) fr.failReason = after[fr.key] ? failReason(after[fr.key]!) : 'no result';
    console.log(`  ${fr.name}: ${fr.passedAfter ? 'passed' : `FAILED (${fr.failReason})`}; sources ${fr.beforeSources.join('+')} -> ${fr.afterSources.join('+') || '-'}; first path ${fr.firstPathChanged ? `CHANGED ${fr.before[0]} -> ${fr.after[0] ?? '(none)'}` : 'same'}${readsOneSource(now) ? ' (one source)' : ''}`);
  }
  console.log(`  verification ${row!.id}: ${rep.errorMessage ? `error: ${rep.errorMessage}` : rep.allPassed ? 'passed' : `not passed (${rep.failedFields.map((f) => f.name).join(', ')})`}`);

  let coverageId: string | null = null;
  if (coverageRun) { console.log('  coverage check running...'); coverageId = await (coverageRun as Promise<string | null>); }
  if (coverageId) {
    const c = await db.query.coverageChecks.findFirst({ where: eq(coverageChecks.id, coverageId), columns: { id: true, status: true, error: true } });
    rep.coverage = c ? { checkId: c.id, status: c.status, error: c.error } : null;
    console.log(`  coverage check: ${c?.status}${c?.error ? ` (${c.error})` : ''}`);
  }
  // The Jev agreement write runSourceVerification fires un-awaited.
  for (let i = 0; i < 10; i++) {
    const a = await db.query.sourceVerifications.findFirst({ where: eq(sourceVerifications.id, row!.id), columns: { verifyAgreement: true } });
    if (a?.verifyAgreement) { const g = a.verifyAgreement as { asked: number; agreed: number }; rep.agreement = { asked: g.asked, agreed: g.agreed }; break; }
    if (readings.length === 0) break;
    await sleep(1000);
  }
  save();
}

function passed(r: FieldVerification | undefined): boolean {
  return !!r && (r.certified.length > 0 || r.defaultOnly === true || r.notOnWebsite === true);
}
function failReason(r: FieldVerification): string {
  const cells = Object.entries(r.cells).filter(([, c]) => c.status !== 'pass')
    .map(([url, c]) => `${url}: ${c.status === 'fail' ? `${c.reason}${c.found ? ` (found ${JSON.stringify(c.found.slice(0, 60))})` : ''}` : c.status}`);
  return [r.failReason, ...cells].filter(Boolean).join('; ') || 'no certified path';
}

const finalSpent = (await jevSpentSinceStart()) - jevBaseline;
console.log(`\nDone. Jev spend this run: $${finalSpent.toFixed(6)}`);
save();
writeFileSync(`${OUT_DIR}/results.json`, JSON.stringify({ startedAt, finishedAt: new Date(), dry: DRY, jevSpentUsd: finalSpent, sites: reports }, null, 2));
process.exit(0);
