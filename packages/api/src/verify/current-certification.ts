// A Source's current certification: currency (spec 4.4) is decided per
// field, at read time, by comparing each stored result's `fieldHash`
// against the present `fieldHash(field, set)` on the latest completed,
// error-free run — a certification exists only when every contract field
// is current on that run or held (spec 2026-10-21 §3.1: a field the latest
// Verify did not pass is read from its hold, the last passing result, while
// the hold stands for today's hash). `definitionHash` is still kept on each row, but
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
import { loadHolds, loadHoldsBatch, resultPasses, type Certifying, type Hold, type HoldsDb } from './holds.js';

export { resultPasses } from './holds.js';

export type Certification = {
  /**
   * The latest clean Verify — when fields are held, the one that did not pass them, not the hold's. A field's
   * own provenance (which Verify passed the result runs read) is `certifyingResult`'s.
   */
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
  /**
   * fieldKey → the website's default as the customer typed it, trimmed (spec 2026-10-13 §5). It is
   * stored as text, not normalised here: normalisation happens at fill time, when
   * `applyDefaults`/`renderDefault` render it for the field's type. Always set by
   * `loadCertificationState`; optional only so older fakes compile.
   */
  defaults?: Record<string, string>;
  /** Spec 2026-10-21 §3.1: the fields read from their hold (the last passing result) because the latest Verify did not pass them. Set only when some are. */
  held?: string[];
};

export function sourceDefinitionHash(source: { schemaDefinition: unknown; verificationSet: unknown }): string | null {
  if (!Array.isArray(source.schemaDefinition) || !source.verificationSet) return null;
  return definitionHash(source.schemaDefinition as SchemaDefinitionField[], source.verificationSet as VerificationSet);
}

export type FieldCurrency = {
  latest: { id: string; completedAt: Date; results: Record<string, FieldVerification>; variantResults: VariantVerification | null } | null;
  currentKeys: string[];
  unchangedKeys: string[];
  /** Spec 2026-10-21 §3.1: fields not current whose hold stands for today's hash. Runs read the hold's paths. */
  heldKeys: string[];
  held: Record<string, Hold>;
};

/** A fresh empty currency each time: callers may keep and extend the arrays. */
const none = (): FieldCurrency => ({ latest: null, currentKeys: [], unchangedKeys: [], heldKeys: [], held: {} });

/**
 * Spec 2026-10-17 §2: the fields whose current result says they are not on this website. Such a
 * field is left empty on every product and never blocks or flags one, so a run's coverage, misses,
 * dead-field classification, backfill targets and the Extract sample's empty-cell note leave it out.
 * Current only: once a cell gets a value the field's hash moves and it counts again. A held field
 * (spec 2026-10-21 §3.1) is read from its hold, so its hold's result decides.
 */
export function notOnWebsiteKeys(currency: Pick<FieldCurrency, 'latest' | 'currentKeys'> & Partial<Pick<FieldCurrency, 'heldKeys' | 'held'>>): string[] {
  const current = currency.currentKeys.filter((k) => currency.latest?.results[k]?.notOnWebsite === true);
  const held = (currency.heldKeys ?? []).filter((k) => currency.held?.[k]?.result.notOnWebsite === true);
  return [...current, ...held];
}

/**
 * The latest completed, error-free run: the one row both field and variant
 * currency are read from. Final review M6: ties on `completedAt` (two rows
 * completed in the same transaction-start-time instant) break on `desc(id)`,
 * the same tie-break `loadFieldCurrencyBatch`'s query already uses — without
 * it the overview and the website page could read different rows for the
 * same source.
 */
function latestCleanRun(db: HoldsDb, sourceId: string) {
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
function currencyOf(source: { schemaDefinition: unknown; verificationSet: unknown } | undefined, row: CleanRunRow | undefined, holds: Hold[] = []): FieldCurrency {
  if (!source || !Array.isArray(source.schemaDefinition) || !source.verificationSet) return none();
  const fields = source.schemaDefinition as SchemaDefinitionField[];
  const set = source.verificationSet as VerificationSet;

  if (!row || !row.completedAt) return none();
  const results = row.results as Record<string, FieldVerification>;

  const unchangedKeys = fields
    .filter((f) => {
      const r = results[f.key];
      return !!r && !!r.fieldHash && r.fieldHash === fieldHash(f, set);
    })
    .map((f) => f.key);

  const currentKeys = unchangedKeys.filter((key) => {
    // A field passed by its default alone (spec 2026-10-13 §4) is current with no path.
    // A field not on this website (spec 2026-10-17 §2) is current with no path.
    return resultPasses(results[key]);
  });

  // Spec 2026-10-21 §3.1: a field not current is held while its hold stands for today's hash.
  // Only the customer's edit moves the hash off the hold's list, so only it ends a hold.
  // A hold counts only when its result passes (fix wave 1, item 6) — writeHolds never writes another, but a
  // row is read as it stands.
  const heldKeys = fields
    .filter((f) => !currentKeys.includes(f.key) && holds.some((h) => h.fieldKey === f.key && resultPasses(h.result) && h.fieldHashes.includes(fieldHash(f, set))))
    .map((f) => f.key);
  const held = Object.fromEntries(heldKeys.map((k) => [k, holds.find((h) => h.fieldKey === k)!]));

  const variantResults = (row.variantResults as VariantVerification | null | undefined) ?? null;
  return { latest: { id: row.id, completedAt: row.completedAt, results, variantResults }, currentKeys, unchangedKeys, heldKeys, held };
}

/**
 * Per-field currency (spec 4.4): one source, one query for its latest
 * completed, error-free run.
 */
export async function loadFieldCurrency(db: HoldsDb, sourceId: string): Promise<FieldCurrency> {
  const source = await db.query.sources.findFirst({
    where: eq(sources.id, sourceId),
    columns: { schemaDefinition: true, verificationSet: true },
  });
  return fieldCurrencyOf(db, sourceId, source);
}

/** `loadFieldCurrency` on a source row the caller already read. */
async function fieldCurrencyOf(db: HoldsDb, sourceId: string, source: { schemaDefinition: unknown; verificationSet: unknown } | undefined): Promise<FieldCurrency> {
  if (!source || !Array.isArray(source.schemaDefinition) || !source.verificationSet) return none();
  const [row, holds] = await Promise.all([latestCleanRun(db, sourceId), loadHolds(db, sourceId)]);
  return currencyOf(source, row ?? undefined, holds);
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

  const [rows, holdsBySource] = await Promise.all([ids.length
    ? db
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
    : Promise.resolve([]), loadHoldsBatch(db, ids)]);
  const rowBySource = new Map(rows.map((r) => [r.sourceId, r]));

  return new Map(sourcesIn.map((s) => [s.id, currencyOf(s, rowBySource.get(s.id) ?? undefined, holdsBySource.get(s.id) ?? [])]));
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
 * (spec 4.4) or held (spec 2026-10-21 §3.1; a held field's paths are its
 * hold's); it carries `variants` only when they are required, current and
 * passed. Holds cover fields only, never variants.
 */
export async function loadCertificationState(db: Database, sourceId: string): Promise<{ cert: Certification | null; variants: VariantCurrency }> {
  // ONE read of the source row, passed down, so the field half and the variant half always
  // describe the same binding state (final review M6).
  const source = await loadSourceRow(db, sourceId);
  const { latest, currentKeys, heldKeys, held } = await fieldCurrencyOf(db, sourceId, source);
  const variants = variantCurrencyOf(source, latest?.variantResults ?? null);

  if (!source || !Array.isArray(source.schemaDefinition) || source.schemaDefinition.length === 0 || !source.verificationSet) return { cert: null, variants };
  const fields = source.schemaDefinition as SchemaDefinitionField[];
  const set = source.verificationSet as VerificationSet;
  // Spec 2026-10-21 §3.1: every field current or held.
  if (!latest || currentKeys.length + heldKeys.length !== fields.length) return { cert: null, variants };

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
      paths: Object.fromEntries(fields.map((f) => [f.key, held[f.key]?.result.certified ?? latest.results[f.key]?.certified ?? []])),
      concepts: Object.fromEntries(fields.map((f) => [f.key, f.concept])),
      hostname,
      defaults: Object.fromEntries(fields.flatMap((f) => { const d = (set.defaults?.[f.key] ?? '').trim(); return d ? [[f.key, d] as const] : []; })),
      ...(heldKeys.length > 0 ? { held: heldKeys } : {}),
      ...(variants.required === 'yes' && variants.passed && variants.result ? { variants: variants.result } : {}),
    },
    variants,
  };
}

/** A certification exists only when EVERY contract field is current (spec 4.4) or held (spec 2026-10-21 §3.1). */
export async function loadCurrentCertification(db: Database, sourceId: string): Promise<Certification | null> {
  return (await loadCertificationState(db, sourceId)).cert;
}

/** Variant currency against the latest clean run (the same row `loadFieldCurrency` reads); see `variantCurrencyOf`. */
export async function loadVariantCurrency(db: Database, sourceId: string): Promise<VariantCurrency> {
  const source = await loadSourceRow(db, sourceId);
  const row = await latestCleanRun(db, sourceId);
  return variantCurrencyOf(source, (row?.variantResults as VariantVerification | null | undefined) ?? null);
}

/** The result runs read for `key` now — its current result, else its hold — or null (spec 2026-10-21 §3.1). */
export function certifyingResult(currency: FieldCurrency, key: string): Certifying | null {
  if (currency.latest && currency.currentKeys.includes(key)) {
    const r = currency.latest.results[key]!;
    return { result: r, verificationId: currency.latest.id, verifiedAt: currency.latest.completedAt, fieldHashes: r.fieldHash ? [r.fieldHash] : [] };
  }
  const h = currency.held[key];
  return h ? { result: h.result, verificationId: h.verificationId, verifiedAt: h.verifiedAt, fieldHashes: h.fieldHashes } : null;
}

/**
 * Why this website may not run, or null when it may: a certification, and the variants it needs. The one rule
 * `requireCertification` (the run gate) throws with and `runnableOf` answers, so the two never differ
 * (fix wave 1, item 6). The gate also lets a legacy website (no customer schema) through before asking; that
 * is the gate's own, since such a website has no certification state to read.
 */
export function runRefusal(state: { cert: Certification | null; variants: VariantCurrency }): string | null {
  if (!state.cert) return 'Verify the schema before extracting';
  if (state.variants.required === 'setup-missing') return "Set up this website's variants before extracting";
  if (state.variants.required === 'yes' && !(state.variants.current && state.variants.passed)) return 'Verify the variants before extracting';
  return null;
}

/** May this website run? `runRefusal`'s rule, as a boolean. */
export function runnableOf(state: { cert: Certification | null; variants: VariantCurrency }): boolean {
  return runRefusal(state) === null;
}
