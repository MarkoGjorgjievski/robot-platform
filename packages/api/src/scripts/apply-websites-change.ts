// packages/api/src/scripts/apply-websites-change.ts
// Spec 2026-10-21 §8: the new behaviour, applied once to the ten websites that
// lost their certification at the 2026-10-21 re-verify (approved as part of
// queue item 1). Per website, one at a time: backfill its holds from its
// latest Verify's stored captures, then run one scheduled check on fresh pages
// (refreshes and their free re-verify included) and wait for that re-verify.
// Records before/after. Keyless; JEV_SHADOW must be empty; no sign-in, no
// user or org created, no binding edited except by a refresh.
//
//   cd packages/api && ANTHROPIC_API_KEY= JEV_SHADOW= TYPESAFE_API_KEY= \
//     CAPTURES_DIR=/c/Users/Marko/Documents/projects/robot-platform/packages/api-server/public/captures \
//     npx tsx src/scripts/apply-websites-change.ts [sourceId ...]
import { writeFileSync, mkdirSync } from 'node:fs';
import { and, desc, eq } from 'drizzle-orm';
import { db, driftChecks, sources, sourceVerifications } from '@robot/db';
import type { SchemaDefinitionField } from '@robot/scraper';
import { withBrowserSession } from '../browser-session.js';
import { backfillHolds } from '../verify/holds.js';
import { checkWebsite } from '../verify/website-checks.js';
import { latestRefreshes, websiteAttention } from '../verify/attention.js';
import { loadCertificationState, loadFieldCurrency, runnableOf } from '../verify/current-certification.js';
import { resolveInFlightVerification } from '../verify/in-flight.js';
import { TEN } from './ten-websites.js';

// Checked after the imports, so after @robot/db has loaded .env (which never overrides a variable the shell set, even empty).
if (process.env.ANTHROPIC_API_KEY || process.env.JEV_SHADOW) { console.error('ANTHROPIC_API_KEY and JEV_SHADOW must be empty for this run.'); process.exit(1); }
if ((process.env.WEBSITE_CHECKS ?? '').trim()) { console.error('WEBSITE_CHECKS must be unset for this run.'); process.exit(1); }
if (!process.env.CAPTURES_DIR) { console.error('Set CAPTURES_DIR to the main checkout’s api-server captures folder.'); process.exit(1); }
const OUT = '../../docs/testing/results/2026-10-21-websites-change-apply';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// The customer's words come from the app's own pure copy functions (spec §5); a variable path keeps tsc out of the app package.
const viewPath = '../../../app/src/lib/site/attention-view.ts';
const view = (await import(viewPath)) as {
  attentionBanner: (a: { driftedFields: string[] | null; fields: string[]; fieldNames: Record<string, string>; goneProducts: number[]; heldSince: Date | null; runnable: boolean }) => string | null;
  extractHeldLine: (held: string[], names: Record<string, string>, since: Date | null) => string | null;
  refreshLine: (r: { at: Date; pages: Record<string, { was: string; now: string }> } | undefined, urls: string[]) => string | null;
};

async function state(id: string) {
  const src = (await db.query.sources.findFirst({ where: eq(sources.id, id), columns: { schemaDefinition: true, verificationSet: true } }))!;
  const fields = src.schemaDefinition as SchemaDefinitionField[];
  const urls = ((src.verificationSet ?? { urls: [] }) as { urls: string[] }).urls;
  const names = Object.fromEntries(fields.map((f) => [f.key, f.name]));
  const currency = await loadFieldCurrency(db, id);
  const attention = await websiteAttention(db, id);
  const runnable = runnableOf(await loadCertificationState(db, id));
  const refreshes = await latestRefreshes(db, id);
  return {
    runnable,
    current: currency.currentKeys.map((k) => names[k] ?? k),
    held: currency.heldKeys.map((k) => names[k] ?? k),
    heldVerifiedOn: Object.fromEntries(currency.heldKeys.map((k) => [names[k] ?? k, currency.held[k]!.verifiedAt.toISOString()])),
    attention: {
      fields: attention.fields.map((k) => names[k] ?? k),
      goneProducts: attention.goneProducts,
      heldSince: attention.heldSince?.toISOString() ?? null,
      findings: Object.fromEntries(Object.entries(attention.findings).map(([k, r]) => [names[k] ?? k, { result: r.result, refresh: r.refresh ?? null }])),
    },
    refreshes: refreshes.map((r) => ({ field: names[r.key] ?? r.key, at: r.at.toISOString(), pages: Object.values(r.pages).map((p) => `${p.was} → ${p.now}`), line: view.refreshLine(r, urls) })),
    customer: {
      banner: view.attentionBanner({ driftedFields: null, fields: attention.fields, fieldNames: names, goneProducts: attention.goneProducts, heldSince: attention.heldSince, runnable }),
      extract: runnable ? view.extractHeldLine(currency.heldKeys, names, attention.heldSince) : null,
    },
  };
}

/** The newest drift check's per-field outcome (staff detail) and the newest verification's outcome. */
async function lastCheck(id: string) {
  const src = (await db.query.sources.findFirst({ where: eq(sources.id, id), columns: { schemaDefinition: true } }))!;
  const names = Object.fromEntries((src.schemaDefinition as SchemaDefinitionField[]).map((f) => [f.key, f.name]));
  const check = await db.query.driftChecks.findFirst({ where: eq(driftChecks.sourceId, id), orderBy: [desc(driftChecks.createdAt)] });
  const verify = await db.query.sourceVerifications.findFirst({ where: and(eq(sourceVerifications.sourceId, id)), orderBy: [desc(sourceVerifications.startedAt)] });
  const fields = ((check?.results as { fields?: Record<string, { result?: string; refresh?: unknown; reads?: Record<string, string | null>; pages?: Record<string, { status?: string }> }> } | null)?.fields) ?? {};
  return {
    check: check ? {
      id: check.id, trigger: check.trigger, status: check.status, createdAt: check.createdAt.toISOString(),
      fields: Object.fromEntries(Object.entries(fields).map(([k, r]) => [names[k] ?? k, { result: r.result ?? null, refresh: r.refresh ?? null, reads: r.reads ?? null, pages: Object.fromEntries(Object.entries(r.pages ?? {}).map(([u, p]) => [u, p.status ?? null])) }])),
    } : null,
    verify: verify ? {
      id: verify.id, startedAt: verify.startedAt.toISOString(), completedAt: verify.completedAt?.toISOString() ?? null, error: verify.errorMessage,
      results: Object.fromEntries(Object.entries((verify.results ?? {}) as Record<string, { status?: string; certified?: unknown[] }>).map(([k, r]) => [names[k] ?? k, r.status ?? (r.certified?.length ? 'certified' : 'not certified')])),
    } : null,
  };
}

async function settle(id: string): Promise<boolean> {
  // A refresh's free re-verify runs in this process; wait for it (well inside the 15-minute stall rule).
  for (let i = 0; i < 160; i++) {
    if (!(await resolveInFlightVerification(db, id))) return true;
    await sleep(5000);
  }
  return false;
}

const only = process.argv.slice(2);
const report: unknown[] = [];
for (const [id, website] of Object.entries(TEN)) {
  if (only.length > 0 && !only.includes(id)) continue;
  const entry: Record<string, unknown> = { website, sourceId: id };
  report.push(entry);
  try {
    if (!(await settle(id))) throw new Error('a Verify was already in flight and did not finish');
    entry.before = await state(id);
    const backfill = await withBrowserSession((browser) => backfillHolds(db, browser, id, { write: true }));
    entry.backfilled = backfill.upsert.map((h) => h.fieldKey);
    entry.backfillFields = backfill.fields;
    entry.afterBackfill = await state(id);
    entry.checked = await checkWebsite(id);
    entry.settled = await settle(id);
    entry.after = await state(id);
    entry.last = await lastCheck(id);
    const b = entry.before as Awaited<ReturnType<typeof state>>;
    const a = entry.after as Awaited<ReturnType<typeof state>>;
    console.log(`${website}: ${b.runnable ? 'ran' : 'refused'} → ${a.runnable ? 'runs' : 'refused'}; check ${String(entry.checked)}; held ${a.held.join(', ') || '—'}; refreshed ${a.refreshes.map((r) => `${r.field} ${r.pages.join(', ')}`).join(' | ') || '—'}; customer: ${a.customer.banner ?? '—'}`);
  } catch (err) {
    entry.error = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
    console.error(`${website}: FAILED — ${entry.error}`);
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/${only.length > 0 ? `apply-${only.map((s) => s.slice(0, 8)).join('-')}` : 'apply'}.json`, JSON.stringify({ at: new Date().toISOString(), report }, null, 2));
}

console.log(`wrote ${OUT}/apply.json`);
process.exit(0);
