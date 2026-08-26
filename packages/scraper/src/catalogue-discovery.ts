import { AnthropicProvider } from '@robot/agent';
import { sanitizeCatalogue, type CandidateCatalogue } from './candidate-catalogue.js';
import { getByDotPath } from './domain-cache.js';

export type CatalogueEvidence = {
  apiBodies: unknown[];
  jsonLdBlocks: unknown[];
  meta: Record<string, string>;
  fieldResults: Array<{ name: string; value: unknown; source: string; path: string }>;
};

export function buildCataloguePrompt(evidence: CatalogueEvidence): string {
  return [
    'You are cataloguing what this product page CAN yield, per concept.',
    'Group value-bearing paths into concepts (snake_case singular: price, rating, review_count, image).',
    'Label each candidate by its meaning, never its path: "list", "range_min", "promo", "yotpo".',
    'Only use paths that appear in the evidence below. Never invent a path.',
    'A candidate may carry scope facts (e.g. {"seller": "MobileMonster"}, {"system": "yotpo"}).',
    '',
    '## Extraction results (paths the pipeline already used)',
    JSON.stringify(evidence.fieldResults, null, 2),
    '## API bodies (dot-paths resolve against these)',
    JSON.stringify(evidence.apiBodies).slice(0, 30_000),
    '## JSON-LD',
    JSON.stringify(evidence.jsonLdBlocks).slice(0, 10_000),
    '## Meta tags',
    JSON.stringify(evidence.meta),
  ].join('\n');
}

/**
 * Fabricated paths are rejected MECHANICALLY, before anything is written —
 * the same "never cache an unverified answer" rule the pagination work
 * established. A path is real if it resolves against a provided API body,
 * or is verbatim one the extraction itself used.
 */
export function parseCatalogueResponse(toolInput: unknown, evidence: CatalogueEvidence): CandidateCatalogue {
  const clean = sanitizeCatalogue(toolInput);
  const knownPaths = new Set(evidence.fieldResults.map((f) => f.path));
  const out: CandidateCatalogue = {};
  for (const [concept, candidates] of Object.entries(clean)) {
    const kept = candidates
      .filter((c) => {
        if (knownPaths.has(c.path)) return true;
        return evidence.apiBodies.some((body) => {
          const v = getByDotPath(body, c.path);
          return v !== undefined && v !== null;
        });
      })
      // `displayed`/`verifiedAt` are set only by displayed-verification
      // (`markDisplayed`), never by discovery — a tool response that names
      // them (a hallucinated or replayed field) must not mint them here, even
      // though `sanitizeCatalogue` itself stays permissive about carrying
      // them through for its OTHER caller (DB reads via `markDisplayed`'s
      // legitimate flags flowing through `lookupDomainCache`).
      .map(({ displayed: _displayed, verifiedAt: _verifiedAt, ...rest }) => rest);
    if (kept.length > 0) out[concept] = kept;
  }
  return out;
}

/**
 * Input schema kept permissive — {@link parseCatalogueResponse} (via
 * sanitizeCatalogue and fabricated-path rejection) is the real gate, not this
 * schema.
 */
const recordCatalogueTool = {
  name: 'record_catalogue',
  description:
    'Record the candidate catalogue for this product page: for each concept (e.g. price, rating, ' +
    'review_count, image), list the candidate paths that yield a value for it, each labelled by meaning.',
  input_schema: {
    type: 'object' as const,
    properties: {},
    additionalProperties: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string', description: 'Short distinctive label within the concept, e.g. "list", "displayed", "yotpo".' },
          source: { type: 'string', description: 'Same vocabulary as field extraction sources: api, json-ld, meta, xpath.' },
          path: { type: 'string', description: 'Dot-path (for api/json-ld/meta) or XPath (for xpath) — must appear in the evidence provided.' },
          sampleValue: { description: 'The value observed at this path when the catalogue was built.' },
          scope: { type: 'object', description: 'Optional scope facts that make the value interpretable, e.g. {"seller": "MobileMonster"}.' },
        },
        required: ['label', 'source', 'path', 'sampleValue'],
      },
    },
  },
};

/**
 * Thin Anthropic tool-use wrapper around the two pure functions above.
 * Discovery must never fail an extraction: any API error is logged and
 * swallowed, returning an empty catalogue.
 */
export async function discoverCandidateCatalogue(
  evidence: CatalogueEvidence,
  opts: { apiKey: string; model?: string },
): Promise<CandidateCatalogue> {
  try {
    const provider = new AnthropicProvider(opts.apiKey, opts.model);
    const toolInput = await provider.callWithTool({
      system: 'You catalogue what a product page can yield, per concept, from the evidence you are given.',
      tool: recordCatalogueTool,
      userText: buildCataloguePrompt(evidence),
    });
    return parseCatalogueResponse(toolInput, evidence);
  } catch (err) {
    console.error('[catalogue-discovery] discoverCandidateCatalogue failed:', err);
    return {};
  }
}
