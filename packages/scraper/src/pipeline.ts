import { PlaywrightBrowser, checkPageHealth, type PageCapture, type BrowserOptions, type CaptureOptions } from '@robot/browser';
import { SchemaAgent, type AgentProvider, type DiscoveredSchema, type ExtractionPlan, type ValidationResult } from '@robot/agent';
import { buildExtractionScript, type ExecutorResult } from './executor.js';

export type PipelineOptions = {
  browserOptions?: BrowserOptions;
  captureOptions?: CaptureOptions;
  provider?: AgentProvider;
  apiKey?: string;
  model?: string;
  ollamaBaseUrl?: string;
  maxRefinements?: number;
  confidenceThreshold?: number;
};

export type PipelineResult = {
  schema: DiscoveredSchema;
  plan: ExtractionPlan;
  data: Record<string, unknown>[];
  validation: ValidationResult;
  capture: PageCapture;
};

export class ScraperPipeline {
  private browser: PlaywrightBrowser;
  private agent: SchemaAgent;
  private options: PipelineOptions;

  constructor(options: PipelineOptions = {}) {
    this.browser = new PlaywrightBrowser();
    this.agent = new SchemaAgent({
      provider: options.provider,
      apiKey: options.apiKey,
      model: options.model,
      ollamaBaseUrl: options.ollamaBaseUrl,
    });
    this.options = {
      ...options,
      maxRefinements: options.maxRefinements ?? 2,
      confidenceThreshold: options.confidenceThreshold ?? 0.8,
    };
  }

  async run(url: string): Promise<PipelineResult> {
    await this.browser.launch(this.options.browserOptions);

    try {
      const capture = await this.browser.capture(url, this.options.captureOptions);

      // Check page health before spending AI credits
      const health = checkPageHealth(capture.html, capture.title, url);
      if (!health.healthy) {
        throw new Error(`Page blocked or unhealthy: ${health.reason}`);
      }

      const schema = await this.agent.discoverSchema(capture);
      let plan = await this.agent.generateSelectors(capture, schema.fields, schema.page_type);
      plan.page_type = schema.page_type;
      let extractionResult = await this.extractWithPlan(url, plan);

      // If listing page returned very few rows, retry with a hint
      const isListing = ['listing', 'search_results', 'table'].includes(schema.page_type);
      if (isListing && extractionResult.data.length < 3) {
        console.warn(`[pipeline] Listing page returned only ${extractionResult.data.length} rows — retrying with stricter prompt`);
        plan = await this.agent.generateSelectors(capture, schema.fields, schema.page_type);
        plan.page_type = schema.page_type;
        const retry = await this.extractWithPlan(url, plan);
        if (retry.data.length > extractionResult.data.length) {
          extractionResult = retry;
        }
      }

      let validation = await this.agent.validateExtraction(capture, extractionResult.data);

      let refinements = 0;
      const maxRefinements = this.options.maxRefinements ?? 2;
      const threshold = this.options.confidenceThreshold ?? 0.8;

      while (validation.confidence < threshold && refinements < maxRefinements) {
        plan = await this.agent.generateSelectors(capture, schema.fields, schema.page_type);
        plan.page_type = schema.page_type;
        extractionResult = await this.extractWithPlan(url, plan);
        validation = await this.agent.validateExtraction(capture, extractionResult.data);
        refinements++;
      }

      return { schema, plan, data: extractionResult.data, validation, capture };
    } finally {
      await this.browser.close();
    }
  }

  private async extractWithPlan(url: string, plan: ExtractionPlan): Promise<ExecutorResult> {
    const script = buildExtractionScript(plan);
    return this.browser.evaluate<ExecutorResult>(url, script, this.options.captureOptions);
  }

  async close(): Promise<void> {
    await this.browser.close();
  }
}
