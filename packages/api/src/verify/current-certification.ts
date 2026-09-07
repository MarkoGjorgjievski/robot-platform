// A Source's current certification: the latest completed, all-passed
// verification whose `definitionHash` still matches the Source's current
// `schemaDefinition` + `verificationSet`. Editing the schema (`updateSchema`)
// never touches past `source_verifications` rows, so "current" is decided
// here, at read time, by comparing hashes rather than by any stored flag.

import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { sources, sourceVerifications } from '@robot/db';
import type { Database } from '@robot/db';
import {
  definitionHash,
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

/** The latest completed, all-passed verification whose hash matches the Source's current definition; null otherwise. */
export async function loadCurrentCertification(db: Database, sourceId: string): Promise<Certification | null> {
  const source = await db.query.sources.findFirst({
    where: eq(sources.id, sourceId),
    columns: { schemaDefinition: true, verificationSet: true },
  });
  const hash = source ? sourceDefinitionHash(source) : null;
  if (!hash) return null;

  const row = await db.query.sourceVerifications.findFirst({
    where: and(
      eq(sourceVerifications.sourceId, sourceId),
      eq(sourceVerifications.definitionHash, hash),
      eq(sourceVerifications.allPassed, true),
      isNotNull(sourceVerifications.completedAt),
    ),
    orderBy: [desc(sourceVerifications.completedAt)],
  });
  if (!row) return null;

  const results = row.results as Record<string, FieldVerification>;
  const fields = source!.schemaDefinition as SchemaDefinitionField[];
  const set = source!.verificationSet as VerificationSet;

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
    verificationId: row.id,
    completedAt: row.completedAt!,
    paths: Object.fromEntries(fields.map((f) => [f.key, results[f.key]?.certified ?? []])),
    concepts: Object.fromEntries(fields.map((f) => [f.key, f.concept])),
    hostname,
  };
}
