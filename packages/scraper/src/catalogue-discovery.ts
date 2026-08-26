import { AnthropicProvider } from '@robot/agent';
import { sanitizeCatalogue, type CandidateCatalogue } from './candidate-catalogue.js';
import { getByDotPath } from './domain-cache.js';

export type CatalogueEvidence = {
  apiBodies: unknown[];
  jsonLdBlocks: unknown[];
  meta: Record<string, string>;
  fieldResults: Array<{ name: string; value: unknown; source: string; path: string }>;
};

/** Per-body and whole-section budgets for the API evidence (chars). One slice
 *  over ALL bodies cut Newegg's first 37KB body mid-JSON (2026-08-26) — the
 *  model was labelling broken evidence. Bodies are serialized individually,
 *  product-bearing ones first, and a body that cannot fit whole is dropped
 *  with a note rather than truncated into invalid JSON. */
const PER_BODY_CHAR_BUDGET = 12_000;
const API_SECTION_CHAR_BUDGET = 30_000;

export function buildCataloguePrompt(evidence: CatalogueEvidence): string {
  // Product-bearing bodies (ones the extraction's own api paths resolve
  // against) go first — they are the evidence the catalogue is FOR; widget
  // and telemetry bodies ride along only if budget remains.
  const apiPaths = evidence.fieldResults.filter((f) => f.source === 'api' || f.source === 'api-ai').map((f) => f.path);
  const ranked = [...evidence.apiBodies].sort((a, b) => {
    const hits = (body: unknown) => apiPaths.filter((p) => {
      const v = getByDotPath(body, p);
      return v !== undefined && v !== null;
    }).length;
    return hits(b) - hits(a);
  });

  const bodySections: string[] = [];
  let spent = 0;
  let dropped = 0;
  for (const body of ranked) {
    const serialized = JSON.stringify(body);
    if (serialized === undefined) continue;
    if (serialized.length > PER_BODY_CHAR_BUDGET || spent + serialized.length > API_SECTION_CHAR_BUDGET) {
      dropped++;
      continue;
    }
    bodySections.push(serialized);
    spent += serialized.length;
  }
  if (dropped > 0) bodySections.push(`(${dropped} additional response body/bodies omitted for size)`);

  return [
    'You are cataloguing what this product page CAN yield, per concept.',
    'Group value-bearing paths into concepts (snake_case singular: price, rating, review_count, image).',
    'Label each candidate by its meaning, never its path: "list", "range_min", "promo", "yotpo".',
    'Only use paths that appear in the evidence below. Never invent a path.',
    'A candidate may carry scope facts (e.g. {"seller": "MobileMonster"}, {"system": "yotpo"}).',
    'Keep every sampleValue short: truncate long text to at most ~100 characters.',
    'Include a candidate for every path listed under Extraction results that yields a real value —',
    'even when two paths express the same concept differently (different review systems, granularities,',
    'or phrasings): give each a label that says which one it is.',
    '',
    '## Extraction results (paths the pipeline already used)',
    JSON.stringify(evidence.fieldResults, null, 2),
    '## API bodies (dot-paths resolve against these; each line is one complete body)',
    ...bodySections,
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
/**
 * The tool asks for an ENVELOPE — { concepts: [{ concept, candidates }] } —
 * because a record with dynamic keys cannot be described by a JSON schema's
 * `properties`, and the 2026-08-26 dogfood proved the schemaless shape is
 * unstable: the model invented its own wrappers and every response sanitized
 * to {} in silence. The envelope is converted to the record shape here; a
 * bare record is still accepted as a defensive fallback.
 */
function unwrapEnvelope(toolInput: unknown): unknown {
  if (toolInput === null || typeof toolInput !== 'object' || Array.isArray(toolInput)) return toolInput;
  const concepts = (toolInput as Record<string, unknown>).concepts;
  if (!Array.isArray(concepts)) return toolInput;
  const record: Record<string, unknown> = {};
  for (const entry of concepts) {
    if (entry === null || typeof entry !== 'object') continue;
    const { concept, candidates } = entry as Record<string, unknown>;
    if (typeof concept !== 'string' || concept.length === 0 || !Array.isArray(candidates)) continue;
    record[concept] = candidates;
  }
  return record;
}

export function parseCatalogueResponse(toolInput: unknown, evidence: CatalogueEvidence): CandidateCatalogue {
  const clean = sanitizeCatalogue(unwrapEnvelope(toolInput));
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
 * An explicit envelope, not a record with dynamic keys: JSON schema cannot
 * name dynamic properties, and a `properties: {}` schema left the model free
 * to invent shapes (2026-08-26 dogfood: three runs, three silent empties).
 * `parseCatalogueResponse` (sanitize + fabricated-path rejection) remains the
 * real gate; this schema's job is only to make the SHAPE deterministic.
 */
const recordCatalogueTool = {
  name: 'record_catalogue',
  description:
    'Record the candidate catalogue for this product page: one entry per concept (e.g. price, rating, ' +
    'review_count, image), each listing the candidate paths that yield a value for it, labelled by meaning.',
  input_schema: {
    type: 'object' as const,
    properties: {
      concepts: {
        type: 'array',
        description: 'One entry per concept found on the page.',
        items: {
          type: 'object',
          properties: {
            concept: { type: 'string', description: 'Concept name, snake_case singular: "price", "rating", "review_count", "image".' },
            candidates: {
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
          required: ['concept', 'candidates'],
        },
      },
    },
    required: ['concepts'],
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
      // A rich page's catalogue (Newegg: 18 fields) overran the 4096 default
      // and the truncated tool_use parsed as {} — silently, before the
      // provider learned to throw on max_tokens (2026-08-26).
      maxTokens: 8192,
    });
    return parseCatalogueResponse(toolInput, evidence);
  } catch (err) {
    console.error('[catalogue-discovery] discoverCandidateCatalogue failed:', err);
    return {};
  }
}
