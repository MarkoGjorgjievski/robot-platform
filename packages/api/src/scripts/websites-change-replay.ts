// packages/api/src/scripts/websites-change-replay.ts
// Read-only replay (spec 2026-10-21 §9): for the ten websites that lost their
// certification at the 2026-10-21 re-verify, what the new rules would do on
// that Verify's stored captures — which fields would be held (runs again),
// which values refreshed, what needs the customer. No database write (backfill
// with write: false), no page load (stored captures only), no model.
//
//   cd packages/api && ANTHROPIC_API_KEY= \
//     CAPTURES_DIR=/c/Users/Marko/Documents/projects/robot-platform/packages/api-server/public/captures \
//     npx tsx src/scripts/websites-change-replay.ts
import { writeFileSync, mkdirSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { db, sources } from '@robot/db';
import { planRefresh, type SchemaDefinitionField, type VerificationSet } from '@robot/scraper';
import { forWebsite } from '../proxy/website-session.js';
import { backfillHolds } from '../verify/holds.js';
import { loadCertificationState, runnableOf } from '../verify/current-certification.js';
import { TEN } from './ten-websites.js';

if (process.env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY must be empty for this run.'); process.exit(1); }
if (!process.env.CAPTURES_DIR) { console.error('Set CAPTURES_DIR to the main checkout’s api-server captures folder.'); process.exit(1); }
const OUT = '../../docs/testing/results/2026-10-21-websites-change';

type FieldOut = { name: string; held: boolean; refresh: string; reads: Record<string, string | null>; expected: Record<string, string> };
const report: Array<{ website: string; sourceId: string; runnableBefore: boolean; runnableAfter: boolean; fields: FieldOut[] }> = [];

for (const [id, website] of Object.entries(TEN)) {
  const src = (await db.query.sources.findFirst({ where: eq(sources.id, id), columns: { schemaDefinition: true, verificationSet: true } }))!;
  const fields = src.schemaDefinition as SchemaDefinitionField[];
  const set = src.verificationSet as VerificationSet;
  const runnableBefore = runnableOf(await loadCertificationState(db, id));
  // Each website in its own browser, with its own profile (spec 2026-10-24 proxy §3.1; final review I2).
  const out = await forWebsite(id)((browser) => backfillHolds(db, browser, id, { write: false }));
  const heldKeys = out.upsert.map((h) => h.fieldKey);
  const rows: FieldOut[] = [];
  for (const key of Object.keys(out.readings)) {
    const field = fields.find((f) => f.key === key)!;
    const c = out.certifying[key]!;
    const provenOn = Object.fromEntries(Object.entries(c.result.cells).map(([u, cell]) => [u, cell.status === 'pass' ? cell.path : undefined]));
    const plan = heldKeys.includes(key) ? planRefresh({ field, expected: set.expected[key] ?? {}, provenOn, readings: out.readings[key]! }) : null;
    rows.push({
      name: field.name, held: heldKeys.includes(key),
      refresh: !plan ? 'not held' : plan.kind === 'refresh' ? `refresh: ${Object.values(plan.pages).map((p) => `${p.was} → ${p.now}`).join(', ')}` : plan.kind === 'refused' ? `refused: ${plan.reason}` : 'nothing moved',
      reads: Object.fromEntries(Object.entries(out.readings[key]!).map(([u, r]) => [u, r.value])),
      expected: set.expected[key] ?? {},
    });
  }
  // Runs after the backfill when every field passed on the latest Verify or would be held (variants: none of the ten has any).
  const runnableAfter = out.latestId !== null && fields.every((f) => out.passing.includes(f.key) || heldKeys.includes(f.key));
  report.push({ website, sourceId: id, runnableBefore, runnableAfter, fields: rows });
  console.log(`${website}: before ${runnableBefore ? 'runs' : 'refused'}, after ${runnableAfter ? 'runs' : 'refused'}; held ${heldKeys.length}; ${rows.map((r) => `${r.name} ${r.refresh}`).join(' | ')}`);
}

mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/replay.json`, JSON.stringify({ at: new Date().toISOString(), report }, null, 2));
console.log(`wrote ${OUT}/replay.json`);
process.exit(0);
