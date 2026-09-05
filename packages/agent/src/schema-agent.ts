import Anthropic from '@anthropic-ai/sdk';
import type { PageCapture } from '@robot/browser';
import { AnthropicProvider } from './providers/anthropic.js';
import { OllamaProvider } from './providers/ollama.js';
import { cleanHtml, focusWindow } from './focus-html.js';
import { discoverSchemaTool, generateSelectorsTool, extractFromApiTool, validateExtractionTool, detectPaginationTool, extractVariantsTool, locateResultsTool, proposePathsTool } from './tools.js';
import { parsePathProposals, PROPOSE_PATHS_SYSTEM, type PathProposal } from './propose-paths.js';
import {
  SCHEMA_DISCOVERY_SYSTEM,
  SELECTOR_GENERATION_SYSTEM,
  API_EXTRACTION_SYSTEM,
  VALIDATION_SYSTEM,
  PAGINATION_DETECTION_SYSTEM,
  EXTRACT_VARIANTS_SYSTEM,
  schemaDiscoveryUserContent,
  selectorGenerationUserContent,
  selectorRetryUserContent,
  apiExtractionUserContent,
  validationUserContent,
  paginationDetectionUserContent,
} from './prompts.js';
import type {
  DiscoveredSchema,
  ExtractionPlan,
  ApiExtractionResult,
  ValidationResult,
  SchemaField,
  RetryFeedback,
  PaginationDetectionResult,
  Variant,
} from './types.js';

export type AgentProvider = 'anthropic' | 'ollama';

export type SchemaAgentOptions = {
  provider?: AgentProvider;
  apiKey?: string;
  model?: string;
  ollamaBaseUrl?: string;
};

export class SchemaAgent {
  private anthropic?: AnthropicProvider;
  private ollama?: OllamaProvider;
  private providerName: AgentProvider;

  constructor(options?: SchemaAgentOptions) {
    this.providerName = options?.provider ?? (process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'ollama');

    if (this.providerName === 'anthropic') {
      const apiKey = options?.apiKey ?? process.env.ANTHROPIC_API_KEY;
      if (!apiKey) throw new Error('ANTHROPIC_API_KEY is required for anthropic provider');
      this.anthropic = new AnthropicProvider(apiKey, options?.model);
    } else {
      this.ollama = new OllamaProvider(
        options?.ollamaBaseUrl ?? process.env.OLLAMA_BASE_URL,
        options?.model ?? process.env.OLLAMA_MODEL,
      );
    }
  }

  async discoverSchema(capture: PageCapture, requestedFields?: SchemaField[]): Promise<DiscoveredSchema> {
    // Prepare intercepted API responses for the prompt (deduplicated, product-like APIs only)
    const seen = new Set<string>();
    const interceptedApis: Array<{ url: string; json: string }> = [];
    for (const req of capture.interceptedRequests) {
      if (!req.responseBody || seen.has(req.url)) continue;
      seen.add(req.url);
      const urlLower = req.url.toLowerCase();
      if (urlLower.includes('translation') || urlLower.includes('localisation')
        || urlLower.includes('config') || urlLower.includes('analytics')
        || urlLower.includes('tracking') || urlLower.includes('feature-flag')) continue;
      interceptedApis.push({ url: req.url, json: req.responseBody });
    }

    const userText = schemaDiscoveryUserContent(
      capture.markdown,
      capture.structuredData,
      requestedFields?.map(f => ({ name: f.name, type: f.type, description: f.description })),
      interceptedApis.length > 0 ? interceptedApis : undefined,
    );

    if (this.anthropic) {
      const result = await this.anthropic.callWithTool({
        system: SCHEMA_DISCOVERY_SYSTEM,
        tool: discoverSchemaTool,
        userText,
        image: capture.screenshot,
      });
      return assertDiscoveredSchema(result, capture.url);
    }

    const json = await this.ollama!.callWithJson({
      system: SCHEMA_DISCOVERY_SYSTEM + '\n\nYou MUST respond with valid JSON only.',
      userText: ollamaSchemaPrompt(capture.markdown),
      image: capture.screenshot,
    }) as Record<string, unknown>;

    return normalizeSchemaResponse(json);
  }

  /**
   * Ask the screenshot where the repeating results start.
   *
   * Costs one cheap vision call and repays it immediately: without an anchor the
   * HTML slice is taken from the top of the document, and on a real category page
   * the first product tile sat 681,000 characters in — so the model was shown the
   * header and the nav and answered "link to this item" with the privacy policy.
   * Returns the landmark text, or null when the page shows no repeating results.
   */
  async locateResults(capture: PageCapture, image?: Buffer): Promise<string | null> {
    if (!this.anthropic) return null; // Vision-only; Ollama has no callWithTool.
    try {
      const result = (await this.anthropic.callWithTool({
        system: 'You locate the repeating results on a listing page by LOOKING at the screenshot.',
        tool: locateResultsTool,
        userText: 'Where do the repeating results begin on this page?',
        image: image ?? capture.screenshot,
        maxTokens: 512,
      })) as { has_results?: boolean; landmark_text?: string; first_result_text?: string };

      if (!result.has_results) return null;
      const landmark = (result.landmark_text ?? '').trim() || (result.first_result_text ?? '').trim();
      return landmark.length >= 3 ? landmark : null;
    } catch (err) {
      // An anchor is an optimisation; failing to get one must never fail the run.
      console.error('[agent] locateResults failed (non-fatal):', err);
      return null;
    }
  }

  async generateSelectors(capture: PageCapture, fields: SchemaField[], pageType?: string, image?: Buffer): Promise<ExtractionPlan> {
    // Listing pages are where the window matters: a detail page's content is near
    // the top, a results grid can be most of a megabyte down.
    const landmark = pageType === 'listing' ? await this.locateResults(capture, image) : null;
    if (landmark) console.log(`[agent] results landmark: "${landmark}"`);
    const html = truncateHtml(capture.html, this.anthropic ? 50000 : 30000, landmark ?? undefined);
    const fieldSummary = fields.map(f => ({ name: f.name, type: f.type, tier: f.tier }));
    const userText = selectorGenerationUserContent(html, fieldSummary, pageType);

    if (this.anthropic) {
      const result = await this.anthropic.callWithTool({
        system: SELECTOR_GENERATION_SYSTEM,
        tool: generateSelectorsTool,
        userText,
        image: image ?? capture.screenshot,
      });
      return result as ExtractionPlan;
    }

    const json = await this.ollama!.callWithJson({
      system: SELECTOR_GENERATION_SYSTEM + '\n\nYou MUST respond with valid JSON only. Return XPath expressions, NOT data values.',
      userText: ollamaSelectorPrompt(html, fieldSummary),
    }) as Record<string, unknown>;

    return normalizeSelectorResponse(json);
  }

  /**
   * AI fallback for variant_array fields. Called when JSON-LD ProductGroup is
   * absent and the variants cache misses. Returns variants[] + an opaque
   * path_hint that gets persisted to domainIntelligence for next-run cache.
   */
  async extractVariants(
    capture: PageCapture,
    screenshot: Buffer,
  ): Promise<{ variants: Variant[]; path_hint: string }> {
    const nextDataRaw = capture.structuredData.nextData
      ? JSON.stringify(capture.structuredData.nextData)
      : '';
    const nextData = nextDataRaw.length > 50_000
      ? nextDataRaw.slice(0, 50_000) + '...[truncated]'
      : nextDataRaw;

    const userText = nextData
      ? `Page nextData blob (truncated to 50KB if longer):\n${nextData}`
      : `No __NEXT_DATA__ blob on this page — rely on the screenshot.`;

    try {
      if (!this.anthropic) {
        // AI variants fallback is Anthropic-first; Ollama provider does not
        // support callWithTool. Return empty so callers fall through gracefully.
        return { variants: [], path_hint: '' };
      }
      const input = (await this.anthropic.callWithTool({
        system: EXTRACT_VARIANTS_SYSTEM,
        tool: extractVariantsTool,
        userText,
        image: screenshot,
        maxTokens: 4096,
      })) as { variants?: unknown; path_hint?: unknown };

      const variants = Array.isArray(input.variants) ? (input.variants as Variant[]) : [];
      const path_hint = typeof input.path_hint === 'string' ? input.path_hint : '';
      return { variants, path_hint };
    } catch (err) {
      console.error('[extractVariants] error:', err);
      return { variants: [], path_hint: '' };
    }
  }

  async retrySelectorGeneration(
    capture: PageCapture,
    fields: SchemaField[],
    pageType: string,
    feedback: RetryFeedback,
    image?: Buffer,
  ): Promise<ExtractionPlan> {
    const html = truncateHtml(capture.html, this.anthropic ? 50000 : 30000);
    const fieldSummary = fields.map(f => ({ name: f.name, type: f.type }));
    const userText = selectorRetryUserContent(html, fieldSummary, feedback, pageType);

    if (this.anthropic) {
      const result = await this.anthropic.callWithTool({
        system: SELECTOR_GENERATION_SYSTEM,
        tool: generateSelectorsTool,
        userText,
        image: image ?? capture.screenshot,
      });
      return result as ExtractionPlan;
    }

    const json = await this.ollama!.callWithJson({
      system: SELECTOR_GENERATION_SYSTEM + '\n\nYou MUST respond with valid JSON only. Return XPath expressions, NOT data values.',
      userText,
    }) as Record<string, unknown>;

    return normalizeSelectorResponse(json);
  }

  async detectPagination(html: string): Promise<PaginationDetectionResult> {
    const truncated = truncateHtml(html, this.anthropic ? 50000 : 30000);
    const userText = paginationDetectionUserContent(truncated);

    if (this.anthropic) {
      const result = await this.anthropic.callWithTool({
        system: PAGINATION_DETECTION_SYSTEM,
        tool: detectPaginationTool,
        userText,
      });
      return result as PaginationDetectionResult;
    }

    const json = await this.ollama!.callWithJson({
      system: PAGINATION_DETECTION_SYSTEM + '\n\nYou MUST respond with valid JSON only.',
      userText,
    }) as Record<string, unknown>;

    return {
      has_pagination: Boolean(json.has_pagination ?? false),
      strategy: (json.strategy as PaginationDetectionResult['strategy']) ?? 'none',
      url_template: json.url_template as string | undefined,
      next_selector: json.next_selector as string | undefined,
      page_selector: json.page_selector as string | undefined,
    };
  }

  /**
   * Use AI to extract field values from a raw API JSON response.
   * This handles complex/unknown API structures that mechanical flattening can't parse.
   */
  async extractFromApi(
    apiJson: string,
    apiUrl: string,
    fields: SchemaField[],
  ): Promise<ApiExtractionResult> {
    // Truncate API JSON to fit in context
    const truncated = apiJson.length > 30000 ? apiJson.slice(0, 30000) + '\n... (truncated)' : apiJson;
    const fieldSummary = fields.map(f => ({ name: f.name, type: f.type, tier: f.tier }));
    const userText = apiExtractionUserContent(truncated, fieldSummary, apiUrl);

    if (this.anthropic) {
      const result = await this.anthropic.callWithTool({
        system: API_EXTRACTION_SYSTEM,
        tool: extractFromApiTool,
        userText,
      });
      return result as ApiExtractionResult;
    }

    // Ollama fallback — JSON mode
    const json = await this.ollama!.callWithJson({
      system: API_EXTRACTION_SYSTEM + '\n\nYou MUST respond with valid JSON only.',
      userText,
    }) as Record<string, unknown>;

    const rawFields = (json.fields ?? json.data ?? []) as Array<Record<string, unknown>>;
    return {
      fields: rawFields.map(f => ({
        name: String(f.name ?? ''),
        value: f.value ?? null,
        json_path: String(f.json_path ?? f.path ?? ''),
        confidence: Number(f.confidence ?? 0),
      })),
    };
  }

  async proposePaths(userText: string): Promise<PathProposal[]> {
    if (!this.anthropic) return []; // tool calls only; Ollama has no callWithTool
    const result = await this.anthropic.callWithTool({
      system: PROPOSE_PATHS_SYSTEM,
      tool: proposePathsTool,
      userText,
      maxTokens: 2048,
    });
    return parsePathProposals(result);
  }

  async validateExtraction(
    capture: PageCapture,
    extractedData: Record<string, unknown>[],
  ): Promise<ValidationResult> {
    const userText = validationUserContent(extractedData);

    if (this.anthropic) {
      const result = await this.anthropic.callWithTool({
        system: VALIDATION_SYSTEM,
        tool: validateExtractionTool,
        userText,
        image: capture.screenshot,
        maxTokens: 2048,
      });
      return result as ValidationResult;
    }

    const json = await this.ollama!.callWithJson({
      system: VALIDATION_SYSTEM + '\n\nYou MUST respond with valid JSON only.',
      userText,
      image: capture.screenshot,
    }) as Record<string, unknown>;

    return {
      is_complete: (json.is_complete as boolean) ?? false,
      missing_items: (json.missing_items as string[]) ?? [],
      incorrect_values: (json.incorrect_values as ValidationResult['incorrect_values']) ?? [],
      confidence: (json.confidence as number) ?? 0,
    };
  }
}

// ─── Ollama-specific prompts ─────────────────────────────────────────────────

function ollamaSchemaPrompt(markdown: string): string {
  return `Analyze this web page and propose a data schema for the primary repeating data elements.

You MUST respond with a JSON object with these keys:
- "page_type": one of "listing", "detail", "search_results", "table", "other"
- "description": brief string
- "fields": array of objects with "name", "type", "description", "required", "example_value"

Example:
{"page_type":"listing","description":"Product listing","fields":[{"name":"title","type":"string","description":"Product title","required":true,"example_value":"iPhone 15"}]}

The "fields" array MUST contain at least 2 fields.

Page content (markdown):

${markdown}`;
}

function ollamaSelectorPrompt(html: string, fields: Array<{ name: string; type: string }>): string {
  const fieldList = fields.map(f => `- ${f.name} (${f.type})`).join('\n');
  return `Generate XPath expressions to extract these fields from each repeating item:

${fieldList}

Respond with JSON:
{"row_xpath":"//div[@class='product-card']","fields":[{"name":"title","xpath":".//h2","attribute":"textContent","transform":"trim"}]}

Do NOT extract data. Return ONLY XPath expressions.

HTML:

${html}`;
}

/**
 * Validate schema-discovery output before it leaves the agent.
 *
 * The Anthropic path used to `return result as DiscoveredSchema` — an unchecked
 * cast over whatever the model put in a tool call. On 2026-08-19 that produced a
 * Barnes & Noble run where `fields` was not an array, and the failure surfaced
 * three layers away as `analysis.schema.fields.map is not a function`, with no
 * indication of which page or model had misbehaved.
 *
 * Note the irony this fixes: the Ollama path has always normalised and thrown
 * descriptively, so the *fallback* provider was the safer one.
 *
 * Well-formed output passes through untouched. Anything else goes through the
 * same repair the Ollama path uses — which tolerates the model naming the array
 * `schema` or `columns` — and throws with the raw payload if that fails too.
 */
function assertDiscoveredSchema(result: unknown, url: string): DiscoveredSchema {
  const candidate = result as Partial<DiscoveredSchema> | null;
  if (candidate && Array.isArray(candidate.fields) && candidate.fields.length > 0) {
    return candidate as DiscoveredSchema;
  }
  if (!result || typeof result !== 'object') {
    throw new Error(`Schema discovery for ${url} returned ${typeof result}, not an object`);
  }
  try {
    return normalizeSchemaResponse(result as Record<string, unknown>);
  } catch (err) {
    throw new Error(
      `Schema discovery for ${url} returned no usable fields (${(err as Error).message})`,
    );
  }
}

// ─── Normalization helpers for Ollama ─────────────────────────────────────────

function normalizeSchemaResponse(json: Record<string, unknown>): DiscoveredSchema {
  const fields = normalizeFields(json.fields ?? json.schema ?? json.data_fields ?? json.columns ?? []);
  if (fields.length === 0) {
    throw new Error('Schema discovery returned no fields. Raw: ' + JSON.stringify(json).slice(0, 500));
  }
  return {
    page_type: (json.page_type as string ?? 'other') as DiscoveredSchema['page_type'],
    description: (json.description as string) ?? '',
    fields,
  };
}

function normalizeSelectorResponse(json: Record<string, unknown>): ExtractionPlan {
  const rowXpath = (json.row_xpath as string) ?? '';
  if (!rowXpath) {
    throw new Error('Selector generation returned no row_xpath. Raw: ' + JSON.stringify(json).slice(0, 500));
  }
  return {
    row_xpath: rowXpath,
    fields: normalizeSelectors(json.fields ?? json.selectors ?? []),
  };
}

function normalizeFields(raw: unknown): SchemaField[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((f: Record<string, unknown>) => ({
    name: String(f.name ?? f.field_name ?? ''),
    type: String(f.type ?? f.data_type ?? 'string') as SchemaField['type'],
    description: String(f.description ?? ''),
    required: Boolean(f.required ?? false),
    example_value: f.example_value != null ? String(f.example_value) : undefined,
  })).filter(f => f.name);
}

function normalizeSelectors(raw: unknown): ExtractionPlan['fields'] {
  if (!Array.isArray(raw)) return [];
  return raw.map((f: Record<string, unknown>) => ({
    name: String(f.name ?? f.field_name ?? ''),
    xpath: String(f.xpath ?? f.selector ?? f.css_selector ?? ''),
    attribute: String(f.attribute ?? 'textContent'),
    transform: String(f.transform ?? 'none') as 'none',
  })).filter(f => f.name && f.xpath);
}

/**
 * The slice of the page the model is shown.
 *
 * Was: the first `maxChars` characters. On a 790,000-character category page
 * that meant the header, the nav and the filter widgets — and not one product
 * tile, which started at character 681,000. The model dutifully answered "the
 * link to this item's page" with the site's privacy policy, because that was
 * what it could see. `focusWindow` finds the region the page's repeating content
 * actually lives in. `landmark` is text a vision pass read off the screenshot as
 * sitting just above the results — the most direct signal when it is available.
 */
function truncateHtml(html: string, maxChars: number, landmark?: string): string {
  const focused = focusWindow(cleanHtml(html), maxChars, { landmark });
  if (focused.index > 0) {
    console.log(`[agent] HTML window: ${focused.strategy} at ${focused.index} of ${html.length} chars`);
  }
  return focused.text;
}

