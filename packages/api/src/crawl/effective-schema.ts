// packages/api/src/crawl/effective-schema.ts
// One field list for the extraction chain, no matter where a Source's schema
// actually lives.
//
// A normal Source's schema lives on its Dataset (`datasets.schema`), shared
// across every Source in that dataset. Phase 2 (contract-on-dataset) put the
// project's field list there too, as keyed contract entries `{ key, name,
// type: CustomerFieldType, concept }` (spec 4.1) sitting alongside whatever
// legacy unkeyed operator entries were already on the dataset — so the
// Scratch dataset is no longer guaranteed empty. Only a Source whose dataset
// has no schema at all falls back to `sources.selectorsJson.fields` instead,
// legacy data written by the deleted `sources.analyze` procedure (removed
// 2026-09; no live writer).
//
// Both readers of "the schema" (`crawl.ts`'s plan path and the schema that
// feeds `extract-item.ts` via `crawl.ts`'s execute) must fall back the same
// way, or a Scratch source silently plans/extracts zero fields.

import { DETAIL_URL_FIELD, customerTypeToFieldType, type CustomerFieldType, type OriginField, type SchemaDefinitionField } from '@robot/scraper';

export type EffectiveSchemaField = OriginField & { displayName?: string };

type SelectorsJsonFieldsShape = {
  fields?: Array<OriginField & Record<string, unknown>>;
};

/** A dataset schema entry as it comes off the wire: either a keyed contract
 * entry (`contractFields`'s shape, spec 4.1) or a legacy unkeyed operator
 * entry (already an `OriginField`). */
type DatasetSchemaEntry = (EffectiveSchemaField & Record<string, unknown>) & { key?: unknown };

/** True whenever the Source carries a customer-authored schema definition
 * (Task 1's `sources.schemaDefinition`) that should win over both the
 * dataset schema and `selectorsJson.fields`. */
export function isCustomerSchema(source: { schemaDefinition?: unknown }): boolean {
  return Array.isArray(source.schemaDefinition) && source.schemaDefinition.length > 0;
}

/**
 * Dataset schema wins whenever it is non-empty — that is the normal case for
 * every non-Scratch Source. Only when the dataset has no schema at all does
 * this fall back to the source's own `selectorsJson.fields`, excluding any
 * field explicitly disabled (`enabled === false`).
 *
 * The dataset branch maps each keyed contract entry (`{ key, name, type:
 * CustomerFieldType, concept }`, spec 4.1) into the shape the extraction
 * chain expects: `key` becomes `name` (the chain's field identifier),
 * `type` is translated from the customer's vocabulary to the agent's
 * `FieldType` vocabulary via `customerTypeToFieldType`, `origin` defaults to
 * `'detail'` when absent, and the customer's plain-language label survives
 * as `displayName`. A legacy unkeyed operator entry has no `key` and passes
 * through unchanged.
 *
 * BOTH branches preserve the full field objects. The fallback used to map
 * down to `{name, type}`, which silently stripped `origin`/`input_column`/
 * `candidate` from a Scratch source's schema — hidden by `as OriginField[]`
 * casts at the call sites — so a customer's explicit candidate choice (the
 * v2.5 serving order) never reached extraction, and every field defaulted to
 * `'detail'` in `partitionSchemaByOrigin`.
 *
 * `DETAIL_URL_FIELD` is filtered out of both branches — Finding 4
 * (final-review-findings.md): it is planning machinery (the row-scoped
 * "which detail page does this row link to" field `runListingAnalysis`
 * always adds, and that the deleted `sources.analyze` procedure (removed
 * 2026-09; no live writer) used to persist into `selectorsJson.fields`
 * verbatim, for the discovery report), re-added by `plan-run.ts` itself
 * wherever a listing crawl actually needs it. Left in here, it round-trips
 * into `extract-item.ts`'s detail-origin fields (`partitionSchemaByOrigin`
 * has no origin to place it by, so it defaults to `'detail'`) — a
 * `detail_url` column in every result row/export, an extra AI-selector
 * attempt per cold detail domain, and `detail_url` fieldPaths written into
 * the enriched-forever `(domain, 'detail')` cache.
 */
export function effectiveSchema(source: {
  dataset?: { schema?: unknown } | null;
  selectorsJson?: unknown;
  schemaDefinition?: unknown;
}): EffectiveSchemaField[] {
  if (isCustomerSchema(source)) {
    return (source.schemaDefinition as SchemaDefinitionField[]).map((f) => ({
      name: f.key,
      type: customerTypeToFieldType(f.type),
      origin: 'detail' as const,
      displayName: f.name,
    }));
  }

  const datasetSchema = source.dataset?.schema as DatasetSchemaEntry[] | null | undefined;
  if (Array.isArray(datasetSchema) && datasetSchema.length > 0) {
    return datasetSchema
      // Axis entries (spec 2026-10-01 §2, `kind: 'axis'`) sit on the dataset
      // schema alongside contract fields but are never extracted as a field
      // themselves — they have no `type`, so mapping one through here the
      // way a keyed field is mapped would hand the chain a field with
      // `type: undefined`. `contractFields` applies this same exclusion;
      // mirrored here rather than reusing it because this branch must also
      // keep legacy unkeyed entries, which `contractFields` drops.
      .filter((f) => (f as { kind?: unknown }).kind !== 'axis')
      .filter((f) => f.name !== DETAIL_URL_FIELD)
      .map((f) =>
        typeof f.key === 'string'
          ? {
              ...f,
              name: f.key,
              type: customerTypeToFieldType(f.type as unknown as CustomerFieldType),
              origin: f.origin ?? 'detail',
              displayName: f.name,
            }
          : f,
      );
  }

  const selectors = source.selectorsJson as SelectorsJsonFieldsShape | null | undefined;
  const fields = selectors?.fields ?? [];
  return fields.filter((f) => f.enabled !== false && f.name !== DETAIL_URL_FIELD);
}
