import Anthropic from '@anthropic-ai/sdk';
import type { Tool } from '@anthropic-ai/sdk/resources/messages';

export class AnthropicProvider {
  private client: Anthropic;
  private model: string;
  private maxRetries: number;

  constructor(apiKey: string, model?: string, maxRetries?: number) {
    this.client = new Anthropic({ apiKey });
    this.model = model ?? 'claude-sonnet-4-20250514';
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
          console.warn(`[anthropic] ${status} error, retrying in ${delay}ms (attempt ${attempt + 1}/${this.maxRetries})`);
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
