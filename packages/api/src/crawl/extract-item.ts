// packages/api/src/crawl/extract-item.ts
// One work item → one persisted row.
//
// The detail page is asked ONLY for detail-origin fields. Listing-origin values
// were captured during planning and travel on the item; re-asking the detail page
// for them risks a wrong value from a page that never had them, which is exactly
// what the origin partition exists to prevent.
//
// A certified Source (deps.certification set) takes an entirely different
// path: it runs ONLY the paths a human verification certified — never
// runExtraction, never cache/AI enrichment — via runVerifiedExtraction. A
// path that no longer resolves is an honest miss (null in the row), not a
// cue to fall back to anything else. Both paths persist through the same
// captures+extractions rows (persistRow), so every downstream reader
// (coverage, export, the results table) sees one shape no matter which
// extraction chain produced it.

import type { IBrowser } from '@robot/browser';
import {
  runExtraction, mergeRow, partitionSchemaByOrigin, discoverCandidateCatalogue,
  runVerifiedExtraction, recordVerifiedPathStats, resolveVariantList, buildVariantRows,
  buildXPathLinksScript, normalizeVariantLink, normalizeVariantLinks, groupKeyOf, variantKeyOf,
  resolveBudget, itemCap,
  type ExtractionAgent, type OriginField, type SchemaDefinitionField, type VariantRunPlan,
} from '@robot/scraper';
import { captures, extractions } from '@robot/db';
import type { db as Database } from '@robot/db';
import type { ClaimedItem } from './claim-item.js';
import { queueVariantGroup } from './queue-variant-pages.js';
import type { Certification } from '../verify/current-certification.js';

export type ExtractItemDeps = {
  browser: IBrowser;
  agent: ExtractionAgent | null;
  sourceId: string;
  runId: string;
  schema: OriginField[];
  /** Injected so the merge can be tested without a browser or an API key. */
  extract?: typeof runExtraction;
  /** Set for a certified customer Source — routes extraction through
   * runVerifiedExtraction instead of the cache/AI chain. */
  certification?: Certification | null;
  /** The Source's customer schema definition, for the CUSTOMER field type
   * (effectiveSchema's OriginField.type is the agent FieldType, not the
   * customer type the certified paths' normalize/render need). */
  schemaDefinition?: SchemaDefinitionField[];
  extractVerified?: typeof runVerifiedExtraction;
  recordStats?: typeof recordVerifiedPathStats;
  /** The run's variant plan (loaded once by start-execution.ts), when this Source's
   * certification carries variants. Task 3 reads this to build one row per variant;
   * unset, extraction behaves exactly as it does today. */
  variantPlan?: VariantRunPlan | null;
  /** The run's item cap, `itemCap(resolveBudget(source.budget))`, computed once per
   * run by start-execution.ts. Links-method variant pages count against it. Unset
   * falls back to the default budget's cap. */
  itemCap?: number;
  /** Injected so the links method can be tested without a database. */
  queueVariants?: typeof queueVariantGroup;
};

export async function extractItem(
  db: typeof Database,
  item: ClaimedItem,
  deps: ExtractItemDeps,
): Promise<{ row: Record<string, unknown>; extractionId: string | null; targetFields: string[] | null }> {
  // A repair item's focus narrows what we ask the detail page for. `origin:
  // 'input'` fields always survive the filter — they cost nothing to keep and
  // mergeRow needs them to fill in the row's input columns.
  //
  // Fix round 1 (reviewer finding, Critical): a variants plan's key-composing
  // fields (`skuKey`/`gtinKey`) must survive the filter too, even when
  // neither is the repair's own target. `variantKeyOf` (scraper/verify/
  // variant-rows.ts) prefers the SKU, then the GTIN, over axes/URL — so a
  // backfill that narrows the request to (say) just `price` would re-extract
  // without the SKU, `variantKeyOf` would fall back to axes/own-URL for
  // every re-extracted row, and none of those keys would match the parent's
  // SKU-derived `_variant_key`s in mergeBackfillResult — every row looking
  // "unmatched" and (pre-fix-round-2) appended as a duplicate.
  const focus = item.targetFields;
  const keyFields = new Set<string>();
  if (deps.variantPlan?.skuKey) keyFields.add(deps.variantPlan.skuKey);
  if (deps.variantPlan?.gtinKey) keyFields.add(deps.variantPlan.gtinKey);
  const schema = focus
    ? deps.schema.filter((f) => focus.includes(f.name) || f.origin === 'input' || keyFields.has(f.name))
    : deps.schema;
  const partitions = partitionSchemaByOrigin(schema);

  // `rows.length` is normally 1 — a list-method variants plan (Task 3) is the
  // one path that persists several rows (one per variant) in the single
  // extraction a product page produces. Every other caller passes a one-row
  // array, so `data`/`rowCount` are byte-identical to the old persistRow.
  const persistRows = async (rows: Record<string, unknown>[], confidence: number, metadata: Record<string, unknown> = {}) => {
    const [capture] = await db.insert(captures).values({
      sourceId: deps.sourceId,
      runId: deps.runId,
      url: item.url,
      metadata,
    }).returning({ id: captures.id });

    const [extraction] = await db.insert(extractions).values({
      sourceId: deps.sourceId,
      captureId: capture!.id,
      runId: deps.runId,
      data: rows,
      rowCount: rows.length,
      confidence,
    }).returning({ id: extractions.id });

    // `item.targetFields` IS the merge target list for a backfill item — the
    // same repair focus that narrowed the schema above is exactly what a
    // merge-aware `onDone` needs to know which cells this row is allowed to
    // fill on the parent item. The returned `row` stays the FIRST row, so
    // existing callers (none of which know about variants) keep working.
    return { row: rows[0] ?? {}, extractionId: extraction?.id ?? null, targetFields: item.targetFields };
  };

  if (deps.certification) {
    const extractVerified = deps.extractVerified ?? runVerifiedExtraction;
    const recordStats = deps.recordStats ?? recordVerifiedPathStats;
    const types = new Map((deps.schemaDefinition ?? []).map((f) => [f.key, f.type]));
    const fields = schema
      .filter((f) => (f.origin ?? 'detail') === 'detail')
      .map((f) => ({
        key: f.name,
        type: types.get(f.name) ?? 'text',
        concept: deps.certification!.concepts[f.name] ?? f.name,
        paths: deps.certification!.paths[f.name] ?? [],
      }));

    const verified = await extractVerified({ url: item.url, fields }, { browser: deps.browser });

    // M3: the stats belong to the host the certification was proven against
    // — the `domain_intelligence` row `saveVerifiedPaths` actually wrote
    // these paths into — not to whatever host this item's URL happens to
    // carry (a CDN host, a country domain, a redirect target), where they
    // do not exist and the update would silently no-op.
    //
    // I5: cache bookkeeping is an enrichment, never a reason to fail a work
    // item. The row below is real, extracted data; losing it because a
    // stats UPDATE deadlocked or the domain row vanished would be strictly
    // worse than losing one hit/miss tally, so this logs and carries on.
    try {
      await recordStats(deps.certification.hostname, 'detail', verified.stats.map((s) => ({ concept: s.concept, path: s.path, hit: s.hit, value: s.value, url: item.url })));
    } catch (err) {
      console.error(`[crawl] verified path stats failed for ${item.url}:`, err);
    }

    const row = mergeRow({
      inputFields: partitions.input,
      inputValues: item.inputValues,
      listingValues: item.listingValues,
      detailRow: verified.data,
      url: item.url,
      pageNumber: item.pageNumber,
    });

    const hits = fields.filter((f) => verified.data[f.key] !== null).length;
    const confidence = fields.length ? Math.round((100 * hits) / fields.length) : 0;

    // The capture's timings ride on the capture row so a run can be measured
    // per product from the database, not from a console log: this is how the
    // 70 s → 7 s Ikea change is checked, and what the next speed work reads.
    const t = verified.timings;
    if (t) console.log(`[crawl] ${item.url} captured in ${t.totalMs}ms (navigate ${t.navigateMs}ms, ready ${t.readyState ?? 'n/a'} ${t.readyMs ?? 0}ms), ${hits}/${fields.length} fields`);

    // List-method variants: the certified list lives on this same page capture
    // (certification Global Constraints, 2026-10-02) — a page that no longer
    // carries it (resolveVariantList → null) just gets its own one-row
    // extraction, exactly as a non-variants product does; the run never fails
    // over it (Review Focus 1). `links` method and no plan at all both fall
    // through to the single product row, unchanged.
    if (deps.variantPlan?.method === 'list') {
      const plan = deps.variantPlan;
      const entries = verified.capture ? resolveVariantList(verified.capture, plan.list!) : null;
      const built = buildVariantRows({ productRow: row, entries, plan, pageUrl: item.url });
      return persistRows(built.rows, confidence, t ? { capture: t } : {});
    }

    // Links-method variants (Task 4): this page is ONE variant — it keeps its
    // own single row — and its swatch links (the certified collector, read off
    // the same capture) name the rest of its group. Every member computes the
    // same group, so the same `_product_key` (groupKeyOf: the smallest
    // normalised URL), whichever is extracted first (Review Focus 2).
    if (deps.variantPlan?.method === 'links') {
      const plan = deps.variantPlan;
      const ownUrl = normalizeVariantLink(item.url);
      const links = verified.capture && plan.collector
        ? (await deps.browser.setContentEvaluate<Array<{ href: string; label: string }> | null>(
            verified.capture.html, buildXPathLinksScript(plan.collector, item.url))) ?? []
        : [];

      if (links.length === 0) {
        // A product without variants (or a page that no longer carries the
        // collector): its own URL is its key, and it has no `_variant_key`.
        return persistRows([{ ...row, _product_key: ownUrl }], confidence, t ? { capture: t } : {});
      }

      const group = normalizeVariantLinks([item.url, ...links.map((l) => l.href)]);
      const productKey = groupKeyOf(group);
      const own: Record<string, unknown> = { ...row, _product_key: productKey };
      const ownLink = links.find((l) => normalizeVariantLink(l.href) === ownUrl);
      const firstAxis = plan.axes[0];
      if (ownLink && firstAxis) own[firstAxis.key] = ownLink.label;
      own._variant_key = variantKeyOf(own, plan, ownUrl);

      // Queued BEFORE the row is persisted: a queueing failure fails the item
      // with nothing written, so its retry cannot leave a second extraction
      // (and a doubled row total) behind. queueVariantGroup itself skips every
      // member already in the run.
      //
      // Final review I1: only an original extraction queues. A repair item
      // (`targetFields` set — a backfill or repair-sweep run) fills cells on
      // its parent; it does not crawl, and siblings queued into that child
      // run would never merge back anywhere.
      const others = group.filter((u) => u !== ownUrl);
      if (others.length > 0 && item.targetFields == null) {
        const queue = deps.queueVariants ?? queueVariantGroup;
        await queue(db, {
          runId: deps.runId,
          sourceId: deps.sourceId,
          productKey,
          urls: others,
          from: item,
          cap: deps.itemCap ?? itemCap(resolveBudget(null)),
        });
      }

      return persistRows([own], confidence, t ? { capture: t } : {});
    }

    return persistRows([row], confidence, t ? { capture: t } : {});
  }

  const extract = deps.extract ?? runExtraction;

  // Catalogue discovery is an enrichment, injected only when we have a key to
  // pay for it — undefined skips discovery entirely (see ExtractionDeps).
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const discoverCatalogue = apiKey
    ? (evidence: Parameters<typeof discoverCandidateCatalogue>[0]) =>
        discoverCandidateCatalogue(evidence, { apiKey })
    : undefined;

  // runExtraction takes the per-domain lock itself, and this loop is sequential,
  // so nothing here holds a lock around it.
  const outcome = await extract(
    {
      url: item.url,
      pageType: 'detail',
      fields: partitions.detail.map((f) => ({ name: f.name, type: f.type, candidate: f.candidate })),
    },
    { browser: deps.browser, agent: deps.agent, discoverCatalogue },
  );

  const row = mergeRow({
    inputFields: partitions.input,
    inputValues: item.inputValues,
    listingValues: item.listingValues,
    detailRow: outcome.data[0] ?? {},
    url: item.url,
    pageNumber: item.pageNumber,
  });

  return persistRows([row], Math.round((outcome.confidence ?? 0) * 100));
}
