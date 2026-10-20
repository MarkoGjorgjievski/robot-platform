// Read-only check (spec 2026-10-20 one-source §7). For every website whose latest completed
// verification certified a field on two or more paths that read one source by the old rule (all
// API, or all JSON-LD), certify that field again on that verification's own stored captures — no
// agent, no domain store, no live page: free — and print the stored paths beside the new ones.
// Select queries only; nothing is written to the database or the capture files.
//
// Websites are named by their org/project/website NAMES as the database has them (not slugs) —
// this is Marko's own test data, so the names are the readable identifier.
//
// Controller ruling 2026-10-20 (packages/scraper/src/verify/certify.ts `isUncappedSource`): XPath
// paths are exempt from the 2-per-source cap and never flagged as "one source" — already true of
// the old rule below too, since an all-XPath field never matches `every(source === 'api')` or
// `every(source === 'json-ld')`. No code change needed; reported for the record.
//
//   cd packages/api && CAPTURES_DIR=/c/Users/Marko/Documents/projects/robot-platform/packages/api-server/public/captures npx tsx src/scripts/one-source-recertify.ts
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import type { PageCapture } from '@robot/browser';
import { datasets, db, orgs, projects, sources, sourceVerifications } from '@robot/db';
import { readsOneSource, runVerification, sourceKey, type CertifiedPath, type FieldVerification, type SchemaDefinitionField, type VerificationSet } from '@robot/scraper';
import { withBrowserSession } from '../browser-session.js';
import { readCaptureFile, type StoredCaptureRef } from '../verify/capture-store.js';

const oldRule = (ps: CertifiedPath[]) => ps.length >= 2 && (ps.every((p) => p.source === 'api') || ps.every((p) => p.source === 'json-ld'));
const label = (p: CertifiedPath) => `${p.source} ${p.path}${p.container ? ` @ ${p.container}` : ''}`;
// A stored (pre-container-labelling) result never carries `container`; the current code always
// stamps one on an API path. So the FIRST path's identity for "did it change" is source+path+transform
// only — a path that only gained its container label (e.g. "api price" -> "api price @ <url>") reads
// as unchanged here, and is still shown with its label in the printed before/after.
const pathIdentity = (p: CertifiedPath) => `${p.source} ${p.path} ${p.transform}`;

const withSets = await db
  .select({ id: sources.id, name: sources.name, schemaDefinition: sources.schemaDefinition, verificationSet: sources.verificationSet, project: projects.name, org: orgs.name })
  .from(sources)
  .leftJoin(datasets, eq(datasets.id, sources.datasetId))
  .leftJoin(projects, eq(projects.id, datasets.projectId))
  .leftJoin(orgs, eq(orgs.id, projects.orgId))
  .where(isNotNull(sources.verificationSet));

let checked = 0, spread = 0, single = 0, uncertified = 0, skipped = 0, firstPathChanged = 0;
const firstPathChanges: Array<{ website: string; field: string; before: string; after: string }> = [];
await withBrowserSession(async (browser) => {
  for (const s of withSets) {
    if (!Array.isArray(s.schemaDefinition)) continue;
    const [latest] = await db
      .select({ results: sourceVerifications.results, captures: sourceVerifications.captures })
      .from(sourceVerifications)
      .where(and(eq(sourceVerifications.sourceId, s.id), isNotNull(sourceVerifications.completedAt), isNull(sourceVerifications.errorMessage)))
      .orderBy(desc(sourceVerifications.completedAt))
      .limit(1);
    if (!latest) continue;
    const results = latest.results as Record<string, FieldVerification>;
    const fields = (s.schemaDefinition as SchemaDefinitionField[]).filter((f) => oldRule(results[f.key]?.certified ?? []));
    if (fields.length === 0) continue;
    const website = `${s.org ?? '?'}/${s.project ?? '?'}/${s.name}`;
    const set = s.verificationSet as VerificationSet;
    const refs = (latest.captures ?? {}) as Record<string, StoredCaptureRef>;
    const captures: Record<string, PageCapture> = {};
    for (const url of set.urls) {
      const ref = refs[url];
      const c = ref?.captureId ? await readCaptureFile(ref.captureId) : null;
      if (c) captures[url] = c;
    }
    // Every proof page from its stored file, or the field is skipped: a missing one would be captured live.
    if (Object.keys(captures).length !== set.urls.length) {
      skipped += fields.length;
      console.log(`\n${website}: skipped ${fields.length} field(s) — ${set.urls.length - Object.keys(captures).length} stored capture(s) missing`);
      continue;
    }
    const run = await runVerification({ fields, verificationSet: set }, { browser, agent: null, free: true, captures });
    for (const f of fields) {
      checked++;
      const before = results[f.key]!.certified;
      const now = run.outcome.fields[f.key]?.certified ?? [];
      if (now.length === 0) uncertified++;
      else if (readsOneSource(now) || now.length === 1) single++;
      else spread++;
      const beforeFirst = before[0] ? label(before[0]) : '(none)';
      const afterFirst = now[0] ? label(now[0]) : '(none)';
      const changed = (before[0] ? pathIdentity(before[0]) : null) !== (now[0] ? pathIdentity(now[0]) : null);
      if (changed) { firstPathChanged++; firstPathChanges.push({ website, field: f.name, before: beforeFirst, after: afterFirst }); }
      console.log(`\n${website} — ${f.name}`);
      console.log(`  stored: ${before.map(label).join(' | ')}`);
      console.log(`  now:    ${now.map(label).join(' | ') || '(nothing certified on the stored captures)'}`);
      console.log(`  sources now: ${new Set(now.map(sourceKey)).size}`);
      console.log(`  first path changed: ${changed ? `YES — ${beforeFirst} -> ${afterFirst}` : 'no'}`);
    }
  }
});
console.log(`\n${checked} one-source field(s) certified again on stored captures, ${skipped} skipped (captures missing): ${spread} now read two or more sources, ${single} still one source, ${uncertified} certified nothing, ${firstPathChanged} changed their first certified path.`);
if (firstPathChanges.length > 0) {
  console.log(`\nFirst certified path changed (customer-visible) on:`);
  for (const c of firstPathChanges) console.log(`  ${c.website} — ${c.field}: ${c.before} -> ${c.after}`);
}
process.exit(0);
