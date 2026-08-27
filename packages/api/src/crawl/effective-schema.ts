// packages/api/src/crawl/effective-schema.ts
// One field list for the extraction chain, no matter where a Source's schema
// actually lives.
//
// A normal Source's schema lives on its Dataset (`datasets.schema`), shared
// across every Source in that dataset. A Scratch source (quickCreate/analyze,
// mvp-simplification task 7) has no meaningful dataset schema to inherit — its
// Scratch dataset is deliberately created with an EMPTY schema (see
// `sources.quickCreate`) — so its schema lives directly on
// `sources.selectorsJson.fields` instead, written by `sources.analyze`.
//
// Both readers of "the schema" (`crawl.ts`'s plan path and the schema that
// feeds `extract-item.ts` via `crawl.ts`'s execute) must fall back the same
// way, or a Scratch source silently plans/extracts zero fields.

import { DETAIL_URL_FIELD } from '@robot/scraper';

export type EffectiveSchemaField = { name: string; type: string };

type SelectorsJsonFieldsShape = {
  fields?: Array<{ name: string; type: string; enabled?: boolean }>;
};

/**
 * Dataset schema wins whenever it is non-empty — that is the normal case for
 * every non-Scratch Source. Only when the dataset has no schema at all does
 * this fall back to the source's own `selectorsJson.fields`, mapped down to
 * `{name, type}` and excluding any field explicitly disabled
 * (`enabled === false`).
 *
 * `DETAIL_URL_FIELD` is filtered out of both branches — Finding 4
 * (final-review-findings.md): it is planning machinery (the row-scoped
 * "which detail page does this row link to" field `runListingAnalysis`
 * always adds, and `sources.analyze` persists into `selectorsJson.fields`
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
}): EffectiveSchemaField[] {
  const datasetSchema = source.dataset?.schema as EffectiveSchemaField[] | null | undefined;
  if (Array.isArray(datasetSchema) && datasetSchema.length > 0) {
    return datasetSchema.filter((f) => f.name !== DETAIL_URL_FIELD);
  }

  const selectors = source.selectorsJson as SelectorsJsonFieldsShape | null | undefined;
  const fields = selectors?.fields ?? [];
  return fields
    .filter((f) => f.enabled !== false && f.name !== DETAIL_URL_FIELD)
    .map((f) => ({ name: f.name, type: f.type }));
}
