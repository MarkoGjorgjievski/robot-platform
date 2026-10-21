// packages/api/src/test-helpers/seed-attention.ts
// A website that changed (spec 2026-10-21), seeded directly for the route
// smoke and router tests: every contract field passed two days ago; `heldKey`
// failed in a Verify that completed just now and is held; `refreshedKey` was
// refreshed automatically today; a scheduled check found `heldKey` changed.
// Holds cover fields only, so both seeded runs carry the website's variant
// result (final review I3): the latest clean run's when it is current and
// passed, else — on a website whose variants are required — a pass for the
// setup as it is now.
// No browser, no Verify. Cleaned up with the project (every table cascades on
// `sources.id`).
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import { db, driftChecks, fieldHolds, sources, sourceVerifications, valueRefreshes } from '@robot/db';
import { fieldHash, type CertifiedPath, type DriftCheckResults, type SchemaDefinitionField, type VerificationSet } from '@robot/scraper';
import type { VariantSetup } from '../contract.js';
import { currentVariantHash, variantsRequired } from '../verify/variant-check.js';

export async function seedAttention(sourceId: string, args: { heldKey: string; refreshedKey: string }): Promise<{ heldSince: Date }> {
  const source = await db.query.sources.findFirst({
    where: eq(sources.id, sourceId),
    columns: { schemaDefinition: true, verificationSet: true, variantSetup: true },
    with: { dataset: { columns: { schema: true, variantMode: true } } },
  });
  if (!source) throw new Error(`seedAttention: source ${sourceId} not found`);
  const fields = (source.schemaDefinition ?? []) as SchemaDefinitionField[];
  const set = (source.verificationSet ?? { urls: [], expected: {} }) as VerificationSet;
  const path: CertifiedPath = { source: 'json-ld', path: 'name', transform: 'identity' };
  const pass = (f: SchemaDefinitionField) => ({
    key: f.key, cells: Object.fromEntries(set.urls.map((u) => [u, { status: 'pass', found: 'x', path }])),
    certified: [path], weakEvidence: false, aiCalled: false, incomplete: false, fieldHash: fieldHash(f, set),
  });
  const held = fields.find((f) => f.key === args.heldKey);
  if (!held) throw new Error(`seedAttention: ${args.heldKey} is not on this website`);
  const refreshed = fields.find((f) => f.key === args.refreshedKey);
  if (!refreshed) throw new Error(`seedAttention: ${args.refreshedKey} is not on this website`);
  const url = set.urls[0];
  if (!url) throw new Error('seedAttention: the website has no proof pages');

  const heldSince = new Date(Date.now() - 2 * 86_400_000);
  const lastClean = await db.query.sourceVerifications.findFirst({
    where: and(eq(sourceVerifications.sourceId, sourceId), isNotNull(sourceVerifications.completedAt), isNull(sourceVerifications.errorMessage)),
    orderBy: [desc(sourceVerifications.completedAt), desc(sourceVerifications.id)],
    columns: { variantResults: true },
  });
  const setup = (source.variantSetup as VariantSetup | null) ?? null;
  const previous = (lastClean?.variantResults ?? null) as { hash?: string; passed?: boolean } | null;
  let variantResults: unknown = previous;
  if (variantsRequired(source.dataset?.variantMode, setup) === 'yes') {
    const hash = currentVariantHash({ set, setup: setup!, datasetSchema: source.dataset?.schema });
    // Every contract field passed two days ago, variants with them: a result for another setup, or a failed one, is not that.
    if (!previous || previous.hash !== hash || previous.passed !== true) variantResults = { method: setup!.method, hash, passed: true, pages: {} };
  }
  const passing = Object.fromEntries(fields.map((f) => [f.key, pass(f)]));
  const [passed] = await db.insert(sourceVerifications)
    .values({ sourceId, definitionHash: 'x', startedAt: heldSince, completedAt: heldSince, allPassed: true, results: passing, variantResults })
    .returning({ id: sourceVerifications.id });
  const failedHeld = { ...pass(held), certified: [], cells: Object.fromEntries(set.urls.map((u) => [u, { status: 'fail', reason: 'different_value', found: 'New' }])) };
  // Completed now: any check seeded earlier on this website (the smoke's drift test) is older than this Verify, so it says nothing about a current field.
  const [failed] = await db.insert(sourceVerifications)
    .values({ sourceId, definitionHash: 'x', completedAt: new Date(), allPassed: false, results: { ...passing, [held.key]: failedHeld }, variantResults })
    .returning({ id: sourceVerifications.id });
  await db.insert(fieldHolds).values({
    sourceId, fieldKey: held.key, result: pass(held), verificationId: passed!.id, verifiedAt: heldSince, failedVerificationId: failed!.id, fieldHashes: [pass(held).fieldHash],
  });
  await db.insert(valueRefreshes).values({
    sourceId, fieldKey: refreshed.key, pages: { [url]: { was: '1.00', now: '1.10', path } }, fromHash: 'seed', toHash: fieldHash(refreshed, set),
  });
  const results: DriftCheckResults = {
    runId: null, trigger: 'schedule',
    fields: { [held.key]: { key: held.key, result: 'changed', path, pages: { [url]: { status: 'ok', value: 'New', changed: true, was: 'Old' } } } },
  };
  await db.insert(driftChecks).values({ sourceId, status: 'done', trigger: 'schedule', results, completedAt: new Date() });
  await db.update(sources).set({ driftedFields: null }).where(eq(sources.id, sourceId));
  return { heldSince };
}
