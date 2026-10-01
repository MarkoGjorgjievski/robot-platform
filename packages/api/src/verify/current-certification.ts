// A Source's current certification: currency (spec 4.4) is decided per
// field, at read time, by comparing each stored result's `fieldHash`
// against the present `fieldHash(field, set)` on the latest completed,
// error-free run — a certification exists only when every contract field
// is current on that run. `definitionHash` is still kept on each row, but
// only for history; nothing here reads it to decide currency. Editing the
// binding (`updateBinding`) or the contract (`datasets.ts`'s `addField` /
// `renameField` / `retypeField` / `deleteField`) never touches past
// `source_verifications` rows, so a hash mismatch — not a stored flag — is
// what tells a caller a field moved on since that run.

import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import { sources, sourceVerifications } from '@robot/db';
import type { Database } from '@robot/db';
import {
  definitionHash,
  fieldHash,
  type CertifiedPath,
  type FieldVerification,
  type SchemaDefinitionField,
  type VariantVerification,
  type VerificationSet,
} from '@robot/scraper';
import type { VariantSetup } from '../contract.js';
import { variantsRequired, currentVariantHash, type VariantsRequired } from './variant-check.js';

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
  /** The website's variant certification (spec 2026-10-01): present only when its variants are required, current and passed. */
  variants?: VariantVerification;
};

export function sourceDefinitionHash(source: { schemaDefinition: unknown; verificationSet: unknown }): string | null {
  if (!Array.isArray(source.schemaDefinition) || !source.verificationSet) return null;
  return definitionHash(source.schemaDefinition as SchemaDefinitionField[], source.verificationSet as VerificationSet);
}

/** The latest completed, error-free run: the one row both field and variant currency are read from. */
function latestCleanRun(db: Database, sourceId: string) {
  return db.query.sourceVerifications.findFirst({
    where: and(eq(sourceVerifications.sourceId, sourceId), isNotNull(sourceVerifications.completedAt), isNull(sourceVerifications.errorMessage)),
    orderBy: [desc(sourceVerifications.completedAt)],
  });
}

/**
 * Per-field currency (spec 4.4). The latest completed, error-free run is the
 * only one consulted; a field is current when that run holds a passing result
 * for it whose `fieldHash` equals the hash of the field as it stands now.
 * Rows written before phase 2 carry no `fieldHash` and are never current.
 *
 * `unchangedKeys` is the wider set: fields whose latest result still
 * describes the field as it stands now (matching `fieldHash`), passed or
 * failed. It is what tells "fails on product 2" apart from "changed since
 * verified" — a failing field is never current, but it can be unchanged.
 */
export async function loadFieldCurrency(db: Database, sourceId: string): Promise<{
  latest: { id: string; completedAt: Date; results: Record<string, FieldVerification> } | null;
  currentKeys: string[];
  unchangedKeys: string[];
}> {
  const source = await db.query.sources.findFirst({
    where: eq(sources.id, sourceId),
    columns: { schemaDefinition: true, verificationSet: true },
  });
  if (!source || !Array.isArray(source.schemaDefinition) || !source.verificationSet) return { latest: null, currentKeys: [], unchangedKeys: [] };
  const fields = source.schemaDefinition as SchemaDefinitionField[];
  const set = source.verificationSet as VerificationSet;

  const row = await latestCleanRun(db, sourceId);
  if (!row) return { latest: null, currentKeys: [], unchangedKeys: [] };
  const results = row.results as Record<string, FieldVerification>;

  const unchangedKeys = fields
    .filter((f) => {
      const r = results[f.key];
      return !!r && !!r.fieldHash && r.fieldHash === fieldHash(f, set);
    })
    .map((f) => f.key);

  const currentKeys = unchangedKeys.filter((key) => {
    const r = results[key]!;
    return r.certified.length > 0 && Object.values(r.cells).length > 0 && Object.values(r.cells).every((c) => c.status === 'pass');
  });

  return { latest: { id: row.id, completedAt: row.completedAt!, results }, currentKeys, unchangedKeys };
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

  const variants = await loadVariantCurrency(db, sourceId);
  return {
    verificationId: latest.id,
    completedAt: latest.completedAt,
    paths: Object.fromEntries(fields.map((f) => [f.key, latest.results[f.key]?.certified ?? []])),
    concepts: Object.fromEntries(fields.map((f) => [f.key, f.concept])),
    hostname,
    ...(variants.required === 'yes' && variants.passed && variants.result ? { variants: variants.result } : {}),
  };
}

/**
 * Variant currency (spec 2026-10-01 §4), decided at read time like the
 * fields': the project's mode and the website's setup say whether variants
 * are required at all, and the latest clean run (the same row
 * `loadFieldCurrency` reads) is current only while its `variantResults.hash`
 * equals the hash of the setup and answers as they stand now. Setting the
 * project back to `ignore`, or the website to "no variants", needs no new
 * run: `required` becomes `no` and nothing here gates.
 */
export async function loadVariantCurrency(db: Database, sourceId: string): Promise<{
  required: VariantsRequired; current: boolean; passed: boolean; result: VariantVerification | null;
}> {
  const source = await db.query.sources.findFirst({
    where: eq(sources.id, sourceId),
    columns: { verificationSet: true, variantSetup: true },
    with: { dataset: { columns: { schema: true, variantMode: true } } },
  });
  const setup = (source?.variantSetup as VariantSetup | null | undefined) ?? null;
  const required = variantsRequired(source?.dataset?.variantMode, setup);
  if (required !== 'yes' || !source?.verificationSet) return { required, current: false, passed: false, result: null };

  const row = await latestCleanRun(db, sourceId);
  const result = (row?.variantResults as VariantVerification | null | undefined) ?? null;
  const current = !!result && result.hash === currentVariantHash({ set: source.verificationSet as VerificationSet, setup: setup!, datasetSchema: source.dataset?.schema });
  return { required, current, passed: current && result!.passed, result };
}
