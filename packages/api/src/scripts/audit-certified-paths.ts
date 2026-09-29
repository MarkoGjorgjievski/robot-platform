// Read-only audit (spec 2026-09-29 §5): for every website with a verification
// set, would the paths its latest completed verification certified still
// qualify under C2? Prints a table and exits. Select queries only — this
// script never writes; a flagged website is re-verified by the customer.
//
//   pnpm --filter @robot/api exec tsx src/scripts/audit-certified-paths.ts
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import { datasets, db, orgs, projects, sources, sourceVerifications } from '@robot/db';
import type { FieldVerification, SchemaDefinitionField, VerificationSet } from '@robot/scraper';
import { auditField, type AuditRow } from './audit-certified-paths-core.js';

const withSets = await db
  .select({ id: sources.id, name: sources.name, schemaDefinition: sources.schemaDefinition, verificationSet: sources.verificationSet, project: projects.slug, org: orgs.slug })
  .from(sources)
  .leftJoin(datasets, eq(datasets.id, sources.datasetId))
  .leftJoin(projects, eq(projects.id, datasets.projectId))
  .leftJoin(orgs, eq(orgs.id, projects.orgId))
  .where(isNotNull(sources.verificationSet));

const rows: AuditRow[] = [];
let unverified = 0;
for (const s of withSets) {
  if (!Array.isArray(s.schemaDefinition)) continue;
  const [latest] = await db
    .select({ results: sourceVerifications.results })
    .from(sourceVerifications)
    .where(and(eq(sourceVerifications.sourceId, s.id), isNotNull(sourceVerifications.completedAt), isNull(sourceVerifications.errorMessage)))
    .orderBy(desc(sourceVerifications.completedAt))
    .limit(1);
  if (!latest) { unverified++; continue; }
  const results = latest.results as Record<string, FieldVerification>;
  const website = `${s.org ?? '?'}/${s.project ?? '?'}/${s.name}`;
  for (const field of s.schemaDefinition as SchemaDefinitionField[]) {
    const certified = results[field.key]?.certified ?? [];
    if (certified.length === 0) continue;
    rows.push(auditField({ website, field, set: s.verificationSet as VerificationSet, certified }));
  }
}

const cols: Array<[string, (r: AuditRow) => string]> = [
  ['website', (r) => r.website],
  ['field', (r) => r.field],
  ['certified paths', (r) => r.paths.join(' | ')],
  ['ok', (r) => (r.ok ? 'ok' : 'NO')],
  ['why', (r) => r.why ?? ''],
];
const widths = cols.map(([h, f]) => Math.min(70, Math.max(h.length, ...rows.map((r) => f(r).length))));
const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join('  ').trimEnd();
console.log(line(cols.map(([h]) => h)));
console.log(line(widths.map((w) => '-'.repeat(w))));
for (const r of rows) console.log(line(cols.map(([, f]) => f(r))));
const flagged = rows.filter((r) => !r.ok);
console.log(`\n${withSets.length} websites with a verification set, ${unverified} never verified; ${rows.length} certified fields audited, ${flagged.length} on paths that no longer qualify (${new Set(flagged.map((r) => r.website)).size} websites).`);
process.exit(0);
