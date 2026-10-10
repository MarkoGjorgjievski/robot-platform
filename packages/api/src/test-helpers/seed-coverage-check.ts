// packages/api/src/test-helpers/seed-coverage-check.ts
// A passing Verify, inserted directly against the database, so the app's
// route smoke can run a real coverage check (spec 2026-10-10 §7) without a
// real Verify (off-limits in the smoke with an Anthropic key present). The
// same pattern as `seed-drift-check.ts`'s baseline: every field given here is
// certified at its current `fieldHash`, passing on every proof page. Cleaned
// up with the project: `source_verifications` cascades on `sources.id`.
import { eq } from 'drizzle-orm';
import { db, sources, sourceVerifications } from '@robot/db';
import { fieldHash, type CertifiedPath, type SchemaDefinitionField, type VerificationSet } from '@robot/scraper';

/**
 * Inserts one completed, all-passed verification certifying each field in
 * `certifiedByKey` on the paths given (the first one named on every cell).
 * A certification exists only when every contract field is current, so a
 * caller that wants one passes every field of the contract.
 */
export async function seedPassingVerification(sourceId: string, certifiedByKey: Record<string, CertifiedPath[]>): Promise<{ verificationId: string }> {
  const source = await db.query.sources.findFirst({ where: eq(sources.id, sourceId), columns: { schemaDefinition: true, verificationSet: true } });
  if (!source) throw new Error(`seedPassingVerification: source ${sourceId} not found`);
  const fields = (source.schemaDefinition ?? []) as SchemaDefinitionField[];
  const set = (source.verificationSet ?? { urls: [], expected: {} }) as VerificationSet;

  const results = Object.fromEntries(
    Object.entries(certifiedByKey).map(([key, certified]) => {
      const field = fields.find((f) => f.key === key);
      if (!field) throw new Error(`seedPassingVerification: field ${key} is not on this source's contract`);
      if (certified.length === 0) throw new Error(`seedPassingVerification: field ${key} has no path to certify`);
      const cells = Object.fromEntries(set.urls.map((u) => [u, { status: 'pass' as const, found: 'x', path: certified[0]! }]));
      return [key, { key, cells, certified, weakEvidence: false, aiCalled: false, incomplete: false, fieldHash: fieldHash(field, set) }];
    }),
  );

  const [row] = await db
    .insert(sourceVerifications)
    .values({ sourceId, definitionHash: 'x', completedAt: new Date(), allPassed: true, results })
    .returning({ id: sourceVerifications.id });
  return { verificationId: row!.id };
}
