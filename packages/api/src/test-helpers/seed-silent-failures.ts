// packages/api/src/test-helpers/seed-silent-failures.ts
// Verify never fails silently (spec 2026-10-20 §6): the route smoke's seeded state, inserted
// directly — no Verify is pressed. A completed Verify whose one field fails on one product with
// `elsewhere` (every other field certified at its current fieldHash), then a newer run that failed
// with a raw error. Both are newer than anything an earlier smoke step seeded. Cleaned up with the
// project: `source_verifications` cascades on `sources.id`.
import { eq } from 'drizzle-orm';
import { db, sources, sourceVerifications } from '@robot/db';
import { fieldHash, type CertifiedPath, type SchemaDefinitionField, type VerificationSet } from '@robot/scraper';

/** The failed run's stored error: library text a customer must never see. */
export const SEEDED_RAW_ERROR = 'page.goto: Timeout 60000ms exceeded. Request timed out.';

export async function seedFailedAfterElsewhere(sourceId: string, opts: { elsewhereKey: string; elsewhereUrl: string }): Promise<{ completedId: string; failedId: string }> {
  const source = await db.query.sources.findFirst({ where: eq(sources.id, sourceId), columns: { schemaDefinition: true, verificationSet: true } });
  if (!source) throw new Error(`seedFailedAfterElsewhere: source ${sourceId} not found`);
  const fields = (source.schemaDefinition ?? []) as SchemaDefinitionField[];
  const set = (source.verificationSet ?? { urls: [], expected: {} }) as VerificationSet;
  if (!fields.some((f) => f.key === opts.elsewhereKey)) throw new Error(`seedFailedAfterElsewhere: ${opts.elsewhereKey} is not on this source's contract`);
  if (!set.urls.includes(opts.elsewhereUrl)) throw new Error(`seedFailedAfterElsewhere: ${opts.elsewhereUrl} is not a proof page`);

  const path: CertifiedPath = { source: 'json-ld', path: 'name', transform: 'identity' };
  const results = Object.fromEntries(fields.map((f) => {
    const failing = f.key === opts.elsewhereKey;
    const cells = Object.fromEntries(set.urls.map((u) => [u, failing && u === opts.elsewhereUrl
      ? { status: 'fail' as const, reason: 'elsewhere' as const }
      : { status: 'pass' as const, found: 'x', path }]));
    return [f.key, { key: f.key, cells, certified: failing ? [] : [path], weakEvidence: false, aiCalled: false, incomplete: false, fieldHash: fieldHash(f, set) }];
  }));

  const now = Date.now();
  const [done] = await db.insert(sourceVerifications)
    .values({ sourceId, definitionHash: 'x', startedAt: new Date(now - 2000), completedAt: new Date(now - 1900), allPassed: false, results })
    .returning({ id: sourceVerifications.id });
  const [failed] = await db.insert(sourceVerifications)
    .values({ sourceId, definitionHash: 'x', startedAt: new Date(now - 1000), completedAt: new Date(now - 900), errorMessage: SEEDED_RAW_ERROR })
    .returning({ id: sourceVerifications.id });
  return { completedId: done!.id, failedId: failed!.id };
}
