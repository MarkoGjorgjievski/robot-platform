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

import { and, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
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

type FieldCurrency = {
  latest: { id: string; completedAt: Date; results: Record<string, FieldVerification>; variantResults: VariantVerification | null } | null;
  currentKeys: string[];
  unchangedKeys: string[];
};

/**
 * The latest completed, error-free run: the one row both field and variant
 * currency are read from. Final review M6: ties on `completedAt` (two rows
 * completed in the same transaction-start-time instant) break on `desc(id)`,
 * the same tie-break `loadFieldCurrencyBatch`'s query already uses — without
 * it the overview and the website page could read different rows for the
 * same source.
 */
function latestCleanRun(db: Database, sourceId: string) {
  return db.query.sourceVerifications.findFirst({
    where: and(eq(sourceVerifications.sourceId, sourceId), isNotNull(sourceVerifications.completedAt), isNull(sourceVerifications.errorMessage)),
    orderBy: [desc(sourceVerifications.completedAt), desc(sourceVerifications.id)],
  });
}

/** The one clean-run row either `fieldCurrencyOf` or its batched sibling reads from. */
type CleanRunRow = { id: string; completedAt: Date | null; results: unknown; variantResults?: unknown };

/**
 * The hash comparison itself (spec 4.4), given the source row and its one
 * clean-run row (if any) — kept separate from fetching either, so
 * `loadFieldCurrencyBatch` can read every source's row in one query and still
 * decide currency exactly the way `loadFieldCurrency` does for one.
 *
 * A field is current when the run holds a passing result for it whose
 * `fieldHash` equals the hash of the field as it stands now. Rows written
 * before phase 2 carry no `fieldHash` and are never current.
 *
 * `unchangedKeys` is the wider set: fields whose latest result still
 * describes the field as it stands now (matching `fieldHash`), passed or
 * failed. It is what tells "fails on product 2" apart from "changed since
 * verified" — a failing field is never current, but it can be unchanged.
 */
function currencyOf(source: { schemaDefinition: unknown; verificationSet: unknown } | undefined, row: CleanRunRow | undefined): FieldCurrency {
  if (!source || !Array.isArray(source.schemaDefinition) || !source.verificationSet) return { latest: null, currentKeys: [], unchangedKeys: [] };
  const fields = source.schemaDefinition as SchemaDefinitionField[];
  const set = source.verificationSet as VerificationSet;

  if (!row || !row.completedAt) return { latest: null, currentKeys: [], unchangedKeys: [] };
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

  const variantResults = (row.variantResults as VariantVerification | null | undefined) ?? null;
  return { latest: { id: row.id, completedAt: row.completedAt, results, variantResults }, currentKeys, unchangedKeys };
}

/**
 * Per-field currency (spec 4.4): one source, one query for its latest
 * completed, error-free run.
 */
export async function loadFieldCurrency(db: Database, sourceId: string): Promise<FieldCurrency> {
  const source = await db.query.sources.findFirst({
    where: eq(sources.id, sourceId),
    columns: { schemaDefinition: true, verificationSet: true },
  });
  return fieldCurrencyOf(db, sourceId, source);
}

/** `loadFieldCurrency` on a source row the caller already read. */
async function fieldCurrencyOf(db: Database, sourceId: string, source: { schemaDefinition: unknown; verificationSet: unknown } | undefined): Promise<FieldCurrency> {
  if (!source || !Array.isArray(source.schemaDefinition) || !source.verificationSet) return { latest: null, currentKeys: [], unchangedKeys: [] };
  const row = await latestCleanRun(db, sourceId);
  return currencyOf(source, row ?? undefined);
}

/**
 * `loadFieldCurrency`, batched (ops overview, cut-over Task 3): every source's
 * latest clean run is read in ONE query (`selectDistinctOn`, same shape
 * `projects.get`'s last-run read uses for `runs`), rather than one
 * `loadFieldCurrency` call per source — so an ops page listing every
 * customer website never loops a per-source read beyond this single batch.
 * Reuses `currencyOf`'s hash logic verbatim, so a source's currency here is
 * never allowed to drift from what `loadFieldCurrency` would say for it alone.
 */
export async function loadFieldCurrencyBatch(
  db: Database,
  sourcesIn: Array<{ id: string; schemaDefinition: unknown; verificationSet: unknown }>,
): Promise<Map<string, FieldCurrency>> {
  const ids = sourcesIn.filter((s) => Array.isArray(s.schemaDefinition) && s.verificationSet).map((s) => s.id);

  const rows = ids.length
    ? await db
        .selectDistinctOn([sourceVerifications.sourceId], {
          sourceId: sourceVerifications.sourceId,
          id: sourceVerifications.id,
          completedAt: sourceVerifications.completedAt,
          results: sourceVerifications.results,
          variantResults: sourceVerifications.variantResults,
        })
        .from(sourceVerifications)
        .where(and(inArray(sourceVerifications.sourceId, ids), isNotNull(sourceVerifications.completedAt), isNull(sourceVerifications.errorMessage)))
        .orderBy(sourceVerifications.sourceId, desc(sourceVerifications.completedAt), desc(sourceVerifications.id))
    : [];
  const rowBySource = new Map(rows.map((r) => [r.sourceId, r]));

  return new Map(sourcesIn.map((s) => [s.id, currencyOf(s, rowBySource.get(s.id) ?? undefined)]));
}

export type VariantCurrency = { required: VariantsRequired; current: boolean; passed: boolean; result: VariantVerification | null };

type VariantSource = { verificationSet: unknown; variantSetup: unknown; dataset: { schema: unknown; variantMode: string } | null } | undefined;

/** The source row both halves of currency read: its fields and proof pages, and what the project and the website ask for of variants now. */
function loadSourceRow(db: Database, sourceId: string) {
  return db.query.sources.findFirst({
    where: eq(sources.id, sourceId),
    columns: { schemaDefinition: true, verificationSet: true, variantSetup: true },
    with: { dataset: { columns: { schema: true, variantMode: true } } },
  });
}

/**
 * Variant currency (spec 2026-10-01 §4) of one stored run's `variantResults`,
 * decided at read time like the fields': the project's mode and the website's
 * setup say whether variants are required at all, and the stored result is
 * current only while its hash equals the hash of the setup and answers as
 * they stand now. Setting the project back to `ignore`, or the website to
 * "no variants", needs no new run: `required` becomes `no` and nothing gates.
 */
function variantCurrencyOf(source: VariantSource, result: VariantVerification | null): VariantCurrency {
  const setup = (source?.variantSetup as VariantSetup | null | undefined) ?? null;
  const required = variantsRequired(source?.dataset?.variantMode, setup);
  if (required !== 'yes' || !source?.verificationSet) return { required, current: false, passed: false, result: null };
  const current = !!result && result.hash === currentVariantHash({ set: source.verificationSet as VerificationSet, setup: setup!, datasetSchema: source.dataset?.schema });
  return { required, current, passed: current && result!.passed, result };
}

/**
 * The certification and the variant currency, both from ONE read of the
 * latest clean run, so the field paths and the variants can never come from
 * different runs. `cert` is null unless every contract field is current
 * (spec 4.4); it carries `variants` only when they are required, current and
 * passed.
 */
export async function loadCertificationState(db: Database, sourceId: string): Promise<{ cert: Certification | null; variants: VariantCurrency }> {
  // ONE read of the source row, passed down, so the field half and the variant half always
  // describe the same binding state (final review M6).
  const source = await loadSourceRow(db, sourceId);
  const { latest, currentKeys } = await fieldCurrencyOf(db, sourceId, source);
  const variants = variantCurrencyOf(source, latest?.variantResults ?? null);

  if (!source || !Array.isArray(source.schemaDefinition) || source.schemaDefinition.length === 0 || !source.verificationSet) return { cert: null, variants };
  const fields = source.schemaDefinition as SchemaDefinitionField[];
  const set = source.verificationSet as VerificationSet;
  if (!latest || currentKeys.length !== fields.length) return { cert: null, variants };

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
    return { cert: null, variants };
  }

  return {
    cert: {
      verificationId: latest.id,
      completedAt: latest.completedAt,
      paths: Object.fromEntries(fields.map((f) => [f.key, latest.results[f.key]?.certified ?? []])),
      concepts: Object.fromEntries(fields.map((f) => [f.key, f.concept])),
      hostname,
      ...(variants.required === 'yes' && variants.passed && variants.result ? { variants: variants.result } : {}),
    },
    variants,
  };
}

/** A certification exists only when EVERY contract field is current on this source (spec 4.4). */
export async function loadCurrentCertification(db: Database, sourceId: string): Promise<Certification | null> {
  return (await loadCertificationState(db, sourceId)).cert;
}

/** Variant currency against the latest clean run (the same row `loadFieldCurrency` reads); see `variantCurrencyOf`. */
export async function loadVariantCurrency(db: Database, sourceId: string): Promise<VariantCurrency> {
  const source = await loadSourceRow(db, sourceId);
  const row = await latestCleanRun(db, sourceId);
  return variantCurrencyOf(source, (row?.variantResults as VariantVerification | null | undefined) ?? null);
}
