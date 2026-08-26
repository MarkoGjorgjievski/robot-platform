// packages/api/src/crawl/extract-item.ts
// One work item → one persisted row.
//
// The detail page is asked ONLY for detail-origin fields. Listing-origin values
// were captured during planning and travel on the item; re-asking the detail page
// for them risks a wrong value from a page that never had them, which is exactly
// what the origin partition exists to prevent.

import type { IBrowser } from '@robot/browser';
import {
  runExtraction, mergeRow, partitionSchemaByOrigin, discoverCandidateCatalogue,
  type ExtractionAgent, type OriginField,
} from '@robot/scraper';
import { captures, extractions } from '@robot/db';
import type { db as Database } from '@robot/db';
import type { ClaimedItem } from './claim-item.js';

export type ExtractItemDeps = {
  browser: IBrowser;
  agent: ExtractionAgent | null;
  sourceId: string;
  runId: string;
  schema: OriginField[];
  /** Injected so the merge can be tested without a browser or an API key. */
  extract?: typeof runExtraction;
};

export async function extractItem(
  db: typeof Database,
  item: ClaimedItem,
  deps: ExtractItemDeps,
): Promise<{ row: Record<string, unknown>; extractionId: string | null }> {
  const partitions = partitionSchemaByOrigin(deps.schema);
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

  const [capture] = await db.insert(captures).values({
    sourceId: deps.sourceId,
    runId: deps.runId,
    url: item.url,
    metadata: {},
  }).returning({ id: captures.id });

  const [extraction] = await db.insert(extractions).values({
    sourceId: deps.sourceId,
    captureId: capture!.id,
    runId: deps.runId,
    data: [row],
    rowCount: 1,
    confidence: Math.round((outcome.confidence ?? 0) * 100),
  }).returning({ id: extractions.id });

  return { row, extractionId: extraction?.id ?? null };
}
