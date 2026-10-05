// packages/api/src/test-helpers/seed-drift-check.ts
// A finished, "moved" drift check for one field, plus the "verified" baseline
// it is about — both inserted directly against the database, the way
// `seed-variants-run.ts` seeds a run the app's route smoke can open without
// ever running a real check (needs a browser) or a real Verify (off-limits
// in the smoke with an Anthropic key present). Cleaned up with the project:
// both tables cascade on `sources.id`, same as `seed-variants-run.ts`'s rows
// do.
import { eq } from 'drizzle-orm';
import { db, driftChecks, sources, sourceVerifications } from '@robot/db';
import {
  fieldHash,
  type CertifiedPath,
  type DriftCheckResults,
  type Mark,
  type SchemaDefinitionField,
  type VerificationSet,
} from '@robot/scraper';

/** A plausible, made-up mark on a product page — good enough to prove `acceptMoved`'s wiring, not a real DOM position. */
function fakeMark(i: number): Mark {
  return { xpaths: [`//div[@class='amount'][${i}]`], text: 'x', rect: { x: 0, y: 0, w: 10, h: 10 } };
}

/**
 * Certifies `fieldKey` at its current `fieldHash` (so the row reads
 * "verified" until the repair below is accepted), then records one finished
 * drift check that found it `moved` to a fabricated element on every proof
 * page, and flags it on `sources.driftedFields`.
 */
export async function seedDriftCheck(sourceId: string, fieldKey: string): Promise<{ checkId: string }> {
  const source = await db.query.sources.findFirst({ where: eq(sources.id, sourceId), columns: { schemaDefinition: true, verificationSet: true } });
  if (!source) throw new Error(`seedDriftCheck: source ${sourceId} not found`);
  const fields = (source.schemaDefinition ?? []) as SchemaDefinitionField[];
  const set = (source.verificationSet ?? { urls: [], expected: {} }) as VerificationSet;
  const field = fields.find((f) => f.key === fieldKey);
  if (!field) throw new Error(`seedDriftCheck: field ${fieldKey} is not on this source's contract`);

  const certified: CertifiedPath = { source: 'json-ld', path: 'offers.price', transform: 'identity' };
  const cells = Object.fromEntries(set.urls.map((u) => [u, { status: 'pass' as const, found: 'x', path: certified }]));
  await db.insert(sourceVerifications).values({
    sourceId,
    definitionHash: 'x',
    completedAt: new Date(),
    allPassed: true,
    results: {
      [field.key]: {
        key: field.key, cells, certified: [certified], weakEvidence: false, aiCalled: false, incomplete: false,
        fieldHash: fieldHash(field, set),
      },
    },
  });

  const results: DriftCheckResults = {
    runId: null,
    fields: {
      [field.key]: {
        key: field.key,
        result: 'moved',
        path: { source: 'xpath', path: "//div[@class='amount']", transform: 'identity' },
        pages: Object.fromEntries(set.urls.map((u, i) => [u, { status: 'ok' as const, value: 'x', mark: fakeMark(i + 1) }])),
      },
    },
  };
  const [row] = await db.insert(driftChecks).values({ sourceId, runId: null, status: 'done', results, completedAt: new Date() }).returning({ id: driftChecks.id });
  await db.update(sources).set({ driftedFields: [field.key] }).where(eq(sources.id, sourceId));
  return { checkId: row!.id };
}
