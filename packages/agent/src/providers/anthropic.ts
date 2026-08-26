import Anthropic from '@anthropic-ai/sdk';
import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import { EXTRACTION_MODEL } from '../models.js';
import { recordUsage } from '../usage.js';

export class AnthropicProvider {
  private client: Anthropic;
  private model: string;
  private maxRetries: number;

  constructor(apiKey: string, model?: string, maxRetries?: number) {
    this.client = new Anthropic({ apiKey });
    this.model = model ?? EXTRACTION_MODEL;
    this.maxRetries = maxRetries ?? 3;
  }

  async callWithTool(options: {
    system: string;
    tool: Tool;
    userText: string;
    image?: Buffer;
    maxTokens?: number;
  }): Promise<unknown> {
    const content: Anthropic.MessageCreateParams['messages'][0]['content'] = [];

    if (options.image) {
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: options.image.toString('base64'),
        },
      });
    }

    content.push({ type: 'text', text: options.userText });

    const params: Anthropic.MessageCreateParams = {
      model: this.model,
      max_tokens: options.maxTokens ?? 4096,
      system: options.system,
      tools: [options.tool],
      tool_choice: { type: 'tool', name: options.tool.name },
      messages: [{ role: 'user', content }],
    };

    // Retry with exponential backoff for transient errors (429, 529)
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.client.messages.create(params);
        recordUsage(this.model, response.usage);

        // A response cut off at max_tokens can still carry a tool_use block
        // whose input parses as {} — which reads as "the model answered
        // nothing" when the truth is "the answer did not fit". Newegg's
        // catalogue discovery failed exactly this way, three runs in a row,
        // with no symptom but an absence (2026-08-26). Truncation is an
        // error, never an empty answer.
        if (response.stop_reason === 'max_tokens') {
          throw new Error(
            `${options.tool.name} failed: response truncated at max_tokens=${params.max_tokens} — raise maxTokens or shrink the requested output`,
          );
        }

        const toolBlock = response.content.find(b => b.type === 'tool_use');
        if (!toolBlock || toolBlock.type !== 'tool_use') {
          throw new Error(`${options.tool.name} failed: no tool_use in response`);
        }

        return toolBlock.input;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const status = (err as { status?: number }).status;

        // Only retry on transient errors
        if (status === 429 || status === 529 || status === 503) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
          console.warn(`[anthropic] ${status} error, retrying in ${delay}ms (retry ${attempt + 1}/${this.maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        // Non-retryable error
        throw err;
      }
    }

    throw lastError ?? new Error('Max retries exceeded');
  }
}
