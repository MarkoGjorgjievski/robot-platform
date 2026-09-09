// A Source's current certification: the latest completed, all-passed
// verification whose `definitionHash` still matches the Source's current
// `schemaDefinition` + `verificationSet`. Editing the schema (`updateSchema`)
// never touches past `source_verifications` rows, so "current" is decided
// here, at read time, by comparing hashes rather than by any stored flag.

import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import { sources, sourceVerifications } from '@robot/db';
import type { Database } from '@robot/db';
import {
  definitionHash,
  fieldHash,
  type CertifiedPath,
  type FieldVerification,
  type SchemaDefinitionField,
  type VerificationSet,
} from '@robot/scraper';

export type Certification = {
  verificationId: string;
  completedAt: Date;
  paths: Record<string /* field key */, CertifiedPath[]>;
  concepts: Record<string, string>;
  /**
   * The hostname the certification was proven against — `verificationSet.urls[0]`'s.
   *
   * M3: every verified-path hit/miss must be booked against THIS host,
   * because that is the `domain_intelligence` row `saveVerifiedPaths` wrote
   * the paths into. Deriving it from the item URL instead (what
   * `extract-item.ts` used to do) books stats against whatever host the
   * crawl happens to be on — a CDN host, a country domain, a redirect
   * target — where the paths do not exist, so `recordVerifiedPathStats`
   * silently no-ops and the real row's hit rates never move.
   */
  hostname: string;
};

export function sourceDefinitionHash(source: { schemaDefinition: unknown; verificationSet: unknown }): string | null {
  if (!Array.isArray(source.schemaDefinition) || !source.verificationSet) return null;
  return definitionHash(source.schemaDefinition as SchemaDefinitionField[], source.verificationSet as VerificationSet);
}

/**
 * Per-field currency (spec 4.4). The latest completed, error-free run is the
 * only one consulted; a field is current when that run holds a passing result
 * for it whose `fieldHash` equals the hash of the field as it stands now.
 * Rows written before phase 2 carry no `fieldHash` and are never current.
 */
export async function loadFieldCurrency(db: Database, sourceId: string): Promise<{
  latest: { id: string; completedAt: Date; results: Record<string, FieldVerification> } | null;
  currentKeys: string[];
}> {
  const source = await db.query.sources.findFirst({
    where: eq(sources.id, sourceId),
    columns: { schemaDefinition: true, verificationSet: true },
  });
  if (!source || !Array.isArray(source.schemaDefinition) || !source.verificationSet) return { latest: null, currentKeys: [] };
  const fields = source.schemaDefinition as SchemaDefinitionField[];
  const set = source.verificationSet as VerificationSet;

  const row = await db.query.sourceVerifications.findFirst({
    where: and(eq(sourceVerifications.sourceId, sourceId), isNotNull(sourceVerifications.completedAt), isNull(sourceVerifications.errorMessage)),
    orderBy: [desc(sourceVerifications.completedAt)],
  });
  if (!row) return { latest: null, currentKeys: [] };
  const results = row.results as Record<string, FieldVerification>;

  const currentKeys = fields
    .filter((f) => {
      const r = results[f.key];
      if (!r || !r.fieldHash || r.fieldHash !== fieldHash(f, set)) return false;
      return r.certified.length > 0 && Object.values(r.cells).length > 0 && Object.values(r.cells).every((c) => c.status === 'pass');
    })
    .map((f) => f.key);

  return { latest: { id: row.id, completedAt: row.completedAt!, results }, currentKeys };
}

/** A certification exists only when EVERY contract field is current on this source (spec 4.4). */
export async function loadCurrentCertification(db: Database, sourceId: string): Promise<Certification | null> {
  const source = await db.query.sources.findFirst({
    where: eq(sources.id, sourceId),
    columns: { schemaDefinition: true, verificationSet: true },
  });
  if (!source || !Array.isArray(source.schemaDefinition) || source.schemaDefinition.length === 0 || !source.verificationSet) return null;
  const fields = source.schemaDefinition as SchemaDefinitionField[];
  const set = source.verificationSet as VerificationSet;

  const { latest, currentKeys } = await loadFieldCurrency(db, sourceId);
  if (!latest || currentKeys.length !== fields.length) return null;

  // A certification with no usable hostname is not a certification: the
  // hostname IS the domain_intelligence row the certified paths live in and
  // the key every verified-path stat is booked under (M3). `verificationSet`
  // is jsonb — nothing in the database forces `urls[0]` to be a parseable
  // URL, and a Source hand-edited or written by an older/looser path could
  // carry anything. Refusing here means `requireCertification` says "verify
  // the schema before extracting" (recoverable, and true) instead of the
  // whole procedure dying on a TypeError from `new URL`.
  let hostname: string;
  try {
    hostname = new URL(set.urls[0]!).hostname;
  } catch {
    console.error(`[verify] source ${sourceId} has an unparseable verification url; treating it as uncertified`);
    return null;
  }

  return {
    verificationId: latest.id,
    completedAt: latest.completedAt,
    paths: Object.fromEntries(fields.map((f) => [f.key, latest.results[f.key]?.certified ?? []])),
    concepts: Object.fromEntries(fields.map((f) => [f.key, f.concept])),
    hostname,
  };
}
