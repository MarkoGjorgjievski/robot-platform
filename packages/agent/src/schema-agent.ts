import Anthropic from '@anthropic-ai/sdk';
import type { PageCapture } from '@robot/browser';
import { AnthropicProvider } from './providers/anthropic.js';
import { OllamaProvider } from './providers/ollama.js';
import { discoverSchemaTool, generateSelectorsTool, extractFromApiTool, validateExtractionTool, detectPaginationTool } from './tools.js';
import {
  SCHEMA_DISCOVERY_SYSTEM,
  SELECTOR_GENERATION_SYSTEM,
  API_EXTRACTION_SYSTEM,
  VALIDATION_SYSTEM,
  PAGINATION_DETECTION_SYSTEM,
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
      return result as DiscoveredSchema;
    }

    const json = await this.ollama!.callWithJson({
      system: SCHEMA_DISCOVERY_SYSTEM + '\n\nYou MUST respond with valid JSON only.',
      userText: ollamaSchemaPrompt(capture.markdown),
      image: capture.screenshot,
    }) as Record<string, unknown>;

    return normalizeSchemaResponse(json);
  }

  async generateSelectors(capture: PageCapture, fields: SchemaField[], pageType?: string): Promise<ExtractionPlan> {
    const html = truncateHtml(capture.html, this.anthropic ? 50000 : 30000);
    const fieldSummary = fields.map(f => ({ name: f.name, type: f.type, tier: f.tier }));
    const userText = selectorGenerationUserContent(html, fieldSummary, pageType);

    if (this.anthropic) {
      const result = await this.anthropic.callWithTool({
        system: SELECTOR_GENERATION_SYSTEM,
        tool: generateSelectorsTool,
        userText,
        image: capture.screenshot,
      });
      return result as ExtractionPlan;
    }

    const json = await this.ollama!.callWithJson({
      system: SELECTOR_GENERATION_SYSTEM + '\n\nYou MUST respond with valid JSON only. Return XPath expressions, NOT data values.',
      userText: ollamaSelectorPrompt(html, fieldSummary),
    }) as Record<string, unknown>;

    return normalizeSelectorResponse(json);
  }

  async retrySelectorGeneration(
    capture: PageCapture,
    fields: SchemaField[],
    pageType: string,
    feedback: RetryFeedback,
  ): Promise<ExtractionPlan> {
    const html = truncateHtml(capture.html, this.anthropic ? 50000 : 30000);
    const fieldSummary = fields.map(f => ({ name: f.name, type: f.type }));
    const userText = selectorRetryUserContent(html, fieldSummary, feedback, pageType);

    if (this.anthropic) {
      const result = await this.anthropic.callWithTool({
        system: SELECTOR_GENERATION_SYSTEM,
        tool: generateSelectorsTool,
        userText,
        image: capture.screenshot,
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

function truncateHtml(html: string, maxChars: number): string {
  // Strip elements that waste tokens but never contain extractable data.
  // Conservative: only remove things we're certain are junk.
  // JSON-LD, meta tags, and structured data are already extracted separately.
  let cleaned = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '')
    .replace(/<link\b[^>]*\/?>/gi, '')
    .replace(/<meta\b[^>]*\/?>/gi, '')
    .replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, '')
    // Collapse whitespace
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (cleaned.length <= maxChars) return cleaned;
  const cutPoint = cleaned.lastIndexOf('>', maxChars);
  return cutPoint > 0 ? cleaned.slice(0, cutPoint + 1) : cleaned.slice(0, maxChars);
}
